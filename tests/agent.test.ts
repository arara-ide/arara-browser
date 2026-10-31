import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

function fixture() {
  const tabs = [
    { id: 1, windowId: 9, active: true, status: 'complete', url: 'https://example.com/', title: 'Example' },
    { id: 2, windowId: 9, active: false, status: 'complete', url: 'https://other.test/', title: 'Other' },
    { id: 3, windowId: 9, active: false, status: 'complete', url: 'chrome://settings/', title: 'Settings' },
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
    scripting: { executeScript: vi.fn(async () => [{ result: { value: '42' } }]) },
  };
  const scope: Record<string, unknown> = { chrome, setTimeout, clearTimeout };
  scope.globalThis = scope;
  for (const file of ['agent-tabs.js', 'agent-worker.js']) runInNewContext(readFileSync(`extension/${file}`, 'utf8'), scope);
  return { agent: scope.AraraAgent as { execute(c: unknown): Promise<any>; loop(api: unknown): Promise<void> }, chrome, sendMessage };
}

describe('agent in the user browser', () => {
  it('runs page actions in the selected tab and shows the cursor in every web tab', async () => {
    const f = fixture();
    expect(await f.agent.execute({ action: 'click', args: { uid: 'u1' } })).toEqual({ text: 'clicked' });
    expect(f.sendMessage).toHaveBeenCalledWith(1, { type: 'agentRun', action: 'click', args: { uid: 'u1' } });
    const states = f.sendMessage.mock.calls.filter(([, m]) => (m as { type: string }).type === 'agentCursorState');
    expect(states.map(([id, m]) => [id, (m as { state: { here: boolean } }).state.here])).toEqual([[1, true], [2, false]]);
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
