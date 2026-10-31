(() => {
  if (globalThis.__araraAgent && globalThis.__araraRuntime === chrome.runtime?.id) return;
  globalThis.__araraAgent = true;
  globalThis.__araraRuntime = chrome.runtime?.id;
  const { find, snapshot, read, pointIn, reveal, settle, aimAt, describe } = globalThis.AraraDom;
  const input = globalThis.AraraInput;
  const logs = { console: [], network: [] };
  document.addEventListener('arara-page-log', event => {
    try {
      const entry = JSON.parse(event.detail), list = logs[entry.kind];
      if (!list) return;
      list.push({ id: list.length + 1, ...entry });
      if (list.length > 500) list.shift();
    } catch {}
  });
  const listing = kind => logs[kind].map(e => kind === 'console' ? `#${e.id} [${e.level}] ${e.text.slice(0, 300)}` : `#${e.id} ${e.method} ${e.status} ${e.url}`).join('\n') || `No ${kind} entries.`;
  const entry = (kind, id) => { const e = logs[kind].find(x => x.id === Number(id)); if (!e) throw new Error(`Entry ${id} not found.`); return JSON.stringify(e, null, 2); };
  const required = (element, action) => element ?? (() => { throw new Error(`${action} needs uid or selector.`); })();
  const cursor = globalThis.AraraCursor;
  let reading = 0;
  const notify = (at, action) => chrome.runtime.sendMessage({ type: 'agentCursor', x: at.x, y: at.y, action }).catch(() => {});
  const CHASE_DURING_SCROLL = 0.5;
  async function cursorAt(element, action) {
    reading++;
    const aim = aimAt(element);
    const { moving, settled } = reveal(element);
    if (moving && cursor) await cursor.chase(aim, settled, Math.random() < CHASE_DURING_SCROLL ? 0 : 180 + Math.random() * 220);
    else await settled;
    const at = aim();
    void notify(at, action);
    await cursor?.moveTo(at.x, at.y);
    if (action === 'click') await cursor?.press();
    drift(element);
    return at;
  }
  function drift(element) {
    const delay = cursor?.driftDelay();
    if (delay === null || delay === undefined) return;
    const run = reading;
    setTimeout(() => {
      if (run !== reading || !cursor.visible || !element.isConnected) return;
      const at = pointIn(element.getBoundingClientRect());
      if (!at) return;
      void cursor.moveTo(at.x, at.y, 0.7).then(() => { if (run === reading) void notify(at, 'move'); });
    }, delay);
  }
  const visibleText = element => {
    const box = element.getBoundingClientRect();
    if (box.width < 8 || box.height < 6 || box.bottom < 0 || box.top > innerHeight || box.right < 0 || box.left > innerWidth || cursor?.owns(element)) return null;
    const own = [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 2);
    return own ? box : null;
  };
  async function follow(root) {
    const run = ++reading, scope = root ?? document.body;
    const boxes = [];
    for (const element of scope.querySelectorAll('h1,h2,h3,h4,h5,p,li,td,th,dt,dd,label,a,button,span,div')) {
      const box = visibleText(element);
      if (box) boxes.push(box);
      if (boxes.length > 200) break;
    }
    if (!boxes.length && root) { const box = root.getBoundingClientRect(); if (box.width && box.height) boxes.push(box); }
    boxes.sort((a, b) => a.top - b.top || a.left - b.left);
    const picks = boxes.length <= 6 ? boxes : Array.from({ length: 6 }, (_, i) => boxes[Math.round(i * (boxes.length - 1) / 5)]);
    const end = performance.now() + 2600;
    for (const box of picks) {
      if (run !== reading || performance.now() > end) return;
      const y = box.top + Math.min(box.height / 2, 12);
      await cursor?.moveTo(box.left + 6, y, 1.6);
      if (run !== reading) return;
      await cursor?.moveTo(Math.min(box.right - 6, box.left + 6 + Math.min(box.width, 420)), y, 2.2);
    }
    if (run === reading && cursor) void notify(cursor.position, 'move');
  }
  async function run(action, args = {}) {
    const element = find(args);
    switch (action) {
      case 'read': { if (element) { reading++; await reveal(element).settled; } void follow(element); return read(element); }
      case 'take_snapshot': { void follow(element); return snapshot(element ?? document.body); }
      case 'click': { const target = required(element, action); const { x, y } = await cursorAt(target, 'click'); input.click(target, x, y, args.dblClick ? 2 : 1); break; }
      case 'hover': { const target = required(element, action); const { x, y } = await cursorAt(target, 'move'); input.hover(target, x, y); break; }
      case 'fill': { const target = required(element, action); await cursorAt(target, 'type'); await input.fill(target, String(args.value ?? '')); break; }
      case 'fill_form': {
        const items = Array.isArray(args.elements) ? args.elements : [];
        const step = input.typingStep(items.reduce((sum, item) => sum + String(item.value ?? '').length, 0));
        for (const item of items) { const field = required(find(item), action); await cursorAt(field, 'type'); await input.fill(field, String(item.value ?? ''), step); }
        break;
      }
      case 'press_key': reading++; input.key(args.key ?? 'Enter', element ?? undefined); break;
      case 'type_text': reading++; await input.type(args.text ?? ''); if (args.submitKey) input.key(args.submitKey); break;
      case 'scroll': reading++; input.scroll(element, args); await settle(() => `${scrollX},${scrollY}${element ? ',' + Math.round(element.getBoundingClientRect().top) : ''}`); break;
      case 'wait_for': await input.waitFor(args); break;
      case 'list_console_messages': return listing('console');
      case 'get_console_message': return entry('console', args.msgid ?? args.id);
      case 'list_network_requests': return listing('network');
      case 'get_network_request': return entry('network', args.reqid ?? args.id);
      default: throw new Error(`Unsupported action ${action}.`);
    }
    await input.delay(300);
    return `${action} done.${element ? ` ${describe(element)}` : ''}\nurl: ${location.href}\ntitle: ${document.title}`;
  }
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.tab) return;
    if (message?.type === 'agentCursorState') { globalThis.AraraCursor?.render(message.state); return; }
    if (message?.type !== 'agentRun') return;
    run(message.action, message.args).then(text => reply({ text }), error => reply({ error: error.message }));
    return true;
  });
  chrome.runtime.sendMessage({ type: 'agentHello' }).then(state => globalThis.AraraCursor?.render(state)).catch(() => {});
})();
