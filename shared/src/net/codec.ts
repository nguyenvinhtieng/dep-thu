import { BTN_MASK, GameState, PlayerState, SlipperObj, SlipperState } from '../sim/state';
import { SimEvent } from '../sim/step';
import { Phase } from './messages';

// ---- Input C→S: u16 latestSeq, u16 viewTick, u8 count, u8[count] nút (cũ → mới) ----

export interface InputPacket {
  seq: number;
  viewTick: number;
  buttons: number[];
}

export function encodeInput(seq: number, viewTick: number, buttons: ArrayLike<number>, count: number): Uint8Array {
  const out = new Uint8Array(5 + count);
  const v = new DataView(out.buffer);
  v.setUint16(0, seq & 0xffff);
  v.setUint16(2, viewTick & 0xffff);
  out[4] = count;
  for (let i = 0; i < count; i++) out[5 + i] = buttons[i] & BTN_MASK;
  return out;
}

export function decodeInput(buf: Uint8Array): InputPacket | null {
  if (buf.byteLength < 5) return null;
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const count = buf[4];
  if (count < 1 || count > 16 || buf.byteLength !== 5 + count) return null;
  const buttons: number[] = [];
  for (let i = 0; i < count; i++) buttons.push(buf[5 + i] & BTN_MASK);
  return { seq: v.getUint16(0), viewTick: v.getUint16(2), buttons };
}

// ---- Ping/Pong ----

export function encodePing(t: number): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setFloat64(0, t);
  return out;
}
export function decodePing(buf: Uint8Array): number | null {
  if (buf.byteLength !== 8) return null;
  const t = new DataView(buf.buffer, buf.byteOffset, 8).getFloat64(0);
  return Number.isFinite(t) ? t : null;
}
export function encodePong(t: number, tick: number): Uint8Array {
  const out = new Uint8Array(10);
  const v = new DataView(out.buffer);
  v.setFloat64(0, t);
  v.setUint16(8, tick & 0xffff);
  return out;
}
export function decodePong(buf: Uint8Array): { t: number; tick: number } {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return { t: v.getFloat64(0), tick: v.getUint16(8) };
}

// ---- Snapshot S→C ----
// Header 11 byte: u16 tick, u16 ackSeq, u8 phase, u16 phaseLeft, u8 round, u8 nPlayers, u8 nSlippers, u8 flags
// Người 21 byte, dép 1 byte (đang cầm) hoặc 10 byte, event 11 byte.

export interface NetPlayer extends PlayerState {
  connected: boolean;
  wins: number;
}

export interface SnapshotHeader {
  tick: number;
  ackSeq: number;
  phase: Phase;
  phaseLeft: number; // tick
  round: number;
}

export interface NetEvent extends SimEvent {
  id: number; // u16 tăng dần, client bỏ trùng
}

export interface Snapshot extends SnapshotHeader {
  frozen: boolean;
  players: NetPlayer[];
  slippers: SlipperObj[];
  events: NetEvent[];
}

const HEADER = 11;
const PLAYER_BYTES = 21;

export interface SnapshotExtra {
  phase: Phase;
  phaseLeft: number;
  round: number;
  connected: boolean[];
  wins: number[];
}

/** Phần thân dùng chung cho mọi người nhận; ackSeq ghi riêng từng người bằng writeAck(). */
export function encodeSnapshot(s: GameState, x: SnapshotExtra, events: NetEvent[]): Uint8Array {
  let size = HEADER + s.players.length * PLAYER_BYTES + 1 + events.length * 11;
  for (const d of s.slippers) size += d.state === SlipperState.Held ? 1 : 10;
  const out = new Uint8Array(size);
  const v = new DataView(out.buffer);
  let o = 0;
  v.setUint16(o, s.tick & 0xffff); o += 2;
  v.setUint16(o, 0); o += 2;
  out[o++] = x.phase;
  v.setUint16(o, Math.min(x.phaseLeft, 0xffff)); o += 2;
  out[o++] = x.round;
  out[o++] = s.players.length;
  out[o++] = s.slippers.length;
  out[o++] = s.frozen ? 1 : 0;
  s.players.forEach((p, i) => {
    out[o++] = (p.active ? 1 : 0) | (p.alive ? 2 : 0) | (p.onGround ? 4 : 0) | (p.facing > 0 ? 8 : 0) | (x.connected[i] ? 16 : 0);
    v.setUint16(o, Math.round(p.x * 8)); o += 2;
    v.setUint16(o, Math.max(0, Math.round(p.y * 8))); o += 2;
    v.setInt16(o, Math.round(p.vx * 8)); o += 2;
    v.setInt16(o, Math.round(p.vy * 8)); o += 2;
    out[o++] = (p.hp & 15) | ((p.ammo & 15) << 4);
    out[o++] = p.charge < 0 ? 255 : p.charge;
    out[o++] = p.throwCd;
    out[o++] = p.catchWin;
    out[o++] = p.catchCd;
    out[o++] = p.stun;
    out[o++] = Math.min(p.invuln, 255);
    out[o++] = (p.coyote & 15) | ((p.jumpBuffer & 15) << 4);
    out[o++] = p.prevButtons;
    out[o++] = (p.dodge & 15) | ((p.pickLock & 15) << 4); // DODGE.ticks, PICKUP.lockTicks ≤ 15
    out[o++] = (p.dodgeCd & 63) | (p.airDodged ? 64 : 0) | (p.dodgePerfect ? 128 : 0); // cooldown ≤ 63
    out[o++] = x.wins[i] ?? 0;
  });
  for (const d of s.slippers) {
    out[o++] = d.state | (d.harmful ? 4 : 0) | ((d.owner < 0 ? 7 : d.owner) << 3);
    if (d.state === SlipperState.Held) continue;
    v.setUint16(o, Math.max(0, Math.round(d.x * 8))); o += 2;
    v.setUint16(o, Math.max(0, Math.round(d.y * 8))); o += 2;
    v.setInt16(o, Math.round(d.vx * 8)); o += 2;
    v.setInt16(o, Math.round(d.vy * 8)); o += 2;
    out[o++] = d.angle;
  }
  out[o++] = events.length;
  for (const e of events) {
    v.setUint16(o, e.id); o += 2;
    out[o++] = e.type;
    v.setInt8(o++, e.a);
    v.setInt8(o++, e.b);
    v.setInt8(o++, e.c);
    v.setUint16(o, Math.max(0, Math.round(e.x))); o += 2;
    v.setUint16(o, Math.max(0, Math.round(e.y))); o += 2;
    o++; // dự phòng
  }
  return out;
}

