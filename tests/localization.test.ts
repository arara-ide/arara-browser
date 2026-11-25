import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';
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
  for (const file of ['popup.js', 'background.js', 'content.js']) {
    for (const ref of readFileSync(`extension/${file}`, 'utf8').matchAll(/chrome\.i18n\.getMessage\('([^']+)'/g)) expect(catalogs[0][ref[1]], `${file}: ${ref[1]}`).toBeDefined();
  }
  for (const ref of readFileSync('extension/popup.html', 'utf8').matchAll(/data-i18n="([^"]+)"/g)) expect(catalogs[0][ref[1]], ref[1]).toBeDefined();
});

it('includes the Arara settings path and a short version label in each locale', () => {
  for (const [index, settings] of ['Settings', 'Configurações', 'Configuración'].entries()) {
    expect(catalogs[index].instructions.message).toContain(`Arara Code › ${settings} › Arara Browser`);
    expect(catalogs[index].current.message).toMatch(/^\S+ \$1$/);
  }
  expect(catalogs[1].documentBusy.message).toBe('Documento ocupado');
  expect(catalogs[2].documentBusy.message).toBe('Documento ocupado');
});

it('shows localized popup errors when pairing code is malformed or runtime messaging fails', async () => {
  const node = () => ({ value: '', textContent: '', hidden: false, disabled: false, type: 'password', dataset: {} as Record<string, string>, classList: { toggle() {} }, setAttribute() {}, onclick: null as null | (() => Promise<void>) });
  const elements: Record<string, ReturnType<typeof node>> = Object.fromEntries(['code', 'connection', 'connect', 'status', 'show', 'update-status', 'update', 'sites', 'pairing'].map(id => [id, node()]));
  const update = { version: '0.3.1', url: 'https://example.test/extension.zip', xpi: 'https://example.test/extension.xpi' };
  const downloads: string[] = [];
  const sendMessage = async (msg: { type: string }) => {
    if (msg.type === 'releaseCheck') return { update, failed: false };
    throw new Error('Could not establish connection. Receiving end does not exist.');
  };
  const chrome = {
    i18n: { getUILanguage: () => 'pt-BR', getMessage: (key: string) => catalogs[1][key]?.message ?? key },
    runtime: { sendMessage, getManifest: () => ({ version: '0.2.7' }) },
    storage: { local: { get: async () => ({}) }, session: { get: async () => ({}) }, onChanged: { addListener() {} } },
    tabs: { create: async ({ url }: { url: string }) => { downloads.push(url); } },
    permissions: { contains: async () => true },
  };
  runInNewContext(readFileSync('extension/popup.js', 'utf8'), {
    document: { documentElement: { lang: '' }, querySelectorAll: () => [], getElementById: (id: string) => elements[id] },
    navigator: { userAgent: 'Firefox/130' },
    chrome, atob, btoa,
  });
  await Promise.resolve();
  expect(elements.update.hidden).toBe(false);
  await elements.update.onclick!();
  expect(downloads).toEqual([update.xpi]);

  for (const raw of ['', 'not-base64!', btoa('null'), btoa(JSON.stringify({ port: 70000, token: 'a'.repeat(43) }))]) {
    elements.code.value = raw;
    await elements.connect.onclick!();
    expect(elements.status.textContent).toBe(catalogs[1].invalidCodeIde.message);
  }
  elements.code.value = btoa(JSON.stringify({ port: 12345, token: 'a'.repeat(43) }));
  await elements.connect.onclick!();
  expect(elements.status.textContent).toBe(catalogs[1].openIde.message);
});
