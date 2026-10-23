let polling, worker, active, browserTab, handed, completed, workTab;
async function api(path, data) {
  const { connection } = await chrome.storage.session.get('connection');
  if (!connection) throw new Error('Conecte a IDE primeiro.');
  const response = await fetch(`http://127.0.0.1:${connection.port}${path}`, { method: 'POST', headers: { authorization: `Bearer ${connection.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ worker, ...data }), signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error('A IDE não está conectada.');
  return response.json();
}
async function clearWork() {
  active = null; browserTab = null; handed = null; completed = null;
  await chrome.storage.session.remove(['active', 'browserTab', 'handed', 'completed']);
}
async function saveResult(id, result) {
  completed = { id, result };
  await chrome.storage.session.set({ completed });
}
async function bindings() {
  const { conversationBindings = {}, workTabBinding } = await chrome.storage.local.get(['conversationBindings', 'workTabBinding']);
  if (workTabBinding?.contextId && !conversationBindings[workTabBinding.contextId]) conversationBindings[workTabBinding.contextId] = workTabBinding;
  return conversationBindings;
}
async function rememberWorkTab(tab, contextId) {
  // This is a tab/conversation pointer, not a credential. Pairing stays in session storage.
  if (tab?.id && /^https:\/\/chatgpt\.com\/(?:.*\/)?c\/[^/?#]+/.test(tab.url ?? '')) {
    const { workTabBinding } = await chrome.storage.local.get('workTabBinding');
    const previousContext = workTabBinding?.id === tab.id && workTabBinding.url === tab.url ? workTabBinding.contextId : undefined;
    const binding = { id: tab.id, url: tab.url, contextId: contextId ?? previousContext };
    const conversationBindings = await bindings();
    if (binding.contextId) conversationBindings[binding.contextId] = binding;
    await chrome.storage.local.set({ workTabBinding: binding, conversationBindings });
  }
}
function poll() {
  return polling ??= runPoll().finally(() => { polling = null; });
}
async function runPoll() {
  try {
    await initialized;
    worker ??= (await chrome.storage.local.get('worker')).worker;
    if (!worker) { worker = crypto.randomUUID(); await chrome.storage.local.set({ worker }); }
    const { job, cancel, disconnected } = await api('/poll', { contexts: Object.keys(await bindings()) });
    if (completed && !disconnected) {
      // Retrying the receipt never sends another ChatGPT message.
      await api('/result', completed);
      await clearWork();
    }
    if (cancel && active?.id === cancel) {
      const tabId = browserTab;
      await rememberWorkTab(await chrome.tabs.get(tabId).catch(() => null));
      await clearWork();
      if (tabId) {
        await chrome.tabs.sendMessage(tabId, { type: 'cancel', id: cancel }).catch(() => {});
      }
    }
    if (disconnected) { await clearWork(); await chrome.storage.session.remove(['connection']); throw new Error('Desconectado pela IDE. Copie o código atual.'); }
    if (job && active) await api('/result', { id: job.id, result: { error: 'O navegador ainda está atendendo outro pedido.' } });
    if (job && !active) {
      active = job; handed = null;
      try {
        const binding = job.kind === 'send' && job.contextId ? (await bindings())[job.contextId] : undefined;
        const candidateId = job.kind === 'send' && job.contextId ? binding?.id : workTab;
        const existing = candidateId ? await chrome.tabs.get(candidateId).catch(() => null) : null;
        const reuse = existing?.url?.startsWith('https://chatgpt.com/') && (!binding || existing.url === binding.url);
        const tab = reuse
          ? existing
          : await chrome.tabs.create({ url: binding?.url ?? 'https://chatgpt.com/', active: job.kind === 'models' });
        if (job.kind === 'send') {
          active = { ...job, prompt: binding ? job.prompt : (job.initialPrompt ?? job.prompt) };
          delete active.initialPrompt;
        }
        browserTab = workTab = tab.id;
        await chrome.storage.session.set({ active, browserTab, workTab });
        await rememberWorkTab(tab);
        // Jobs use the existing document. A loading document will pick up at ready.
        if (reuse && tab.status !== 'loading') {
          handed = job.id;
          await chrome.storage.session.set({ handed });
          await chrome.tabs.sendMessage(tab.id, { type: 'job', job: active }).then(receipt => {
            if (receipt?.ok === false) throw new Error('Document busy');
          }).catch(async () => {
            if (active?.id === job.id && !completed) await saveResult(job.id, { error: 'A extensão não respondeu nesta aba. Recarregue a extensão e a aba do ChatGPT.' });
          });
        }
      } catch { await saveResult(job.id, { error: 'Não foi possível abrir a aba do ChatGPT.' }); }
    }
    await chrome.storage.session.set({ connectionStatus: { ok: true, time: Date.now() } });
    return { ok: true };
  } catch (error) {
    // Preserve admitted work; retrying a receipt never resends a prompt.
    await chrome.storage.session.set({ connectionStatus: { ok: false, time: Date.now() } });
    return { ok: false, error: error.message };
  }
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  void initialized.then(() => {
  if (!sender.tab && message.type === 'connect') {
    void (async () => {
      const connection = message.connection;
      if (!connection || !Number.isInteger(connection.port) || connection.port < 1 || connection.port > 65535 || !/^[\w-]{40,100}$/.test(connection.token)) return reply({ ok: false, error: 'Código inválido.' });
      await polling;
      const previous = (await chrome.storage.session.get('connection')).connection;
      if (active && (previous?.port !== connection.port || previous?.token !== connection.token)) return reply({ ok: false, error: 'Interrompa o pedido atual antes de trocar a conexão.' });
      await chrome.storage.session.set({ connection });
      reply(await poll());
    })().catch(error => reply({ ok: false, error: error.message }));
    return;
  }
  if (!sender.tab && message.type === 'disconnect') {
    void (async () => {
      await polling;
      if (active) {
        await chrome.tabs.sendMessage(browserTab, { type: 'cancel', id: active.id }).catch(() => {});
        await api('/result', { id: active.id, result: { error: 'Navegador desconectado pelo usuário.' } }).catch(() => {});
      }
      await clearWork();
      await chrome.storage.session.remove(['connection', 'connectionStatus']);
      reply({ ok: true });
    })().catch(() => reply({ ok: false }));
    return;
  }
  if (sender.url?.startsWith('https://chatgpt.com/') && sender.tab?.id === browserTab && active) {
    if (message.type === 'ready') {
      if (handed === active.id) {
        reply({ job: null });
        if (!completed) void saveResult(active.id, { error: 'A página foi recarregada depois da entrega. Nenhuma mensagem foi reenviada; confira a conversa no navegador.' }).then(() => poll());
      } else {
        handed = active.id;
        chrome.storage.session.set({ handed }).then(() => reply({ job: active }));
      }
      return true;
    }
    if (message.type === 'progress' && message.id === active.id && !completed && typeof message.text === 'string') {
      api('/progress', { id: active.id, text: message.text }).then(() => reply({ ok: true })).catch(() => reply({ ok: false }));
      return true;
    }
    if (message.type === 'submitted' && message.id === active.id && active.kind === 'send' && !completed) {
      const contextId = active.contextId;
      chrome.tabs.get(workTab).then(tab => rememberWorkTab(tab, contextId))
        .then(() => reply({ ok: true })).catch(() => reply({ ok: false }));
      return true;
    }
    if (message.type === 'result' && message.id === active.id && !completed) {
      const contextId = !message.result?.error && typeof message.result?.text === 'string' ? active.contextId : undefined;
      saveResult(active.id, message.result).then(async () => {
        await rememberWorkTab(await chrome.tabs.get(workTab).catch(() => null), contextId);
        reply({ ok: true }); void poll();
      }).catch(() => reply({ ok: false }));
      return true;
    }
  }
  reply({ job: null, ok: false });
  }).catch(() => reply({ ok: false }));
  return true;
});
chrome.tabs.onRemoved.addListener(tabId => {
  void initialized.then(() => { if (tabId === browserTab && active && !completed) void saveResult(active.id, { error: 'A aba do ChatGPT foi fechada antes da confirmação. Nenhuma mensagem foi reenviada.' }).then(() => poll()); });
});
const initialized = (async () => {
  const saved = await chrome.storage.session.get(['active', 'browserTab', 'handed', 'completed', 'workTab']);
  active = saved.active; browserTab = saved.browserTab; handed = saved.handed; completed = saved.completed; workTab = saved.workTab;
  if (!workTab) {
    const { workTabBinding } = await chrome.storage.local.get('workTabBinding');
    const tab = workTabBinding?.id ? await chrome.tabs.get(workTabBinding.id).catch(() => null) : null;
    if (tab?.url === workTabBinding?.url && /^https:\/\/chatgpt\.com\/(?:.*\/)?c\/[^/?#]+/.test(tab?.url ?? '')) {
      workTab = tab.id;
      await chrome.storage.session.set({ workTab });
    }
  }
  await chrome.alarms.create('poll', { periodInMinutes: 0.5 });
})();
void initialized.then(() => poll());
chrome.alarms.onAlarm.addListener(() => void poll());
setInterval(() => void poll(), 1000);
