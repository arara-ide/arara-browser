import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
const source = readFileSync('extension/background.js', 'utf8');

async function fixture(failReceipt = false, workTabBinding?: { id: number; url: string; contextId?: string }, extra: { update?: { version: string; url: string }; reload?: boolean } = {}) {
  const session = new Map<string, unknown>([['connection', { port: 12345, token: 'test-token' }]]);
  const local = new Map<string, unknown>([['worker', 'worker-1']]);
  if (workTabBinding) local.set('workTabBinding', workTabBinding);
  const store = (values: Map<string, unknown>) => ({
    get: async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(k => [k, values.get(k)])),
    set: async (data: Record<string, unknown>) => { for (const [k, value] of Object.entries(data)) values.set(k, value); },
    remove: async (keys: string[]) => { for (const key of keys) values.delete(key); },
  });
  let listener!: (message: unknown, sender: unknown, reply: (value: unknown) => void) => unknown;
  let tick!: () => void;
  let first = true;
  const job = { id: 'request-1', kind: 'send', prompt: 'Test', model: 'Thinking' };
  const request = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    if (String(url).endsWith('/poll')) {
      const next = first ? job : null; first = false;
      return Response.json({ job: next, cancel: null, ...(extra.reload ? { reload: true } : {}) });
    }
    if (failReceipt) { failReceipt = false; throw new Error('temporary receipt failure'); }
    return Response.json({ acknowledged: JSON.parse(init?.body as string).id });
  });
  const updateTab = vi.fn(async () => ({ id: 7 }));
  const createTab = vi.fn(async () => ({ id: 7 }));
  const chrome = {
    i18n: { getMessage: (key: string, values: string[] | string = []) => String(JSON.parse(readFileSync("extension/_locales/pt_BR/messages.json", "utf8"))[key]?.message ?? key).replace(/\$(\d)/g, (_, n) => [values].flat()[Number(n) - 1] ?? '') },
    storage: { session: store(session), local: store(local) },
    tabs: { create: createTab, get: vi.fn(async (id: number) => ({ id, url: 'https://chatgpt.com/c/test' })), update: updateTab, sendMessage: vi.fn(async () => {}), remove: vi.fn(async () => {}), onRemoved: { addListener: vi.fn() } },
    runtime: { onMessage: { addListener: (fn: typeof listener) => { listener = fn; } }, getManifest: () => ({ version: '0.2.0' }), reload: vi.fn() },
    alarms: { create: vi.fn(async () => {}), onAlarm: { addListener: vi.fn() } },
  };
  const AraraUpdates = { freshness: async () => extra.update ?? null };
  runInNewContext(source, { chrome, fetch: request, crypto: webcrypto, AbortSignal, AraraUpdates, setInterval: (fn: () => void) => { tick = fn; } });
  if (!extra.update && !extra.reload) await vi.waitFor(() => expect(session.get('active')).toEqual(job));
  const send = (message: unknown, tabId = 7) => new Promise<unknown>(resolve => listener(message, { tab: { id: tabId }, url: 'https://chatgpt.com/' }, resolve));
  return { chrome, job, send, tick, request, session, local, createTab, updateTab, removeTab: chrome.tabs.remove, sendMessage: chrome.tabs.sendMessage, getTab: chrome.tabs.get, popup: (message: unknown) => new Promise<any>(resolve => listener(message, {}, resolve)) };
}
describe('outdated extension and self-update', () => {
  it('refuses work while a newer release exists, tells the IDE the version and shows it in the popup', async () => {
    const f = await fixture(false, undefined, { update: { version: '0.3.0', url: 'https://github.com/arara-ide/arara-browser/releases/download/v0.3.0/arara-browser-0.3.0.zip' } });
    await vi.waitFor(() => expect(f.request.mock.calls.some(([url]) => String(url).endsWith('/result'))).toBe(true));
    const poll = JSON.parse(f.request.mock.calls.find(([url]) => String(url).endsWith('/poll'))![1]!.body as string);
    expect(poll).toMatchObject({ version: '0.2.0', outdated: { latest: '0.3.0' } });
    const result = JSON.parse(f.request.mock.calls.find(([url]) => String(url).endsWith('/result'))![1]!.body as string);
    expect(result.result.error).toContain('0.3.0');
    expect(f.session.get('active')).toBeUndefined();
    expect(f.session.get('outdated')).toMatchObject({ current: '0.2.0', latest: '0.3.0' });
    expect(f.createTab).not.toHaveBeenCalled();
  });
  it('reloads itself when the IDE replaced the files and keeps the pairing across the reload', async () => {
    const f = await fixture(false, undefined, { reload: true });
    await vi.waitFor(() => expect(f.chrome.runtime.reload).toHaveBeenCalled());
    expect(f.local.get('reloadConnection')).toMatchObject({ connection: { port: 12345, token: 'test-token' } });
  });
});
describe('browser worker delivery', () => {
  it('initializes each context once and keeps subsequent prompts incremental', async () => {
    const f = await fixture();
    await f.send({ type: 'ready' });
    await f.send({ type: 'result', id: f.job.id, result: { text: 'Done' } });
    await vi.waitFor(() => expect(f.session.has('active')).toBe(false));
    for (const [id, contextId, prompt, expected] of [
      ['setup', 'conversation-a', 'opa', 'Instruções iniciais'],
      ['next', 'conversation-a', 'lista os arquivos', 'lista os arquivos'],
      ['tools', 'conversation-a', 'Resultados das ferramentas: src/', 'Resultados das ferramentas: src/'],
      ['new-context', 'conversation-b', 'outro pedido', 'Instruções iniciais'],
      ['return-context', 'conversation-a', 'voltei', 'voltei'],
    ]) {
      const job = { id, kind: 'send', contextId, initialPrompt: 'Instruções iniciais', prompt };
      f.request.mockResolvedValueOnce(Response.json({ job, cancel: null })); f.tick();
      await vi.waitFor(() => expect(f.session.get('active')).toEqual({ id, kind: 'send', contextId, prompt: expected }));
      if (id === 'setup' || id === 'new-context') {
        expect(await f.send({ type: 'ready' })).toMatchObject({ job: { prompt: expected } });
      } else {
        expect(f.sendMessage).toHaveBeenCalledWith(7, { type: 'job', job: { id, kind: 'send', contextId, prompt: expected } });
      }
      await f.send({ type: 'submitted', id });
      expect(f.local.get('workTabBinding')).toMatchObject({ id: 7, contextId });
      await f.send({ type: 'result', id, result: { text: 'Done' } });
      await vi.waitFor(() => expect(f.session.has('active')).toBe(false));
    }
    expect(f.updateTab).not.toHaveBeenCalled();
    expect(f.createTab).toHaveBeenCalledTimes(3);
    expect(Object.keys(f.local.get('conversationBindings') as object)).toEqual(['conversation-a', 'conversation-b']);
  });
  it('routes different IDE conversations to separate tabs and returns to the original tab', async () => {
    const f = await fixture();
    await f.send({ type: 'ready' });
    await f.send({ type: 'result', id: f.job.id, result: { text: 'Done' } });
    await vi.waitFor(() => expect(f.session.has('active')).toBe(false));
    f.getTab.mockImplementation(async id => ({ id, url: `https://chatgpt.com/c/chat-${id}` }));
    for (const [id, contextId, tabId, fresh] of [
      ['first', 'a', 8, true], ['second', 'b', 9, true], ['return', 'a', 8, false],
    ] as const) {
      if (fresh) f.createTab.mockResolvedValueOnce({ id: tabId });
      const job = { id, kind: 'send', contextId, prompt: 'Next', initialPrompt: 'Setup' };
      f.request.mockResolvedValueOnce(Response.json({ job, cancel: null })); f.tick();
      await vi.waitFor(() => expect(f.session.get('browserTab')).toBe(tabId));
      if (fresh) expect(await f.send({ type: 'ready' }, tabId)).toMatchObject({ job: { prompt: 'Setup' } });
      else expect(f.sendMessage).toHaveBeenCalledWith(tabId, { type: 'job', job: { id, kind: 'send', contextId, prompt: 'Next' } });
      await f.send({ type: 'submitted', id }, tabId);
      await f.send({ type: 'result', id, result: { text: 'Done' } }, tabId);
      await vi.waitFor(() => expect(f.session.has('active')).toBe(false));
    }
    expect(f.createTab).toHaveBeenCalledTimes(3);
    expect(f.local.get('conversationBindings')).toMatchObject({
      a: { id: 8, url: 'https://chatgpt.com/c/chat-8' }, b: { id: 9, url: 'https://chatgpt.com/c/chat-9' },
    });
  });
  it('restores the same conversation after extension reload clears session storage', async () => {
    const f = await fixture(false, { id: 7, url: 'https://chatgpt.com/c/test' });
    await vi.waitFor(() => expect(f.sendMessage).toHaveBeenCalledWith(7, { type: 'job', job: f.job }));
    expect(f.createTab).not.toHaveBeenCalled();
    expect(f.updateTab).not.toHaveBeenCalled();
    expect(f.session.get('workTab')).toBe(7);
  });
  it('reopens a saved context after its tab closes without resending setup', async () => {
    const f = await fixture(false, { id: 7, url: 'https://chatgpt.com/c/test', contextId: 'saved' });
    await f.send({ type: 'result', id: f.job.id, result: { text: 'Done' } });
    await vi.waitFor(() => expect(f.session.has('active')).toBe(false));
    f.getTab.mockRejectedValueOnce(new Error('Tab closed'));
    const job = { id: 'resume', kind: 'send', contextId: 'saved', prompt: 'Continue', initialPrompt: 'Full history' };
    f.request.mockResolvedValueOnce(Response.json({ job, cancel: null })); f.tick();
    await vi.waitFor(() => expect(f.createTab).toHaveBeenCalledWith({ url: 'https://chatgpt.com/c/test', active: false }));
    expect(await f.send({ type: 'ready' })).toMatchObject({ job: { prompt: 'Continue' } });
    const polls = f.request.mock.calls.filter(([url]) => String(url).endsWith('/poll'));
    expect(JSON.parse(polls.at(-1)![1]?.body as string).contexts).toContain('saved');
  });
  it('does not restore a tab whose URL no longer matches the saved conversation', async () => {
    const f = await fixture(false, { id: 7, url: 'https://chatgpt.com/c/another-conversation' });
    expect(f.createTab).toHaveBeenCalledTimes(1);
    expect(f.sendMessage).not.toHaveBeenCalled();
  });
  it('forwards revisions only from its active job without completing or resending it', async () => {
    const f = await fixture();
    await f.send({ type: 'ready' });
    expect(await f.send({ type: 'progress', id: 'old', text: 'Ignored' })).toMatchObject({ ok: false });
    expect(await f.send({ type: 'progress', id: f.job.id, text: 'Partial' })).toMatchObject({ ok: true });
    const progress = f.request.mock.calls.filter(([url]) => String(url).endsWith('/progress'));
    expect(progress).toHaveLength(1);
    expect(JSON.parse(progress[0][1]?.body as string)).toMatchObject({ id: f.job.id, text: 'Partial' });
    expect(f.session.has('active')).toBe(true);
    expect(f.session.has('completed')).toBe(false);
    expect(f.createTab).toHaveBeenCalledTimes(1);
  });
  it('never dispatches a prompt again after a page reload', async () => {
    const f = await fixture();
    expect(await f.send({ type: 'ready' })).toMatchObject({ job: f.job });
    expect(await f.send({ type: 'ready' })).toMatchObject({ job: null });
    await vi.waitFor(() => expect(f.session.has('active')).toBe(false));
    expect(f.createTab).toHaveBeenCalledTimes(1);
    const receipts = f.request.mock.calls.filter(([url]) => String(url).endsWith('/result'));
    expect(receipts).toHaveLength(1);
    expect(JSON.parse(receipts[0][1]?.body as string).result.error).toContain('Nenhuma mensagem foi reenviada');
  });
  it('retries a stored receipt after a network failure without sending again', async () => {
    const f = await fixture(true);
    await f.send({ type: 'ready' });
    expect(await f.send({ type: 'result', id: f.job.id, result: { text: 'Answer' } })).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(f.request.mock.calls.filter(([url]) => String(url).endsWith('/result'))).toHaveLength(1));
    f.tick();
    await vi.waitFor(() => expect(f.session.has('completed')).toBe(false));
    expect(f.request.mock.calls.filter(([url]) => String(url).endsWith('/result'))).toHaveLength(2);
    expect(f.createTab).toHaveBeenCalledTimes(1);
    expect(f.session.get('connection')).toMatchObject({ token: 'test-token' });
    expect(f.local.has('connection')).toBe(false);
  });
  it('discovers models repeatedly in the existing page without navigating it', async () => {
    const f = await fixture();
    await f.send({ type: 'ready' });
    await f.send({ type: 'result', id: f.job.id, result: { text: 'Done' } });
    await vi.waitFor(() => expect(f.session.has('active')).toBe(false));
    for (const id of ['models-1', 'models-2']) {
      const job = { id, kind: 'models' };
      f.request.mockResolvedValueOnce(Response.json({ job, cancel: null }));
      f.tick();
      await vi.waitFor(() => expect(f.sendMessage).toHaveBeenCalledWith(7, { type: 'job', job }));
      await f.send({ type: 'result', id, result: { models: [] } });
      await vi.waitFor(() => expect(f.session.has('active')).toBe(false));
    }
    expect(f.updateTab).not.toHaveBeenCalled();
    expect(f.createTab).toHaveBeenCalledTimes(1);
  });
  it('reuses only its dedicated ChatGPT tab for the next step', async () => {
    const f = await fixture();
    await f.send({ type: 'ready' });
    await f.send({ type: 'result', id: f.job.id, result: { text: 'Done' } });
    await vi.waitFor(() => expect(f.session.has('active')).toBe(false));
    f.request.mockResolvedValueOnce(Response.json({ job: { ...f.job, id: 'second' }, cancel: null }));
    f.tick();
    await vi.waitFor(() => expect(f.sendMessage).toHaveBeenCalledWith(7, { type: 'job', job: { ...f.job, id: 'second' } }));
    expect(f.updateTab).not.toHaveBeenCalled();
    expect(f.createTab).toHaveBeenCalledTimes(1);
  });
  it('keeps the conversation tab after cancellation and delivers the next prompt there', async () => {
    const f = await fixture();
    await f.send({ type: 'ready' });
    f.request.mockResolvedValueOnce(Response.json({ job: null, cancel: f.job.id }));
    f.tick();
    await vi.waitFor(() => expect(f.sendMessage).toHaveBeenCalledWith(7, { type: 'cancel', id: f.job.id }));
    expect(f.session.get('workTab')).toBe(7);
    expect(f.removeTab).not.toHaveBeenCalled();
    const job = { ...f.job, id: 'after-cancel' };
    f.request.mockResolvedValueOnce(Response.json({ job, cancel: null }));
    f.tick();
    await vi.waitFor(() => expect(f.sendMessage).toHaveBeenCalledWith(7, { type: 'job', job }));
    expect(f.createTab).toHaveBeenCalledTimes(1);
    expect(f.updateTab).not.toHaveBeenCalled();
  });
  it('reports a failed connection instead of claiming success', async () => {
    const f = await fixture();
    await f.popup({ type: 'disconnect' });
    f.request.mockResolvedValue(new Response('', { status: 403 }));
    const reply = await f.popup({ type: 'connect', connection: { port: 12345, token: 'a'.repeat(43) } });
    expect(reply.ok).toBe(false);
    expect(reply.error).toContain('não está conectada');
  });

});
