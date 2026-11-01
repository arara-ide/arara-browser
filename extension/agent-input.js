(() => {
  if (globalThis.AraraInput && globalThis.__araraRuntime === chrome.runtime?.id) return;
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const CHARS_PER_MINUTE = 2000, MAX_TYPING_MS = 60000, FOCUS_BEFORE_TYPING_MS = 500;
  const typingStep = total => Math.min(60000 / CHARS_PER_MINUTE, MAX_TYPING_MS / Math.max(1, total));
  const requireConnected = element => { if (element.isConnected === false) throw new Error('Element is gone. Call take_snapshot again.'); };
  const nativeSetter = element => Object.getOwnPropertyDescriptor(element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value').set;
  const fire = (element, type, init = {}) => {
    const Kind = type.startsWith('key') ? KeyboardEvent : type.startsWith('pointer') ? PointerEvent : MouseEvent;
    element.dispatchEvent(new Kind(type, { bubbles: true, cancelable: true, composed: true, ...init }));
  };
  function setValue(element, value) {
    element.focus();
    if (element.isContentEditable) {
      document.getSelection().selectAllChildren(element);
      document.execCommand('insertText', false, value);
    } else {
      nativeSetter(element).call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const typable = element => element.isContentEditable || (element.tagName === 'TEXTAREA') || (element.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'color', 'file', 'date', 'datetime-local', 'month', 'time', 'week', 'submit', 'button', 'hidden'].includes(element.type));
  function insert(element, char) {
    requireConnected(element);
    fire(element, 'keydown', { key: char });
    if (element.isContentEditable) document.execCommand('insertText', false, char);
    else {
      nativeSetter(element).call(element, (element.value ?? '') + char);
      element.dispatchEvent(new InputEvent('input', { bubbles: true, data: char, inputType: 'insertText' }));
    }
    fire(element, 'keyup', { key: char });
  }
  async function typeInto(element, text, step) {
    for (const char of String(text)) { insert(element, char); await delay(step); }
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function clear(element) {
    element.focus();
    if (element.isContentEditable) { document.getSelection().selectAllChildren(element); document.execCommand('delete'); return; }
    nativeSetter(element).call(element, '');
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
  }
  async function fill(element, value, step = typingStep(String(value).length)) {
    if (element.tagName === 'SELECT') {
      const option = [...element.options].find(o => o.value === value || o.text.trim() === value);
      if (!option) throw new Error(`Option ${value} not found.`);
      return setValue(element, option.value);
    }
    if (!typable(element)) return setValue(element, value);
    element.focus();
    await delay(FOCUS_BEFORE_TYPING_MS);
    requireConnected(element);
    clear(element);
    await typeInto(element, value, step);
  }
  function click(element, x, y, count = 1) {
    for (let i = 0; i < count; i++) {
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) fire(element, type, { clientX: x, clientY: y });
      element.click();
    }
    if (count > 1) fire(element, 'dblclick', { clientX: x, clientY: y });
  }
  function hover(element, x, y) { for (const type of ['pointerover', 'mouseover', 'mousemove']) fire(element, type, { clientX: x, clientY: y }); }
  function key(name, element = document.activeElement ?? document.body) {
    const parts = String(name).split('+'), keyName = parts.pop();
    const init = { key: keyName, ctrlKey: parts.includes('Control'), shiftKey: parts.includes('Shift'), altKey: parts.includes('Alt'), metaKey: parts.includes('Meta') };
    fire(element, 'keydown', init);
    if (keyName === 'Enter' && element.form && element.tagName === 'INPUT') element.form.requestSubmit();
    fire(element, 'keyup', init);
  }
  async function type(text) {
    const element = document.activeElement;
    if (!element || element === document.body) throw new Error('Focus a field first (click or fill).');
    await typeInto(element, text, typingStep(String(text).length));
  }
  function scroll(element, args) {
    if (element) return element.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (args.to) return window.scrollTo({ top: args.to === 'top' ? 0 : document.documentElement.scrollHeight, behavior: 'smooth' });
    const amount = Number(args.amount) || 600, d = args.direction ?? 'down';
    window.scrollBy({ top: d === 'down' ? amount : d === 'up' ? -amount : 0, left: d === 'right' ? amount : d === 'left' ? -amount : 0, behavior: 'smooth' });
  }
  async function waitFor(args) {
    const end = Date.now() + Math.min(Number(args.timeout) || 10000, 60000);
    const wanted = [].concat(args.text ?? []).map(String);
    while (Date.now() < end) {
      if (wanted.length ? wanted.some(t => document.body.innerText.includes(t)) : args.selector && document.querySelector(args.selector)) return;
      await delay(250);
    }
    throw new Error('Timed out waiting.');
  }
  globalThis.AraraInput = { delay, fill, click, hover, key, type, scroll, waitFor, typingStep, CHARS_PER_MINUTE, FOCUS_BEFORE_TYPING_MS };
})();
