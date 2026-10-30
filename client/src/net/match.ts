import {
  decodePong, decodeSnapshot, encodeInput, encodePing, Ev, launchSlipper, moveSlipper, MoveResult, NET, NetEvent,
  NetPlayer, Phase, PlayerStepResult, Snapshot, SlipperObj, SlipperState, TICK_HZ,
} from '@dep/shared';
import { Clock } from './clock';
import { Predictor } from './prediction';

const TICK_MS = 1000 / TICK_HZ;
const MAX_EXTRAP = (NET.extrapolateMaxMs * TICK_HZ) / 1000;

type FullSnap = Snapshot & { full: number };

export interface RenderPlayer extends NetPlayer {
  slot: number;
  me: boolean;
}

export interface RenderSlipper extends SlipperObj {
  ghost: boolean;
}

export interface MatchView {
  phase: Phase;
  phaseLeft: number; // tick
  round: number;
  players: RenderPlayer[];
  slippers: RenderSlipper[];
}

/** Hiệu ứng cần phát: từ server (đã trễ theo nội suy) hoặc dự đoán cục bộ. */
export interface FxEvent extends NetEvent {
  local: boolean;
}

export interface MatchIO {
  sendInput(b: Uint8Array): void;
  sendPing(b: Uint8Array): void;
}

interface Ghost {
  s: SlipperObj;
  age: number;
  serverTick: number; // tick server của Throw tương ứng; Infinity = chưa biết
}

/**
 * Lõi mạng của một trận, không phụ thuộc Phaser/DOM (bot Node dùng lại được).
 * Đồng hồ + nội suy cho người khác/dép, dự đoán cho mình, đệm sự kiện theo thời điểm hiển thị.
 */
export class NetMatch {
  readonly clock: Clock;
  readonly pred = new Predictor();
  slot: number;
  rtt = 0;
  latest: FullSnap | null = null;
  stats = { inBps: 0, outBps: 0, snapsPerSec: 0, bufferLen: 0, reconcileErr: 0 };
  onFx: ((e: FxEvent) => void) | null = null;

  private snaps: FullSnap[] = [];
  private pending: { e: NetEvent; at: number }[] = [];
  private seen = new Set<number>();
  private seenOrder: number[] = [];
  private ghosts: Ghost[] = [];
  private acc = 0;
  private lastNow = -1;
  private localTicks = 0;
  private lastPing = 0;
  private counters = { in: 0, out: 0, snaps: 0, since: 0 };

  constructor(private io: MatchIO, slot: number) {
    this.slot = slot;
    this.clock = new Clock(slot < 0);
  }

  get spectator() {
    return this.slot < 0;
  }

  handleSnapshot(buf: Uint8Array, now: number) {
    this.counters.in += buf.byteLength + 3;
    this.counters.snaps++;
    const raw = decodeSnapshot(buf);
    const snap = raw as FullSnap;
    snap.full = this.clock.unwrap(raw.tick);
    if (this.latest && snap.full <= this.latest.full) return;
    this.clock.sample(snap.full, now);
    this.latest = snap;
    this.snaps.push(snap);
    while (this.snaps.length > 2 && this.snaps[0].full < snap.full - 90) this.snaps.shift();

    const me = this.slot >= 0 ? snap.players[this.slot] : undefined;
    if (me && me.active) {
      this.pred.reconcile(me, snap.ackSeq, snap.frozen);
      this.stats.reconcileErr = this.pred.lastError;
    } else if (this.pred.p) this.pred.reset();

    for (const e of snap.events) {
      if (this.seen.has(e.id)) continue;
      this.seen.add(e.id);
      this.seenOrder.push(e.id);
      if (this.seenOrder.length > 512) this.seen.delete(this.seenOrder.shift()!);
      // event có thể xảy ra trước snapshot này tối đa vài tick; hiển thị cùng lúc với hình nội suy
      const at = snap.full - 1;
      if (e.type === Ev.Throw && e.a === this.slot) {
        const g = this.ghosts.find((x) => x.serverTick === Infinity);
        if (g) g.serverTick = at;
      }
      this.pending.push({ e, at });
    }
  }

  handlePong(buf: Uint8Array, now: number) {
    this.counters.in += buf.byteLength + 3;
    const { t } = decodePong(buf);
    const r = now - t;
    if (r >= 0 && r < 10_000) this.rtt = this.rtt ? this.rtt + (r - this.rtt) * 0.2 : r;
  }

