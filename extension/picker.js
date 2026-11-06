/*
 * Portions adapted from Chat On Steroids (https://github.com/totec448-spec/chat-on-steroids),
 * MIT License, Copyright (c) 2026 Chat On Steroids contributors.
 */
(() => {
  if (window.__araraPicker) return;
  window.__araraPicker = true;
  const TRIGGER = '[data-codex-intelligence-trigger], [data-composer-navigation-target="reasoning"]';
  const EFFORTS = { none: 'none', instant: 'none', minimal: 'minimal', min: 'low', low: 'low', standard: 'medium', medium: 'medium', extended: 'high', high: 'high', xhigh: 'xhigh', 'extra high': 'xhigh', max: 'xhigh', ultra: 'ultra', pro: 'pro' };
  const label = value => typeof value === 'string' && value.trim() && value.length <= 80 ? value.trim() : null;
  const modelName = value => { const name = label(value); return name && /^\d/.test(name) ? `GPT-${name}` : name; };
  const isPro = value => /^(?:pro|(?:gpt-?)?\d+(?:[.-]\d+)?-pro)$/.test(String(value ?? '').trim().toLowerCase());
  const laneEffort = lane => isPro(lane?.model) ? 'pro'
    : EFFORTS[String(lane?.labels?.effort ?? lane?.sliderLabel ?? '').trim().toLowerCase()] ?? EFFORTS[lane?.reasoningEffort] ?? null;
  function fiberOf(node) {
    const key = node && Object.keys(node).find(name => name.startsWith('__reactFiber$'));
    return key ? node[key] : null;
  }
  function snapshot() {
    const node = [...document.querySelectorAll(TRIGGER)].find(element => element.getClientRects().length > 0);
    for (let fiber = fiberOf(node), up = 0; fiber && up < 80; up++, fiber = fiber.return) {
      const props = fiber.memoizedProps;
      if (!Array.isArray(props?.powerSelections)) continue;
      const options = props.modelListConfig?.options;
      const selected = props.selectedPowerSelection ?? props.selectedLabelCandidate;
      if (!selected || !Array.isArray(options)) return null;
      const current = options.find(option => option?.selected === true);
      const versions = options.filter(option => option && option.disabled !== true && label(option.id) && label(option.label))
        .map(option => ({ id: option.id, label: modelName(option.label) }));
      const choices = props.powerSelections.map(lane => ({ bucket: lane?.powerSettingIndex, model: lane?.model, effort: laneEffort(lane),
        available: props.modelSelectionDisabled !== true && lane?.disabled !== true && (!lane?.availability || lane.availability.status === 'available') }))
        .filter(choice => Number.isInteger(choice.bucket) && typeof choice.model === 'string' && choice.effort);
      const chosen = choices.find(choice => choice.model === selected.model && choice.effort === laneEffort(selected));
      if (!current || !versions.length || !choices.length || !chosen) return null;
      return { version: current.id, versions, choices, lanes: props.powerSelections.map(lane => lane?.powerSettingIndex), currentBucket: chosen.bucket };
    }
    return null;
  }
  window.addEventListener('message', event => {
    const data = event.data;
    if (event.source !== window || data?.source !== 'arara-picker-ask' || typeof data.nonce !== 'string') return;
    let picker = null;
    try { picker = snapshot(); } catch { picker = null; }
    window.postMessage({ source: 'arara-picker-reply', nonce: data.nonce, picker }, location.origin);
  });
})();
