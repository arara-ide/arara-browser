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
  const CHASE_DURING_SCROLL = 0.5, MAX_CLICKS = 40, BETWEEN_CLICKS_MS = 120;
  async function approach(element) {
    reading++;
    const aim = aimAt(element);
    const { moving, settled } = reveal(element);
    if (moving && cursor) await cursor.chase(aim, settled, Math.random() < CHASE_DURING_SCROLL ? 0 : 180 + Math.random() * 220);
    else await settled;
    return aim;
  }
  async function cursorAt(element, action) {
    const aim = await approach(element);
    const at = aim();
    await cursor?.moveTo(at.x, at.y);
    if (action === 'click') await cursor?.press();
    void notify(at, action);
    return at;
  }
  const contains = (box, at) => at.x >= box.left && at.x <= box.left + box.width && at.y >= box.top && at.y <= box.top + box.height;
  function drift(element) {
    const delay = cursor?.driftDelay();
    if (delay === null || delay === undefined) return;
    const run = reading;
    setTimeout(() => {
      if (run !== reading || !cursor.visible || !element.isConnected) return;
      const box = element.getBoundingClientRect();
      if (!contains(box, cursor.position)) return;
      const at = pointIn(box);
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
  const clickTargets = args => {
    const list = Array.isArray(args.uids) ? args.uids.map(uid => ({ uid })) : Array.isArray(args.elements) ? args.elements : null;
    return list ?? [args];
  };
  async function clickAll(args) {
    const targets = clickTargets(args), total = targets.length, count = args.dblClick ? 2 : 1;
    if (!total) throw new Error('click needs uid, selector, uids or elements.');
    let done = 0, last = null;
    try {
      for (const item of targets.slice(0, MAX_CLICKS)) {
        let target;
        try { target = required(find(item), 'click'); }
        catch (error) { throw new Error(done ? `Clicked ${done} of ${total}. ${error.message}` : error.message); }
        if (done) await input.delay(BETWEEN_CLICKS_MS);
        const { x, y } = await cursorAt(target, 'click');
        input.click(target, x, y, count);
        done++; last = target;
      }
    } finally { if (args.marked) for (const node of document.querySelectorAll('[data-arara-click]')) node.removeAttribute('data-arara-click'); }
    const rest = total - done;
    return { last, text: total === 1 ? '' : rest ? `Clicked ${done} of ${total}; call click again for the remaining ${rest}.` : `Clicked ${done} elements, one by one.` };
  }
  async function run(action, args = {}) {
    if (action === 'click') {
      const { last, text } = await clickAll(args);
      await input.delay(300);
      drift(last);
      return `click done.${text ? ` ${text}` : ''} ${describe(last)}\nurl: ${location.href}\ntitle: ${document.title}`;
    }
    const element = find(args);
    let last = null;
    switch (action) {
      case 'read': { if (element) await approach(element); void follow(element); return read(element); }
      case 'take_snapshot': { if (element) await approach(element); void follow(element); return snapshot(element ?? document.body); }
      case 'hover': { const target = required(element, action); const { x, y } = await cursorAt(target, 'move'); input.hover(target, x, y); last = target; break; }
      case 'fill': { const target = required(element, action); await cursorAt(target, 'type'); await input.fill(target, String(args.value ?? '')); last = target; break; }
      case 'fill_form': {
        const items = Array.isArray(args.elements) ? args.elements : [];
        const step = input.typingStep(items.reduce((sum, item) => sum + String(item.value ?? '').length, 0));
        for (const item of items) { const field = required(find(item), action); await cursorAt(field, 'type'); await input.fill(field, String(item.value ?? ''), step); last = field; }
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
    if (last) drift(last);
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
