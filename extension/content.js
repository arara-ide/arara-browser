// DOM-only transport: no cookies, ChatGPT credentials, or private HTTP endpoints.
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
  });
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
  // Slow React menus can mount well after the click. Keep waiting in this document.
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
    // A fenced transport envelope has a language/copy toolbar outside <code>.
    if (!remainder.textContent.trim()) return blocks[0].textContent.trim();
  }
  return part.innerText.trim();
}
function assistantText(row) {
  const parts = row.matches(proseSelector) ? [row] : [...row.querySelectorAll(proseSelector)];
  // Read authored content, never the surrounding "ChatGPT disse" heading or action bar.
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
    while (!cancelled) {
      const trigger = await waitFor(() => visible(modelTrigger()) ? modelTrigger() : null, 20 * 60_000, 1000);
      const selected = trigger?.innerText.trim();
      const rows = await choices(trigger);
      // Only publish actual UI options; no guessed model IDs or efforts.
      const effort = effortTrigger();
      const efforts = effort && effort !== trigger ? (await choices(effort)).map(r => r.label) : [];
      const labels = [...new Set([selected, ...rows.map(r => r.label)].filter(Boolean))];
      if (!labels.length) { await delay(1000); continue; }
      return { models: labels.map(label => ({ id: label, name: label, vendor: 'chatgpt-web', description: 'Modelo oferecido pelo ChatGPT no navegador.', ...(efforts.length ? { reasoning: { efforts } } : {}) })) };
    }
    throw new Error(chrome.i18n.getMessage('cancelled'));
  }
  await choose(modelTrigger, job.model);
  if (job.effort) await choose(effortTrigger, job.effort);
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
  // Never click Send twice. A lost confirmation remains uncertain.
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
    // The complete transport envelope is a boundary even when ChatGPT renders no action bar.
    // Still require Stop to stay absent: a transient pause must not execute partial work.
    const quiet = text && text === last && !stopButton() && (completeEnvelope(text) || hasCompletedActions(current));
    quietSince = quiet ? quietSince || Date.now() : 0;
    if (text && text !== last) await chrome.runtime.sendMessage({ type: 'progress', id: job.id, text });
    last = text;
    if (quietSince && Date.now() - quietSince >= 4000) return { text };
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
    // Release the document before acknowledging: the IDE can immediately request the next tool step.
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
  // DOM ready can race the tab-created event in the worker.
  await delay(500);
  const response = await chrome.runtime.sendMessage({ type: 'ready' });
  await runJob(response?.job);
})();
