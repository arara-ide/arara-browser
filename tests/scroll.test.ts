import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

function fixture(reducedMotion = false) {
  const element = (width = 1000, height = 700, contentHeight = height, overflowY = 'visible') => ({
    tagName: 'DIV', parentElement: null as any, isContentEditable: false,
    clientWidth: width, clientHeight: height, scrollWidth: width, scrollHeight: contentHeight,
    scrollTop: 0, scrollLeft: 0, overflowX: 'visible', overflowY,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: width, bottom: height, width, height }),
    dispatchEvent: vi.fn(() => true), scrollIntoView: vi.fn(),
    scrollTo: vi.fn(function (this: any, options: any) { if (options.top !== undefined) this.scrollTop = options.top; if (options.left !== undefined) this.scrollLeft = options.left; }),
    scrollBy: vi.fn(function (this: any, options: any) { this.scrollTop += options.top ?? 0; this.scrollLeft += options.left ?? 0; }),
  });
  const root = element(), body = element(), main = element(1000, 700, 4000, 'auto');
  root.tagName = 'HTML'; body.tagName = 'BODY'; body.parentElement = root; main.parentElement = body;
  const document = { scrollingElement: root, documentElement: root, body, activeElement: body, querySelectorAll: () => [root, body, main] };
  const settle = vi.fn(async (key: () => string) => { key(); });
  class FakeEvent { constructor(public type: string, init: object) { Object.assign(this, init); } }
  const scope: any = { chrome: {}, document, window: { scrollBy: root.scrollBy.bind(root), scrollTo: root.scrollTo.bind(root) }, innerWidth: 1000, innerHeight: 700, getComputedStyle: (target: any) => target, AraraDom: { settle, smooth: () => !reducedMotion }, KeyboardEvent: FakeEvent };
  scope.globalThis = scope;
  runInNewContext(readFileSync('extension/agent-input.js', 'utf8'), scope);
  return { input: scope.AraraInput, root, body, main, document, settle, element };
}

describe('page scrolling', () => {
  it('scrolls the visible panel when the document has no scroll range', async () => {
    const f = fixture();
    await f.input.scroll(null, { direction: 'down', amount: 650 });
    expect(f.main.scrollBy).toHaveBeenCalledWith(expect.objectContaining({ top: 650, left: 0 }));
    expect(f.root.scrollBy).not.toHaveBeenCalled();
    expect(f.settle).toHaveBeenCalledOnce();
  });
  it('keeps normal documents on the document scroller', async () => {
    const f = fixture(); f.root.scrollHeight = 5000;
    await f.input.scroll(null, { direction: 'up', amount: 300 });
    expect(f.root.scrollBy).toHaveBeenCalledWith(expect.objectContaining({ top: -300 }));
    expect(f.main.scrollBy).not.toHaveBeenCalled();
  });
  it('ignores locked documents and offscreen or smaller panels', async () => {
    const f = fixture(); f.root.scrollHeight = 5000; f.root.overflowY = 'hidden';
    const sidebar = f.element(200, 700, 9000, 'auto'), hidden = f.element(1200, 900, 8000, 'auto');
    hidden.getBoundingClientRect = () => ({ left: 2000, top: 0, right: 3200, bottom: 900, width: 1200, height: 900 });
    f.document.querySelectorAll = () => [f.root, f.body, sidebar, hidden, f.main];
    await f.input.scroll(null, { to: 'bottom' });
    expect(f.main.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 4000 }));
    expect(sidebar.scrollTo).not.toHaveBeenCalled();
    expect(hidden.scrollTo).not.toHaveBeenCalled();
  });
  it('scrolls the nearest scrollable ancestor of an explicit target', async () => {
    const f = fixture(), child = f.element(); child.parentElement = f.main; f.root.scrollHeight = 5000;
    await f.input.scroll(child, { direction: 'up', amount: 200 });
    expect(f.main.scrollBy).toHaveBeenCalledWith(expect.objectContaining({ top: -200 }));
    expect(child.scrollIntoView).not.toHaveBeenCalled();
  });
  it('preserves reveal for an element without a direction or edge', async () => {
    const f = fixture(), child = f.element(); child.parentElement = f.main;
    await f.input.scroll(child, {});
    expect(child.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: 'center' }));
    expect(f.settle).toHaveBeenCalledOnce();
  });
  it('handles horizontal panels and settles on their scroll offsets', async () => {
    const f = fixture(); f.main.scrollWidth = 3000; f.main.overflowX = 'auto';
    await f.input.scroll(null, { direction: 'right', amount: 400 });
    expect(f.main.scrollLeft).toBe(400);
    const key = f.settle.mock.calls[0][0];
    const before = key(); f.main.scrollLeft = 700;
    expect(key()).not.toBe(before);
  });
  it('uses the focused panel for navigation keys', async () => {
    const f = fixture(), sidebar = f.element(200, 700, 5000, 'auto'), control = f.element();
    sidebar.parentElement = f.body; control.parentElement = sidebar;
    await f.input.key('PageDown', control);
    expect(sidebar.scrollTop).toBeGreaterThan(0);
    expect(f.main.scrollBy).not.toHaveBeenCalled();
  });
  it('honors reduced motion when scrolling', async () => {
    const f = fixture(true);
    await f.input.scroll(null, { direction: 'down' });
    expect(f.main.scrollBy).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));
  });
  it('implements synthetic navigation keys against the active scroll panel', async () => {
    const f = fixture();
    await f.input.key('PageDown'); expect(f.main.scrollTop).toBeGreaterThan(0);
    await f.input.key('PageUp'); expect(f.main.scrollTop).toBe(0);
    await f.input.key('End'); expect(f.main.scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 4000 }));
    await f.input.key('Home'); expect(f.main.scrollTop).toBe(0);
    await f.input.key('ArrowDown'); expect(f.main.scrollTop).toBeGreaterThan(0);
  });
  it('respects prevented keys, editing controls and modified shortcuts', async () => {
    const f = fixture(); f.body.dispatchEvent.mockReturnValue(false);
    await f.input.key('PageDown');
    f.body.dispatchEvent.mockReturnValue(true);
    await f.input.key('Control+End');
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON']) {
      const control = f.element(); control.tagName = tagName; control.parentElement = f.main;
      await f.input.key(tagName === 'BUTTON' ? 'Space' : 'End', control);
    }
    const editable = f.element(); editable.isContentEditable = true;
    await f.input.key('End', editable);
    expect(f.main.scrollBy).not.toHaveBeenCalled(); expect(f.main.scrollTo).not.toHaveBeenCalled();
  });
  it('does not submit a form when the page prevents Enter', async () => {
    const f = fixture(), control = Object.assign(f.element(), { tagName: 'INPUT', form: { requestSubmit: vi.fn() } });
    control.dispatchEvent.mockReturnValue(false);
    await f.input.key('Enter', control);
    expect(control.form.requestSubmit).not.toHaveBeenCalled();
    control.dispatchEvent.mockReturnValue(true);
    await f.input.key('Enter', control);
    expect(control.form.requestSubmit).toHaveBeenCalledOnce();
  });
});
