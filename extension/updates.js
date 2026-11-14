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
  const CHECK_EVERY_MS = 12 * 60 * 60 * 1000;
  const RETRY_AFTER_MS = 10 * 60 * 1000;
  let pending;
  async function check(current) {
    const response = await fetch('https://api.github.com/repos/arara-ide/arara-browser/releases/latest', {
      headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10000), cache: 'no-store',
    });
    if (!response.ok) throw new Error(`GitHub: HTTP ${response.status}`);
    return releaseUpdate(await response.json(), current);
  }
  async function refresh(current, storage, now, force) {
    const { releaseCheck } = await storage.get('releaseCheck');
    const cached = releaseCheck?.current === current ? releaseCheck : undefined;
    if (cached?.failed && now >= cached.attempted && now - cached.attempted < RETRY_AFTER_MS) return cached.update ?? null;
    if (!force && !cached?.failed && now >= cached?.checked && now - cached.checked < CHECK_EVERY_MS) return cached.update ?? null;
    try {
      const update = await check(current);
      await storage.set({ releaseCheck: { current, checked: now, attempted: now, failed: false, update } });
      return update;
    } catch {
      const update = cached?.update ?? null;
      await storage.set({ releaseCheck: { current, checked: cached?.checked, attempted: now, failed: true, update } });
      return update;
    }
  }
  function freshness(current, storage, now = Date.now(), force = false) {
    return pending ??= refresh(current, storage, now, force).finally(() => { pending = null; });
  }
  globalThis.AraraUpdates = { releaseUpdate, check, freshness, CHECK_EVERY_MS, RETRY_AFTER_MS };
})();
