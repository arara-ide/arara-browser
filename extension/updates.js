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
    return { version, url };
  }
  globalThis.AraraUpdates = { releaseUpdate, async check(current) {
    const response = await fetch('https://api.github.com/repos/arara-ide/arara-browser/releases/latest', {
      headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10000), cache: 'no-store',
    });
    if (!response.ok) throw new Error(`GitHub: HTTP ${response.status}`);
    return releaseUpdate(await response.json(), current);
  } };
})();
