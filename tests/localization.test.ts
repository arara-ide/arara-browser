import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';
const catalogs = ['en', 'pt_BR', 'es'].map(locale => JSON.parse(readFileSync(`extension/_locales/${locale}/messages.json`, 'utf8')) as Record<string, { message: string }>);
it('ships complete native Chrome catalogs with matching substitution parameters', () => {
  const params = (text: string) => [...text.matchAll(/\$\d+/g)].map(match => match[0]).sort();
  for (const catalog of catalogs) {
    expect(Object.keys(catalog).sort()).toEqual(Object.keys(catalogs[0]).sort());
    for (const [key, entry] of Object.entries(catalogs[0])) {
      expect(catalog[key].message.trim(), key).not.toBe('');
      expect(params(catalog[key].message), key).toEqual(params(entry.message));
    }
  }
  const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
  expect(manifest.default_locale).toBe('en');
  for (const ref of JSON.stringify(manifest).matchAll(/__MSG_(\w+)__/g)) expect(catalogs[0][ref[1]], ref[1]).toBeDefined();
});
it('resolves every static popup and runtime reference from the native catalogs', () => {
  for (const file of ['popup.js', 'background.js', 'content.js', 'cursor.js']) {
    for (const ref of readFileSync(`extension/${file}`, 'utf8').matchAll(/(?:chrome\.i18n\.getMessage\(|\bmessage\(|setText\('[^']+',\s*)'([^']+)'/g)) expect(catalogs[0][ref[1]], `${file}: ${ref[1]}`).toBeDefined();
  }
  for (const ref of readFileSync('extension/popup.html', 'utf8').matchAll(/data-i18n="([^"]+)"/g)) expect(catalogs[0][ref[1]], ref[1]).toBeDefined();
});

it('includes the Arara settings path and a short version label in each locale', () => {
  for (const [index, settings] of ['Settings', 'Configurações', 'Configuración'].entries()) {
    expect(catalogs[index].uiLanguage.message).toBe(['en', 'pt-BR', 'es'][index]);
    expect(catalogs[index].extensionName.message).toBe('Arara Browser');
    expect(catalogs[index].instructions.message).toContain(`Arara Code › ${settings} › Arara Browser`);
    expect(catalogs[index].current.message).toMatch(/^\S+ \$1$/);
  }
  expect(catalogs[1].documentBusy.message).toBe('Documento ocupado');
  expect(catalogs[2].documentBusy.message).toBe('Documento ocupado');
});

type StorageChanges = Record<string, { newValue?: unknown }>;
const translate = (key: string, value?: string) => (catalogs[1][key]?.message ?? key).replace('$1', value ?? '');
const code = { port: 12345, token: 'a'.repeat(43) };
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

function popup(overrides: Record<string, unknown> = {}, reads: { local?: () => Promise<unknown>; session?: () => Promise<unknown> } = {}) {
  const node = () => ({ value: '', textContent: '', hidden: false, disabled: false, type: 'password', dataset: {} as Record<string, string>, classList: { toggle() {} }, setAttribute() {}, removeAttribute() {}, focus: vi.fn(), contains: () => false, onclick: null as null | (() => Promise<void>), oninput: null as null | (() => void), onsubmit: null as null | ((event: { preventDefault: () => void }) => Promise<void>) });
  const elements: Record<string, ReturnType<typeof node>> = Object.fromEntries(['code', 'connection', 'connect', 'status', 'show', 'update-status', 'update', 'sites', 'pairing', 'connection-form', 'disconnect-note', 'sites-status', 'sites-result', 'sites-help', 'update-panel', 'update-help', 'update-result'].map(id => [id, node()]));
  const update = { version: '0.3.1', url: 'https://example.test/extension.zip', xpi: 'https://example.test/extension.xpi' };
  const downloads: string[] = [];
  const sendMessage = vi.fn(async (msg: { type: string }) => {
    if (msg.type === 'releaseCheck') return { update, failed: false };
    throw new Error('Could not establish connection. Receiving end does not exist.');
  });
  const storageListeners: Array<(change: StorageChanges, area: string) => void> = [];
  const local = { get: reads.local ?? (async () => ({})) };
  const session = { get: reads.session ?? (async () => ({})) };
  const chrome = {
    i18n: { getUILanguage: () => 'pt-BR', getMessage: translate },
    runtime: { sendMessage, getManifest: () => ({ version: '0.2.7' }) },
    storage: { local, session, onChanged: { addListener(listener: (change: StorageChanges, area: string) => void) { storageListeners.push(listener); } } },
    tabs: { create: vi.fn(async ({ url }: { url: string }) => { downloads.push(url); }) },
    permissions: { contains: async () => true, getAll: async () => ({ origins: [] }), onAdded: { addListener() {} }, onRemoved: { addListener() {} } },
  };
  Object.assign(chrome, overrides);
  const document = { documentElement: { lang: '' }, activeElement: null, querySelectorAll: () => [], getElementById: (id: string) => elements[id] };
  runInNewContext(readFileSync('extension/popup.js', 'utf8'), {
    document,
    navigator: { userAgent: 'Firefox/130' },
    chrome, atob, btoa, setTimeout: vi.fn(), clearTimeout: vi.fn(),
  });
  const emit = (area: string, key: string, newValue?: unknown) => storageListeners.forEach(listener => listener({ [key]: { newValue } }, area));
  const submit = () => elements['connection-form'].onsubmit?.({ preventDefault() {} }) ?? elements.connect.onclick!();
  return { elements, downloads, update, document, emit, submit, chrome };
}

it('shows localized popup errors when pairing code is malformed or runtime messaging fails', async () => {
  const { elements, downloads, update, submit } = popup();
  await flush();
  expect(elements.update.hidden).toBe(false);
  await elements.update.onclick!();
  expect(downloads).toEqual([update.xpi]);

  for (const raw of ['', 'not-base64!', btoa('null'), btoa(JSON.stringify({ port: 70000, token: 'a'.repeat(43) }))]) {
    elements.code.value = raw;
    await submit();
    expect(elements.status.textContent).toBe(catalogs[1].invalidCodeIde.message);
  }
  elements.code.value = btoa(JSON.stringify({ port: 12345, token: 'a'.repeat(43) }));
  await submit();
  expect(elements.status.textContent).toBe(catalogs[1].openIde.message);
});

it('keeps an acknowledged connection and shows a localized failure when disconnect is refused', async () => {
  const sendMessage = vi.fn(async ({ type }: { type: string }) => type === 'disconnect' ? { ok: false } : { update: null });
  const { elements, emit, submit } = popup({ runtime: { sendMessage, getManifest: () => ({ version: '0.2.7' }) } });
  await flush();
  emit('local', 'connection', code);
  emit('session', 'connectionStatus', { ok: true, time: Date.now() });
  expect(elements.connection.textContent).toBe(translate('connected'));
  await submit();
  expect(sendMessage).toHaveBeenCalledWith({ type: 'disconnect' });
  expect(elements.connection.textContent).toBe(translate('connected'));
  expect(elements.status.textContent).toBe(translate('disconnectFailed'));
});

it('preserves the edited code across storage updates and does not clear action feedback on a heartbeat', async () => {
  const { elements, emit, submit } = popup();
  await flush();
  elements.code.value = 'draft';
  elements.code.oninput?.();
  emit('local', 'connection', code);
  expect(elements.code.value).toBe('draft');
  await submit();
  emit('session', 'connectionStatus', { ok: false, time: Date.now() });
  expect(elements.status.textContent).toBe(translate('invalidCodeIde'));
});

it('reports an unknown state on a storage read failure and prefers newer observations to an initial snapshot', async () => {
  const failed = popup({}, { local: async () => { throw new Error('Raw storage error'); } });
  await flush();
  expect(failed.elements.connection.textContent).toBe(translate('connectionUnknown'));
  expect(failed.elements.status.textContent).toBe(translate('connectionReadFailed'));
  failed.emit('local', 'connection');
  expect(failed.elements.connection.textContent).toBe(translate('disconnected'));
  expect(failed.elements.status.textContent).toBe('');

  let resolve!: (snapshot: unknown) => void;
  const initial = new Promise(complete => { resolve = complete; });
  const current = popup({}, { local: () => initial });
  current.emit('local', 'connection', code);
  current.emit('session', 'connectionStatus', { ok: true, time: Date.now() });
  resolve({});
  await flush();
  expect(current.elements.connection.textContent).toBe(translate('connected'));
  current.emit('session', 'connectionStatus', { ok: true, time: Date.now() - 46000 });
  expect(current.elements.connection.textContent).toBe(translate('connectionOffline'));
});

it('updates partial and full site access after denial, grant and revocation without touching connection feedback', async () => {
  let origins = ['https://example.test/*'];
  const listeners: Array<() => void> = [];
  const event = { addListener: (listener: () => void) => listeners.push(listener) };
  const request = vi.fn(async () => false);
  const { elements } = popup({ permissions: {
    contains: async () => origins.includes('<all_urls>'),
    getAll: async () => ({ origins }),
    request,
    onAdded: event,
    onRemoved: event,
  } });
  await flush();
  expect(elements['sites-status'].textContent).toBe(translate('sitesPartial'));
  await elements.sites.onclick!();
  expect(request).toHaveBeenCalledWith({ origins: ['<all_urls>'] });
  expect(elements['sites-result'].textContent).toBe(translate('sitesDenied'));
  expect(elements.status.textContent).toBe('');
  for (const [next, label, hidden] of [[['<all_urls>'], 'sitesGranted', true], [[], 'sitesUnavailable', false]] as const) {
    origins = [...next];
    listeners.forEach(listener => listener());
    await flush();
    expect(elements['sites-status'].textContent).toBe(translate(label));
    expect(elements.sites.hidden).toBe(hidden);
  }
});

it('shows the update blocker even when connected, uses a cached update on check failure and handles a rejected download', async () => {
  const { elements, emit, update } = popup({ tabs: { create: async () => { throw new Error('Raw browser error'); } } });
  await flush();
  emit('local', 'connection', code);
  emit('session', 'connectionStatus', { ok: true, time: Date.now() });
  emit('local', 'releaseCheck', { current: '0.2.7', update, failed: true });
  expect(elements.connection.textContent).toBe(translate('connected'));
  expect(elements['update-status'].textContent).toBe(translate('updateRequired', update.version));
  expect(elements['update-panel'].dataset.blocking).toBe('true');
  await elements.update.onclick!();
  expect(elements['update-result'].textContent).toBe(translate('updateOpenFailed'));
  expect(elements.update.disabled).toBe(false);
});
