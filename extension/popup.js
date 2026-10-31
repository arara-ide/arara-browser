document.documentElement.lang = chrome.i18n.getUILanguage();
for (const element of document.querySelectorAll('[data-i18n]')) element.textContent = chrome.i18n.getMessage(element.dataset.i18n);
const q = id => document.getElementById(id);
const encode = value => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function render({ code, connected, notice }) {
  if (code !== undefined) q('code').value = code;
  if (connected !== undefined) {
    q('connection').textContent = connected ? chrome.i18n.getMessage('connected') : chrome.i18n.getMessage('disconnected');
    q('connection').dataset.connected = String(connected);
    q('connect').textContent = chrome.i18n.getMessage(connected ? 'disconnect' : 'connect');
    q('connect').classList.toggle('secondary', connected);
    q('connect').dataset.connected = String(connected);
  }
  if (notice !== undefined) q('status').textContent = notice;
}
const action = type => chrome.runtime.sendMessage({ type });
q('show').onclick = () => {
  const show = q('code').type === 'password';
  q('code').type = show ? 'text' : 'password';
  q('show').textContent = show ? chrome.i18n.getMessage('hide') : chrome.i18n.getMessage('show');
  q('show').setAttribute('aria-pressed', String(show));
};
async function disconnect() {
  await action('disconnect'); render({ code: '', connected: false, notice: chrome.i18n.getMessage('disconnectedNotice') });
}
async function connect() {
  try {
    const connection = JSON.parse(atob(q('code').value.trim().replace(/-/g, '+').replace(/_/g, '/')));
    if (!Number.isInteger(connection.port) || connection.port < 1 || connection.port > 65535 || !/^[\w-]{40,100}$/.test(connection.token)) throw new Error(chrome.i18n.getMessage('invalidCodeIde'));
    const result = await chrome.runtime.sendMessage({ type: 'connect', connection });
    render({ connected: result.ok, notice: result.ok ? chrome.i18n.getMessage('ready') : result.error || chrome.i18n.getMessage('openIde') });
  } catch (error) { render({ connected: false, notice: error.message }); }
}
q('connect').onclick = async () => {
  q('connect').disabled = true;
  try { await (q('connect').dataset.connected === 'true' ? disconnect() : connect()); }
  finally { q('connect').disabled = false; }
};
  chrome.storage.session.get(['connection', 'connectionStatus']).then(({ connection, connectionStatus }) => {
    render({ code: connection ? encode(connection) : '', connected: connectionStatus?.ok === true && Date.now() - connectionStatus.time < 45000 });
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && changes.connection) render({ code: changes.connection.newValue ? encode(changes.connection.newValue) : '' });
    if (area === 'session' && changes.connectionStatus) render({ connected: changes.connectionStatus.newValue?.ok === true });
  });

async function checkUpdate() {
  const current = chrome.runtime.getManifest().version;
  q('update-status').textContent = chrome.i18n.getMessage('checking', String(current));
  try {
    const update = await AraraUpdates.check(current);
    q('update-status').textContent = update ? chrome.i18n.getMessage('available', String(update.version)) : chrome.i18n.getMessage('current', String(current));
    q('update').hidden = !update;
    if (update) q('update').onclick = () => chrome.tabs.create({ url: update.url });
  } catch {
    q('update-status').textContent = chrome.i18n.getMessage('updateFailed', String(current));
  }
}
void checkUpdate();
const allSites = { origins: ['<all_urls>'] };
async function renderSites() { q('sites').hidden = await chrome.permissions.contains(allSites); }
q('sites').onclick = async () => {
  const granted = await chrome.permissions.request(allSites).catch(() => false);
  render({ notice: chrome.i18n.getMessage(granted ? 'sitesAllowed' : 'sitesDenied') });
  await renderSites();
};
void renderSites();
const firefox = /Firefox\//.test(navigator.userAgent);
function renderOutdated(outdated) {
  q('outdated').hidden = !outdated;
  if (!outdated) return;
  q('outdated-body').textContent = chrome.i18n.getMessage('outdatedBody', [outdated.current, outdated.latest]);
  q('outdated-manual').textContent = chrome.i18n.getMessage(firefox ? 'outdatedManualFirefox' : 'outdatedManual');
  q('outdated-download').onclick = () => chrome.tabs.create({ url: (firefox && outdated.xpi) || outdated.url });
}
async function checkOutdated() {
  const current = chrome.runtime.getManifest().version;
  const update = await AraraUpdates.freshness(current, chrome.storage.local).catch(() => null);
  renderOutdated(update ? { current, latest: update.version, url: update.url, xpi: update.xpi } : null);
}
void checkOutdated();
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.releaseCheck) void checkOutdated(); });
