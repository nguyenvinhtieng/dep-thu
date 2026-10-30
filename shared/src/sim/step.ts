import { DODGE, PLAYER, SLIPPER } from '../config';
import { catchZone, PlayerStepResult, stepPlayer } from './player';
import { MoveResult, moveSlipper, segmentAabb } from './slipper';
import { Btn, dodging, GameState, PlayerState, SlipperObj, SlipperState } from './state';

export enum Ev {
  Throw = 1, // a=người ném, b=dép
  Catch = 2, // a=người bắt, b=dép
  Hit = 3, // a=nạn nhân, b=dép, c=người ném
  Bounce = 4, // b=dép
  Pickup = 5, // a=người nhặt, b=dép
  Eliminated = 6, // a=người
  CatchStart = 7, // a=người
  Land = 8, // b=dép
  DodgeStart = 9, // a=người
  Dodge = 10, // né sát: a=người né, b=dép, c=người ném
}

export interface SimEvent {
  type: Ev;
  a: number;
  b: number;
  c: number;
  x: number;
  y: number;
}

export interface StepHooks {
  /** Lag compensation: vị trí dép người p đã nhìn thấy (quá khứ). undefined = không tua. */
  pastSlipper?(p: number, s: number): { x: number; y: number; state: SlipperState } | undefined;
}

const tmpRes: PlayerStepResult[] = [];
const throwCharge: number[] = [];
const wantPickup: boolean[] = [];

function ev(out: SimEvent[], type: Ev, a: number, b: number, c: number, x: number, y: number) {
  out.push({ type, a, b, c, x, y });
}

/** Đặt dép vào trạng thái bay theo lực gồng. Dùng chung cho server và ném dự đoán ở client. */
export function launchSlipper(d: SlipperObj, p: PlayerState, owner: number, charge: number) {
  const t = charge / SLIPPER.maxChargeTicks;
  const speed = SLIPPER.minSpeed + (SLIPPER.maxSpeed - SLIPPER.minSpeed) * t;
  d.state = SlipperState.Flying;
  d.owner = owner;
  d.harmful = true;
  d.x = p.x + p.facing * SLIPPER.spawnOffsetX;
  d.y = p.y - SLIPPER.spawnOffsetY;
  d.vx = Math.round(p.facing * speed + p.vx * 0.25);
  d.vy = Math.round(-speed * SLIPPER.liftRatio);
  d.angle = 0;
}

export function countAmmo(s: GameState, p: number): number {
  let n = 0;
  for (const d of s.slippers) if (d.state === SlipperState.Held && d.owner === p) n++;
  return n;
}

const circleInRect = (x: number, y: number, r: number, z: { x0: number; x1: number; y0: number; y1: number }) =>
  x + r >= z.x0 && x - r <= z.x1 && y + r >= z.y0 && y - r <= z.y1;

function canCatch(p: PlayerState, pi: number, d: SlipperObj): boolean {
  if (d.state !== SlipperState.Flying) return false;
  // Không bắt dép của chính mình khi nó còn nguy hiểm (lượt ném của mình)
  if (d.owner === pi && d.harmful) return false;
  return p.alive && p.catchWin > 0 && p.ammo < PLAYER.maxAmmo;
}

function doCatch(s: GameState, pi: number, si: number, out: SimEvent[]) {
  const p = s.players[pi];
  const d = s.slippers[si];
  d.state = SlipperState.Held;
  d.owner = pi;
  d.harmful = false;
  d.vx = d.vy = 0;
  p.catchWin = 0;
  p.ammo++;
  ev(out, Ev.Catch, pi, si, 0, d.x, d.y);
}

function dropAll(s: GameState, pi: number) {
  const p = s.players[pi];
  let k = 0;
  for (const d of s.slippers) {
    if (d.state === SlipperState.Held && d.owner === pi) {
      // Rơi tại chỗ, vô hại; tự nằm xuống khi chạm sàn/bục
      d.state = SlipperState.Flying;
      d.x = p.x;
      d.y = p.y - PLAYER.h / 2;
      d.vx = k++ === 0 ? -80 : 80;
      d.vy = -240;
      d.harmful = false;
    }
  }
  p.ammo = 0;
}

/**
 * Một tick mô phỏng cố định. Thứ tự: input → người → bắt → dép (swept) → trúng (bắt ưu tiên) → nhặt.
 * inputs[i] = bitmask nút của người i. Events đẩy vào `out`.
 */
