import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MsgBin, NET } from '@dep/shared';

vi.mock('phaser', () => ({ default: {} }));
vi.mock('@colyseus/sdk', () => ({ Client: class {}, Room: class {} }));
vi.mock('../../client/src/input/input', () => ({ Input: class {}, keyName: vi.fn() }));
vi.mock('../../client/src/net/match', () => ({ NetMatch: class {} }));
vi.mock('../../client/src/net/netsim', () => ({ parseNetSim: vi.fn(), Pipe: class {} }));
vi.mock('../../client/src/scenes/MatchScene', () => ({ MatchScene: class {} }));
vi.mock('../../client/src/ui/dom', () => ({ h: vi.fn(), hex: vi.fn(), mount: vi.fn(), toast: vi.fn() }));
vi.mock('../../client/src/ui/help', () => ({ helpModal: vi.fn(), prefs: {} }));

import { App } from '../../client/src/app';

type Callback = (...args: any[]) => void;
function room() {
  const messages = new Map<string | number, Callback>();
  const events = new Map<string, Callback>();
  return {
    connection: { isOpen: true },
    sessionId: 'session',
    leave: vi.fn().mockResolvedValue(1000),
    sendBytes: vi.fn(), send: vi.fn(),
    onMessage: vi.fn((type, callback) => messages.set(type, callback)),
    onDrop: vi.fn((callback) => events.set('drop', callback)),
    onReconnect: vi.fn((callback) => events.set('reconnect', callback)),
    onLeave: vi.fn((callback) => events.set('leave', callback)),
    message: (type: string | number, value: unknown) => messages.get(type)?.(value),
    event: (type: string, ...args: unknown[]) => events.get(type)?.(...args),
  };
}
type TestRoom = ReturnType<typeof room>;
type Harness = {
  room: TestRoom | null;
  joining: boolean;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  rooms: Map<string, unknown>;
  client: { create: ReturnType<typeof vi.fn>; joinById: ReturnType<typeof vi.fn> };
  profile: { name: string; guestId: string; char: number };
  screen: string;
  chatLog: unknown[];
  match: { update: ReturnType<typeof vi.fn> } | null;
  input: { buttons: ReturnType<typeof vi.fn> };
  lastPing: number;
  lastRttSent: number;
  rtt: number;
  pipeIn: { push: (callback: Callback) => void };
  pipeOut: { push: (callback: Callback) => void };
  queue: Callback[];
  joinRoom: (fn: () => Promise<TestRoom>) => Promise<void>;
  quickPlay: () => Promise<void>;
  enterRoom: (room: TestRoom) => void;
  leaveRoom: () => void;
  netTick: () => void;
  showLobby: ReturnType<typeof vi.fn>;
  showRoom: ReturnType<typeof vi.fn>;
  leaveLobby: ReturnType<typeof vi.fn>;
  endMatch: ReturnType<typeof vi.fn>;
  onInfo: ReturnType<typeof vi.fn>;
  onSnapshot: ReturnType<typeof vi.fn>;
  onPong: ReturnType<typeof vi.fn>;
};
function app(): Harness {
  const queue: Callback[] = [];
  return Object.assign(Object.create(App.prototype), {
    room: null, joining: false, reconnectTimer: null, rooms: new Map(),
    client: { create: vi.fn(), joinById: vi.fn() },
    profile: { name: 'Jimmy', guestId: 'guest', char: 3 },
    screen: 'lobby', chatLog: [], match: null, input: { buttons: vi.fn(() => 0) },
    lastPing: -Infinity, lastRttSent: Infinity, rtt: 0,
    pipeIn: { push: (callback: Callback) => queue.push(callback) },
    pipeOut: { push: (callback: Callback) => queue.push(callback) }, queue,
    showLobby: vi.fn(), showRoom: vi.fn(), leaveLobby: vi.fn(), endMatch: vi.fn(),
    onInfo: vi.fn(), onSnapshot: vi.fn(), onPong: vi.fn(),
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('sessionStorage', { removeItem: vi.fn() });
  vi.stubGlobal('history', { replaceState: vi.fn() });
  vi.stubGlobal('location', { pathname: '/', search: '' });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('client room lifecycle', () => {
  it('allows only one concurrent join across direct join and quick play', async () => {
    const a = app(), pending = deferred<TestRoom>(), joined = room();
    const join = vi.fn(() => pending.promise), secondJoin = vi.fn();
    const first = a.joinRoom(join);
    await Promise.all([a.joinRoom(secondJoin), a.quickPlay()]);
    expect(join).toHaveBeenCalledTimes(1);
    expect(secondJoin).not.toHaveBeenCalled();
    expect(a.client.create).not.toHaveBeenCalled();
    pending.resolve(joined);
    await first;
    expect(a.room).toBe(joined);
    await a.joinRoom(secondJoin);
    expect(secondJoin).not.toHaveBeenCalled();
  });

  it('serializes quick-play requests and permits retry after a failed join', async () => {
    const a = app(), pending = deferred<TestRoom>();
    a.client.create.mockReturnValue(pending.promise);
    const first = a.quickPlay();
    await a.quickPlay();
    expect(a.client.create).toHaveBeenCalledTimes(1);
    pending.resolve(room());
    await first;
    a.leaveRoom();
    await a.joinRoom(() => Promise.reject(new Error('full')));
    const next = room();
    await a.joinRoom(() => Promise.resolve(next));
    expect(a.room).toBe(next);
  });

  it('leaves replaced sessions and ignores their late events and queued snapshots', () => {
    const a = app(), old = room(), current = room();
    a.enterRoom(old);
    old.message(MsgBin.Snapshot, new Uint8Array([1]));
    a.enterRoom(current);
    expect(old.leave).toHaveBeenCalledWith(true);
    old.message('info', { members: [] });
    old.message('chat', { text: 'stale' });
    old.event('drop');
    old.event('leave', 1006);
    a.queue.forEach((callback) => callback());
    expect(a.room).toBe(current);
    expect(a.onInfo).not.toHaveBeenCalled();
    expect(a.onSnapshot).not.toHaveBeenCalled();
    expect(a.chatLog).toEqual([]);
    expect(a.showLobby).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('returns to lobby immediately when leaving offline without waiting for the server', () => {
    const a = app(), joined = room();
    joined.leave.mockReturnValue(new Promise(() => {}));
    a.enterRoom(joined);
    joined.connection.isOpen = false;
    joined.event('drop');
    a.leaveRoom();
    expect(a.room).toBeNull();
    expect(joined.leave).toHaveBeenCalledWith(true);
    expect(a.endMatch).toHaveBeenCalledTimes(1);
    expect(a.showLobby).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    joined.event('leave', 1000);
    expect(a.showLobby).toHaveBeenCalledTimes(1);
  });

  it('bounds reconnection to the server grace period despite repeated drop events', async () => {
    const a = app(), joined = room();
    a.enterRoom(joined);
    joined.event('drop');
    await vi.advanceTimersByTimeAsync(NET.reconnectSeconds * 500);
    joined.event('drop');
    await vi.advanceTimersByTimeAsync(NET.reconnectSeconds * 500);
    expect(joined.leave).toHaveBeenCalledWith(true);
    expect(a.room).toBeNull();
    expect(a.showLobby).toHaveBeenCalledTimes(1);
  });

  it('keeps a reconnected session and cancels its old timeout', async () => {
    const a = app(), joined = room();
    a.enterRoom(joined);
    joined.event('drop');
    await vi.advanceTimersByTimeAsync(1000);
    joined.event('reconnect');
    await vi.advanceTimersByTimeAsync(NET.reconnectSeconds * 1000);
    expect(a.room).toBe(joined);
    expect(joined.leave).not.toHaveBeenCalled();
    expect(a.showLobby).not.toHaveBeenCalled();
  });

  it('does not tick a disconnected match or send an old queued ping to a new room', () => {
    const a = app(), old = room(), current = room();
    a.enterRoom(old);
    old.connection.isOpen = false;
    a.match = { update: vi.fn() };
    a.netTick();
    expect(a.match.update).not.toHaveBeenCalled();
    expect(a.queue).toHaveLength(0);
    a.match = null;
    old.connection.isOpen = true;
    a.netTick();
    expect(a.queue).toHaveLength(1);
    a.enterRoom(current);
    a.queue.forEach((callback) => callback());
    expect(old.sendBytes).not.toHaveBeenCalled();
    expect(current.sendBytes).not.toHaveBeenCalled();
  });
});
