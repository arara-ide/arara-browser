(function () {
  const repository = 'https://github.com/arara-ide/arara-browser';
  function releaseUpdate(release, current) {
    if (release.draft || release.prerelease || !/^v\d+\.\d+\.\d+$/.test(release.tag_name)) return null;
    const version = release.tag_name.slice(1);
    const parts = version.split('.').map(Number), installed = current.split('.').map(Number);
    const different = parts.findIndex((part, index) => part !== installed[index]);
    if (different < 0 || parts[different] < installed[different]) return null;
    const name = `arara-browser-${version}.zip`;
    const url = `${repository}/releases/download/${release.tag_name}/${name}`;
    if (!release.assets?.some(asset => asset.name === name && asset.browser_download_url === url && asset.state === 'uploaded')) return null;
    const xpiName = `arara-browser-${version}.xpi`, xpi = `${repository}/releases/download/${release.tag_name}/${xpiName}`;
    const signed = release.assets.some(asset => asset.name === xpiName && asset.browser_download_url === xpi && asset.state === 'uploaded');
    return { version, url, ...(signed ? { xpi } : {}) };
  }
  const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
  async function check(current) {
    const response = await fetch('https://api.github.com/repos/arara-ide/arara-browser/releases/latest', {
      headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10000), cache: 'no-store',
    });
    if (!response.ok) throw new Error(`GitHub: HTTP ${response.status}`);
    return releaseUpdate(await response.json(), current);
  }
  async function freshness(current, storage, now = Date.now(), force = false) {
    const { releaseCheck } = await storage.get('releaseCheck');
    if (!force && releaseCheck?.current === current && now - releaseCheck.checked < CHECK_EVERY_MS) return releaseCheck.update ?? null;
    try {
      const update = await check(current);
      await storage.set({ releaseCheck: { current, checked: now, update } });
      return update;
    } catch { return releaseCheck?.current === current ? releaseCheck.update ?? null : null; }
  }
  globalThis.AraraUpdates = { releaseUpdate, check, freshness, CHECK_EVERY_MS };
})();