  /** Gọi thường xuyên (≥ 60 lần/s nếu được). buttons = bitmask hiện tại. */
  update(now: number, buttons: number) {
    if (this.lastNow < 0) this.lastNow = now;
    this.acc = Math.min(this.acc + (now - this.lastNow), 250);
    this.lastNow = now;

    if (now - this.lastPing >= NET.pingIntervalMs) {
      this.lastPing = now;
      const b = encodePing(now);
      this.counters.out += b.byteLength + 3;
      this.io.sendPing(b);
    }
    if (now - this.counters.since >= 1000) {
      const s = (now - this.counters.since) / 1000;
      this.stats.inBps = this.counters.in / s;
      this.stats.outBps = this.counters.out / s;
      this.stats.snapsPerSec = this.counters.snaps / s;
      this.counters.in = this.counters.out = this.counters.snaps = 0;
      this.counters.since = now;
    }

    while (this.acc >= TICK_MS) {
      this.acc -= TICK_MS;
      this.pred.decay(TICK_MS);
      for (const g of this.ghosts) {
        g.age++;
        if (g.s.state === SlipperState.Flying) {
          const r = moveSlipper(g.s);
          if (r & MoveResult.Wall) this.emitLocal(Ev.Bounce, -1, g.s.x, g.s.y);
        }
      }
      this.ghosts = this.ghosts.filter((g) => g.age < TICK_HZ * 1.5);
      if (this.spectator || !this.clock.ready()) continue;
      const r = this.pred.tick(buttons);
      this.localTicks++;
      if (r) this.localEffects(r);
      if (this.localTicks % NET.inputSendEveryTicks === 0) {
        const recent = this.pred.recent(NET.inputRedundancy);
        const view = Math.floor(this.clock.renderTick(now)) & 0xffff;
        const b = encodeInput(this.pred.seq, view, recent, recent.length);
        this.counters.out += b.byteLength + 3;
        this.io.sendInput(b);
      }
    }
  }

  /** Trạng thái để vẽ tại thời điểm now; đồng thời phát các sự kiện đã tới giờ. */
  view(now: number): MatchView | null {
    const L = this.latest;
    if (!L || !this.clock.ready()) return null;
    const rt = Math.min(this.clock.renderTick(now), L.full + MAX_EXTRAP);
    this.stats.bufferLen = this.snaps.filter((s) => s.full > rt).length;

    // phát sự kiện đến hạn
    if (this.pending.length) {
      const due = this.pending.filter((p) => p.at <= rt);
      if (due.length) {
        this.pending = this.pending.filter((p) => p.at > rt);
        for (const d of due) this.onFx?.({ ...d.e, local: false });
      }
    }

    let a = this.snaps[0];
    let b = a;
    for (let i = this.snaps.length - 1; i >= 0; i--) {
      if (this.snaps[i].full <= rt) {
        a = this.snaps[i];
        b = this.snaps[i + 1] ?? a;
        break;
      }
    }
    const span = b.full - a.full;
    const t = span > 0 ? Math.min(Math.max((rt - a.full) / span, 0), 1) : 0;
    const extra = b === a ? Math.max(0, rt - a.full) / TICK_HZ : 0; // giây ngoại suy
    const near = t < 0.5 ? a : b;

    const players: RenderPlayer[] = near.players.map((np, i) => {
      const pa = a.players[i];
      const pb = b.players[i];
      const r: RenderPlayer = { ...np, slot: i, me: i === this.slot };
      r.x = lerp(pa.x, pb.x, t) + pa.vx * extra;
      r.y = lerp(pa.y, pb.y, t) + (pa.onGround ? 0 : pa.vy * extra);
      return r;
    });
    const mp = this.pred.p;
    if (mp && this.slot >= 0 && players[this.slot]) {
      const keep = players[this.slot];
      Object.assign(keep, mp, { x: mp.x + this.pred.errX, y: mp.y + this.pred.errY, connected: keep.connected, wins: keep.wins });
    }

    const slippers: RenderSlipper[] = near.slippers.map((nd, i) => {
      const da = a.slippers[i];
      const db = b.slippers[i];
      const r: RenderSlipper = { ...nd, ghost: false };
      if (da.state !== SlipperState.Held && db.state !== SlipperState.Held && da.state === db.state) {
        r.x = lerp(da.x, db.x, t);
        r.y = lerp(da.y, db.y, t);
        r.angle = lerpAngle(da.angle, db.angle, t);
      } else if (b === a && da.state === SlipperState.Flying) {
        r.x = da.x + da.vx * extra;
        r.y = da.y + da.vy * extra;
      }
      return r;
    });
    this.ghosts = this.ghosts.filter((g) => rt < g.serverTick);
    for (const g of this.ghosts) slippers.push({ ...g.s, ghost: true });

    return { phase: L.phase, phaseLeft: L.phaseLeft, round: L.round, players, slippers };
  }

  private localEffects(r: PlayerStepResult) {
    const p = this.pred.p!;
    if (r.throwCharge >= 0) {
      const s: SlipperObj = { state: SlipperState.Held, owner: this.slot, x: 0, y: 0, vx: 0, vy: 0, angle: 0, harmful: true };
      launchSlipper(s, p, this.slot, r.throwCharge);
      this.ghosts.push({ s, age: 0, serverTick: Infinity });
      this.emitLocal(Ev.Throw, this.slot, s.x, s.y);
    }
    if (r.catchStart) this.emitLocal(Ev.CatchStart, this.slot, p.x, p.y);
    if (r.dodgeStart) this.emitLocal(Ev.DodgeStart, this.slot, p.x, p.y);
    if (r.jumped) this.emitLocal(Ev.Land, -2, p.x, p.y); // -2 = nhảy (chỉ cho âm thanh)
  }

  private emitLocal(type: Ev, a: number, x: number, y: number) {
    this.onFx?.({ type, a, b: -1, c: 0, x, y, id: -1, local: true });
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function lerpAngle(a: number, b: number, t: number) {
  let d = (b - a) & 0xff;
  if (d > 127) d -= 256;
  return (a + d * t + 256) % 256;
}
