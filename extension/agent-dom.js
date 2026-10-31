(() => {
  if (globalThis.AraraDom && globalThis.__araraRuntime === chrome.runtime?.id) return;
  const uids = new WeakMap(), elements = new Map();
  let sequence = 0;
  const SELECTOR = 'a[href], button, input, select, textarea, summary, [role], [contenteditable="true"], [tabindex]:not([tabindex="-1"]), h1, h2, h3, h4, label, img[alt]';
  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const shown = element => {
    if (!element?.getClientRects().length || globalThis.AraraCursor?.owns(element)) return false;
    const style = getComputedStyle(element);
    return style.visibility !== 'hidden' && style.visibility !== 'collapse';
  };
  const uidOf = element => {
    let uid = uids.get(element);
    if (!uid) { uid = `u${++sequence}`; uids.set(element, uid); }
    elements.set(uid, new WeakRef(element));
    return uid;
  };
  function find(args = {}) {
    if (args.uid) {
      const element = elements.get(String(args.uid))?.deref();
      if (!element?.isConnected) throw new Error(`Element ${args.uid} is gone. Call take_snapshot again.`);
      return element;
    }
    if (args.selector) {
      const element = document.querySelector(String(args.selector));
      if (!element) throw new Error(`No element matches ${args.selector}.`);
      return element;
    }
    return null;
  }
  const label = element => clean(element.getAttribute('aria-label') || element.getAttribute('alt') || element.getAttribute('title') || element.getAttribute('placeholder') || element.labels?.[0]?.innerText || element.innerText || element.value).slice(0, 120);
  const role = element => element.getAttribute('role') || (element.tagName === 'A' ? 'link' : element.tagName === 'INPUT' ? `input[${element.type}]` : element.tagName.toLowerCase());
  function describe(element) {
    const parts = [`uid=${uidOf(element)}`, role(element), JSON.stringify(label(element))];
    if (element.tagName === 'A' && element.getAttribute('href')) parts.push(`href=${element.getAttribute('href').slice(0, 200)}`);
    if ('value' in element && element.tagName !== 'BUTTON' && element.value) parts.push(`value=${JSON.stringify(String(element.value).slice(0, 200))}`);
    if (element.checked) parts.push('checked');
    if (element.disabled) parts.push('disabled');
    if (element === document.activeElement) parts.push('focused');
    return parts.join(' ');
  }
  function snapshot(root = document.body, limit = 40000) {
    const lines = [`url: ${location.href}`, `title: ${document.title}`];
    let size = 0;
    for (const element of (root ?? document.body).querySelectorAll(SELECTOR)) {
      if (!shown(element)) continue;
      const line = describe(element);
      size += line.length;
      if (size > limit) { lines.push('…'); break; }
      lines.push(line);
    }
    return lines.join('\n');
  }
  function read(root) {
    const scope = root ?? document.body;
    const body = clean(scope.innerText).slice(0, 20000);
    return `url: ${location.href}\ntitle: ${document.title}\n\n${body}\n\n${snapshot(scope, 8000)}`;
  }
  function pointIn(box, random = Math.random, view = { width: innerWidth, height: innerHeight }) {
    const left = Math.max(box.left, 0), right = Math.min(box.left + box.width, view.width);
    const top = Math.max(box.top, 0), bottom = Math.min(box.top + box.height, view.height);
    if (right <= left || bottom <= top) return null;
    const spread = (from, to) => { const margin = Math.min((to - from) * 0.2, 12); return from + margin + random() * Math.max(0, to - from - margin * 2); };
    return { x: Math.round(spread(left, right)), y: Math.round(spread(top, bottom)) };
  }
  const smooth = () => !document.hidden && globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches !== true;
  const later = callback => (document.hidden ? setTimeout(callback, 16) : requestAnimationFrame(callback));
  function visibleEnough(box, view = { width: innerWidth, height: innerHeight }) {
    const width = Math.min(box.right, view.width) - Math.max(box.left, 0), height = Math.min(box.bottom, view.height) - Math.max(box.top, 0);
    return width >= Math.min(box.width, 24) && height >= Math.min(box.height, 24) && width > 0 && height > 0;
  }
  function settle(key, { frames = 6, timeout = 2500 } = {}) {
    return new Promise(resolve => {
      let last, same = 0;
      const start = performance.now();
      const tick = () => {
        const now = key();
        same = now === last ? same + 1 : 0; last = now;
        if (same >= frames || performance.now() - start > timeout) resolve(); else later(tick);
      };
      later(tick);
    });
  }
  const boxKey = element => () => { const b = element.getBoundingClientRect(); return `${Math.round(b.left)},${Math.round(b.top)},${scrollX},${scrollY}`; };
  function reveal(element) {
    if (visibleEnough(element.getBoundingClientRect())) return { moving: false, settled: Promise.resolve() };
    element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: smooth() ? 'smooth' : 'auto' });
    return { moving: true, settled: settle(boxKey(element)) };
  }
  function aimAt(element, random = Math.random) {
    const values = [random(), random()];
    return () => {
      let i = 0;
      const box = element.getBoundingClientRect();
      const inside = pointIn(box, () => values[i++ % 2]);
      if (inside) return inside;
      const clamp = (value, max) => Math.round(Math.min(Math.max(value, 8), max - 8));
      return { x: clamp(box.left + box.width * values[0], innerWidth), y: clamp(box.top + box.height * values[1], innerHeight) };
    };
  }
  function point(element, random = Math.random) {
    element.scrollIntoView({ block: 'center', inline: 'center' });
    const box = element.getBoundingClientRect();
    return pointIn(box, random) ?? { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) };
  }
  globalThis.AraraDom = { find, snapshot, read, point, pointIn, reveal, settle, aimAt, visibleEnough, describe };
})();
