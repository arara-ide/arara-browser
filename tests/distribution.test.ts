import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { Script } from 'node:vm';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { expect, it } from 'vitest';
it('produces a reproducible installable ZIP with checksums and exactly the public runtime assets', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const name = `arara-browser-${pkg.version}.zip`;
  execFileSync(process.execPath, ['scripts/build.mjs']);
  const first = readFileSync(`dist/${name}`);
  execFileSync(process.execPath, ['scripts/build.mjs']);
  expect(readFileSync(`dist/${name}`).equals(first)).toBe(true);
  const hash = createHash('sha256').update(first).digest('hex');
  expect(readFileSync('dist/SHA256SUMS', 'utf8')).toBe(`${hash}  ${name}\n${hash}  arara-browser-${pkg.version}.xpi\n`);
  expect(readFileSync(`dist/arara-browser-${pkg.version}.xpi`).equals(first)).toBe(true);
  const files = unzipSync(first);
  expect(Object.keys(files).sort()).toEqual([...readdirSync('extension', { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => `${entry.parentPath}/${entry.name}`.replaceAll('\\', '/').replace(/^extension\//, '')), 'LICENSE'].sort());
  const manifest = JSON.parse(Buffer.from(files['manifest.json']).toString());
  expect(manifest.version).toBe(pkg.version);
  expect(manifest.manifest_version).toBe(3);
  for (const name of [manifest.background.service_worker, manifest.action.default_popup, ...manifest.content_scripts.flatMap((script: { js: string[] }) => script.js)]) expect(files[name]).toBeDefined();
  for (const [name, bytes] of Object.entries(files)) {
    expect(Buffer.from(bytes).equals(readFileSync(name === 'LICENSE' ? name : `extension/${name}`))).toBe(true);
    if (name.endsWith('.js')) expect(() => new Script(Buffer.from(bytes).toString(), { filename: name })).not.toThrow();
  }
});
