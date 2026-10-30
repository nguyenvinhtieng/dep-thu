import { EventEmitter } from 'node:events';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client, ClientState, CloseCode, LocalDriver, LocalPresence, matchMaker } from '@colyseus/core';
import { NET, RoomInfo } from '@dep/shared';
import { MatchRoom, usedCodes } from '../src/rooms/MatchRoom';

// Keep the real Colyseus room, matchmaking driver and disposal hooks. Only the
// transport is a double: these regressions do not need an open TCP listener.
const roomType = 'lifecycle-test';
let rooms: MatchRoom[] = [];

async function createRoom() {
  const listing = await matchMaker.createRoom(roomType, { name: 'Jimmy' });
  const room = matchMaker.getLocalRoomById(listing.roomId) as MatchRoom;
  rooms.push(room);
  return room;
}

function addClient(room: MatchRoom, sid: string, spectate = false) {
  const client = {
    sessionId: sid, reconnectionToken: `${sid}-token`, state: ClientState.JOINED,
    ref: new EventEmitter(), send: vi.fn(), sendBytes: vi.fn(),
    enqueueRaw: vi.fn(), raw: vi.fn(), leave: vi.fn(),
  } as unknown as Client;
  room.clients.push(client);
  room.onJoin(client, { name: sid, guestId: sid, char: 0, spectate });
  return client;
}

function leave(room: MatchRoom, client: Client, code = CloseCode.CONSENTED) {
  return (room as unknown as {
    _onLeave(client: Client, code: number): Promise<void>;
  })._onLeave(client, code);
}

function watchInfo(room: MatchRoom) {
  const broadcast = vi.spyOn(room, 'broadcast');
  return () => {
    const calls = broadcast.mock.calls.filter(([type]) => type === 'info');
    return calls.at(-1)?.[1] as RoomInfo;
  };
}

async function expectDisposed(room: MatchRoom) {
  expect(await matchMaker.query({ roomId: room.roomId })).toEqual([]);
  expect(matchMaker.getLocalRoomById(room.roomId)).toBeUndefined();
  expect(usedCodes.has(room.roomId)).toBe(false);
}

beforeAll(async () => {
  await matchMaker.setup(new LocalPresence(), new LocalDriver());
  matchMaker.defineRoomType(roomType, MatchRoom);
});

beforeEach(() => {
  vi.useFakeTimers();
  rooms = [];
});

afterEach(async () => {
  for (const room of rooms) {
    for (const client of [...room.clients]) await leave(room, client);
    await room.disconnect();
  }
  vi.restoreAllMocks();
  vi.useRealTimers();
});

afterAll(async () => {
  matchMaker.removeRoomType(roomType);
  await matchMaker.presence.shutdown();
  await matchMaker.driver.shutdown();
});

describe('room membership and native empty-room disposal', () => {
  it('removes an explicit departure immediately and preserves a connected spectator', async () => {
    const room = await createRoom();
    const info = watchInfo(room);
    const player = addClient(room, 'Player');
    const viewer = addClient(room, 'Viewer', true);

    await leave(room, player);
    expect(info().members.map((m) => m.sid)).toEqual([viewer.sessionId]);
    expect(info().hostSid).toBe(viewer.sessionId);
    await vi.advanceTimersByTimeAsync((NET.reconnectSeconds + 2) * 1000);
    expect(await matchMaker.query({ roomId: room.roomId })).toHaveLength(1);
    expect(usedCodes.has(room.roomId)).toBe(true);
  });

  it('removes the listing and room code after the last explicit departure', async () => {
    const room = await createRoom();
    const player = addClient(room, 'Player');
    await vi.advanceTimersByTimeAsync(room.seatReservationTimeout * 1000 + 1);

    await leave(room, player);
    await vi.advanceTimersByTimeAsync(0);
    await expectDisposed(room);
  });

  it('expires an abandoned initial seat reservation without a successful join', async () => {
    const reservation = await matchMaker.create(roomType, { name: 'Jimmy' });
    const room = matchMaker.getLocalRoomById(reservation.roomId) as MatchRoom;
    rooms.push(room);

    await vi.advanceTimersByTimeAsync(room.seatReservationTimeout * 1000 + 1);
    await expectDisposed(room);
  });

  it('does not keep an empty room alive when the first join has invalid options', async () => {
    const room = await createRoom();
    const invalid = { sessionId: 'Invalid' } as Client;
    expect(() => room.onJoin(invalid, { name: '' })).toThrow();

    await vi.advanceTimersByTimeAsync(room.seatReservationTimeout * 1000 + 1);
    await expectDisposed(room);
  });

  it('retains a dropped player during grace, then removes them and disposes the room', async () => {
    const room = await createRoom();
    const info = watchInfo(room);
    const player = addClient(room, 'Player');
    const dropped = leave(room, player, CloseCode.ABNORMAL_CLOSURE);

    await vi.advanceTimersByTimeAsync(1000);
    expect(info().members).toHaveLength(1);
    expect(info().members[0].connected).toBe(false);
    expect(await matchMaker.query({ roomId: room.roomId })).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(NET.reconnectSeconds * 1000 + 1001);
    await dropped;
    await expectDisposed(room);
  });

  it('keeps the viewer after one player leaves and the other loses connection, then deletes the empty room', async () => {
    const room = await createRoom();
    const info = watchInfo(room);
    const first = addClient(room, 'First');
    const second = addClient(room, 'Second');
    const viewer = addClient(room, 'Viewer', true);

    await leave(room, first);
    const dropped = leave(room, second, CloseCode.ABNORMAL_CLOSURE);
    await vi.advanceTimersByTimeAsync((NET.reconnectSeconds + 2) * 1000);
    await dropped;

    expect(info().members).toHaveLength(1);
    expect(info().members[0]).toMatchObject({ sid: viewer.sessionId, slot: -1, connected: true });
    expect(info().hostSid).toBe(viewer.sessionId);
    expect(await matchMaker.query({ roomId: room.roomId })).toHaveLength(1);
    expect(usedCodes.has(room.roomId)).toBe(true);

    await leave(room, viewer);
    await vi.advanceTimersByTimeAsync(0);
    await expectDisposed(room);
  });

  it('reconnects the same member without adding another spectator or suffixing their name', async () => {
    const room = await createRoom();
    const info = watchInfo(room);
    const viewer = addClient(room, 'Jimmy', true);
    let restore!: (client: Client) => void;
    vi.spyOn(room, 'allowReconnection').mockImplementation(() => new Promise<Client>((resolve) => { restore = resolve; }) as ReturnType<MatchRoom['allowReconnection']>);
    const dropped = room.onDrop(viewer);
    const replacement = { ...viewer, ref: new EventEmitter() } as Client;

    room.onReconnect(replacement);
    restore(replacement);
    await dropped;

    expect(info().members).toHaveLength(1);
    expect(info().members[0]).toMatchObject({ sid: viewer.sessionId, name: 'Jimmy', slot: -1, connected: true });
  });
});
