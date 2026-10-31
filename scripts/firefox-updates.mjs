import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export function firefoxUpdates({ id, version, hash, minVersion }) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid version ${version}`);
  const link = `https://github.com/arara-ide/arara-browser/releases/download/v${version}/arara-browser-${version}.xpi`;
  return { addons: { [id]: { updates: [{ version, update_link: link, update_hash: `sha256:${hash}`, applications: { gecko: { strict_min_version: minVersion } } }] } } };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const version = process.argv[2];
  const manifest = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
  const gecko = manifest.browser_specific_settings.gecko;
  const hash = createHash('sha256').update(await readFile(`dist/arara-browser-${version}.xpi`)).digest('hex');
  process.stdout.write(JSON.stringify(firefoxUpdates({ id: gecko.id, version, hash, minVersion: gecko.strict_min_version }), null, 2) + '\n');
}
