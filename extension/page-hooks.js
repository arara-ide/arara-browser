(() => {
  if (window.__araraHooks) return;
  window.__araraHooks = true;
  const emit = detail => document.dispatchEvent(new CustomEvent('arara-page-log', { detail: JSON.stringify(detail) }));
  const short = value => { try { return typeof value === 'string' ? value : JSON.stringify(value); } catch { return String(value); } };
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    const original = console[level];
    console[level] = function (...args) { emit({ kind: 'console', level, text: args.map(short).join(' ').slice(0, 2000) }); return original.apply(this, args); };
  }
  window.addEventListener('error', event => emit({ kind: 'console', level: 'error', text: String(event.message).slice(0, 2000) }));
  const originalFetch = window.fetch;
  window.fetch = async function (resource, init) {
    const url = String(resource?.url ?? resource), method = init?.method ?? resource?.method ?? 'GET';
    try { const response = await originalFetch.apply(this, arguments); emit({ kind: 'network', method, url, status: response.status }); return response; }
    catch (error) { emit({ kind: 'network', method, url, status: 0, error: String(error) }); throw error; }
  };
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.addEventListener('loadend', () => emit({ kind: 'network', method, url: String(url), status: this.status }));
    return open.apply(this, arguments);
  };
})();
