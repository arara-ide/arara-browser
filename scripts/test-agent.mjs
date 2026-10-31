import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { unzipSync } from 'fflate';
import assert from 'node:assert/strict';

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const PAGE = '<!doctype html><title>Form</title><h1>Agent test</h1><input id="name" aria-label="Name"><button id="go" onclick="document.querySelector(\'#out\').textContent=\'Hello \'+document.querySelector(\'#name\').value;console.log(\'clicked\')">Greet</button><p id="out"></p>';
const site = createServer((req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE));
const sitePort = await listen(site);
const queue = [], results = new Map();
const token = 'a'.repeat(48);
const ide = createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  if (req.headers.authorization !== `Bearer ${token}`) return res.writeHead(403).end();
  const body = JSON.parse(raw || '{}');
  const reply = value => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(value));
  if (req.url === '/poll') return reply({ job: null, cancel: null, agent: queue.length > 0 });
  if (req.url === '/agent/poll') return reply({ command: queue.shift() ?? null });
  if (req.url === '/agent/result') { results.get(body.id)?.(body.result); return reply({}); }
  reply({});
});
const idePort = await listen(ide);
const profile = await mkdtemp(join(tmpdir(), 'arara-browser-agent-'));
const extension = join(profile, 'extension');
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
for (const [name, contents] of Object.entries(unzipSync(await readFile(`dist/arara-browser-${pkg.version}.zip`)))) {
  await mkdir(dirname(join(extension, name)), { recursive: true });
  await writeFile(join(extension, name), contents);
}
const context = await chromium.launchPersistentContext(join(profile, 'user'), { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const url = `http://127.0.0.1:${sitePort}/`;
  const first = await context.newPage(); await first.goto(url);
  const second = await context.newPage(); await second.goto(`${url}?second`);
  await first.bringToFront();
  await worker.evaluate(connection => chrome.storage.session.set({ connection }), { port: idePort, token });
  let sequence = 0;
  const run = (action, args = {}) => new Promise(resolve => { const id = `c${++sequence}`; results.set(id, resolve); queue.push({ id, action, args }); });
  const pages = (await run('list_pages')).text.split('\n');
  const firstId = Number(/pageId=(\d+)/.exec(pages.find(line => line.endsWith(url)) ?? '')?.[1]);
  assert.ok(Number.isInteger(firstId), pages.join('\n'));
  await run('select_page', { pageId: firstId, bringToFront: false });
  const snapshot = await run('take_snapshot');
  const field = /uid=(u\d+) [^\n]*"Name"/.exec(snapshot.text)?.[1], button = /uid=(u\d+) button "Greet"/.exec(snapshot.text)?.[1];
  assert.ok(field && button, snapshot.text);
  const typingStarted = Date.now();
  assert.ok(!(await run('fill', { uid: field, value: 'Arara' })).error);
  const typingMs = Date.now() - typingStarted;
  assert.ok(typingMs >= 5 * 80, `typing finished after the 700 cpm animation (${typingMs} ms)`);
  assert.equal(await first.locator('#name').inputValue(), 'Arara');
  assert.ok(!(await run('click', { uid: button })).error);
  assert.equal(await first.locator('#out').innerText(), 'Hello Arara');
  assert.match((await run('read', { selector: '#out' })).text, /Hello Arara/);
  assert.match((await run('list_console_messages')).text, /clicked/);
  assert.equal((await run('evaluate_script', { function: '() => document.title' })).text, '"Form"');
  assert.equal(await first.locator('arara-cursor').count(), 1);
  assert.equal(await second.locator('arara-cursor').count(), 1);
  const shot = await run('take_screenshot');
  assert.equal(shot.images?.[0]?.mimeType, 'image/png');
  console.log(`Agent in the user's tabs (snapshot, fill, click, read, console, script, screenshot, cursor in 2 tabs): PASS (Chromium ${context.browser()?.version() ?? ''})`);
} finally {
  await context.close(); site.close(); ide.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
