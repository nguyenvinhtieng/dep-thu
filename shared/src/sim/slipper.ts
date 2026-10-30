import { DT, SLIPPER, WORLD } from '../config';
import { SlipperObj, SlipperState, q8 } from './state';

export enum MoveResult {
  None = 0,
  Wall = 1,
  Landed = 2,
  Rested = 4,
}

/** Di chuyển dép đang bay một tick: trọng lực, xoay, nảy tường/trần, chạm sàn/bục (test đoạn cũ→mới). */
export function moveSlipper(d: SlipperObj): number {
  let res: number = MoveResult.None;
  const r = SLIPPER.r;
  const prevY = d.y;
  d.vy += SLIPPER.gravity * DT;
  d.x += d.vx * DT;
  d.y += d.vy * DT;
  d.angle = (d.angle + (d.vx >= 0 ? SLIPPER.spinPerTick : -SLIPPER.spinPerTick) + 256) & 255;

  if (d.x - r < WORLD.wallLeft) {
    d.x = WORLD.wallLeft + r;
    d.vx = -d.vx * SLIPPER.wallRestitution;
    res |= MoveResult.Wall;
  } else if (d.x + r > WORLD.wallRight) {
    d.x = WORLD.wallRight - r;
    d.vx = -d.vx * SLIPPER.wallRestitution;
    res |= MoveResult.Wall;
  }
  if (d.y - r < WORLD.ceilingY) {
    d.y = WORLD.ceilingY + r;
    d.vy = -d.vy * SLIPPER.wallRestitution;
    res |= MoveResult.Wall;
  }

  if (d.vy > 0) {
    let landY = Infinity;
    if (d.y + r >= WORLD.floorY) landY = WORLD.floorY;
    for (const pl of WORLD.platforms) {
      if (prevY + r <= pl.y && d.y + r >= pl.y && d.x >= pl.x && d.x <= pl.x + pl.w && pl.y < landY) landY = pl.y;
    }
    if (landY !== Infinity) {
      d.y = landY - r;
      d.harmful = false; // chạm đất là hết nguy hiểm
      d.vy = -d.vy * SLIPPER.floorRestitution;
      if (Math.abs(d.vy) < 160) d.vy = 0;
      d.vx *= SLIPPER.floorFriction;
      res |= MoveResult.Landed;
      if (d.vy === 0 && Math.abs(d.vx) < SLIPPER.restSpeed) {
        d.state = SlipperState.Grounded;
        d.vx = 0;
        d.angle = 0;
        res |= MoveResult.Rested;
      }
    }
  }
  d.x = q8(d.x);
  d.y = q8(d.y);
  d.vx = q8(d.vx);
  d.vy = q8(d.vy);
  return res;
}

/**
 * Đoạn thẳng (x0,y0)→(x1,y1) cắt AABB [ax0,ax1]×[ay0,ay1]? Trả t∈[0,1] lần chạm đầu, -1 nếu không.
 * Dùng cho dép nhanh không xuyên người (swept test).
 */
export function segmentAabb(x0: number, y0: number, x1: number, y1: number, ax0: number, ay0: number, ax1: number, ay1: number): number {
  let tmin = 0;
  let tmax = 1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  if (dx === 0) {
    if (x0 < ax0 || x0 > ax1) return -1;
  } else {
    let t0 = (ax0 - x0) / dx;
    let t1 = (ax1 - x0) / dx;
    if (t0 > t1) { const t = t0; t0 = t1; t1 = t; }
    if (t0 > tmin) tmin = t0;
    if (t1 < tmax) tmax = t1;
    if (tmin > tmax) return -1;
  }
  if (dy === 0) {
    if (y0 < ay0 || y0 > ay1) return -1;
  } else {
    let t0 = (ay0 - y0) / dy;
    let t1 = (ay1 - y0) / dy;
    if (t0 > t1) { const t = t0; t0 = t1; t1 = t; }
    if (t0 > tmin) tmin = t0;
    if (t1 < tmax) tmax = t1;
    if (tmin > tmax) return -1;
  }
  return tmin;
}