export function writeAck(buf: Uint8Array, ackSeq: number) {
  buf[2] = (ackSeq >> 8) & 0xff;
  buf[3] = ackSeq & 0xff;
}

export function decodeSnapshot(buf: Uint8Array): Snapshot {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let o = 0;
  const tick = v.getUint16(o); o += 2;
  const ackSeq = v.getUint16(o); o += 2;
  const phase = buf[o++] as Phase;
  const phaseLeft = v.getUint16(o); o += 2;
  const round = buf[o++];
  const np = buf[o++];
  const ns = buf[o++];
  const frozen = (buf[o++] & 1) === 1;
  const players: NetPlayer[] = [];
  for (let i = 0; i < np; i++) {
    const f = buf[o++];
    const x = v.getUint16(o) / 8; o += 2;
    const y = v.getUint16(o) / 8; o += 2;
    const vx = v.getInt16(o) / 8; o += 2;
    const vy = v.getInt16(o) / 8; o += 2;
    const ha = buf[o++];
    const ch = buf[o++];
    const throwCd = buf[o++];
    const catchWin = buf[o++];
    const catchCd = buf[o++];
    const stun = buf[o++];
    const invuln = buf[o++];
    const cj = buf[o++];
    const prevButtons = buf[o++];
    const dl = buf[o++];
    const dc = buf[o++];
    const wins = buf[o++];
    players.push({
      active: (f & 1) !== 0, alive: (f & 2) !== 0, onGround: (f & 4) !== 0, facing: f & 8 ? 1 : -1, connected: (f & 16) !== 0,
      x, y, vx, vy, hp: ha & 15, ammo: ha >> 4, charge: ch === 255 ? -1 : ch,
      throwCd, catchWin, catchCd, stun, invuln, coyote: cj & 15, jumpBuffer: cj >> 4, prevButtons, wins,
      dodge: dl & 15, pickLock: dl >> 4, dodgeCd: dc & 63, airDodged: (dc & 64) !== 0, dodgePerfect: (dc & 128) !== 0,
    });
  }
  const slippers: SlipperObj[] = [];
  for (let i = 0; i < ns; i++) {
    const f = buf[o++];
    const state = (f & 3) as SlipperState;
    const ow = f >> 3;
    const d: SlipperObj = { state, harmful: (f & 4) !== 0, owner: ow === 7 ? -1 : ow, x: 0, y: 0, vx: 0, vy: 0, angle: 0 };
    if (state !== SlipperState.Held) {
      d.x = v.getUint16(o) / 8; o += 2;
      d.y = v.getUint16(o) / 8; o += 2;
      d.vx = v.getInt16(o) / 8; o += 2;
      d.vy = v.getInt16(o) / 8; o += 2;
      d.angle = buf[o++];
    }
    slippers.push(d);
  }
  const ne = buf[o++];
  const events: NetEvent[] = [];
  for (let i = 0; i < ne; i++) {
    const id = v.getUint16(o); o += 2;
    const type = buf[o++];
    const a = v.getInt8(o++);
    const b = v.getInt8(o++);
    const c = v.getInt8(o++);
    const x = v.getUint16(o); o += 2;
    const y = v.getUint16(o); o += 2;
    o++;
    events.push({ id, type, a, b, c, x, y });
  }
  return { tick, ackSeq, phase, phaseLeft, round, frozen, players, slippers, events };
}

/** So sánh u16 có quấn vòng: a mới hơn b? */
export const seqNewer = (a: number, b: number) => ((a - b) & 0xffff) !== 0 && ((a - b) & 0xffff) < 0x8000;
/** Khoảng cách u16 a - b có dấu. */
export const seqDiff = (a: number, b: number) => (((a - b) & 0xffff) << 16) >> 16;
