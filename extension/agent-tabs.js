(() => {
  if (globalThis.AraraTabs) return;
  let cursor = { active: false }, selected;
  const DEVICES = { desktop: { width: 1366, height: 768 }, mobile: { width: 375, height: 667 } };
  const pageAllowed = url => /^(?:https?|file):/.test(url ?? '');
  const zoomOf = tabId => Promise.resolve().then(() => chrome.tabs.getZoom?.(tabId)).then(zoom => (Number(zoom) > 0 ? Number(zoom) : 1)).catch(() => 1);
  const stateFor = async tabId => ({ ...cursor, here: tabId === cursor.tabId, zoom: await zoomOf(tabId) });
  async function broadcast() {
    const tabs = (await chrome.tabs.query({})).filter(tab => pageAllowed(tab.url));
    await Promise.all(tabs.map(tab => stateFor(tab.id).then(state => chrome.tabs.sendMessage(tab.id, { type: 'agentCursorState', state })).catch(() => {})));
  }
  async function setCursor(next) { cursor = { ...cursor, ...next }; await broadcast(); }
  const hello = tabId => stateFor(tabId);
  async function current() {
    const tab = selected ? await chrome.tabs.get(selected).catch(() => null) : null;
    if (tab) return tab;
    const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!active) throw new Error('No open tab.');
    selected = active.id;
    return active;
  }
  function settled(tabId, timeout = 30000) {
    return new Promise(resolve => {
      const done = () => { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(listener); resolve(); };
      const listener = (id, info) => { if (id === tabId && info.status === 'complete') done(); };
      const timer = setTimeout(done, timeout);
      chrome.tabs.onUpdated.addListener(listener);
      chrome.tabs.get(tabId).then(tab => { if (tab.status === 'complete') done(); }).catch(done);
    });
  }
  const line = tab => `${tab.id === selected ? '*' : ' '} pageId=${tab.id} ${tab.title ?? ''} — ${tab.url ?? ''}`;
  async function listPages() { return (await chrome.tabs.query({})).map(line).join('\n'); }
  async function navigate(args) {
    const tab = await current();
    if (args.type === 'back') await chrome.tabs.goBack(tab.id);
    else if (args.type === 'forward') await chrome.tabs.goForward(tab.id);
    else if (args.type === 'reload') await chrome.tabs.reload(tab.id);
    else {
      const url = String(args.url ?? '');
      if (!/^https?:\/\//.test(url)) throw new Error('navigate_page needs an http(s) url.');
      await chrome.tabs.update(tab.id, { url });
    }
    await settled(tab.id);
    const after = await chrome.tabs.get(tab.id);
    return `url: ${after.url}\ntitle: ${after.title}`;
  }
  async function newPage(args) {
    const tab = await chrome.tabs.create({ url: /^https?:\/\//.test(args.url ?? '') ? args.url : 'about:blank', active: args.background !== true });
    selected = tab.id;
    await settled(tab.id);
    return listPages();
  }
  async function selectPage(args) {
    const tab = await chrome.tabs.get(Number(args.pageId ?? args.pageIdx));
    selected = tab.id;
    if (args.bringToFront !== false) { await chrome.tabs.update(tab.id, { active: true }); await chrome.windows.update(tab.windowId, { focused: true }); }
    return listPages();
  }
  async function closePage(args) {
    const id = Number(args.pageId ?? selected);
    await chrome.tabs.remove(id);
    if (id === selected) selected = undefined;
    return listPages();
  }
  async function screenshot() {
    const tab = await current();
    if (!tab.active) await chrome.tabs.update(tab.id, { active: true });
    const data = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    return { text: `Screenshot of ${tab.url}`, images: [{ data: data.replace(/^data:image\/png;base64,/, ''), mimeType: 'image/png' }] };
  }
  async function evaluate(args) {
    const tab = await current();
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', args: [String(args.function ?? args.script ?? '')], func: async source => {
      try { const value = await (0, eval)(`(${source})`)(); return { value: JSON.stringify(value) ?? 'undefined' }; }
      catch (error) { return { error: String(error?.message ?? error) }; }
    } });
    if (result?.result?.error) throw new Error(result.result.error);
    return String(result?.result?.value ?? 'undefined').slice(0, 40000);
  }
  async function device(args) {
    const size = DEVICES[args.device === 'mobile' ? 'mobile' : 'desktop'];
    const tab = await current();
    await chrome.windows.update(tab.windowId, { ...size, state: 'normal' });
    return `Window resized to ${size.width}×${size.height}.`;
  }
  async function inject(tabId) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', files: ['page-hooks.js'] }).catch(() => {});
      await chrome.scripting.executeScript({ target: { tabId }, files: ['cursor.js', 'agent-dom.js', 'agent-input.js', 'agent.js'] });
      return true;
    } catch { return false; }
  }
  async function inPage(action, args) {
    const tab = await current();
    if (!pageAllowed(tab.url)) throw new Error(`This tab (${tab.url}) does not allow extensions. Navigate to a web page first.`);
    await setCursor({ active: true, tabId: tab.id });
    const message = { type: 'agentRun', action, args };
    let reply = await chrome.tabs.sendMessage(tab.id, message).catch(() => null);
    if (!reply && await inject(tab.id)) reply = await chrome.tabs.sendMessage(tab.id, message).catch(() => null);
    if (!reply) throw new Error('The page did not respond. Reload the tab and try again.');
    if (reply.error) throw new Error(reply.error);
    return reply.text;
  }
  chrome.tabs.onRemoved.addListener(id => { if (id === selected) selected = undefined; });
  chrome.tabs.onActivated.addListener(() => { if (cursor.active) void broadcast(); });
  chrome.tabs.onZoomChange?.addListener(() => { if (cursor.active) void broadcast(); });
  globalThis.AraraTabs = { current, setCursor, hello, listPages, navigate, newPage, selectPage, closePage, screenshot, evaluate, device, inPage, get selected() { return selected; } };
})();
