import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { CLI, fetchCli, integrityOf } from '../src/cli.js';

export function stubTarball(script) {
  const dir = mkdtempSync(join(tmpdir(), 'cmda-tgz-'));
  mkdirSync(join(dir, 'package', 'bin'), { recursive: true });
  writeFileSync(join(dir, 'package', 'bin', 'complex-md.js'), script);
  writeFileSync(join(dir, 'package', 'package.json'), '{"type":"module"}');
  execFileSync('tar', ['-czf', join(dir, 'cli.tgz'), '-C', dir, 'package']);
  const bytes = readFileSync(join(dir, 'cli.tgz'));
  return { bytes, integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64') };
}

const serve = (bytes) => async () => new Response(bytes, { status: 200 });

test('the pinned CLI is an exact version from the npm registry with a sha512 integrity', () => {
  assert.match(CLI.version, /^\d+\.\d+\.\d+$/);
  assert.equal(CLI.tarball, `https://registry.npmjs.org/complex-md/-/complex-md-${CLI.version}.tgz`);
  assert.match(CLI.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/);
});

test('a tarball that matches the pin is unpacked and its bin returned', async () => {
  const t = stubTarball('console.log("stub")\n');
  const dir = mkdtempSync(join(tmpdir(), 'cmda-cli-'));
  const bin = await fetchCli({ fetch: serve(t.bytes), dir, pin: { ...CLI, integrity: t.integrity } });
  assert.equal(bin, join(dir, 'package', 'bin', 'complex-md.js'));
  assert.ok(existsSync(bin));
  assert.equal(integrityOf(t.bytes), t.integrity);
});

test('a tarball that does not match the pin is refused and not unpacked', async () => {
  const t = stubTarball('console.log("stub")\n');
  const dir = mkdtempSync(join(tmpdir(), 'cmda-cli-'));
  await assert.rejects(fetchCli({ fetch: serve(t.bytes), dir, pin: CLI }), /integrity/);
  assert.equal(existsSync(join(dir, 'package')), false);
});

test('a failed download is an error', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cmda-cli-'));
  await assert.rejects(fetchCli({ fetch: async () => new Response('no', { status: 503 }), dir }), /503/);
});
