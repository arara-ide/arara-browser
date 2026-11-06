import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { unzipSync } from 'fflate';

const folder = await mkdtemp(join(tmpdir(), 'arara-browser-firefox-'));
let finish, fail, child, timer;
const completion = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
const site = createServer(async (req, res) => {
  if (req.url === '/result' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const result = JSON.parse(body);
    res.end('ok');
    if (result.error) fail(new Error(result.error));
    else finish(result);
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'" });
  res.end('<!doctype html><title>Firefox agent fixture</title><h1>Strict CSP</h1><input id="name" aria-label="Name"><button id="go">Go</button>');
});
try {
  await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${site.address().port}`;
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const extension = join(folder, 'extension');
  const artifact = process.env.ARARA_BROWSER_PACKAGE ?? `dist/arara-browser-${pkg.version}.xpi`;
  for (const [name, bytes] of Object.entries(unzipSync(await readFile(artifact)))) {
    await mkdir(dirname(join(extension, name)), { recursive: true });
    await writeFile(join(extension, name), bytes);
  }
  const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
  manifest.content_scripts = [];
  manifest.background.scripts.push('firefox-test.js');
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(join(extension, 'firefox-test.js'), `
    (async () => {
      const report = value => fetch(${JSON.stringify(url + '/result')}, { method: 'POST', body: JSON.stringify(value) });
      const check = (value, message) => { if (!value) throw new Error(message); };
      const run = async (action, args = {}) => {
        const result = await AraraAgent.execute({ action, args });
        if (result.error) throw new Error(action + ': ' + result.error);
        return result.text;
      };
      try {
        const saved = await chrome.storage.local.get('testTab');
        if (saved.testTab) {
          await run('select_page', { pageId: saved.testTab });
          check((await run('take_snapshot')).includes('Firefox agent fixture'), 'snapshot after extension reload');
          const [state] = await chrome.scripting.executeScript({ target: { tabId: saved.testTab }, func: () => ({ value: document.querySelector('#name').value, clicks: document.querySelector('#go').dataset.clicks, cursors: document.querySelectorAll('arara-cursor').length }) });
          check(state.result.value === 'Firefox' && state.result.clicks === '1' && state.result.cursors === 1, 'form and single cursor survive reload');
          await report({ ok: true });
          return;
        }
        const tab = await chrome.tabs.create({ url: ${JSON.stringify(url)} });
        await run('select_page', { pageId: tab.id });
        await AraraTabs.navigate({ type: 'reload' });
        const send = chrome.tabs.sendMessage.bind(chrome.tabs);
        chrome.tabs.sendMessage = (id, message, ...rest) => message.type === 'agentRun' ? Promise.reject(new Error('No content message reply')) : send(id, message, ...rest);
        const snapshot = await run('take_snapshot');
        check(snapshot.includes('Strict CSP'), 'recovery injects the packaged page agent under strict CSP');
        const field = /uid=(u\\d+) input\\[text\\] "Name"/.exec(snapshot)?.[1];
        const button = /uid=(u\\d+) button "Go"/.exec(snapshot)?.[1];
        check(field && button, 'snapshot exposes controls');
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => document.querySelector('#go').addEventListener('click', event => { event.currentTarget.dataset.clicks = String(Number(event.currentTarget.dataset.clicks || 0) + 1); event.currentTarget.textContent = 'Clicked'; }) });
        await run('fill', { uid: field, value: 'Firefox' });
        await run('click', { uid: button });
        check((await run('read', { selector: '#go' })).includes('Clicked'), 'read after click');
        await run('press_key', { key: 'Escape' });
        await chrome.storage.local.set({ testTab: tab.id });
        chrome.runtime.reload();
      } catch (error) { await report({ error: String(error.message || error) + '\\n' + String(error.stack || '') }); }
    })();
  `);
  const binary = process.env.ARARA_FIREFOX_BINARY ?? (process.platform === 'darwin' ? '/Applications/Firefox.app/Contents/MacOS/firefox' : 'firefox');
  const command = ['exec', '--yes', '--package=web-ext@10.8.0', '--', 'web-ext', 'run', '--no-config-discovery', '--source-dir', extension, '--firefox', binary, '--no-reload', '--no-input', '--args=-headless'];
  child = process.env.npm_execpath
    ? spawn(process.execPath, [process.env.npm_execpath, ...command], { detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
    : spawn('npm', command, { detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  child.on('error', fail);
  child.on('exit', code => { if (code) fail(new Error(`Firefox runner exited ${code}: ${output}`)); });
  timer = setTimeout(() => fail(new Error(`Firefox test timed out: ${output}`)), 60000);
  assert.deepEqual(await completion, { ok: true });
  console.log('Firefox packaged agent: strict CSP, missing content scripts, unavailable message replies, snapshot, fill, one click, read, key, reload and one cursor: PASS');
} finally {
  clearTimeout(timer);
  if (child?.pid) {
    if (process.platform === 'win32') child.kill();
    else { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
  }
  site.closeAllConnections();
  site.close();
  await rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
