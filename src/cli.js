// The complex-md CLI that the opt-in checks run. The version is exact and
// the tarball is checked against the sha512 integrity the npm registry
// published for it, the same check npm makes from a lock file. Nothing is
// installed: the commands the action runs need no dependency of the CLI.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

export const CLI = {
  version: '0.9.2',
  tarball: 'https://registry.npmjs.org/complex-md/-/complex-md-0.9.2.tgz',
  integrity: 'sha512-zbf/7kD0r5IZs/3as7i3gmQ0ghURiT+cXMz4V04B7WQxwp6t0+ck2AiT5rdRcmxPh2I+U7rU+e9rHPViLo+gPw==',
};

export const integrityOf = (bytes) => 'sha512-' + createHash('sha512').update(bytes).digest('base64');

/* Download, check, unpack. Returns the path of bin/complex-md.js. */
export async function fetchCli({ fetch = globalThis.fetch, dir, pin = CLI } = {}) {
  const res = await fetch(pin.tarball);
  if (!res.ok) throw new Error(`downloading complex-md ${pin.version} returned ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const got = integrityOf(bytes);
  if (got !== pin.integrity) {
    throw new Error(`complex-md ${pin.version} tarball failed its integrity check: expected ${pin.integrity}, got ${got}`);
  }
  rmSync(join(dir, 'package'), { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const tgz = join(dir, `complex-md-${pin.version}.tgz`);
  writeFileSync(tgz, bytes);
  execFileSync('tar', ['-xzf', tgz, '-C', dir, '--no-same-owner'], { stdio: 'pipe' });
  return join(dir, 'package', 'bin', 'complex-md.js');
}
