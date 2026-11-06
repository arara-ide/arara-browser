let cancelled = false;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const visible = element => {
  if (!element?.getClientRects().length) return false;
  const style = getComputedStyle(element);
  return style.visibility !== 'hidden' && style.visibility !== 'collapse' && style.opacity !== '0';
};
async function waitFor(find, timeout = 20000, interval = 250) {
  const end = Date.now() + timeout;
  while (Date.now() < end && !cancelled) { const value = find(); if (value) return value; await delay(interval); }
  throw new Error(cancelled ? chrome.i18n.getMessage('cancelled') : chrome.i18n.getMessage('notReady'));
}
const firstVisible = selector => [...document.querySelectorAll(selector)].find(visible);
const composer = () => firstVisible('#prompt-textarea, form[data-chatgpt-composer] [contenteditable="true"][role="textbox"]');
const sendButton = () => firstVisible('button[data-testid="send-button"], form[data-chatgpt-composer] button[type="submit"]');
const stopButton = () => [...document.querySelectorAll('button[data-testid="stop-button"], button[data-testid="composer-stop-button"], button[aria-label^="Stop" i], button[aria-label^="Parar" i]')].find(visible);
const modelTrigger = () => firstVisible('[data-testid="model-switcher-dropdown-button"], [data-composer-navigation-target="reasoning"], [data-codex-intelligence-trigger]');
const effortTrigger = () => firstVisible('[data-composer-navigation-target="reasoning"], [data-codex-intelligence-trigger]');
async function choices(trigger) {
  if (!visible(trigger)) return [];
  if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click();
  const items = await waitFor(() => {
    const items = [...document.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="option"]')].filter(visible);
    return items.length ? items : null;
  }, 5000);
  const rows = items.filter(e => e.getAttribute('aria-disabled') !== 'true').map(e => ({ label: e.innerText.trim(), element: e })).filter(row => row.label && row.label.length < 150);
  (rows[0]?.element ?? trigger).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await delay(150);
  if (trigger.getAttribute('aria-expanded') === 'true') trigger.click();
  return rows;
}
async function choose(findTrigger, label) {
  const trigger = await waitFor(() => { const element = findTrigger(); return visible(element) ? element : null; });
  if (trigger.innerText.trim() === label) return;
  if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click();
  let element;
  try {
    element = await waitFor(() => [...document.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="option"]')]
      .find(e => visible(e) && e.getAttribute('aria-disabled') !== 'true' && e.innerText.trim() === label));
  } catch (error) {
    if (cancelled) throw error;
    throw new Error(chrome.i18n.getMessage('modelUnavailable'));
  }
  element.click(); await delay(400);
}
function pickerState() {
  if (location.origin === 'null') return Promise.resolve(null);
  return new Promise(resolve => {
    const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const finish = value => { clearTimeout(timer); window.removeEventListener('message', receive); resolve(value); };
    const receive = event => { if (event.source === window && event.data?.source === 'arara-picker-reply' && event.data.nonce === nonce) finish(event.data.picker ?? null); };
    const timer = setTimeout(() => finish(null), 800);
    window.addEventListener('message', receive);
    window.postMessage({ source: 'arara-picker-ask', nonce }, location.origin);
  });
}
function settle(read, timeout = 4000) {
  return new Promise(resolve => {
    let done = false, reading = false;
    const finish = value => { if (done) return; done = true; observer.disconnect(); clearTimeout(timer); clearInterval(tick); resolve(value); };
    const check = async () => {
      if (done || reading) return;
      if (cancelled) return finish(null);
      reading = true;
      try { const value = await read(); if (value) finish(value); } catch { finish(null); } finally { reading = false; }
    };
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true });
    const timer = setTimeout(() => finish(null), timeout);
    const tick = setInterval(check, 200);
    void check();
  });
}
const pickerPanel = () => document.querySelector('[data-model-picker-view], [data-testid="composer-intelligence-picker-content"]');
const pickerTrigger = () => firstVisible('[data-codex-intelligence-trigger], [data-composer-navigation-target="reasoning"]');
function press(node, key) {
  if (!node) return false;
  node.focus();
  node.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true }));
  return true;
}
function pickerSession() {
  const motion = document.createElement('style');
  motion.textContent = '[role="menu"]:has([data-model-picker-view]),[role="menu"]:has([data-testid="composer-intelligence-picker-content"]){animation:none!important;transition:none!important}';
  const state = predicate => settle(async () => { const value = await pickerState(); return value && (!predicate || predicate(value)) ? value : null; });
  const versionRows = () => [...(pickerPanel()?.querySelectorAll('[role="menuitemradio"]') ?? [])].filter(row => !row.closest('[inert]'));
  return {
    async open() {
      document.head.append(motion);
      for (let attempt = 0; attempt < 4 && !pickerPanel() && !cancelled; attempt++) {
        if (!press(pickerTrigger(), 'Enter')) return null;
        await settle(pickerPanel, 1500);
      }
      return pickerPanel() ? state() : null;
    },
    async version(target) {
      const before = await state();
      if (!before) return null;
      if (before.version === target) return before;
      const label = before.versions.find(version => version.id === target)?.label;
      if (!label) return null;
      if (!versionRows().length) pickerPanel()?.querySelector('[data-model-picker-view-toggle], [role="menuitem"][aria-expanded]')?.click();
      const row = await settle(() => versionRows().find(node => node.getAttribute('aria-disabled') !== 'true' && node.textContent.trim().replace(/\s+/g, ' ') === label));
      if (!press(row, 'Enter')) return null;
      return state(next => next.version === target);
    },
    async bucket(target) {
      let current = await state();
      for (let step = 0; current && step < 24; step++) {
        if (current.currentBucket === target) return current;
        const order = current.lanes ?? current.choices.map(choice => choice.bucket);
        const from = order.indexOf(current.currentBucket), to = order.indexOf(target);
        if (from < 0 || to < 0) return null;
        const slider = [...(pickerPanel()?.querySelectorAll('[data-reasoning-slider], [role="menuitem"][aria-keyshortcuts*="ArrowRight"]') ?? [])].find(node => !node.closest('[inert]'));
        const previous = current.currentBucket;
        if (!press(slider, to > from ? 'ArrowRight' : 'ArrowLeft')) return null;
        current = await state(next => next.currentBucket !== previous);
      }
      return null;
    },
    async close() {
      try {
        const panel = pickerPanel();
        if (panel) press(panel.contains(document.activeElement) ? document.activeElement : panel, 'Escape');
        return Boolean(await settle(() => !pickerPanel(), 2000));
      } finally { motion.remove(); }
    }
  };
}
async function prepareChatSurface() {
  const radios = [...document.querySelectorAll('[role="radio"][data-tpp-toggle-value]')].filter(visible);
  const chat = radios.find(node => node.getAttribute('data-tpp-toggle-value') === 'chatgpt');
  if (!chat || chat.getAttribute('aria-checked') === 'true') return;
  chat.click();
  await settle(() => chat.getAttribute('aria-checked') === 'true', 3000);
}
function catalogEntry(version, state) {
  const efforts = [...new Set(state.choices.filter(choice => choice.available).map(choice => choice.effort))];
  return { id: version.id, name: version.label, vendor: 'chatgpt-web', description: chrome.i18n.getMessage('modelDescription'), ...(efforts.length ? { reasoning: { efforts } } : {}) };
}
async function pickerModels() {
  await prepareChatSurface();
  const original = await pickerState();
  if (!original) return null;
  const models = new Map([[original.version, catalogEntry(original.versions.find(v => v.id === original.version), original)]]);
  const others = original.versions.filter(version => version.id !== original.version);
  if (!others.length) return [...models.values()];
  const ui = pickerSession();
  try {
    if (!await ui.open()) return [...models.values()];
    for (const version of others) {
      const state = await ui.version(version.id);
      if (state) models.set(version.id, catalogEntry(version, state));
    }
    await ui.version(original.version);
    await ui.bucket(original.currentBucket);
  } finally { await ui.close(); }
  const order = original.versions.map(version => version.id);
  return [...models.values()].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}
