const message = (key, value) => chrome.i18n.getMessage(key, value);
document.documentElement.lang = message('uiLanguage');
for (const element of document.querySelectorAll('[data-i18n]')) element.textContent = message(element.dataset.i18n);
const q = id => document.getElementById(id);
const action = type => chrome.runtime.sendMessage({ type });
const encode = value => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const freshness = 45000;
const pairingErrors = new Set(['invalidCode', 'expiredCode', 'ideUnexpectedResponse', 'disconnectedByIde', 'stopFirst']);
const failedReads = new Set();
let savedConnection, connectionStatus, pending, expiry;
let ready = false, editing = false, invalid = false, connectionRevision = 0, statusRevision = 0;

function setText(id, key, value) {
  const text = key ? message(key, value) : '';
  if (q(id).textContent !== text) q(id).textContent = text;
}

function connected() {
  return Boolean(savedConnection && connectionStatus?.ok && Date.now() - connectionStatus.time < freshness);
}

function setCodeVisibility(show) {
  q('code').type = show ? 'text' : 'password';
  setText('show', show ? 'hide' : 'show');
}

function syncCode() {
  if (editing) return;
  q('code').value = savedConnection ? encode(savedConnection) : '';
  setCodeVisibility(false);
}

function renderConnection() {
  clearTimeout(expiry);
  const online = connected();
  const button = q('connect');
  const focusInPairing = online && (q('pairing').contains(document.activeElement) || document.activeElement === q('show'));
  const state = pending ?? (!ready ? 'checkingConnection' : online ? 'connected' : failedReads.size ? 'connectionUnknown' : savedConnection ? 'connectionOffline' : 'disconnected');
  setText('connection', state);
  q('connection').dataset.state = state;
  q('pairing').hidden = online;
  q('show').hidden = online;
  if (online) setCodeVisibility(false);
  q('disconnect-note').hidden = !online;
  q('code').readOnly = Boolean(pending);
  button.disabled = !ready || Boolean(pending);
  setText('connect', online ? 'disconnect' : 'connect');
  button.classList.toggle('secondary', online);
  if (online) button.setAttribute('aria-describedby', 'disconnect-note');
  else button.removeAttribute('aria-describedby');
  if (focusInPairing && !button.disabled) button.focus();
  if (online) expiry = setTimeout(renderConnection, Math.max(1, freshness - (Date.now() - connectionStatus.time)));
}

function invalidCode(key) {
  invalid = true;
  q('code').setAttribute('aria-invalid', 'true');
  setText('status', key);
}

function clearInvalidCode() {
  if (!invalid) return;
  invalid = false;
  q('code').removeAttribute('aria-invalid');
  setText('status');
}

q('show').onclick = () => setCodeVisibility(q('code').type === 'password');
q('code').oninput = () => {
  editing = true;
  clearInvalidCode();
};

function decodeCode(raw) {
  try {
    const value = JSON.parse(atob(raw.trim().replace(/-/g, '+').replace(/_/g, '/')));
    if (value && Number.isInteger(value.port) && value.port >= 1 && value.port <= 65535 &&
        typeof value.token === 'string' && /^[\w-]{40,100}$/.test(value.token)) return value;
  } catch {}
}

q('connection-form').onsubmit = async event => {
  event.preventDefault();
  if (!ready || pending) return;
  const wasConnected = connected();
  const connection = wasConnected ? undefined : decodeCode(q('code').value);
  if (!wasConnected && !connection) {
    invalidCode('invalidCodeIde');
    q('code').focus();
    return;
  }

  const focused = document.activeElement;
  const initialConnectionRevision = connectionRevision;
  const initialStatusRevision = statusRevision;
  clearInvalidCode();
  setText('status');
  pending = wasConnected ? 'disconnecting' : 'connecting';
  renderConnection();
  const fallback = wasConnected ? 'disconnectFailed' : 'openIde';
  try {
    const result = wasConnected ? await action('disconnect') : await chrome.runtime.sendMessage({ type: 'connect', connection });
    if (result?.ok === true) {
      failedReads.clear();
      if (connectionRevision === initialConnectionRevision) savedConnection = connection;
      if (statusRevision === initialStatusRevision) connectionStatus = wasConnected ? undefined : { ok: true, time: Date.now() };
      editing = false;
      syncCode();
    } else {
      const reason = pairingErrors.has(result?.reason) ? result.reason : fallback;
      if (reason === 'expiredCode' || reason === 'invalidCode') invalidCode(reason);
      else setText('status', reason);
    }
  } catch {
    setText('status', fallback);
  } finally {
    pending = undefined;
    renderConnection();
    if (document.activeElement === focused || document.activeElement === document.body) {
      if (connected() && (focused === q('connect') || focused === q('code'))) q('connect').focus();
      else if (focused === q('connect')) q(wasConnected && !savedConnection ? 'code' : 'connect').focus();
    }
  }
};

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.connection) {
    connectionRevision++;
    savedConnection = changes.connection.newValue;
    syncCode();
  } else if (area === 'session' && changes.connectionStatus) {
    statusRevision++;
    const previous = connectionStatus?.reason;
    connectionStatus = changes.connectionStatus.newValue;
    const reason = connectionStatus?.reason;
    if (!pending && reason !== previous && (reason === 'disconnectedByIde' || reason === 'expiredCode')) setText('status', reason);
  } else return;
  if (failedReads.delete(area) && !failedReads.size && q('status').textContent === message('connectionReadFailed')) setText('status');
  renderConnection();
});