export function step(s: GameState, inputs: ArrayLike<number>, out: SimEvent[], hooks?: StepHooks): void {
  const n = s.players.length;
  for (let i = 0; i < n; i++) {
    const r = (tmpRes[i] ??= { jumped: false, catchStart: false, throwCharge: -1, dodgeStart: false, pickup: false });
    stepPlayer(s.players[i], inputs[i] ?? 0, s.frozen, r);
    throwCharge[i] = r.throwCharge;
    wantPickup[i] = r.pickup;
    if (r.catchStart) ev(out, Ev.CatchStart, i, 0, 0, s.players[i].x, s.players[i].y);
    if (r.dodgeStart) ev(out, Ev.DodgeStart, i, 0, 0, s.players[i].x, s.players[i].y);
  }

  // Ném
  for (let i = 0; i < n; i++) {
    if (throwCharge[i] < 0) continue;
    const p = s.players[i];
    const si = s.slippers.findIndex((d) => d.state === SlipperState.Held && d.owner === i);
    if (si < 0) continue;
    const d = s.slippers[si];
    launchSlipper(d, p, i, throwCharge[i]);
    p.ammo--;
    ev(out, Ev.Throw, i, si, 0, d.x, d.y);
  }

  // Bắt (trước khi xét trúng). Có lag compensation qua hooks.pastSlipper.
  for (let i = 0; i < n; i++) {
    const p = s.players[i];
    if (p.catchWin <= 0 || !p.alive) continue;
    const z = catchZone(p);
    for (let si = 0; si < s.slippers.length; si++) {
      const d = s.slippers[si];
      if (!canCatch(p, i, d)) continue;
      let ok = circleInRect(d.x, d.y, SLIPPER.r, z);
      if (!ok && hooks?.pastSlipper) {
        const past = hooks.pastSlipper(i, si);
        if (past && past.state === SlipperState.Flying) ok = circleInRect(past.x, past.y, SLIPPER.r, z);
      }
      if (ok) doCatch(s, i, si, out);
    }
  }

  // Dép bay + trúng
  const hw = PLAYER.w / 2 + SLIPPER.r;
  for (let si = 0; si < s.slippers.length; si++) {
    const d = s.slippers[si];
    if (d.state !== SlipperState.Flying) continue;
    const x0 = d.x;
    const y0 = d.y;
    const wasHarmful = d.harmful;
    const mr = moveSlipper(d);
    if (mr & MoveResult.Wall) ev(out, Ev.Bounce, -1, si, 0, d.x, d.y);
    if (mr & MoveResult.Landed) ev(out, Ev.Land, -1, si, 0, d.x, d.y);

    // Bắt bằng swept: dép lướt qua vùng bắt trong tick này
    let caught = false;
    for (let i = 0; i < n && !caught; i++) {
      const p = s.players[i];
      if (!canCatch(p, i, d)) continue;
      const z = catchZone(p);
      if (segmentAabb(x0, y0, d.x, d.y, z.x0 - SLIPPER.r, z.y0 - SLIPPER.r, z.x1 + SLIPPER.r, z.y1 + SLIPPER.r) >= 0) {
        doCatch(s, i, si, out);
        caught = true;
      }
    }
    if (caught || !wasHarmful) continue;

    // Trúng: chọn người bị chạm sớm nhất dọc đoạn bay
    let best = -1;
    let bestT = 2;
    for (let i = 0; i < n; i++) {
      const p = s.players[i];
      if (!p.alive || i === d.owner || p.invuln > 0) continue;
      const t = segmentAabb(x0, y0, d.x, d.y, p.x - hw, p.y - PLAYER.h - SLIPPER.r, p.x + hw, p.y + SLIPPER.r);
      if (t < 0) continue;
      if (dodging(p)) {
        // i-frame: dép xuyên qua. Lần đầu trong cú lăn → thưởng hồi chiêu
        if (!p.dodgePerfect) {
          p.dodgePerfect = true;
          p.dodgeCd = Math.min(p.dodgeCd, DODGE.perfectCdTicks);
          ev(out, Ev.Dodge, i, si, d.owner, p.x, p.y);
        }
        continue;
      }
      if (t < bestT) { bestT = t; best = i; }
    }
    if (best < 0) continue;
    const v = s.players[best];
    const dir = d.vx >= 0 ? 1 : -1;
    d.x = Math.round(x0 + (d.x - x0) * bestT);
    d.y = Math.round(y0 + (d.y - y0) * bestT);
    d.harmful = false;
    d.state = SlipperState.Flying;
    d.vx = Math.round(d.vx * SLIPPER.hitBounceVx);
    d.vy = SLIPPER.hitBounceVy;
    v.hp--;
    v.invuln = PLAYER.invulnTicks;
    v.stun = PLAYER.stunTicks;
    v.charge = -1;
    v.catchWin = 0;
    v.dodge = 0;
    v.pickLock = 0;
    v.vx = dir * PLAYER.knockbackX;
    v.vy = -PLAYER.knockbackY;
    v.onGround = false;
    ev(out, Ev.Hit, best, si, d.owner, d.x, d.y);
    if (v.hp <= 0) {
      v.alive = false;
      dropAll(s, best);
      ev(out, Ev.Eliminated, best, 0, d.owner, v.x, v.y);
    }
  }

  // Nhặt: chỉ người vừa bấm nhặt, còn chỗ trên tay → chiếc nằm đất gần nhất trong tầm
  for (let i = 0; i < n; i++) {
    if (!wantPickup[i]) continue;
    const p = s.players[i];
    if (!p.alive || p.ammo >= PLAYER.maxAmmo) continue;
    let best = -1;
    let bestDx = Infinity;
    for (let si = 0; si < s.slippers.length; si++) {
      const d = s.slippers[si];
      if (d.state !== SlipperState.Grounded) continue;
      const dx = Math.abs(d.x - p.x);
      if (dx < SLIPPER.pickupDx && Math.abs(d.y - (p.y - 24)) < SLIPPER.pickupDy && dx < bestDx) {
        bestDx = dx;
        best = si;
      }
    }
    if (best < 0) continue;
    const d = s.slippers[best];
    d.state = SlipperState.Held;
    d.owner = i;
    p.ammo++;
    ev(out, Ev.Pickup, i, best, 0, d.x, d.y);
  }

  for (let i = 0; i < n; i++) s.players[i].ammo = countAmmo(s, i);
  s.tick++;
}

export function aliveCount(s: GameState): number {
  let c = 0;
  for (const p of s.players) if (p.active && p.alive) c++;
  return c;
}

export { Btn };
