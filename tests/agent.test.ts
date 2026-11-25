import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

describe('page agent field descriptions', () => {
  it('omits passwords even when a field has no accessible label', () => {
    const scope = { chrome: { runtime: { id: 'test' } }, document: {} };
    runInNewContext(readFileSync('extension/agent-dom.js', 'utf8'), scope);
    const { describe: describeElement } = (scope as typeof scope & { AraraDom: { describe(element: unknown): string } }).AraraDom;
    const field = { tagName: 'INPUT', value: 'fixture-value', getAttribute: () => null };
    expect(describeElement({ ...field, type: 'password' })).toMatch(/^uid=u\d+ input\[password\] ""$/);
    expect(describeElement({ ...field, type: 'text' })).toContain('value="fixture-value"');
  });
});

function fixture(extraTabs: Array<{ id: number; windowId: number; active: boolean; status: string; url: string; title: string; discarded?: boolean }> = []) {
  const tabs = [
    { id: 1, windowId: 9, active: true, status: 'complete', url: 'https://example.com/', title: 'Example' },
    { id: 2, windowId: 9, active: false, status: 'complete', url: 'https://other.test/', title: 'Other' },
    { id: 3, windowId: 9, active: false, status: 'complete', url: 'chrome://settings/', title: 'Settings' },
    ...extraTabs,
  ];
  const sendMessage = vi.fn(async (_id: number, message: { type: string }) => message.type === 'agentRun' ? { text: 'clicked' } : undefined);
  const chrome = {
    tabs: {
      query: vi.fn(async (filter: { active?: boolean }) => filter.active ? tabs.filter(t => t.active) : tabs),
      get: vi.fn(async (id: number) => tabs.find(t => t.id === id) ?? Promise.reject(new Error('gone'))),
      update: vi.fn(async (id: number, change: { url?: string }) => Object.assign(tabs.find(t => t.id === id)!, change)),
      create: vi.fn(async ({ url }: { url: string }) => { const tab = { id: 4, windowId: 9, active: true, status: 'complete', url, title: 'New' }; tabs.push(tab); return tab; }),
      remove: vi.fn(async () => {}), goBack: vi.fn(async () => {}), goForward: vi.fn(async () => {}), reload: vi.fn(async () => {}),
      captureVisibleTab: vi.fn(async () => 'data:image/png;base64,AAAA'), sendMessage,
      onUpdated: { addListener: vi.fn(), removeListener: vi.fn() }, onRemoved: { addListener: vi.fn() }, onActivated: { addListener: vi.fn() },
    },
    windows: { update: vi.fn(async () => {}) },
    cookies: { getAll: vi.fn(async (_details: { url?: string; domain?: string }) => [] as Array<Record<string, unknown>>) },
    storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) }, session: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) } },
    scripting: { executeScript: vi.fn(async (request: { world?: string; target?: { tabId: number }; func?: () => unknown }) => [{ result: request.world === 'MAIN' ? { value: '42' } : { text: 'clicked' } }]) },
  };
  const scope: Record<string, unknown> = { chrome, URL, setTimeout, clearTimeout };
  scope.globalThis = scope;
  for (const file of ['agent-tabs.js', 'agent-worker.js']) runInNewContext(readFileSync(`extension/${file}`, 'utf8'), scope);
  return { agent: scope.AraraAgent as { execute(c: unknown): Promise<any>; loop(api: unknown, refusal?: string): Promise<void>; HANDLERS: Record<string, unknown> }, chrome, sendMessage };
}

