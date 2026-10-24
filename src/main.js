// The action's entry point. GitHub runs this file with Node; inputs
// arrive as INPUT_* variables and the event as a JSON file.
import { readFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseComplexMd } from './vendor/complexmd.js';
import { findTouched } from './findings.js';
import { renderComment, renderCleared } from './comment.js';
import { client, readFileAt, listFiles, commitsBehind, syncSticky } from './github.js';
import { runBounds } from './bounds.js';
import { input, boolInput } from './inputs.js';

const EVENTS = new Set(['pull_request_target', 'pull_request']);

/* Workflow command data: a line break or percent sign in a message would
   otherwise end the command or start a new one. */
export const escapeData = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

function setOutputs(env, outputs) {
  if (!env.GITHUB_OUTPUT) return;
  const lines = Object.entries(outputs).map(([k, v]) => `${k}=${String(v ?? '').replace(/[\r\n]+/g, ' ')}`);
  appendFileSync(env.GITHUB_OUTPUT, lines.join('\n') + '\n');
}

function summary(env, text) {
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, text + '\n');
}

export async function run({ env = process.env, fetch = globalThis.fetch, log = console.log } = {}) {
  const say = (level, msg) => log(`::${level}::${escapeData(msg)}`);
  try {
    const event = env.GITHUB_EVENT_NAME;
    if (!EVENTS.has(event)) {
      say('error', `complex-md-action runs on pull_request_target or pull_request, not on ${event}.`);
      return 1;
    }
    const wantComment = boolInput(env, 'comment', true);
    const wantImpact = boolInput(env, 'impact-strict', false);
    const wantVerify = boolInput(env, 'verify', false);
    if (event === 'pull_request_target' && (wantImpact || wantVerify)) {
      say('error', 'impact-strict and verify read the pull request\'s files. Run them in a pull_request job, never in pull_request_target.');
      return 1;
    }
    const payload = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
    const pr = payload.pull_request;
    if (!pr || !Number.isInteger(pr.number)) {
      say('error', 'The event carries no pull request.');
      return 1;
    }
    let code = 0;
    if (wantComment) code = Math.max(code, await comment({ env, fetch, say, event, pr }));
    if (wantImpact || wantVerify) {
      const gh = client({ token: input(env, 'github-token'), apiUrl: env.GITHUB_API_URL || 'https://api.github.com', fetch });
      code = Math.max(code, await runBounds({ env, gh, say, pr, wantImpact, wantVerify }));
    }
    return code;
  } catch (e) {
    say('error', `complex-md-action: ${e.message}`);
    return 1;
  }
}

async function comment({ env, fetch, say, event, pr }) {
  const repo = env.GITHUB_REPOSITORY;
  const mapPath = input(env, 'map-path', 'COMPLEX.md');
  const baseSha = pr.base?.sha;
  const gh = client({ token: input(env, 'github-token'), apiUrl: env.GITHUB_API_URL || 'https://api.github.com', fetch });
  const text = await readFileAt(gh, repo, mapPath, baseSha);
  if (text === null) {
    say('notice', `No ${mapPath} on the base branch at ${String(baseSha).slice(0, 7)}. Generate one with: npx complex-md`);
    setOutputs(env, { hotspots: 0, 'load-bearing': 0, partners: 0, comment: 'none', 'comment-url': '' });
    return 0;
  }
  const map = parseComplexMd(text);
  if (!map) {
    say('warning', `${mapPath} on the base branch has no front matter that complex-md reads. Regenerate it with: npx complex-md`);
    setOutputs(env, { hotspots: 0, 'load-bearing': 0, partners: 0, comment: 'none', 'comment-url': '' });
    return 0;
  }
  const files = await listFiles(gh, repo, pr.number);
  const f = findTouched(map, files);
  const truncated = Number.isInteger(pr.changed_files) && pr.changed_files > files.length ? files.length : null;
  const ctx = { baseSha, mapPath, front: map.front, truncated };
  let body = null;
  if (!f.clean) {
    ctx.behind = await commitsBehind(gh, repo, map.front.commit, baseSha);
    body = renderComment(f, ctx);
  }
  summary(env, body ?? `**COMPLEX.md**: this pull request touches no hotspot, load bearing file or co-change pair.`);
  const counts = { hotspots: f.hotspots.length, 'load-bearing': f.loadBearing.length, partners: f.partners.length };
  let result;
  try {
    result = await syncSticky(gh, repo, pr.number, { body, cleared: renderCleared({ baseSha, mapPath }) });
  } catch (e) {
    if (e.status !== 403) throw e;
    const msg = 'The token cannot write pull request comments. Grant pull-requests: write. On pull_request, a pull request from a fork gets a read only token; use pull_request_target for the comment.';
    setOutputs(env, { ...counts, comment: 'forbidden', 'comment-url': '' });
    if (event === 'pull_request_target') { say('error', msg); return 1; }
    say('warning', msg);
    return 0;
  }
  setOutputs(env, { ...counts, comment: result.action, 'comment-url': result.url ?? '' });
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().then((code) => { process.exitCode = code; });
}
