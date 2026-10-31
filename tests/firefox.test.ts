import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { firefoxUpdates } from '../scripts/firefox-updates.mjs';

describe('Firefox package', () => {
  const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
  it('declares a self-hosted update manifest and no data collection', () => {
    expect(manifest.browser_specific_settings.gecko).toMatchObject({
      update_url: 'https://github.com/arara-ide/arara-browser/releases/latest/download/updates.json',
      data_collection_permissions: { required: ['none'] }, strict_min_version: '128.0',
    });
    expect(manifest.background.scripts[0]).toBe('updates.js');
  });
  it('points updates.json to the versioned signed package with its hash', () => {
    const value = firefoxUpdates({ id: manifest.browser_specific_settings.gecko.id, version: '0.3.0', hash: 'a'.repeat(64), minVersion: '128.0' });
    expect(value.addons[manifest.browser_specific_settings.gecko.id].updates).toEqual([{ version: '0.3.0', update_link: 'https://github.com/arara-ide/arara-browser/releases/download/v0.3.0/arara-browser-0.3.0.xpi', update_hash: `sha256:${'a'.repeat(64)}`, applications: { gecko: { strict_min_version: '128.0' } } }]);
    expect(() => firefoxUpdates({ id: 'x', version: '0.3', hash: '', minVersion: '128.0' })).toThrow();
  });
});
