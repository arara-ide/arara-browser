const q = id => document.getElementById(id);
const encode = value => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function render({ code, connected, notice }) {
  if (code !== undefined) q('code').value = code;
  if (connected !== undefined) {
    q('connection').textContent = connected ? 'Conectado' : 'Desconectado';
    q('connection').dataset.connected = String(connected);
    q('disconnect').hidden = !connected && !q('code').value;
  }
  if (notice !== undefined) q('status').textContent = notice;
  q('copy').disabled = !q('code').value;
}
const action = type => chrome.runtime.sendMessage({ type });
q('show').onclick = () => {
  const show = q('code').type === 'password';
  q('code').type = show ? 'text' : 'password';
  q('show').textContent = show ? 'Ocultar' : 'Mostrar';
  q('show').setAttribute('aria-pressed', String(show));
};
q('copy').onclick = async () => {
  try { await navigator.clipboard.writeText(q('code').value); render({ notice: 'Código copiado.' }); }
  catch { render({ notice: 'Selecione o código e copie com Ctrl+C.' }); }
};
q('code').oninput = () => { q('copy').disabled = !q('code').value; };
q('chatgpt').onclick = () => chrome.tabs.create({ url: 'https://chatgpt.com/' });
q('disconnect').onclick = async () => {
  await action('disconnect'); render({ code: '', connected: false, notice: 'Desconectado.' });
};
q('connect').onclick = async () => {
  q('connect').disabled = true;
  try {
    const connection = JSON.parse(atob(q('code').value.trim().replace(/-/g, '+').replace(/_/g, '/')));
    if (!Number.isInteger(connection.port) || connection.port < 1 || connection.port > 65535 || !/^[\w-]{40,100}$/.test(connection.token)) throw new Error('Código inválido. Copie novamente na IDE.');
    const result = await chrome.runtime.sendMessage({ type: 'connect', connection });
    render({ connected: result.ok, notice: result.ok ? 'Pronto. Volte ao chat na IDE.' : result.error || 'Abra a IDE e copie o código atual.' });
  } catch (error) { render({ connected: false, notice: error.message }); }
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
  q('update-status').textContent = `Versão ${current} · Verificando atualização…`;
  try {
    const update = await AraraUpdates.check(current);
    q('update-status').textContent = update ? `Versão ${update.version} disponível.` : `Versão ${current} · Atualizada.`;
    q('update').hidden = !update;
    if (update) q('update').onclick = () => chrome.tabs.create({ url: update.url });
  } catch {
    q('update-status').textContent = `Versão ${current} · Não foi possível verificar. Abra novamente para tentar.`;
  }
}
void checkUpdate();
