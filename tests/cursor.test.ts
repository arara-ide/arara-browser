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
  it('types at 2000 characters per minute and draws a 22 px cursor', () => {
    const { AraraInput } = load('agent-input.js', { chrome: {} }) as any;
    expect(AraraInput.CHARS_PER_MINUTE).toBe(2000);
    expect(AraraInput.typingStep(10)).toBe(30);
    expect(AraraInput.typingStep(4000)).toBe(15);
    const { AraraCursor } = load('cursor.js', { document: { querySelectorAll: () => [] } }) as any;
    expect(AraraCursor.SIZE).toBe(22);
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
    const box = { left: 0, top: 0, width: 100, height: 30 };
    const element = { isConnected: true, getBoundingClientRect: () => box, querySelectorAll: () => [] };
    const others: Record<string, { isConnected: boolean; getBoundingClientRect: () => typeof box }> = {};
    const moves: [number, number][] = [], events: string[] = [];
    const cursor = { driftDelay: () => 3000, visible: true, position: { x: 0, y: 0 }, moveTo: vi.fn(async (x: number, y: number) => { moves.push([x, y]); events.push(`move ${x},${y}`); cursor.position = { x, y }; }), chase: vi.fn(async (_aim: unknown, until: Promise<void>) => until), press: vi.fn(async () => { events.push('press'); }), owns: () => false };
    let n = 0;
    const scope = load('agent.js', {
      document: { addEventListener() {} },
      chrome: { runtime: { id: 'x', sendMessage: vi.fn(async () => undefined), onMessage: { addListener: (fn: typeof listener) => { listener = fn; } } } },
      AraraCursor: cursor,
      AraraDom: { find: (args: { uid?: string }) => { if (args.uid === 'gone') throw new Error('Element gone is gone. Call take_snapshot again.'); return (args.uid && others[args.uid]) || element; }, snapshot: () => '', read: () => 'text', describe: () => 'button', aimAt: (target: unknown) => () => target === element ? { x: 10, y: 10 } : { x: 200 + Object.values(others).indexOf(target as never), y: 50 }, reveal: () => scroll ? { moving: true, settled: scroll.settled } : { moving: false, settled: Promise.resolve() }, settle: async () => {}, pointIn: () => ({ x: 50 + ++n, y: 15 }) },
      AraraInput: { delay: async () => {}, click: (target: unknown) => { events.push(`click ${target === element ? 'main' : Object.keys(others).find(key => others[key] === target)}`); }, hover() {}, key() {}, fill: async () => {}, type: async () => {}, typingStep: () => 1 },
      location: { href: 'https://example.test/' }, setTimeout, clearTimeout, performance: { now: () => Date.now() },
    });
    const run = (action: string, args: Record<string, unknown> = { uid: 'u1' }) => new Promise(resolve => listener({ type: 'agentRun', action, args }, {}, resolve));
    return { scope, cursor, moves, events, run, box, others };
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
  it('clicks several elements one by one: move, press, click, then the next', async () => {
    const f = agent();
    for (const uid of ['u2', 'u3']) f.others[uid] = { isConnected: true, getBoundingClientRect: () => f.box };
    const done = f.run('click', { uids: ['u1', 'u2', 'u3'] });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await done).toMatchObject({ text: expect.stringContaining('Clicked 3 elements, one by one.') });
    expect(f.events).toEqual(['move 10,10', 'press', 'click main', 'move 200,50', 'press', 'click u2', 'move 201,50', 'press', 'click u3']);
  });
  it('starts the drift only after the last click and only on the last element', async () => {
    const f = agent();
    f.others.u2 = { isConnected: true, getBoundingClientRect: () => ({ left: 190, top: 40, width: 40, height: 20 }) };
    const done = f.run('click', { uids: ['u1', 'u2'] });
    await vi.advanceTimersByTimeAsync(1000); await done;
    await vi.advanceTimersByTimeAsync(3000);
    expect(f.moves).toEqual([[10, 10], [200, 50], [51, 15]]);
  });
  it('skips the drift when the element moved away from the cursor', async () => {
    const f = agent();
    const done = f.run('click');
    await vi.advanceTimersByTimeAsync(400); await done;
    f.box.top = 500;
    await vi.advanceTimersByTimeAsync(3000);
    expect(f.moves).toEqual([[10, 10]]);
  });
  it('reports partial progress when an element disappears in the middle', async () => {
    const f = agent();
    f.others.u2 = { isConnected: true, getBoundingClientRect: () => f.box };
    const done = f.run('click', { uids: ['u1', 'gone', 'u2'] });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await done).toEqual({ error: 'Clicked 1 of 3. Element gone is gone. Call take_snapshot again.' });
    expect(f.events).toEqual(['move 10,10', 'press', 'click main']);
  });
  it('reads an element out of view: smooth scroll with the cursor chasing it, then the reading pass', async () => {
    let finish!: () => void;
    const settled = new Promise<void>(resolve => { finish = resolve; });
    const f = agent({ settled });
    let answered = false;
    const done = f.run('read').then(value => { answered = true; return value; });
    await vi.advanceTimersByTimeAsync(1500);
    expect(f.cursor.chase).toHaveBeenCalledOnce();
    expect(f.cursor.chase.mock.calls[0][1]).toBe(settled);
    expect(answered).toBe(false);
    finish();
    await vi.advanceTimersByTimeAsync(10);
    expect(await done).toEqual({ text: 'text' });
    expect(f.cursor.press).not.toHaveBeenCalled();
  });
});
