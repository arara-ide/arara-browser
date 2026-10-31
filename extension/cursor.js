(() => {
  if (globalThis.AraraCursor && globalThis.__araraRuntime === chrome.runtime?.id) return;
  for (const stale of document.querySelectorAll('arara-cursor')) stale.remove();
  const SIZE = 22, TIP = { x: SIZE * 4 / 24, y: SIZE * 2 / 24 };
  let host, pointer, badge, frame = 0, motion, finish, scale = 1, pos = { x: 48, y: 48 }, target = { ...pos };
  const ARROW = `<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 24 24"><path d="M4 2l15 9-7 1.6L8.6 20z" fill="#fff" stroke="#000" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
  const still = () => document.hidden || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  const pageZoom = () => Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
  const sizeFor = (browserZoom = 1) => 1 / (Number(browserZoom) > 0 ? Number(browserZoom) : 1);
  function mount() {
    if (host?.isConnected) return;
    host = document.createElement('arara-cursor');
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>:host{all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647}#p{position:fixed;left:0;top:0;width:${SIZE}px;height:${SIZE}px;will-change:transform;transform-origin:${TIP.x}px ${TIP.y}px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.4))}#p svg{display:block;transition:transform .12s ease-out;transform-origin:${TIP.x}px ${TIP.y}px}#p.click svg{transform:scale(.8)}#b{position:fixed;left:12px;bottom:12px;transform-origin:0 100%;font:13px system-ui,sans-serif;background:#111;color:#fff;border-radius:8px;padding:6px 10px;opacity:.88}#b:empty{display:none}</style><div id="p">${ARROW}</div><div id="b"></div>`;
    pointer = root.getElementById('p'); badge = root.getElementById('b');
    document.documentElement.append(host);
    resize();
    place(pos);
  }
  function resize(browserZoom) {
    if (browserZoom !== undefined) scale = sizeFor(browserZoom);
    if (!host) return;
    host.style.zoom = String(1 / pageZoom());
    badge.style.transform = `scale(${scale})`;
    place(pos);
  }
  function place(at) { pos = at; if (pointer) pointer.style.transform = `translate(${at.x - TIP.x}px, ${at.y - TIP.y}px) scale(${scale})`; }
  function curve(from, to) {
    const dx = to.x - from.x, dy = to.y - from.y, dist = Math.hypot(dx, dy) || 1;
    const nx = -dy / dist, ny = dx / dist, bend = (Math.random() < 0.5 ? -1 : 1) * Math.min(160, dist * (0.15 + Math.random() * 0.2));
    const c1 = { x: from.x + dx * 0.3 + nx * bend, y: from.y + dy * 0.3 + ny * bend };
    const c2 = { x: from.x + dx * 0.75 + nx * bend * 0.4, y: from.y + dy * 0.75 + ny * bend * 0.4 };
    return t => { const u = 1 - t; return { x: u ** 3 * from.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t ** 3 * to.x, y: u ** 3 * from.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t ** 3 * to.y }; };
  }
  const durationFor = (from, to) => Math.min(750, Math.max(220, Math.hypot(to.x - from.x, to.y - from.y) * 0.9));
  function stop() {
    cancelAnimationFrame(frame); motion = undefined;
    const pending = finish; finish = undefined; pending?.();
  }
  function animate(step) {
    stop();
    return new Promise(resolve => {
      const end = () => { if (finish === end) { finish = undefined; motion = undefined; } resolve(); };
      finish = end;
      const tick = now => { if (finish !== end) return; if (step(now)) end(); else frame = requestAnimationFrame(tick); };
      frame = requestAnimationFrame(tick);
    });
  }
  function moveTo(x, y, speed = 1) {
    mount();
    const to = { x: Math.round(x), y: Math.round(y) };
    if (to.x === target.x && to.y === target.y && motion) return motion;
    target = to;
    if (still() || Math.hypot(to.x - pos.x, to.y - pos.y) < 2) { stop(); place(to); return Promise.resolve(); }
    const from = { ...pos }, path = curve(from, to), total = durationFor(from, to) / speed, start = performance.now();
    return (motion = animate(now => { const t = Math.min(1, (now - start) / total); place(path(ease(t))); return t >= 1; }));
  }
  function chase(aim, until, delay = 0) {
    mount();
    let done = false;
    void until.then(() => { done = true; });
    if (still()) { stop(); return until; }
    const start = performance.now();
    let last = start;
    return animate(now => {
      const dt = Math.min(64, now - last) / 1000; last = now;
      const at = now - start >= delay ? aim() : null;
      if (at) { const k = 1 - Math.exp(-dt * 6); place({ x: pos.x + (at.x - pos.x) * k, y: pos.y + (at.y - pos.y) * k }); target = { ...pos }; }
      return done;
    });
  }
  function render(next) {
    if (!next?.active) { stop(); host?.remove(); host = undefined; return; }
    const fresh = !host?.isConnected;
    mount();
    resize(next.zoom ?? 1);
    if (fresh && next.here && Number.isFinite(next.x) && Number.isFinite(next.y)) void moveTo(next.x, next.y);
    badge.textContent = next.label ?? '';
  }
  async function press() {
    mount();
    pointer.classList.add('click');
    await new Promise(resolve => setTimeout(resolve, 140));
    pointer.classList.remove('click');
  }
  const DRIFT_CHANCE = 0.7, DRIFT_MIN_MS = 2000, DRIFT_MAX_MS = 5000;
  const driftDelay = (random = Math.random) => random() < DRIFT_CHANCE ? DRIFT_MIN_MS + random() * (DRIFT_MAX_MS - DRIFT_MIN_MS) : null;
  globalThis.AraraCursor = { render, moveTo, chase, press, durationFor, driftDelay, sizeFor, SIZE, get visible() { return !!host?.isConnected; }, get position() { return { ...pos }; }, owns: element => !!host && (element === host || host.contains(element)) };
})();
