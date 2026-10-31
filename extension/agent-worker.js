(() => {
  if (globalThis.AraraAgent) return;
  const tabs = globalThis.AraraTabs;
  const PAGE_ACTIONS = new Set(['read', 'take_snapshot', 'click', 'hover', 'fill', 'fill_form', 'press_key', 'type_text', 'scroll', 'wait_for', 'list_console_messages', 'get_console_message', 'list_network_requests', 'get_network_request']);
  const HANDLERS = {
    list_pages: () => tabs.listPages(),
    navigate_page: args => tabs.navigate(args),
    new_page: args => tabs.newPage(args),
    select_page: args => tabs.selectPage(args),
    close_page: args => tabs.closePage(args),
    take_screenshot: () => tabs.screenshot(),
    evaluate_script: args => tabs.evaluate(args),
    set_device: args => tabs.device(args),
  };
  async function execute(command) {
    const action = String(command?.action ?? ''), args = command?.args && typeof command.args === 'object' ? command.args : {};
    try {
      const output = PAGE_ACTIONS.has(action) ? await tabs.inPage(action, args) : HANDLERS[action] ? await HANDLERS[action](args) : (() => { throw new Error(`Unknown action ${action}.`); })();
      return typeof output === 'string' ? { text: output } : output;
    } catch (error) { return { error: error.message }; }
  }
  let running = false, idle;
  async function loop(api, refusal) {
    if (running) return;
    running = true;
    try {
      for (let i = 0; i < 40; i++) {
        const { command } = await api('/agent/poll', {});
        if (!command) break;
        const result = refusal ? { error: refusal } : await execute(command);
        await api('/agent/result', { id: command.id, result });
      }
    } catch {} finally {
      running = false;
      clearTimeout(idle);
      idle = setTimeout(() => void tabs.setCursor({ active: false }), 15000);
    }
  }
  globalThis.AraraAgent = { execute, loop, PAGE_ACTIONS, HANDLERS };
})();
