(() => {
  if (globalThis.AraraInput && globalThis.__araraRuntime === chrome.runtime?.id) return;
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const CHARS_PER_MINUTE = 2000, MAX_TYPING_MS = 60000, FOCUS_BEFORE_TYPING_MS = 500;
  const typingStep = total => Math.min(60000 / CHARS_PER_MINUTE, MAX_TYPING_MS / Math.max(1, total));
  const requireConnected = element => { if (element.isConnected === false) throw new Error('Element is gone. Call take_snapshot again.'); };
  const nativeSetter = element => Object.getOwnPropertyDescriptor(element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value').set;
  const fire = (element, type, init = {}) => {
    const Kind = type.startsWith('key') ? KeyboardEvent : type.startsWith('pointer') ? PointerEvent : MouseEvent;
    return element.dispatchEvent(new Kind(type, { bubbles: true, cancelable: true, composed: true, ...init }));
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
  async function key(name, element = document.activeElement ?? document.body) {
    const parts = String(name).split('+'), keyName = parts.pop();
    const init = { key: keyName, ctrlKey: parts.includes('Control'), shiftKey: parts.includes('Shift'), altKey: parts.includes('Alt'), metaKey: parts.includes('Meta') };
    const allowed = fire(element, 'keydown', init);
    if (allowed && keyName === 'Enter' && element.form && element.tagName === 'INPUT') element.form.requestSubmit();
    fire(element, 'keyup', init);
    if (!allowed || init.ctrlKey || init.altKey || init.metaKey || element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)) return;
    const space = keyName === 'Space' || keyName === ' ';
    if (space && (element.tagName === 'BUTTON' || element.tagName === 'A')) return;
    const direction = { PageDown: 'down', PageUp: 'up', ArrowDown: 'down', ArrowUp: 'up', ArrowLeft: 'left', ArrowRight: 'right' }[keyName] ?? (space ? init.shiftKey ? 'up' : 'down' : null);
    if (keyName === 'Home' || keyName === 'End') return scroll(element, { to: keyName === 'Home' ? 'top' : 'bottom' });
    if (!direction) return;
    const target = scrollTarget(element, direction === 'left' || direction === 'right');
    return scroll(target, { direction, amount: keyName.startsWith('Arrow') ? 40 : Math.round(target.clientHeight * 0.9) });
  }
  async function type(text) {
    const element = document.activeElement;
    if (!element || element === document.body) throw new Error('Focus a field first (click or fill).');
    await typeInto(element, text, typingStep(String(text).length));
  }
  function scrollTarget(element, horizontal = false) {
    const root = document.scrollingElement ?? document.documentElement;
    const canScroll = target => {
      const style = getComputedStyle(target), overflow = horizontal ? style.overflowX : style.overflowY;
      const range = horizontal ? target.scrollWidth - target.clientWidth : target.scrollHeight - target.clientHeight;
      return range > 1 && (target === root ? !['hidden', 'clip'].includes(overflow) : /^(auto|scroll|overlay)$/.test(overflow));
    };
    for (let node = element; node; node = node.parentElement) if (canScroll(node)) return node;
    if (canScroll(root)) return root;
    let best = root, area = 0;
    for (const node of document.querySelectorAll('*')) {
      if (!canScroll(node)) continue;
      const box = node.getBoundingClientRect(), style = getComputedStyle(node);
      if (style.visibility === 'hidden' || style.visibility === 'collapse') continue;
      const visible = Math.max(0, Math.min(box.right, innerWidth) - Math.max(box.left, 0)) * Math.max(0, Math.min(box.bottom, innerHeight) - Math.max(box.top, 0));
      if (visible > area) { area = visible; best = node; }
    }
    return best;
  }
  async function scroll(element, args) {
    const behavior = globalThis.AraraDom.smooth() ? 'smooth' : 'auto';
    if (element && !args.direction && !args.to && args.amount === undefined) {
      element.scrollIntoView({ block: 'center', behavior });
      return globalThis.AraraDom.settle(() => { const box = element.getBoundingClientRect(); return `${box.left},${box.top}`; });
    }
    const target = scrollTarget(element, args.direction === 'left' || args.direction === 'right');
    const amount = Number(args.amount) || 600, d = args.direction ?? 'down';
    if (args.to) target.scrollTo({ top: args.to === 'top' ? 0 : target.scrollHeight, behavior });
    else target.scrollBy({ top: d === 'down' ? amount : d === 'up' ? -amount : 0, left: d === 'right' ? amount : d === 'left' ? -amount : 0, behavior });
    await globalThis.AraraDom.settle(() => `${target.scrollLeft},${target.scrollTop}`);
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
