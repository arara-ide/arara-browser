import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
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
const token = randomBytes(32).toString('base64url');
let release = { tag_name: 'v99.0.0', assets: [{ name: 'arara-browser-99.0.0.zip', state: 'uploaded', browser_download_url: 'https://github.com/arara-ide/arara-browser/releases/download/v99.0.0/arara-browser-99.0.0.zip' }] };
let releaseStatus = 200, releaseRequests = 0;
const ide = createServer((request, response) => {
  request.resume();
  if (request.url === '/release') { releaseRequests++; return response.writeHead(releaseStatus, { 'content-type': 'application/json' }).end(JSON.stringify(release)); }
  if (request.url === '/cursor-fixture') return response.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>Cursor fixture</title><input aria-label="Fixture control" id="fixture-control">');
  if (request.headers.authorization !== `Bearer ${token}`) return response.writeHead(403).end();
  if (request.method !== 'POST' || request.url !== '/poll') return response.writeHead(404).end();
  response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ job: null, cancel: null }));
});
try {
  await new Promise(resolve => ide.listen(0, '127.0.0.1', resolve));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).hostname;
  assert.equal(await worker.evaluate(() => chrome.runtime.getManifest().version), manifest.version);
  await worker.evaluate(url => { const original = globalThis.fetch; globalThis.fetch = (input, options) => original(String(input).startsWith('https://api.github.com/') ? url : input, options); }, `http://127.0.0.1:${ide.address().port}/release`);
  await worker.evaluate(async () => { await poll(); await chrome.storage.local.remove('releaseCheck'); });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`chrome-extension://${id}/popup.html`);
  await page.locator('#update:not([hidden])').waitFor().catch(async error => { console.error({ status: await page.locator('#update-status').innerText(), cache: await worker.evaluate(() => chrome.storage.local.get('releaseCheck')), errors, releaseRequests }); throw error; });
  assert.match(await page.locator('#update-status').innerText(), /99\.0\.0/);
  const initialViewport = page.viewportSize();
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 600 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.equal(overflow, 0, `popup has no horizontal overflow at ${width} CSS px`);
  }
  await page.setViewportSize(initialViewport);
  await page.evaluate(() => { chrome.tabs.create = async ({ url }) => { window.downloadUrl = url; }; });
  await page.locator('#update').click();
  assert.equal(await page.evaluate(() => window.downloadUrl), release.assets[0].browser_download_url);
  const cachedRequests = releaseRequests;
  release = { tag_name: `v${manifest.version}`, assets: [] };
  await page.reload();
  await page.locator('#update:not([hidden])').waitFor();
  assert.equal(releaseRequests, cachedRequests, 'reopening the popup reuses the twelve-hour background cache');
  const expire = () => worker.evaluate(async () => { const { releaseCheck } = await chrome.storage.local.get('releaseCheck'); await chrome.storage.local.set({ releaseCheck: { ...releaseCheck, checked: Date.now() - 12 * 60 * 60 * 1000, failed: false } }); });
  await expire();
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#update-status').textContent === chrome.i18n.getMessage('current', chrome.runtime.getManifest().version));
  assert.equal(await page.locator('#update').isVisible(), false);
  releaseStatus = 403;
  await expire();
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#update-status').textContent === chrome.i18n.getMessage('updateFailed', chrome.runtime.getManifest().version));
  const failedRequests = releaseRequests;
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#update-status').textContent === chrome.i18n.getMessage('updateFailed', chrome.runtime.getManifest().version));
  await worker.evaluate(async () => { for (let i = 0; i < 10; i++) await poll(); });
  assert.equal(releaseRequests, failedRequests, 'popup reopen and background polling respect the ten-minute failure cooldown');
  assert.equal(await page.locator('#connect').isEnabled(), true);
  const message = key => page.evaluate(name => chrome.i18n.getMessage(name), key);
  assert.equal(await page.locator('#copy, #disconnect, #chatgpt').count(), 0, 'one connection button, no copy or ChatGPT buttons');
  assert.equal(await page.locator('#connect').innerText(), await message('connect'));
  assert.equal(await page.locator('.code-field button').count(), 0, 'Show sits below the field');
  assert.equal(await page.locator('#pairing').isVisible(), true);
  assert.equal(await page.locator('#show').isVisible(), true);
  await page.locator('#code').focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'connect');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'show');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'connect');
  await page.locator('#code').fill('invalid-code');
  await page.locator('#code').press('Enter');
  await page.waitForFunction(() => document.querySelector('#status').textContent === chrome.i18n.getMessage('invalidCodeIde') && !document.querySelector('#connect').disabled);
  assert.equal(await page.locator('#code').getAttribute('aria-invalid'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'code');
  await page.locator('#code').fill('');
  await worker.evaluate(connection => chrome.storage.local.set({ connection }), { port: ide.address().port, token });
  await page.waitForFunction(text => document.querySelector('#connect').textContent === text, await message('disconnect'));
  const connectedAt = await worker.evaluate(async () => (await chrome.storage.session.get('connectionStatus')).connectionStatus.time);
  await page.waitForFunction(async time => {
    const { connectionStatus } = await chrome.storage.session.get('connectionStatus');
    return connectionStatus?.ok === true && connectionStatus.time > time;
  }, connectedAt);
  assert.equal(await page.locator('#connect').innerText(), await message('disconnect'));
  assert.equal(await page.locator('#connect').evaluate(node => node.classList.contains('secondary')), true);
  assert.equal(await page.locator('#pairing').isVisible(), false);
  assert.equal(await page.locator('#show').isVisible(), false);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'connect');
  assert.equal(await page.locator('#status').innerText(), '');
  await page.locator('#connect').click();
  await page.waitForFunction(() => document.querySelector('#connect').textContent === chrome.i18n.getMessage('connect') && !document.querySelector('#connect').disabled);
  assert.equal(await page.locator('#pairing').isVisible(), true);
  assert.equal(await page.locator('#show').isVisible(), true);
  assert.equal(await page.locator('#status').innerText(), '');
  assert.equal(await page.locator('#code').inputValue(), '');
  await worker.evaluate(() => chrome.storage.local.set({ releaseCheck: { current: chrome.runtime.getManifest().version, checked: Date.now(), update: null } }));
  await page.locator('#update').waitFor({ state: 'hidden' });
  const zipUrl = 'https://github.com/arara-ide/arara-browser/releases/download/v99.0.0/arara-browser-99.0.0.zip';
  await worker.evaluate(url => chrome.storage.local.set({ releaseCheck: { current: chrome.runtime.getManifest().version, checked: Date.now(), update: { version: '99.0.0', url } } }), zipUrl);
  await page.locator('#update').waitFor({ timeout: 8000 });
  assert.match(await page.locator('#update-status').innerText(), /99\.0\.0/);
  await page.evaluate(() => { chrome.tabs.create = async ({ url }) => { window.downloadUrl = url; }; });
  await page.locator('#update').click();
  assert.equal(await page.evaluate(() => window.downloadUrl), zipUrl);
  await worker.evaluate(() => chrome.storage.local.set({ releaseCheck: { current: chrome.runtime.getManifest().version, checked: Date.now(), update: null } }));
  await page.locator('#update').waitFor({ state: 'hidden', timeout: 8000 });
  assert.deepEqual(errors, []);

  for (const locale of ['en', 'pt_BR', 'es']) {
    const catalog = JSON.parse(await readFile(join(extension, '_locales', locale, 'messages.json'), 'utf8'));
    const localized = await context.newPage();
    await localized.addInitScript(messages => {
      chrome.i18n.getMessage = (key, value) => messages[key]?.message.replace('$1', value ?? '') ?? '';
    }, catalog);
    await localized.setViewportSize({ width: 320, height: 600 });
    await localized.goto(`chrome-extension://${id}/popup.html`);
    assert.equal(await localized.locator('html').getAttribute('lang'), catalog.uiLanguage.message);
    assert.equal(await localized.locator('#instructions').innerText(), catalog.instructions.message);
    assert.equal(await localized.locator('#sites-help').innerText(), catalog.sitesHelp.message);
    await localized.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    assert.equal(await localized.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, `${locale} reflows at 200% text size`);
    await localized.close();
  }

  await page.emulateMedia({ colorScheme: 'light' });
  const light = await page.locator('body').evaluate(element => getComputedStyle(element).backgroundColor);
  await page.emulateMedia({ colorScheme: 'dark' });
  const dark = await page.locator('body').evaluate(element => getComputedStyle(element).backgroundColor);
  assert.notEqual(light, dark, 'popup follows the browser color scheme');
  await page.emulateMedia({ forcedColors: 'active' });
  await page.locator('#code').focus();
  await page.keyboard.press('Tab');
  assert.notEqual(await page.locator('#connect').evaluate(element => getComputedStyle(element).outlineStyle), 'none');

  const cursor = await context.newPage();
  await cursor.emulateMedia({ reducedMotion: 'reduce' });
  const fixtureUrl = `http://127.0.0.1:${ide.address().port}/cursor-fixture`;
  await cursor.goto(fixtureUrl);
  await cursor.locator('#fixture-control').focus();
  const accessibility = await context.newCDPSession(cursor);
  const cursorTab = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, fixtureUrl);
  const renderCursor = active => worker.evaluate(async ({ tabId, active }) => {
    const [result] = await chrome.scripting.executeScript({ target: { tabId }, args: [active], func: active => {
      globalThis.AraraCursor.render({ active, label: chrome.i18n.getMessage('agentWorking') });
      return chrome.i18n.getMessage(active ? 'agentWorking' : 'agentFinished');
    } });
    return result.result;
  }, { tabId: cursorTab, active });
  for (const active of [true, false]) {
    const announcement = await renderCursor(active);
    await expectAnnouncement(accessibility, announcement);
    assert.equal(await cursor.locator('arara-cursor').count(), Number(active));
    assert.equal(await cursor.evaluate(() => window.document.activeElement.id), 'fixture-control');
  }
  console.log(`Manifest V3, service worker, popup connection and updates, keyboard, reflow at 320/390 px, three catalogs, contrast modes and cursor live region: PASS (Chromium ${context.browser().version()})`);
} finally {
  try { await context.close(); }
  finally {
    ide.closeAllConnections();
    await new Promise((resolve, reject) => ide.close(error => error ? reject(error) : resolve()));
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

async function expectAnnouncement(accessibility, announcement) {
  const deadline = Date.now() + 5000;
  do {
    const { nodes } = await accessibility.send('Accessibility.getFullAXTree');
    const status = nodes.find(node => node.role?.value === 'status' && node.properties?.some(property => property.name === 'live' && property.value.value === 'polite'));
    if (nodes.some(node => node.parentId === status?.nodeId && node.name?.value === announcement)) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  } while (Date.now() < deadline);
  assert.fail(`cursor live region did not expose: ${announcement}`);
}
