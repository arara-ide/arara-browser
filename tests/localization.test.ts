import { readFileSync } from 'node:fs';
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