describe('agent in the user browser', () => {
  it('runs page actions in the selected tab and shows the cursor in every web tab', async () => {
    const f = fixture();
    expect(await f.agent.execute({ action: 'click', args: { uid: 'u1' } })).toEqual({ text: 'clicked' });
    expect(f.chrome.scripting.executeScript).toHaveBeenCalledWith(expect.objectContaining({ target: { tabId: 1, frameIds: [0] }, world: 'ISOLATED', args: ['click', { uid: 'u1' }] }));
    const states = f.sendMessage.mock.calls.filter(([, m]) => (m as { type: string }).type === 'agentCursorState');
    expect(states.map(([id, m]) => [id, (m as { state: { here: boolean } }).state.here])).toEqual([[1, true], [2, false]]);
  });
  it('executes page actions without depending on a content message reply', async () => {
    const f = fixture();
    f.sendMessage.mockRejectedValue(new Error('No response'));
    expect(await f.agent.execute({ action: 'take_snapshot' })).toEqual({ text: 'clicked' });
    expect(f.sendMessage.mock.calls.some(([, message]) => message.type === 'agentRun')).toBe(false);
  });
  it('injects a missing page runner before executing an action once', async () => {
    const f = fixture();
    f.chrome.scripting.executeScript.mockResolvedValueOnce([{ result: { missing: true } }])
      .mockResolvedValueOnce([{}]).mockResolvedValueOnce([{}]);
    expect(await f.agent.execute({ action: 'fill', args: { uid: 'u1', value: 'Name' } })).toEqual({ text: 'clicked' });
    expect(f.chrome.scripting.executeScript).toHaveBeenCalledTimes(4);
  });
  it('preserves Firefox per-frame injection errors', async () => {
    const f = fixture();
    f.chrome.scripting.executeScript.mockResolvedValueOnce([{ result: { missing: true } }])
      .mockResolvedValueOnce([{}]).mockResolvedValueOnce([{ error: new Error('agent.js failed to initialize') }]);
    expect(await f.agent.execute({ action: 'take_snapshot' })).toEqual({ error: 'agent.js failed to initialize' });
    expect(f.chrome.scripting.executeScript).toHaveBeenCalledTimes(3);
  });
  it('does not retry actions after a page execution error or a lost result', async () => {
    const f = fixture();
    f.chrome.scripting.executeScript.mockRejectedValueOnce(new Error('Document unloaded'));
    expect(await f.agent.execute({ action: 'click', args: { uid: 'u1' } })).toEqual({ error: 'Document unloaded' });
    expect(f.chrome.scripting.executeScript).toHaveBeenCalledTimes(1);
    f.chrome.scripting.executeScript.mockResolvedValueOnce([]);
    expect((await f.agent.execute({ action: 'click', args: { uid: 'u1' } })).error).toMatch(/did not return a result/);
    expect(f.chrome.scripting.executeScript).toHaveBeenCalledTimes(2);
  });
  it('manages tabs, screenshots, scripts and devices like the native browser', async () => {
    const f = fixture();
    expect((await f.agent.execute({ action: 'list_pages' })).text).toContain('pageId=2 Other');
    expect((await f.agent.execute({ action: 'navigate_page', args: { url: 'https://arara.dev/' } })).text).toContain('url: https://arara.dev/');
    expect((await f.agent.execute({ action: 'navigate_page', args: { url: 'file:///etc/passwd' } })).error).toMatch(/http/);
    expect((await f.agent.execute({ action: 'select_page', args: { pageId: 2 } })).text).toContain('* pageId=2');
    expect((await f.agent.execute({ action: 'take_screenshot' })).images).toEqual([{ data: 'AAAA', mimeType: 'image/png' }]);
    expect(await f.agent.execute({ action: 'evaluate_script', args: { function: '() => 42' } })).toEqual({ text: '42' });
    await f.agent.execute({ action: 'set_device', args: { device: 'mobile' } });
    expect(f.chrome.windows.update).toHaveBeenCalledWith(9, { width: 375, height: 667, state: 'normal' });
    expect((await f.agent.execute({ action: 'new_page', args: { url: 'https://new.test/' } })).text).toContain('* pageId=4');
    expect((await f.agent.execute({ action: 'nope' })).error).toMatch(/Unknown action/);
  });
  it('refuses tabs that do not accept extensions', async () => {
    const f = fixture();
    await f.agent.execute({ action: 'select_page', args: { pageId: 3 } });
    expect((await f.agent.execute({ action: 'read' })).error).toMatch(/does not allow extensions/);
  });
  it('polls queued commands from the IDE and returns each result once', async () => {
    const f = fixture();
    const queue = [{ id: 'c1', action: 'list_pages', args: {} }];
    const api = vi.fn(async (path: string, _body: unknown) => path === '/agent/poll' ? { command: queue.shift() ?? null } : {});
    await f.agent.loop(api);
    expect(api.mock.calls.map(c => c[0])).toEqual(['/agent/poll', '/agent/result', '/agent/poll']);
    expect(api.mock.calls[1][1]).toMatchObject({ id: 'c1', result: { text: expect.stringContaining('pageId=1') } });
  });
  it('answers every command with the update request while the extension is outdated', async () => {
    const f = fixture();
    const queue = [{ id: 'c1', action: 'click', args: { uid: 'u1' } }];
    const api = vi.fn(async (path: string, _body: unknown) => path === '/agent/poll' ? { command: queue.shift() ?? null } : {});
    await f.agent.loop(api, 'Update Arara Browser');
    expect(api.mock.calls[1][1]).toEqual({ id: 'c1', result: { error: 'Update Arara Browser' } });
    expect(f.sendMessage).not.toHaveBeenCalled();
  });
});

