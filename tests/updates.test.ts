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
  it('links the signed Firefox package when the release has one', () => {
    const { AraraUpdates } = fixture();
    const value = release('0.3.0');
    value.assets.push({ name: 'arara-browser-0.3.0.xpi', state: 'uploaded', browser_download_url: 'https://github.com/arara-ide/arara-browser/releases/download/v0.3.0/arara-browser-0.3.0.xpi' });
    expect(AraraUpdates.releaseUpdate(value, '0.2.0')).toMatchObject({ version: '0.3.0', xpi: expect.stringMatching(/arara-browser-0\.3\.0\.xpi$/) });
    expect(AraraUpdates.releaseUpdate(release('0.3.0'), '0.2.0').xpi).toBeUndefined();
  });
  it('caches the check for 6 hours, keeps the last answer offline and never blocks without one', async () => {
    const context = fixture();
    const saved: Record<string, unknown> = {};
    const storage = { get: async (key: string) => ({ [key]: saved[key] }), set: async (value: Record<string, unknown>) => Object.assign(saved, value) };
    context.fetch.mockResolvedValue(new Response(JSON.stringify(release('0.3.0'))));
    expect((await context.AraraUpdates.freshness('0.2.0', storage, 1000)).version).toBe('0.3.0');
    expect((await context.AraraUpdates.freshness('0.2.0', storage, 2000)).version).toBe('0.3.0');
    expect(context.fetch).toHaveBeenCalledTimes(1);
    context.fetch.mockRejectedValue(new Error('offline'));
    expect((await context.AraraUpdates.freshness('0.2.0', storage, 1000 + context.AraraUpdates.CHECK_EVERY_MS)).version).toBe('0.3.0');
    expect(await context.AraraUpdates.freshness('0.3.0', storage, 5000)).toBeNull();
    expect(await fixture().AraraUpdates.freshness('0.2.0', { get: async () => ({}), set: async () => {} }, 1)).toBeNull();
  });
  it('reports network failures without claiming the installation is up to date', async () => {
    const context = fixture();
    context.fetch.mockResolvedValue(new Response('', { status: 403 }));
    await expect(context.AraraUpdates.check('0.1.0')).rejects.toThrow('HTTP 403');
  });
});