void Promise.allSettled([chrome.storage.local.get('connection'), chrome.storage.session.get('connectionStatus')]).then(([local, session]) => {
  if (!connectionRevision && local.status === 'fulfilled') savedConnection = local.value.connection;
  if (!statusRevision && session.status === 'fulfilled') connectionStatus = session.value.connectionStatus;
  if (!connectionRevision && local.status === 'rejected') failedReads.add('local');
  if (!statusRevision && session.status === 'rejected') failedReads.add('session');
  if (failedReads.size) setText('status', 'connectionReadFailed');
  else if (connectionStatus?.reason === 'disconnectedByIde' || connectionStatus?.reason === 'expiredCode') setText('status', connectionStatus.reason);
  syncCode();
  ready = true;
  renderConnection();
});

const current = chrome.runtime.getManifest().version;
const firefox = /Firefox\//.test(navigator.userAgent);
let updateTarget, releaseRevision = 0;

function renderUpdate({ update, failed } = {}) {
  const target = update && ((firefox && update.xpi) || update.url);
  if (target !== updateTarget) setText('update-result');
  const button = q('update');
  const focusOnDownload = !target && document.activeElement === button;
  updateTarget = target;
  q('update-panel').dataset.blocking = String(Boolean(update));
  setText('update-status', update ? 'updateRequired' : failed ? 'updateFailed' : 'current', update?.version ?? current);
  q('update-help').hidden = !update;
  if (update) setText('update-help', !firefox ? 'updateHelpChromium' : update.xpi ? 'updateHelpFirefox' : 'updateHelpFirefoxZip');
  button.hidden = !target;
  if (focusOnDownload) q('update-status').focus();
}

q('update').onclick = async () => {
  const target = updateTarget;
  const button = q('update');
  if (button.disabled || !target) return;
  const wasFocused = document.activeElement === button;
  button.disabled = true;
  setText('update-result', 'updateOpening');
  try {
    await chrome.tabs.create({ url: target });
    if (target === updateTarget) setText('update-result', 'updateOpened');
  } catch {
    if (target === updateTarget) setText('update-result', 'updateOpenFailed');
  } finally {
    button.disabled = false;
    if (wasFocused && document.activeElement === document.body) q(target === updateTarget ? 'update' : 'update-status').focus();
  }
};

renderUpdate();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.releaseCheck) return;
  releaseRevision++;
  const release = changes.releaseCheck.newValue;
  renderUpdate(release?.current === current ? release : undefined);
});
void action('releaseCheck').then(result => {
  if (!releaseRevision) renderUpdate(result ?? { failed: true });
}, () => {
  if (!releaseRevision) renderUpdate({ failed: true });
});

const allSites = { origins: ['<all_urls>'] };
let siteAccess = 'sitesChecking', permissionRevision = 0, requesting = false;

function renderSiteAccess() {
  const button = q('sites');
  const hasAll = siteAccess === 'sitesGranted';
  const focusOnButton = hasAll && document.activeElement === button;
  setText('sites-status', siteAccess);
  button.hidden = hasAll;
  button.disabled = requesting || siteAccess === 'sitesChecking';
  setText('sites', siteAccess === 'sitesReadFailed' ? 'sitesRetry' : 'allowSites');
  if (focusOnButton) q('sites-status').focus();
}

async function refreshSiteAccess() {
  const revision = ++permissionRevision;
  let next;
  try {
    if (await chrome.permissions.contains(allSites)) next = 'sitesGranted';
    else {
      const { origins } = await chrome.permissions.getAll();
      next = origins?.length ? 'sitesPartial' : 'sitesUnavailable';
    }
  } catch {
    next = 'sitesReadFailed';
  }
  if (revision !== permissionRevision) return;
  siteAccess = next;
  if (next === 'sitesGranted') setText('sites-result');
  renderSiteAccess();
}

q('sites').onclick = async () => {
  if (requesting || siteAccess === 'sitesChecking' || siteAccess === 'sitesGranted') return;
  const wasFocused = document.activeElement === q('sites');
  requesting = true;
  setText('sites-result');
  renderSiteAccess();
  try {
    if (siteAccess !== 'sitesReadFailed') {
      setText('sites-result', 'sitesRequesting');
      const granted = await chrome.permissions.request(allSites);
      setText('sites-result', granted ? undefined : 'sitesDenied');
    }
  } catch {
    setText('sites-result', 'sitesRequestFailed');
  } finally {
    await refreshSiteAccess();
    requesting = false;
    renderSiteAccess();
    if (wasFocused && document.activeElement === document.body) q(siteAccess === 'sitesGranted' ? 'sites-status' : 'sites').focus();
  }
};
chrome.permissions.onAdded.addListener(refreshSiteAccess);
chrome.permissions.onRemoved.addListener(refreshSiteAccess);
renderSiteAccess();
void refreshSiteAccess();