describe('export_session action', () => {
  it('registers export_session in HANDLERS and declares cookies permission in manifest', () => {
    const f = fixture();
    expect(typeof f.agent.HANDLERS.export_session).toBe('function');
    const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
    expect(manifest.permissions).toContain('cookies');
  });

  it('rejects non-http(s) and malformed urls without reading cookies or tabs', async () => {
    const f = fixture();
    for (const url of ['file:///etc/passwd', 'chrome://settings/', 'javascript:alert(1)', 'ftp://example.com/', '', 'https://', ' https://example.com', undefined, 42]) {
      expect(await f.agent.execute({ action: 'export_session', args: { url } })).toEqual({ error: 'export_session needs an http(s) url.' });
    }
    expect(f.chrome.cookies.getAll).not.toHaveBeenCalled();
    expect(f.chrome.tabs.query).not.toHaveBeenCalled();
    expect(f.chrome.tabs.create).not.toHaveBeenCalled();
    expect(f.chrome.tabs.update).not.toHaveBeenCalled();
  });

  it('unions and deduplicates cookies, maps only contract fields, and reads localStorage from an open same-origin tab', async () => {
    const f = fixture([{ id: 5, windowId: 9, active: false, status: 'complete', url: 'https://dash.cloudflare.com/other', title: 'Cloudflare' }]);
    const url = 'https://dash.cloudflare.com/accounts/123';
    f.chrome.cookies.getAll.mockImplementation(async (details: { url?: string; domain?: string }) => {
      if (details.url === url) {
        return [
          { name: 'cf_auth', value: 'secret-1', domain: '.cloudflare.com', path: '/', secure: true, httpOnly: true, sameSite: 'lax', hostOnly: false, session: false, expirationDate: 1900000000, storeId: '0', partitionKey: { topLevelSite: 'https://cloudflare.com' }, firstPartyDomain: 'cloudflare.com' },
          { name: 'sid', value: 'session-only', domain: 'dash.cloudflare.com', path: '/accounts', secure: true, httpOnly: true, sameSite: 'strict', hostOnly: true, session: true, storeId: '0' },
          { name: 'ab', value: '1', domain: 'c.cloudflare.com', path: '/', secure: true, httpOnly: false, sameSite: 'unspecified', hostOnly: true, session: false, expirationDate: 0, storeId: '0' },
        ];
      }
      if (details.domain === 'dash.cloudflare.com') {
        return [
          { name: 'cf_auth', value: 'duplicate-ignored', domain: '.cloudflare.com', path: '/', secure: true, httpOnly: true, sameSite: 'lax', hostOnly: false, session: false, expirationDate: 1900000999, storeId: '0' },
          { name: 'sid', value: 'root-path', domain: 'dash.cloudflare.com', path: '/', secure: true, httpOnly: true, sameSite: 'strict', hostOnly: true, session: true, storeId: '0' },
          { name: 'sub', value: 'sub-val', domain: 'api.dash.cloudflare.com', path: '/', secure: true, httpOnly: false, sameSite: 'no_restriction', hostOnly: false, session: false, expirationDate: 1900000100, storeId: '0' },
          { name: 'a', value: '2', domain: 'bc.cloudflare.com', path: '/', secure: true, httpOnly: false, sameSite: 'unspecified', hostOnly: true, session: true, storeId: '0' },
        ];
      }
      return [];
    });
    f.chrome.scripting.executeScript.mockImplementation(async (request: { target?: { tabId: number }; func?: () => unknown }) => {
      const value = runInNewContext(`(${request.func!.toString()})()`, { localStorage: { theme: 'dark', account: '123' } });
      return [{ result: value }];
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const reply = await f.agent.execute({ action: 'export_session', args: { url } });
    logSpy.mockRestore();
    expect(reply.error).toBeUndefined();
    const payload = JSON.parse(reply.text);
    expect(payload).toEqual({
      format: 'arara-session/1',
      url,
      origin: 'https://dash.cloudflare.com',
      cookies: [
        { name: 'cf_auth', value: 'secret-1', domain: '.cloudflare.com', path: '/', secure: true, httpOnly: true, sameSite: 'lax', hostOnly: false, session: false, expirationDate: 1900000000 },
        { name: 'sid', value: 'session-only', domain: 'dash.cloudflare.com', path: '/accounts', secure: true, httpOnly: true, sameSite: 'strict', hostOnly: true, session: true },
        { name: 'ab', value: '1', domain: 'c.cloudflare.com', path: '/', secure: true, httpOnly: false, sameSite: 'unspecified', hostOnly: true, session: false, expirationDate: 0 },
        { name: 'sid', value: 'root-path', domain: 'dash.cloudflare.com', path: '/', secure: true, httpOnly: true, sameSite: 'strict', hostOnly: true, session: true },
        { name: 'sub', value: 'sub-val', domain: 'api.dash.cloudflare.com', path: '/', secure: true, httpOnly: false, sameSite: 'no_restriction', hostOnly: false, session: false, expirationDate: 1900000100 },
        { name: 'a', value: '2', domain: 'bc.cloudflare.com', path: '/', secure: true, httpOnly: false, sameSite: 'unspecified', hostOnly: true, session: true },
      ],
      localStorage: { theme: 'dark', account: '123' },
    });
    expect('expirationDate' in payload.cookies[1]).toBe(false);
    expect(payload.cookies.every((cookie: Record<string, unknown>) => !('storeId' in cookie) && !('partitionKey' in cookie) && !('firstPartyDomain' in cookie))).toBe(true);
    expect(f.chrome.cookies.getAll).toHaveBeenCalledWith({ url });
    expect(f.chrome.cookies.getAll).toHaveBeenCalledWith({ domain: 'dash.cloudflare.com' });
    expect(f.chrome.scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: 5 }, func: expect.any(Function) });
    expect(f.chrome.tabs.create).not.toHaveBeenCalled();
    expect(f.chrome.tabs.update).not.toHaveBeenCalled();
    expect(f.chrome.windows.update).not.toHaveBeenCalled();
    expect(f.sendMessage).not.toHaveBeenCalled();
    expect(f.chrome.storage.local.set).not.toHaveBeenCalled();
    expect(f.chrome.storage.session.set).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('returns localStorage null without opening or focusing tabs when no matching tab is open', async () => {
    const f = fixture([{ id: 6, windowId: 9, active: false, status: 'complete', url: 'https://dash.cloudflare.com/', title: 'Discarded', discarded: true }]);
    const reply = await f.agent.execute({ action: 'export_session', args: { url: 'https://dash.cloudflare.com/' } });
    const payload = JSON.parse(reply.text);
    expect(payload).toEqual({
      format: 'arara-session/1',
      url: 'https://dash.cloudflare.com/',
      origin: 'https://dash.cloudflare.com',
      cookies: [],
      localStorage: null,
    });
    expect(f.chrome.scripting.executeScript).not.toHaveBeenCalled();
    expect(f.chrome.tabs.create).not.toHaveBeenCalled();
    expect(f.chrome.tabs.update).not.toHaveBeenCalled();
    expect(f.chrome.windows.update).not.toHaveBeenCalled();
    expect(f.sendMessage).not.toHaveBeenCalled();
  });

  it('returns localStorage null when executeScript rejects, returns a frame error, or returns no result', async () => {
    const f = fixture();
    f.chrome.scripting.executeScript.mockRejectedValueOnce(new Error('Cannot access contents'));
    expect(JSON.parse((await f.agent.execute({ action: 'export_session', args: { url: 'https://example.com/' } })).text).localStorage).toBeNull();
    f.chrome.scripting.executeScript.mockResolvedValueOnce([{ error: new Error('SecurityError') }] as never);
    expect(JSON.parse((await f.agent.execute({ action: 'export_session', args: { url: 'https://example.com/' } })).text).localStorage).toBeNull();
    f.chrome.scripting.executeScript.mockResolvedValueOnce([]);
    expect(JSON.parse((await f.agent.execute({ action: 'export_session', args: { url: 'https://example.com/' } })).text).localStorage).toBeNull();
    expect(f.chrome.tabs.create).not.toHaveBeenCalled();
    expect(f.chrome.tabs.update).not.toHaveBeenCalled();
  });

  it('isolates chrome.cookies.getAll failures and throws only when both calls fail', async () => {
    const f = fixture();
    const url = 'https://example.com/app';
    f.chrome.cookies.getAll.mockImplementation(async (details: { url?: string; domain?: string }) => {
      if (details.url) throw new Error('First-party isolation requires firstPartyDomain');
      return [{ name: 'dom', value: 'v', domain: 'example.com', path: '/', secure: true, httpOnly: false, sameSite: 'lax', hostOnly: true, session: true, storeId: 'firefox-default' }];
    });
    f.chrome.scripting.executeScript.mockResolvedValueOnce([{ result: {} }] as never);
    const partialUrlFail = JSON.parse((await f.agent.execute({ action: 'export_session', args: { url } })).text);
    expect(partialUrlFail.cookies).toEqual([{ name: 'dom', value: 'v', domain: 'example.com', path: '/', secure: true, httpOnly: false, sameSite: 'lax', hostOnly: true, session: true }]);
    expect(partialUrlFail.localStorage).toEqual({});

    f.chrome.cookies.getAll.mockImplementation(async (details: { url?: string; domain?: string }) => {
      if (details.domain) throw new Error('First-party isolation requires firstPartyDomain');
      return [{ name: 'u', value: 'v2', domain: '.example.com', path: '/', secure: true, httpOnly: true, sameSite: 'strict', hostOnly: false, session: true }];
    });
    f.chrome.scripting.executeScript.mockResolvedValueOnce([{ result: null }] as never);
    const partialDomainFail = JSON.parse((await f.agent.execute({ action: 'export_session', args: { url } })).text);
    expect(partialDomainFail.cookies).toEqual([{ name: 'u', value: 'v2', domain: '.example.com', path: '/', secure: true, httpOnly: true, sameSite: 'strict', hostOnly: false, session: true }]);
    expect(partialDomainFail.localStorage).toBeNull();

    f.chrome.cookies.getAll.mockRejectedValue(new Error('Cookies unavailable'));
    expect(await f.agent.execute({ action: 'export_session', args: { url } })).toEqual({ error: 'export_session could not read cookies.' });
  });

  it('executes export_session through the /agent/poll loop', async () => {
    const f = fixture();
    f.chrome.cookies.getAll.mockResolvedValueOnce([{ name: 'token', value: 'abc', domain: 'example.com', path: '/', secure: true, httpOnly: true, sameSite: 'lax', hostOnly: true, session: true }]).mockResolvedValueOnce([]);
    f.chrome.scripting.executeScript.mockResolvedValueOnce([{ result: { k: 'v' } }] as never);
    const queue = [{ id: 's1', action: 'export_session', args: { url: 'https://example.com/dashboard' } }];
    const api = vi.fn(async (path: string, _body: unknown) => path === '/agent/poll' ? { command: queue.shift() ?? null } : {});
    await f.agent.loop(api);
    expect(api.mock.calls.map(call => call[0])).toEqual(['/agent/poll', '/agent/result', '/agent/poll']);
    const posted = api.mock.calls[1][1] as { id: string; result: { text: string } };
    expect(posted.id).toBe('s1');
    expect(JSON.parse(posted.result.text)).toEqual({
      format: 'arara-session/1',
      url: 'https://example.com/dashboard',
      origin: 'https://example.com',
      cookies: [{ name: 'token', value: 'abc', domain: 'example.com', path: '/', secure: true, httpOnly: true, sameSite: 'lax', hostOnly: true, session: true }],
      localStorage: { k: 'v' },
    });
    expect(f.chrome.tabs.create).not.toHaveBeenCalled();
    expect(f.chrome.tabs.update).not.toHaveBeenCalled();
    expect(f.sendMessage).not.toHaveBeenCalled();
  });
});