async function pickerSelect(model, effort) {
  await prepareChatSurface();
  const current = await pickerState();
  if (!current || !current.versions.some(version => version.id === model)) return false;
  const lane = state => state.choices.find(choice => choice.bucket === state.currentBucket);
  if (current.version === model && (!effort || lane(current)?.effort === effort)) return true;
  const ui = pickerSession();
  let selected = false;
  try {
    if (!await ui.open()) throw new Error(chrome.i18n.getMessage('modelUnavailable'));
    const state = await ui.version(model);
    if (!state) throw new Error(chrome.i18n.getMessage('modelUnavailable'));
    const wanted = effort ? state.choices.find(choice => choice.available && choice.effort === effort) : null;
    if (effort && !wanted) throw new Error(chrome.i18n.getMessage('modelUnavailable'));
    const after = wanted ? await ui.bucket(wanted.bucket) : state;
    selected = Boolean(after && after.version === model && (!wanted || after.currentBucket === wanted.bucket));
  } finally { await ui.close(); }
  if (!selected) throw new Error(chrome.i18n.getMessage('modelUnavailable'));
  return true;
}
function assistantRows() {
  const explicit = [...document.querySelectorAll('[data-message-author-role="assistant"], [data-content-search-unit-key$=":assistant"], [data-markdown-text-style="assistant-message"]')]
    .filter(e => visible(e) && !e.closest('[data-interrupted="true"]'));
  return explicit.filter(e => !explicit.some(other => other !== e && other.contains(e)));
}
const proseSelector = '.markdown, [data-markdown-text-style="assistant-message"]';
const turnSelector = 'article, section[data-testid^="conversation-turn"], [data-turn-key], [data-chatgpt-search-unit-key]';
function proseText(part) {
  const blocks = part.querySelectorAll('pre code');
  if (blocks.length === 1) {
    const remainder = part.cloneNode(true);
    for (const chrome of remainder.querySelectorAll('pre, button, [role="button"], .sr-only')) chrome.remove();
    if (!remainder.textContent.trim()) return blocks[0].textContent.trim();
  }
  return part.innerText.trim();
}
function assistantText(row) {
  const parts = row.matches(proseSelector) ? [row] : [...row.querySelectorAll(proseSelector)];
  const outer = parts.filter(part => !part.closest('[data-interrupted="true"]') && !parts.some(other => other !== part && other.contains(part)));
  if (outer.length) return outer.map(proseText).filter(Boolean).join('\n\n');
  if (!row.matches('[data-message-author-role="assistant"]')) return '';
  const clone = row.cloneNode(true);
  for (const control of clone.querySelectorAll('button, [role="button"], [role="heading"], .sr-only, [aria-hidden="true"]')) control.remove();
  return clone.textContent.trim();
}
function responseKey(row) {
  const owner = row.closest('[data-message-id], [data-content-search-unit-key], [data-turn-key], [data-chatgpt-search-unit-key]');
  for (const attribute of ['data-message-id', 'data-content-search-unit-key', 'data-turn-key', 'data-chatgpt-search-unit-key']) {
    if (owner?.hasAttribute(attribute)) return `${attribute}:${owner.getAttribute(attribute)}`;
  }
  return row;
}
function hasCompletedActions(row) {
  const turn = row.closest(turnSelector) ?? row;
  return [...turn.querySelectorAll('button[data-testid="copy-turn-action-button"], button[data-testid="good-response-turn-action-button"], button[data-testid="bad-response-turn-action-button"], button[aria-label="Copy"], button[aria-label="Copiar"]')]
    .some(button => !button.closest(proseSelector));
}
function completeEnvelope(text) {
  try {
    const value = JSON.parse(text.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, ''));
    return typeof value?.text === 'string' && Array.isArray(value.toolCalls);
  } catch { return false; }
}
async function execute(job) {
  await waitFor(composer, job.kind === 'models' ? 20 * 60_000 : 20000, job.kind === 'models' ? 1000 : 250);
  if (job.kind === 'models') {
    const fromPicker = await pickerModels();
    if (fromPicker?.length) return { models: fromPicker };
    while (!cancelled) {
      const trigger = await waitFor(() => visible(modelTrigger()) ? modelTrigger() : null, 20 * 60_000, 1000);
      const selected = trigger?.innerText.trim();
      const rows = await choices(trigger);
      const effort = effortTrigger();
      const efforts = effort && effort !== trigger ? (await choices(effort)).map(r => r.label) : [];
      const labels = [...new Set([selected, ...rows.map(r => r.label)].filter(Boolean))];
      if (!labels.length) { await delay(1000); continue; }
      return { models: labels.map(label => ({ id: label, name: label, vendor: 'chatgpt-web', description: chrome.i18n.getMessage('modelDescription'), ...(efforts.length ? { reasoning: { efforts } } : {}) })) };
    }
    throw new Error(chrome.i18n.getMessage('cancelled'));
  }
  if (!(await pickerState() && await pickerSelect(job.model, job.effort))) {
    await choose(modelTrigger, job.model);
    if (job.effort) await choose(effortTrigger, job.effort);
  }
  const input = composer();
  if (input.value !== undefined) {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, job.prompt);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    input.focus();
    const range = document.createRange(); range.selectNodeContents(input);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    document.execCommand('insertText', false, job.prompt);
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: job.prompt }));
  }
  const before = new Map(assistantRows().map(row => [responseKey(row), assistantText(row)]));
  const send = await waitFor(() => { const button = sendButton(); return visible(button) && !button.disabled ? button : null; });
  if (cancelled) throw new Error(chrome.i18n.getMessage('cancelled'));
  send.click();
  const responseNow = () => assistantRows().filter(row => {
    const text = assistantText(row);
    return text && before.get(responseKey(row)) !== text;
  }).at(-1);
  await waitFor(responseNow, 120000);
  await chrome.runtime.sendMessage({ type: 'submitted', id: job.id });
  let last = '', quietSince = 0;
  for (let i = 0; i < 4800 && !cancelled; i++) {
    const current = responseNow();
    const text = current ? assistantText(current) : '';
    const quiet = text && text === last && !stopButton() && (completeEnvelope(text) || hasCompletedActions(current));
    quietSince = quiet ? quietSince || Date.now() : 0;
    if (text && text !== last) await chrome.runtime.sendMessage({ type: 'progress', id: job.id, text });
    last = text;
    if (quietSince && Date.now() - quietSince >= (completeEnvelope(text) ? 1000 : 3000)) return { text };
    await delay(250);
  }
  throw new Error(cancelled ? chrome.i18n.getMessage('cancelled') : chrome.i18n.getMessage('unconfirmed'));
}
let runningJob, lastJob;
async function runJob(job) {
  if (!job || runningJob || lastJob === job.id) return;
  runningJob = lastJob = job.id; cancelled = false;
  try {
    let result;
    try { result = await execute(job); } catch (error) { result = { error: error.message }; }
    const stopped = cancelled;
    runningJob = undefined;
    if (!stopped) await chrome.runtime.sendMessage({ type: 'result', id: job.id, result });
  } finally { if (runningJob === job.id) runningJob = undefined; }
}
chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message.type === 'cancel' && message.id === runningJob) { cancelled = true; stopButton()?.click(); }
  if (message.type === 'job' && ['models', 'send'].includes(message.job?.kind)) {
    if (runningJob && runningJob !== message.job.id) { reply({ ok: false }); return; }
    void runJob(message.job); reply({ ok: true });
  }
});
(async () => {
  await delay(150);
  const response = await chrome.runtime.sendMessage({ type: 'ready' });
  await runJob(response?.job);
})();
