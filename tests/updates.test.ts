import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
function fixture() {
  const context: any = { fetch: vi.fn(), AbortSignal };
  runInNewContext(readFileSync('extension/updates.js', 'utf8'), context);
  return context;
}
function release(version = '0.2.0') {
  const name = `arara-browser-${version}.zip`;
  return { tag_name: `v${version}`, assets: [{ name, state: 'uploaded', browser_download_url: `https://github.com/arara-ide/arara-browser/releases/download/v${version}/${name}` }] };
}
describe('release discovery', () => {
  it('compares numeric versions and links directly to the matching ZIP', () => {
    const { AraraUpdates } = fixture();
    expect(AraraUpdates.releaseUpdate(release('0.10.0'), '0.9.0')).toMatchObject({ version: '0.10.0' });
    expect(AraraUpdates.releaseUpdate(release(), '0.2.0')).toBeNull();
    expect(AraraUpdates.releaseUpdate(release(), '1.0.0')).toBeNull();
  });
  it('rejects drafts, prereleases, foreign URLs and missing assets', () => {
    const { AraraUpdates } = fixture();
    for (const value of [{ ...release(), draft: true }, { ...release(), prerelease: true }, { ...release(), tag_name: 'v1.0.0-rc.1' }, { ...release(), assets: [] }, { ...release(), assets: [{ ...release().assets[0], browser_download_url: 'https://example.com/file.zip' }] }]) expect(AraraUpdates.releaseUpdate(value, '0.1.0')).toBeNull();
  });
  it('reports network failures without claiming the installation is up to date', async () => {
    const context = fixture();
    context.fetch.mockResolvedValue(new Response('', { status: 403 }));
    await expect(context.AraraUpdates.check('0.1.0')).rejects.toThrow('HTTP 403');
  });
});
