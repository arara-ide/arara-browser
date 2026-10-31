import { chromium } from 'playwright';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { unzipSync } from 'fflate';
import assert from 'node:assert/strict';

const profile = await mkdtemp(join(tmpdir(), 'arara-browser-compat-'));
const extension = resolve(profile, 'extension');
await mkdir(extension);
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const zip = await readFile(`dist/arara-browser-${pkg.version}.zip`);
for (const [name, contents] of Object.entries(unzipSync(zip))) {
  assert.match(name, /^(?:[A-Za-z0-9][A-Za-z0-9._-]*|_locales\/(?:en|pt_BR|es)\/messages\.json)$/);
  await mkdir(dirname(join(extension, name)), { recursive: true });
  await writeFile(join(extension, name), contents);
}
const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).hostname;
  assert.equal(await worker.evaluate(() => chrome.runtime.getManifest().version), manifest.version);
  let release = { tag_name: 'v99.0.0', assets: [{ name: 'arara-browser-99.0.0.zip', state: 'uploaded', browser_download_url: 'https://github.com/arara-ide/arara-browser/releases/download/v99.0.0/arara-browser-99.0.0.zip' }] };
  await context.route('https://api.github.com/**', route => route.fulfill({ json: release }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`chrome-extension://${id}/popup.html`);
  await page.locator('#update:not([hidden])').waitFor();
  assert.match(await page.locator('#update-status').innerText(), /99\.0\.0/);
  await page.evaluate(() => { chrome.tabs.create = async ({ url }) => { window.downloadUrl = url; }; });
  await page.locator('#update').click();
  assert.equal(await page.evaluate(() => window.downloadUrl), release.assets[0].browser_download_url);
  release = { tag_name: `v${manifest.version}`, assets: [] };
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#update-status').textContent === chrome.i18n.getMessage('current', chrome.runtime.getManifest().version));
  assert.equal(await page.locator('#update').isVisible(), false);
  await context.unroute('https://api.github.com/**');
  await context.route('https://api.github.com/**', route => route.fulfill({ status: 403, body: 'rate limit' }));
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#update-status').textContent === chrome.i18n.getMessage('updateFailed', chrome.runtime.getManifest().version));
  assert.equal(await page.locator('#connect').isEnabled(), true);
  await worker.evaluate(() => chrome.storage.local.set({ releaseCheck: { current: chrome.runtime.getManifest().version, checked: Date.now(), update: null } }));
  await page.locator('#outdated').waitFor({ state: 'hidden' });
  const zipUrl = 'https://github.com/arara-ide/arara-browser/releases/download/v99.0.0/arara-browser-99.0.0.zip';
  await worker.evaluate(url => chrome.storage.local.set({ releaseCheck: { current: chrome.runtime.getManifest().version, checked: Date.now(), update: { version: '99.0.0', url } } }), zipUrl);
  await page.locator('#outdated').waitFor({ timeout: 8000 });
  assert.match(await page.locator('#outdated-body').innerText(), /99\.0\.0/);
  await page.evaluate(() => { chrome.tabs.create = async ({ url }) => { window.downloadUrl = url; }; });
  await page.locator('#outdated-download').click();
  assert.equal(await page.evaluate(() => window.downloadUrl), zipUrl);
  await worker.evaluate(() => chrome.storage.local.set({ releaseCheck: { current: chrome.runtime.getManifest().version, checked: Date.now(), update: null } }));
  await page.locator('#outdated').waitFor({ state: 'hidden', timeout: 8000 });
  assert.deepEqual(errors, []);
  console.log(`Manifest V3, service worker, popup and update flow: PASS (Chromium ${context.browser().version()})`);
} finally { await context.close(); await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
