(() => {
  if (globalThis.AraraTabs) return;
  let cursor = { active: false }, selected;
  const DEVICES = { desktop: { width: 1366, height: 768 }, mobile: { width: 375, height: 667 } };
  const pageAllowed = url => /^(?:https?|file):/.test(url ?? '');
  const httpUrl = value => {
    if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return null;
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null;
    } catch { return null; }
  };
  const mapCookie = cookie => {
    const mapped = {
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      secure: Boolean(cookie.secure),
      httpOnly: Boolean(cookie.httpOnly),
      sameSite: cookie.sameSite,
      hostOnly: Boolean(cookie.hostOnly),
      session: Boolean(cookie.session),
    };
    if (typeof cookie.expirationDate === 'number') mapped.expirationDate = cookie.expirationDate;
    return mapped;
  };
  const mergeCookies = lists => {
    const seen = new Set();
    const cookies = [];
    for (const list of lists) {
      for (const cookie of list) {
        const key = JSON.stringify([cookie.name, cookie.domain, cookie.path]);
        if (seen.has(key)) continue;
        seen.add(key);
        cookies.push(mapCookie(cookie));
      }
    }
    return cookies;
  };
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
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', args: [String(args.function ?? args.script ?? ''), `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`], func: async (source, run) => {
      const clicks = [], click = HTMLElement.prototype.click, dispatch = EventTarget.prototype.dispatchEvent;
      const queue = element => {
        if (!element.dataset.araraClick) element.dataset.araraClick = `${run}-${clicks.length}`;
        clicks.push(`[data-arara-click="${element.dataset.araraClick}"]`);
      };
      HTMLElement.prototype.click = function () { queue(this); };
      EventTarget.prototype.dispatchEvent = function (event) {
        if (event?.type === 'click' && this instanceof Element) { queue(this); return true; }
        return dispatch.call(this, event);
      };
      try { const value = await (0, eval)(`(${source})`)(); return { value: JSON.stringify(value) ?? 'undefined', clicks }; }
      catch (error) { return { error: String(error?.message ?? error), clicks }; }
      finally { HTMLElement.prototype.click = click; EventTarget.prototype.dispatchEvent = dispatch; }
    } });
    const outcome = result?.result ?? {}, clicks = Array.isArray(outcome.clicks) ? outcome.clicks : [];
    let replay = '';
    if (clicks.length) {
      replay = await inPage('click', { elements: clicks.map(selector => ({ selector })), marked: true }).then(text => text.split('\n')[0], error => `Clicks: ${error.message}`);
      replay = `\nThe script's clicks were made afterwards by the cursor, one by one: ${replay}`;
    }
    if (outcome.error) throw new Error(outcome.error + replay);
    return String(outcome.value ?? 'undefined').slice(0, 40000) + replay;
  }
  async function device(args) {
    const size = DEVICES[args.device === 'mobile' ? 'mobile' : 'desktop'];
    const tab = await current();
    await chrome.windows.update(tab.windowId, { ...size, state: 'normal' });
    return `Window resized to ${size.width}×${size.height}.`;
  }
  async function inject(tabId) {
    await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: 'MAIN', files: ['page-hooks.js'] }).catch(() => {});
    const results = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: 'ISOLATED', files: ['cursor.js', 'agent-dom.js', 'agent-input.js', 'agent.js'] });
    for (const result of results) if (result.error) throw new Error(result.error.message ?? String(result.error));
  }
  async function pageAction(tabId, action, args) {
    const [result] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: 'ISOLATED', args: [action, args], func: async (action, args) => {
      if (!globalThis.AraraPageAgent) return { missing: true };
      try { return { text: await globalThis.AraraPageAgent.run(action, args) }; }
      catch (error) { return { error: String(error?.message ?? error) }; }
    } });
    if (result?.error) throw new Error(result.error.message ?? String(result.error));
    if (!result?.result) throw new Error('The page action did not return a result. Check the page before retrying.');
    return result.result;
  }
  async function inPage(action, args) {
    const tab = await current();
    if (!pageAllowed(tab.url)) throw new Error(`This tab (${tab.url}) does not allow extensions. Navigate to a web page first.`);
    await setCursor({ active: true, tabId: tab.id });
    let reply = await pageAction(tab.id, action, args);
    if (reply.missing) { await inject(tab.id); reply = await pageAction(tab.id, action, args); }
    if (reply.missing) throw new Error('The page agent did not initialize.');
    if (reply.error) throw new Error(reply.error);
    return reply.text;
  }
  async function readCookies(url, hostname) {
    const queries = [{ url }, { domain: hostname }];
    const settled = await Promise.allSettled(queries.map(query => Promise.resolve().then(() => chrome.cookies.getAll(query))));
    if (settled.every(entry => entry.status === 'rejected')) throw new Error('export_session could not read cookies.');
    return mergeCookies(settled.map(entry => (entry.status === 'fulfilled' && Array.isArray(entry.value) ? entry.value : [])));
  }
  async function readLocalStorage(origin) {
    const tabs = await chrome.tabs.query({}).catch(() => []);
    const candidates = tabs
      .filter(tab => typeof tab?.id === 'number' && !tab.discarded && pageAllowed(tab.url) && httpUrl(tab.url)?.origin === origin)
      .sort((a, b) => Number(Boolean(b.active)) - Number(Boolean(a.active)));
    for (const tab of candidates) {
      try {
        const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => Object.fromEntries(Object.entries(localStorage)) });
        const entry = results?.[0];
        if (entry && !entry.error && entry.result && typeof entry.result === 'object' && !Array.isArray(entry.result)) return entry.result;
      } catch {}
    }
    return null;
  }
  async function exportSession(args) {
    const url = typeof args?.url === 'string' ? args.url : '';
    const parsed = httpUrl(url);
    if (!parsed) throw new Error('export_session needs an http(s) url.');
    const cookies = await readCookies(url, parsed.hostname);
    const localStorage = await readLocalStorage(parsed.origin);
    return JSON.stringify({ format: 'arara-session/1', url, origin: parsed.origin, cookies, localStorage });
  }
  chrome.tabs.onRemoved.addListener(id => { if (id === selected) selected = undefined; });
  chrome.tabs.onActivated.addListener(() => { if (cursor.active) void broadcast(); });
  chrome.tabs.onZoomChange?.addListener(() => { if (cursor.active) void broadcast(); });
  globalThis.AraraTabs = { current, setCursor, hello, listPages, navigate, newPage, selectPage, closePage, screenshot, evaluate, device, inPage, exportSession, get selected() { return selected; } };
})();
