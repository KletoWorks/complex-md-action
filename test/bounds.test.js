import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeGitHub } from './helpers.js';
import { client } from '../src/github.js';
import { runBounds, childEnv, impactTargets } from '../src/bounds.js';

/* A stand in for the CLI. impact reads the bounds file in its working
   directory and a reach table the test writes, and prints what the real
   CLI prints with --json. Each call is logged with the env keys it saw. */
const STUB = `
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync('calls.log', JSON.stringify({ args, envKeys: Object.keys(process.env), bounds: existsSync('.complex-md/bounds.json') ? readFileSync('.complex-md/bounds.json', 'utf8') : null, map: existsSync('COMPLEX.md') ? readFileSync('COMPLEX.md', 'utf8') : null }) + '\\n');
if (args[0] === '--help') { console.log(existsSync('has-verify') ? 'npx complex-md verify   drift check' : 'npx complex-md impact <path>'); process.exit(0); }
if (args[0] === 'verify') { const bad = existsSync('verify-fails'); console.log(bad ? 'map is stale' : 'map is fresh'); process.exit(bad ? 1 : 0); }
if (args[0] === 'impact') {
  let bounds;
  try { bounds = JSON.parse(readFileSync('.complex-md/bounds.json', 'utf8')); } catch { console.error('not readable JSON'); process.exit(2); }
  const reach = JSON.parse(readFileSync('reach.json', 'utf8'))[args[1]] ?? 0;
  const over = reach > bounds.reach;
  console.log(JSON.stringify({ path: args[1], covered: true, contributions: [
    { name: 'reach', value: reach, bound: bounds.reach, status: over ? 'over' : 'within', margin: bounds.reach - reach },
    { name: 'direct', value: 1, bound: null, status: 'unbounded' },
  ], status: over ? 'over' : 'within', over: over ? ['reach'] : [] }));
  process.exit(over && args.includes('--strict') ? 1 : 0);
}
process.exit(9);
`;

const BASE = 'bace000000000000000000000000000000000001';

