import { readFile, readdir, mkdir, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';

const files = (await readdir('extension', { recursive: true, withFileTypes: true }))
  .filter(entry => entry.isFile()).map(entry => `${entry.parentPath}/${entry.name}`.replaceAll('\\', '/').replace(/^extension\//, '')).sort();
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const manifest = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(pkg.version) || manifest.version !== pkg.version) throw new Error('package.json and manifest.json versions differ or are invalid');
const entries = {};
for (const file of [...files, 'LICENSE']) {
  if (!/^(?:[A-Za-z0-9][A-Za-z0-9._-]*|_locales\/(?:en|pt_BR|es)\/messages\.json)$/.test(file)) throw new Error(`Unsupported asset name: ${file}`);
  entries[file] = await readFile(file === 'LICENSE' ? file : `extension/${file}`);
}
// STORE + fixed local timestamp: reproducible bytes on every OS/timezone.
const zip = zipSync(entries, { level: 0, mtime: new Date(1980, 0, 1), os: 0 });
const name = `arara-browser-${pkg.version}.zip`;
await rm('dist', { recursive: true, force: true }); await mkdir('dist');
await writeFile(`dist/${name}`, zip);
await writeFile('dist/SHA256SUMS', `${createHash('sha256').update(zip).digest('hex')}  ${name}\n`);
console.log(name);
