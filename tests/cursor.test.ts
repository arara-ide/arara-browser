import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';

function load(file: string, scope: Record<string, unknown>) { scope.globalThis = scope; runInNewContext(readFileSync(`extension/${file}`, 'utf8'), scope); return scope; }
afterEach(() => { vi.useRealTimers(); });

describe('AI cursor realism', () => {
  it('lands on a random point inside the visible part of the element', () => {
    const { AraraDom } = load('agent-dom.js', { innerWidth: 1000, innerHeight: 800 }) as any;
    const box = { left: 100, top: 50, width: 200, height: 40 };
    const view = { width: 1000, height: 800 };
    expect(AraraDom.pointIn(box, () => 0, view)).toEqual({ x: 112, y: 58 });
    expect(AraraDom.pointIn(box, () => 1, view)).toEqual({ x: 288, y: 82 });
    expect(AraraDom.pointIn(box, () => 0.5, view)).toEqual({ x: 200, y: 70 });
    expect(AraraDom.pointIn({ left: 900, top: 10, width: 300, height: 20 }, () => 1, view).x).toBeLessThanOrEqual(1000);
    expect(AraraDom.pointIn({ left: 100, top: 900, width: 50, height: 20 }, () => 0.5, view)).toBeNull();
  });
  it('drifts in 70% of the cases, after 2 to 5 seconds', () => {
    const { AraraCursor } = load('cursor.js', { document: { querySelectorAll: () => [] } }) as any;
    expect(AraraCursor.driftDelay(() => 0.69)).toBe(2000 + 0.69 * 3000);
    expect(AraraCursor.driftDelay(() => 0.7)).toBeNull();
    const delays = [0, 0.999].map(value => { const values = [0, value]; return AraraCursor.driftDelay(() => values.shift()!); });
    expect(delays).toEqual([2000, 2000 + 0.999 * 3000]);
  });
  function agent(scroll?: { settled: Promise<void> }) {
    vi.useFakeTimers();
    let listener!: (message: unknown, sender: unknown, reply: (value: unknown) => void) => unknown;
    const element = { isConnected: true, getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 30 }) };
    const moves: [number, number][] = [];
    const cursor = { driftDelay: () => 3000, visible: true, moveTo: vi.fn(async (x: number, y: number) => { moves.push([x, y]); }), chase: vi.fn(async (_aim: unknown, until: Promise<void>) => until), press: vi.fn(async () => {}), owns: () => false };
    let n = 0;
    const scope = load('agent.js', {
      document: { addEventListener() {} },
      chrome: { runtime: { id: 'x', sendMessage: vi.fn(async () => undefined), onMessage: { addListener: (fn: typeof listener) => { listener = fn; } } } },
      AraraCursor: cursor,
      AraraDom: { find: () => element, snapshot: () => '', read: () => 'text', describe: () => 'button', aimAt: () => () => ({ x: 10, y: 10 }), reveal: () => scroll ? { moving: true, settled: scroll.settled } : { moving: false, settled: Promise.resolve() }, settle: async () => {}, pointIn: () => ({ x: 50 + ++n, y: 15 }) },
      AraraInput: { delay: async () => {}, click() {}, hover() {}, key() {}, fill: async () => {}, type: async () => {}, typingStep: () => 1 },
      location: { href: 'https://example.test/' }, setTimeout, clearTimeout, performance: { now: () => Date.now() },
    });
    const run = (action: string) => new Promise(resolve => listener({ type: 'agentRun', action, args: { uid: 'u1' } }, {}, resolve));
    return { scope, cursor, moves, run };
  }
  it('moves to another random point of the same element when nothing else needs the cursor', async () => {
    const f = agent();
    const done = f.run('hover');
    await vi.advanceTimersByTimeAsync(400);
    await done;
    expect(f.moves).toEqual([[10, 10]]);
    await vi.advanceTimersByTimeAsync(3000);
    expect(f.moves).toEqual([[10, 10], [51, 15]]);
  });
  it('scrolls smoothly first, lets the cursor follow and answers only after the scroll and the final move', async () => {
    let finish!: () => void;
    const settled = new Promise<void>(resolve => { finish = resolve; });
    const f = agent({ settled });
    let answered = false;
    const done = f.run('click').then(value => { answered = true; return value; });
    await vi.advanceTimersByTimeAsync(1500);
    expect(f.cursor.chase).toHaveBeenCalledOnce();
    expect(f.cursor.chase.mock.calls[0][1]).toBe(settled);
    expect(f.moves).toEqual([]);
    expect(answered).toBe(false);
    finish();
    await vi.advanceTimersByTimeAsync(400);
    expect(f.moves).toEqual([[10, 10]]);
    expect(f.cursor.press).toHaveBeenCalledOnce();
    expect(answered).toBe(true);
    expect(await done).toMatchObject({ text: expect.stringContaining('click done') });
  });
  it('skips the drift when another action took the cursor first or the cursor is gone', async () => {
    const f = agent();
    const first = f.run('hover');
    await vi.advanceTimersByTimeAsync(400); await first;
    const second = f.run('press_key');
    await vi.advanceTimersByTimeAsync(400); await second;
    await vi.advanceTimersByTimeAsync(3000);
    expect(f.moves).toEqual([[10, 10]]);
    const third = f.run('hover');
    await vi.advanceTimersByTimeAsync(400); await third;
    f.cursor.visible = false;
    await vi.advanceTimersByTimeAsync(3000);
    expect(f.moves).toEqual([[10, 10], [10, 10]]);
  });
});
