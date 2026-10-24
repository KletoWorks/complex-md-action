// The opt-in checks for a pull_request job: complex-md impact --strict on
// each changed file, and complex-md verify. These read the pull request's
// files, so they belong in a pull_request job with a read only token and
// never in pull_request_target. The CLI runs with process.execPath and an
// argument list, never through a shell, and with no token in its env.
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { readFileAt, listFiles } from './github.js';
import { fetchCli, CLI } from './cli.js';
import { code } from './comment.js';
import { intInput } from './inputs.js';

export const BOUNDS_PATH = '.complex-md/bounds.json';
export const DEFAULT_MAX_FILES = 25;
const TIMEOUT_MS = 300000;

/* The env the CLI runs with: the job's env minus inputs and anything that
   looks like a credential. impact and verify read files and git only. */
export function childEnv(env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    if (/^INPUT_/i.test(k) || /TOKEN|SECRET|PASSWORD|CREDENTIAL|_KEY$|_KEY_|^ACTIONS_/i.test(k)) continue;
    out[k] = v;
  }
  return out;
}

/* Changed files that exist in the checkout, in the API's order. A path
   that starts with a dash would read as a flag, and a path with a dot
   segment is not one GitHub sends; both are left out. */
export function impactTargets(ws, files, max) {
  const run = [];
  for (const f of files || []) {
    const p = f?.filename;
    if (typeof p !== 'string' || !p || f.status === 'removed') continue;
    if (p.startsWith('-') || p.split('/').some((s) => s === '..' || s === '.' || s === '')) continue;
    if (!existsSync(join(ws, p))) continue;
    if (!run.includes(p)) run.push(p);
  }
  return { run: run.slice(0, max), skipped: Math.max(0, run.length - max) };
}

/* Workflow command properties: a comma or colon would end the value. */
const escapeProperty = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A').replace(/:/g, '%3A').replace(/,/g, '%2C');

export async function runBounds({ env, gh, say, pr, wantImpact, wantVerify, getCli = null }) {
  const ws = env.GITHUB_WORKSPACE || process.cwd();
  if (!existsSync(join(ws, '.git'))) {
    say('error', 'impact-strict and verify need the pull request checked out. Add actions/checkout before this step.');
    return 1;
  }
  const bin = await (getCli || (() => fetchCli({ dir: join(env.RUNNER_TEMP || tmpdir(), `complex-md-cli-${CLI.version}`) })))();
  const cli = (args) => spawnSync(process.execPath, [bin, ...args], {
    cwd: ws, env: childEnv(env), encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, shell: false,
  });
  const summary = (text) => { if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, text + '\n'); };
  let status = 0;

  if (wantVerify) {
    const help = cli(['--help']);
    if (!/complex-md verify\b/.test(help.stdout || '')) {
      say('warning', `The pinned complex-md ${CLI.version} has no verify command, so verify checked nothing. It runs once the pinned CLI ships it.`);
    } else {
      const r = cli(['verify']);
      const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
      if (r.status === 0) summary(`**complex-md verify**: passed.\n\n${out ? '```\n' + out + '\n```' : ''}`);
      else {
        say('error', `complex-md verify exited ${r.status ?? r.signal}: ${out}`);
        summary(`**complex-md verify**: failed.\n\n\`\`\`\n${out}\n\`\`\``);
        status = 1;
      }
    }
  }

  if (wantImpact) status = Math.max(status, await impact({ env, gh, say, pr, ws, cli, summary }));
  return status;
}

async function impact({ env, gh, say, pr, ws, cli, summary }) {
  const repo = env.GITHUB_REPOSITORY;
  const files = await listFiles(gh, repo, pr.number);
  const prEditsBounds = files.some((f) => f?.filename === BOUNDS_PATH || f?.previous_filename === BOUNDS_PATH);
  const base = await readFileAt(gh, repo, BOUNDS_PATH, pr.base?.sha);
  if (base === null) {
    say('warning', `No ${BOUNDS_PATH} on the base branch, so impact-strict checked nothing.${prEditsBounds ? ' The bounds this pull request adds apply after merge.' : ' Declare bounds there to use it.'}`);
    return 0;
  }
  if (prEditsBounds) say('notice', `This pull request edits ${BOUNDS_PATH}. The check uses the base branch bounds; the new bounds apply after merge.`);

  const { run, skipped } = impactTargets(ws, files, intInput(env, 'impact-max-files', DEFAULT_MAX_FILES));
  const target = join(ws, BOUNDS_PATH);
  const saved = existsSync(target) ? readFileSync(target) : null;
  const dirExisted = existsSync(dirname(target));
  const results = [];
  let status = 0;
  try {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, base);
    for (const p of run) {
      const r = cli(['impact', p, '--strict', '--json']);
      if (r.status !== 0 && r.status !== 1) {
        say('error', `complex-md impact ${p} exited ${r.status ?? r.signal}: ${`${r.stderr || ''}${r.stdout || ''}`.trim()}`);
        status = 1;
        continue;
      }
      let a;
      try { a = JSON.parse(r.stdout); } catch {
        say('error', `complex-md impact ${p} printed no JSON.`);
        status = 1;
        continue;
      }
      results.push(a);
      if (a.status === 'over') {
        status = 1;
        const over = a.contributions.filter((c) => c.status === 'over').map((c) => `${c.name} ${c.value} is over its bound ${c.bound} by ${c.value - c.bound}`);
        say(`error file=${escapeProperty(p)}`, `Changing ${p} reaches past a declared bound: ${over.join('; ')}.`);
      }
    }
  } finally {
    if (saved === null) {
      rmSync(target, { force: true });
      if (!dirExisted) rmSync(dirname(target), { recursive: true, force: true });
    } else {
      writeFileSync(target, saved);
    }
  }
  if (skipped) say('notice', `${skipped} more changed files were not checked. Raise impact-max-files to check them.`);
  summary(renderImpact(results, skipped));
  return status;
}

export function renderImpact(results, skipped = 0) {
  const names = [];
  for (const a of results) for (const c of a.contributions || []) if (c.bound !== null && c.bound !== undefined && !names.includes(c.name)) names.push(c.name);
  const out = ['**complex-md impact --strict** against the base branch bounds', ''];
  if (!results.length) return [...out, 'No changed file to check.'].join('\n');
  out.push(`| File | ${names.join(' | ')} | Result |`, `|---|${names.map(() => '--:').join('|')}|---|`);
  for (const a of results) {
    const cells = names.map((n) => {
      const c = (a.contributions || []).find((x) => x.name === n);
      return c ? `${c.value} / ${c.bound}` : '';
    });
    out.push(`| ${code(a.path)} | ${cells.join(' | ')} | ${a.status} |`);
  }
  if (skipped) out.push('', `${skipped} more changed files were not checked.`);
  return out.join('\n');
}
