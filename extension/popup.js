document.documentElement.lang = chrome.i18n.getUILanguage();
for (const element of document.querySelectorAll('[data-i18n]')) element.textContent = chrome.i18n.getMessage(element.dataset.i18n);
const q = id => document.getElementById(id);
const encode = value => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function render({ code, connected, notice }) {
  if (code !== undefined) q('code').value = code;
  if (connected !== undefined) {
    const state = String(connected);
    if (q('connection').dataset.connected !== state) {
      q('connection').textContent = chrome.i18n.getMessage(connected ? 'connected' : 'disconnected');
      q('connection').dataset.connected = state;
      q('status').textContent = '';
    }
    q('pairing').hidden = connected;
    q('show').hidden = connected;
    if (connected) setCodeVisibility(false);
    q('connect').textContent = chrome.i18n.getMessage(connected ? 'disconnect' : 'connect');
    q('connect').classList.toggle('secondary', connected);
    q('connect').dataset.connected = String(connected);
  }
  if (notice !== undefined) q('status').textContent = notice;
}
const action = type => chrome.runtime.sendMessage({ type });
function setCodeVisibility(show) {
  q('code').type = show ? 'text' : 'password';
  q('show').textContent = show ? chrome.i18n.getMessage('hide') : chrome.i18n.getMessage('show');
}
q('show').onclick = () => setCodeVisibility(q('code').type === 'password');
async function disconnect() {
  await action('disconnect'); render({ code: '', connected: false, notice: '' });
}
async function connect() {
  let connection;
  try {
    connection = JSON.parse(atob(q('code').value.trim().replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    render({ connected: false, notice: chrome.i18n.getMessage('invalidCodeIde') });
    return;
  }
  if (!connection || typeof connection !== 'object' || !Number.isInteger(connection.port) || connection.port < 1 || connection.port > 65535 || !/^[\w-]{40,100}$/.test(connection.token)) {
    render({ connected: false, notice: chrome.i18n.getMessage('invalidCodeIde') });
    return;
  }
  try {
    const result = await chrome.runtime.sendMessage({ type: 'connect', connection });
    render({ connected: result?.ok === true, notice: result?.ok ? '' : result?.error || chrome.i18n.getMessage('openIde') });
  } catch {
    render({ connected: false, notice: chrome.i18n.getMessage('openIde') });
  }
}
q('connect').onclick = async () => {
  q('connect').disabled = true;
  try { await (q('connect').dataset.connected === 'true' ? disconnect() : connect()); }
  finally { q('connect').disabled = false; }
};
Promise.all([chrome.storage.local.get('connection'), chrome.storage.session.get('connectionStatus')]).then(([{ connection }, { connectionStatus }]) => {
  render({ code: connection ? encode(connection) : '', connected: connectionStatus?.ok === true && Date.now() - connectionStatus.time < 45000 });
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.connection) render({ code: changes.connection.newValue ? encode(changes.connection.newValue) : '' });
  if (area === 'session' && changes.connectionStatus) render({ connected: changes.connectionStatus.newValue?.ok === true });
});

const current = chrome.runtime.getManifest().version;
const firefox = /Firefox\//.test(navigator.userAgent);
function renderUpdate({ update, failed }) {
  const status = update ? chrome.i18n.getMessage('available', update.version) : chrome.i18n.getMessage(failed ? 'updateFailed' : 'current', current);
  if (q('update-status').textContent !== status) q('update-status').textContent = status;
  q('update').hidden = !update;
  q('update').onclick = update ? () => chrome.tabs.create({ url: (firefox && update.xpi) || update.url }) : null;
}
renderUpdate({});
void action('releaseCheck').then(renderUpdate).catch(() => renderUpdate({ failed: true }));
chrome.storage.onChanged.addListener((changes, area) => {
  const release = changes.releaseCheck?.newValue;
  if (area === 'local' && release?.current === current) renderUpdate(release);
});

const allSites = { origins: ['<all_urls>'] };
async function renderSites() { q('sites').hidden = await chrome.permissions.contains(allSites); }
q('sites').onclick = async () => {
  const granted = await chrome.permissions.request(allSites).catch(() => false);
  render({ notice: chrome.i18n.getMessage(granted ? 'sitesAllowed' : 'sitesDenied') });
  await renderSites();
};
void renderSites();