function setup({ files, baseBounds = '{"reach": 5}', headBounds, baseMap = null, headMap, reach = {}, verify = false, verifyFails = false, inputs = {} }) {
  const ws = mkdtempSync(join(tmpdir(), 'cmda-ws-'));
  mkdirSync(join(ws, '.git'));
  const bin = join(ws, '..', `stub-${process.hrtime.bigint()}.mjs`);
  writeFileSync(bin, STUB);
  writeFileSync(join(ws, 'reach.json'), JSON.stringify(reach));
  if (verify) writeFileSync(join(ws, 'has-verify'), '');
  if (verifyFails) writeFileSync(join(ws, 'verify-fails'), '');
  for (const f of files) {
    if (f.status === 'removed') continue;
    mkdirSync(join(ws, f.filename, '..'), { recursive: true });
    writeFileSync(join(ws, f.filename), 'x');
  }
  if (headBounds !== undefined) {
    mkdirSync(join(ws, '.complex-md'), { recursive: true });
    writeFileSync(join(ws, '.complex-md/bounds.json'), headBounds);
  }
  if (headMap !== undefined) writeFileSync(join(ws, 'COMPLEX.md'), headMap);
  const fake = fakeGitHub({
    'GET /repos/acme/app/pulls/7/files': () => ({ body: files }),
    'GET /repos/acme/app/contents/COMPLEX.md': ({ query }) => (baseMap === null || query.ref !== BASE ? { status: 404, body: {} } : { body: baseMap }),
    'GET /repos/acme/app/contents/.complex-md/bounds.json': ({ query }) => (baseBounds === null || query.ref !== BASE ? { status: 404, body: {} } : { body: baseBounds }),
  });
  const logs = [];
  const summaryPath = join(ws, '..', `summary-${process.hrtime.bigint()}`);
  const env = {
    GITHUB_WORKSPACE: ws, GITHUB_REPOSITORY: 'acme/app', GITHUB_STEP_SUMMARY: summaryPath,
    GITHUB_TOKEN: 'secret', 'INPUT_GITHUB-TOKEN': 'secret', ACTIONS_RUNTIME_TOKEN: 'secret', PATH: process.env.PATH, HOME: process.env.HOME,
  };
  for (const [k, v] of Object.entries(inputs)) env[`INPUT_${k.toUpperCase()}`] = v;
  const ctx = {
    env,
    gh: client({ token: 'secret', apiUrl: 'https://api.example.test', fetch: fake.fetch }),
    say: (level, msg) => logs.push(`${level}: ${msg}`),
    pr: { number: 7, base: { sha: BASE } },
    getCli: async () => bin,
  };
  const calls = () => (existsSync(join(ws, 'calls.log')) ? readFileSync(join(ws, 'calls.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
  const summary = () => (existsSync(summaryPath) ? readFileSync(summaryPath, 'utf8') : '');
  return { ws, ctx, logs, calls, summary };
}

const mod = (filename, status = 'modified') => ({ filename, status });

test('every changed file within its bounds passes', async () => {
  const s = setup({ files: [mod('lib/a.js'), mod('lib/b.js')], reach: { 'lib/a.js': 2, 'lib/b.js': 5 } });
  assert.equal(await runBounds({ ...s.ctx, wantImpact: true, wantVerify: false }), 0);
  const impact = s.calls().filter((c) => c.args[0] === 'impact');
  assert.deepEqual(impact.map((c) => c.args), [['impact', 'lib/a.js', '--strict', '--json'], ['impact', 'lib/b.js', '--strict', '--json']]);
  assert.match(s.summary(), /\| `lib\/a\.js` \| 2 \/ 5 \| within \|/);
});

test('a file over a bound fails the job and is annotated', async () => {
  const s = setup({ files: [mod('lib/a.js'), mod('lib/big.js')], reach: { 'lib/big.js': 9 } });
  assert.equal(await runBounds({ ...s.ctx, wantImpact: true, wantVerify: false }), 1);
  assert.ok(s.logs.some((l) => l.startsWith('error file=lib/big.js: ') && l.includes('reach 9 is over its bound 5 by 4')));
  assert.match(s.summary(), /\| `lib\/big\.js` \| 9 \/ 5 \| over \|/);
});

test('the base branch bounds apply, and the pull request copy is restored after', async () => {
  const s = setup({ files: [mod('lib/big.js'), mod('.complex-md/bounds.json')], headBounds: '{"reach": 100}', reach: { 'lib/big.js': 9 } });
  assert.equal(await runBounds({ ...s.ctx, wantImpact: true, wantVerify: false }), 1);
  assert.ok(s.calls().filter((c) => c.args[0] === 'impact').every((c) => c.bounds === '{"reach": 5}'));
  assert.equal(readFileSync(join(s.ws, '.complex-md/bounds.json'), 'utf8'), '{"reach": 100}');
  assert.ok(s.logs.some((l) => l.startsWith('notice: ') && l.includes('apply after merge')));
});

test('the base branch map applies, and the pull request copy is restored after', async () => {
  const s = setup({ files: [mod('lib/a.js'), mod('COMPLEX.md')], baseMap: 'base map', headMap: 'pr map' });
  assert.equal(await runBounds({ ...s.ctx, wantImpact: true, wantVerify: false }), 0);
  const impact = s.calls().filter((c) => c.args[0] === 'impact');
  assert.deepEqual(impact.map((c) => c.args[1]), ['lib/a.js', 'COMPLEX.md']);
  assert.ok(impact.every((c) => c.map === 'base map'));
  assert.equal(readFileSync(join(s.ws, 'COMPLEX.md'), 'utf8'), 'pr map');
  assert.ok(s.logs.some((l) => l.startsWith('notice: ') && l.includes('edits COMPLEX.md')));
});

test('a map that only the pull request adds is set aside during the check', async () => {
  const s = setup({ files: [mod('lib/a.js'), mod('COMPLEX.md', 'added')], headMap: 'pr map' });
  assert.equal(await runBounds({ ...s.ctx, wantImpact: true, wantVerify: false }), 0);
  assert.ok(s.calls().filter((c) => c.args[0] === 'impact').every((c) => c.map === null));
  assert.equal(readFileSync(join(s.ws, 'COMPLEX.md'), 'utf8'), 'pr map');
});

test('a map that is a symlink is refused', async () => {
  const { symlinkSync } = await import('node:fs');
  const s = setup({ files: [mod('lib/a.js')], baseMap: 'base map' });
  const outside = mkdtempSync(join(tmpdir(), 'cmda-outside-'));
  writeFileSync(join(outside, 'victim'), 'keep');
  symlinkSync(join(outside, 'victim'), join(s.ws, 'COMPLEX.md'));
  assert.equal(await runBounds({ ...s.ctx, wantImpact: true, wantVerify: false }), 1);
  assert.ok(s.logs.some((l) => l.startsWith('error: ') && l.includes('COMPLEX.md is a symlink')));
  assert.equal(readFileSync(join(outside, 'victim'), 'utf8'), 'keep');
  assert.equal(s.calls().filter((c) => c.args[0] === 'impact').length, 0);
});

test('a base branch with no bounds file checks nothing and says so', async () => {
  const s = setup({ files: [mod('lib/a.js')], baseBounds: null });
  assert.equal(await runBounds({ ...s.ctx, wantImpact: true, wantVerify: false }), 0);
  assert.equal(s.calls().filter((c) => c.args[0] === 'impact').length, 0);
  assert.ok(s.logs.some((l) => l.startsWith('warning: ') && l.includes('No .complex-md/bounds.json on the base branch')));
  assert.equal(existsSync(join(s.ws, '.complex-md/bounds.json')), false);
});

test('an unreadable bounds file fails the job', async () => {
  const s = setup({ files: [mod('lib/a.js')], baseBounds: '{not json' });
  assert.equal(await runBounds({ ...s.ctx, wantImpact: true, wantVerify: false }), 1);
  assert.ok(s.logs.some((l) => l.startsWith('error: ') && l.includes('exited 2')));
  assert.equal(existsSync(join(s.ws, '.complex-md')), false);
});

test('deleted files and paths that look like flags are not run', () => {
  const ws = mkdtempSync(join(tmpdir(), 'cmda-ws-'));
  writeFileSync(join(ws, 'a.js'), 'x');
  writeFileSync(join(ws, '-rf'), 'x');
  const r = impactTargets(ws, [mod('a.js'), mod('gone.js', 'removed'), mod('-rf'), mod('../x.js'), { filename: 'new.js', previous_filename: 'a.js', status: 'renamed' }], 25);
  assert.deepEqual(r, { run: ['a.js'], skipped: 0 });
});

test('the file count is capped by impact-max-files', async () => {
  const files = Array.from({ length: 4 }, (_, i) => mod(`lib/f${i}.js`));
  const s = setup({ files, inputs: { 'impact-max-files': '2' } });
  assert.equal(await runBounds({ ...s.ctx, wantImpact: true, wantVerify: false }), 0);
  assert.equal(s.calls().filter((c) => c.args[0] === 'impact').length, 2);
  assert.ok(s.logs.some((l) => l.includes('2 more changed files were not checked')));
});

test('the CLI never sees a token', async () => {
  const s = setup({ files: [mod('lib/a.js')] });
  await runBounds({ ...s.ctx, wantImpact: true, wantVerify: false });
  for (const c of s.calls()) {
    assert.equal(c.envKeys.some((k) => /TOKEN|^INPUT_/i.test(k)), false, c.envKeys.join(','));
  }
  assert.deepEqual(Object.keys(childEnv({ PATH: '/bin', GITHUB_TOKEN: 'x', NPM_TOKEN: 'y', AWS_SECRET_ACCESS_KEY: 'z', INPUT_X: 'w', HOME: '/h' })).sort(), ['HOME', 'PATH']);
});

test('verify is skipped with a warning when the pinned CLI has no verify command', async () => {
  const s = setup({ files: [mod('lib/a.js')] });
  assert.equal(await runBounds({ ...s.ctx, wantImpact: false, wantVerify: true }), 0);
  assert.equal(s.calls().some((c) => c.args[0] === 'verify'), false);
  assert.ok(s.logs.some((l) => l.startsWith('warning: ') && l.includes('has no verify command')));
});

test('verify runs when the CLI has it, and its failure fails the job', async () => {
  const ok = setup({ files: [mod('lib/a.js')], verify: true });
  assert.equal(await runBounds({ ...ok.ctx, wantImpact: false, wantVerify: true }), 0);
  assert.ok(ok.calls().some((c) => c.args[0] === 'verify'));
  const bad = setup({ files: [mod('lib/a.js')], verify: true, verifyFails: true });
  assert.equal(await runBounds({ ...bad.ctx, wantImpact: false, wantVerify: true }), 1);
  assert.ok(bad.logs.some((l) => l.startsWith('error: ') && l.includes('map is stale')));
});

test('a workspace with no checkout is an error', async () => {
  const s = setup({ files: [mod('lib/a.js')] });
  s.ctx.env.GITHUB_WORKSPACE = mkdtempSync(join(tmpdir(), 'cmda-empty-'));
  assert.equal(await runBounds({ ...s.ctx, wantImpact: true, wantVerify: false }), 1);
  assert.ok(s.logs.some((l) => l.includes('actions/checkout')));
});

test('a bounds path that is a symlink is refused and nothing is written through it', async () => {
  const { symlinkSync, mkdtempSync: mk } = await import('node:fs');
  for (const kind of ['dir', 'file']) {
    const s = setup({ files: [mod('lib/a.js')] });
    const outside = mk(join(tmpdir(), 'cmda-outside-'));
    if (kind === 'dir') symlinkSync(outside, join(s.ws, '.complex-md'));
    else {
      mkdirSync(join(s.ws, '.complex-md'));
      writeFileSync(join(outside, 'victim'), 'keep');
      symlinkSync(join(outside, 'victim'), join(s.ws, '.complex-md/bounds.json'));
    }
    assert.equal(await runBounds({ ...s.ctx, wantImpact: true, wantVerify: false }), 1, kind);
    assert.ok(s.logs.some((l) => l.startsWith('error: ') && l.includes('symlink')), kind);
    assert.equal(existsSync(join(outside, 'bounds.json')), false, kind);
    if (kind === 'file') assert.equal(readFileSync(join(outside, 'victim'), 'utf8'), 'keep');
    assert.equal(s.calls().filter((c) => c.args[0] === 'impact').length, 0, kind);
  }
});
