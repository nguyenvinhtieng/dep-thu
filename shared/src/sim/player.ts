import { CATCH, DODGE, DT, PICKUP, PLAYER, SLIPPER, WORLD } from '../config';
import { Btn, dodging, PlayerState, q8 } from './state';

export interface PlayerStepResult {
  jumped: boolean;
  catchStart: boolean;
  throwCharge: number; // tick gồng khi thả nút ném; -1 = không ném
  dodgeStart: boolean;
  pickup: boolean; // vừa cúi nhặt: step() tìm dép nằm đất trong tầm
}

const approach = (v: number, target: number, delta: number) =>
  v < target ? Math.min(v + delta, target) : Math.max(v - delta, target);

/**
 * Di chuyển + nhảy + ý định ném/bắt của một người. Dùng chung cho server và prediction client.
 * Không đụng tới dép: throwCharge/catchStart để step() xử lý.
 */
export function stepPlayer(p: PlayerState, rawButtons: number, frozen: boolean, out: PlayerStepResult): void {
  out.jumped = false;
  out.catchStart = false;
  out.throwCharge = -1;
  out.dodgeStart = false;
  out.pickup = false;

  const winding = p.charge >= 0 && p.throwCd > 0;
  if (p.throwCd > 0) p.throwCd--;
  if (p.catchCd > 0) p.catchCd--;
  if (p.catchWin > 0) p.catchWin--;
  if (p.stun > 0) p.stun--;
  if (p.invuln > 0) p.invuln--;
  if (p.coyote > 0) p.coyote--;
  if (p.jumpBuffer > 0) p.jumpBuffer--;
  if (p.dodge > 0) p.dodge--;
  if (p.dodgeCd > 0) p.dodgeCd--;
  if (p.pickLock > 0) p.pickLock--;

  if (!p.active || !p.alive) {
    p.prevButtons = rawButtons;
    return;
  }

  const b = frozen || p.stun > 0 ? 0 : rawButtons;
  const prev = frozen || p.stun > 0 ? 0 : p.prevButtons;
  const pressed = b & ~prev;
  const released = prev & ~b;
  // Đang lăn / cúi nhặt: bỏ qua hướng, nhảy, bắt, bắt đầu gồng
  const busy = p.dodge > 0 || p.pickLock > 0 || winding;
  const dir = busy ? 0 : (b & Btn.Right ? 1 : 0) - (b & Btn.Left ? 1 : 0);
  if (dir !== 0) p.facing = dir as 1 | -1;

  if (p.stun > 0 || frozen) { p.charge = -1; p.dodge = 0; }
  if (p.onGround) p.airDodged = false;

  // Lăn né: lướt theo hướng đang bấm (không bấm thì hướng đang nhìn), có i-frame
  if (pressed & Btn.Dodge && !busy && p.dodgeCd === 0 && p.charge < 0 && (p.onGround || !p.airDodged)) {
    const rd = (b & Btn.Right ? 1 : 0) - (b & Btn.Left ? 1 : 0);
    if (rd !== 0) p.facing = rd as 1 | -1;
    p.dodge = DODGE.ticks;
    p.dodgeCd = DODGE.cooldownTicks;
    p.dodgePerfect = false;
    p.catchWin = 0;
    p.jumpBuffer = 0;
    if (!p.onGround) { p.airDodged = true; p.vy = Math.min(p.vy, -DODGE.airLift); }
    out.dodgeStart = true;
  }

  // Cúi nhặt: chỉ trên mặt đất; trượt nút cũng phải chịu khựng
  if (pressed & Btn.Pickup && !busy && p.dodge === 0 && p.onGround && p.charge < 0) {
    p.pickLock = PICKUP.lockTicks;
    p.catchWin = 0;
    p.jumpBuffer = 0;
    out.pickup = true;
  }
  const locked = p.dodge > 0 || p.pickLock > 0 || winding;

  // Bắt: không bắt khi đang gồng ném
  if (pressed & Btn.Catch && !locked && p.catchCd === 0 && p.charge < 0) {
    p.catchWin = CATCH.windowTicks;
    p.catchCd = CATCH.cooldownTicks;
    out.catchStart = true;
  }

  // Thả để lấy đà: giữ nguyên lực/hướng, đối thủ có một nhịp đọc đòn.
  if (winding) {
    if (p.throwCd === 0 && p.charge >= 0 && !frozen && p.stun === 0) {
      out.throwCharge = p.charge;
      p.throwCd = SLIPPER.throwCooldownTicks + Math.round(SLIPPER.chargedRecoveryTicks * p.charge / SLIPPER.maxChargeTicks);
      p.charge = -1;
    }
  } else if (b & Btn.Throw) {
    if (p.charge >= 0) p.charge = Math.min(p.charge + 1, SLIPPER.maxChargeTicks);
    else if (pressed & Btn.Throw && !locked && p.throwCd === 0 && p.ammo > 0 && p.catchWin === 0) p.charge = 0;
  } else if (released & Btn.Throw && p.charge >= 0) {
    p.throwCd = SLIPPER.windupTicks;
  }

  // Nhảy: jump buffer + coyote time + nhả sớm thì nhảy thấp
  if (pressed & Btn.Jump && !locked) p.jumpBuffer = PLAYER.jumpBufferTicks;
  if (p.jumpBuffer > 0 && !locked && (p.onGround || p.coyote > 0)) {
    p.vy = -PLAYER.jumpSpeed;
    p.onGround = false;
    p.jumpBuffer = 0;
    p.coyote = 0;
    out.jumped = true;
  } else if (released & Btn.Jump && p.vy < 0) {
    p.vy *= PLAYER.jumpCutMul;
  }

  // Ngang
  if (p.stun > 0) {
    if (p.onGround) p.vx = approach(p.vx, 0, PLAYER.groundDecel * 0.5 * DT);
  } else if (dodging(p)) {
    p.vx = p.facing * DODGE.speed;
  } else if (p.pickLock > 0) {
    p.vx = 0;
  } else {
    // vừa lăn xong: hãm về tốc độ chạy cho khỏi trượt xa
    if (p.dodge > 0 && Math.abs(p.vx) > PLAYER.runSpeed) p.vx = Math.sign(p.vx) * PLAYER.runSpeed;
    const target = dir * PLAYER.runSpeed * (p.charge >= 0 ? PLAYER.chargeMoveMul : 1);
    const acc = p.onGround ? (dir !== 0 ? PLAYER.groundAccel : PLAYER.groundDecel) : PLAYER.airAccel;
    p.vx = approach(p.vx, target, acc * DT);
  }

  // Dọc
  p.vy = Math.min(p.vy + (p.vy < 0 ? PLAYER.gravity : PLAYER.fallGravity) * DT, PLAYER.maxFall);

  const prevY = p.y;
  p.x += p.vx * DT;
  p.y += p.vy * DT;

  const half = PLAYER.w / 2;
  if (p.x < WORLD.wallLeft + half) { p.x = WORLD.wallLeft + half; p.vx = 0; }
  if (p.x > WORLD.wallRight - half) { p.x = WORLD.wallRight - half; p.vx = 0; }
  if (p.y - PLAYER.h < WORLD.ceilingY) { p.y = WORLD.ceilingY + PLAYER.h; if (p.vy < 0) p.vy = 0; }

  p.onGround = false;
  if (p.y >= WORLD.floorY) {
    p.y = WORLD.floorY;
    p.vy = 0;
    p.onGround = true;
  } else if (p.vy >= 0) {
    for (const pl of WORLD.platforms) {
      if (prevY <= pl.y && p.y >= pl.y && p.x + half * 0.6 > pl.x && p.x - half * 0.6 < pl.x + pl.w) {
        p.y = pl.y;
        p.vy = 0;
        p.onGround = true;
        break;
      }
    }
  }
  if (p.onGround) p.coyote = PLAYER.coyoteTicks;

  p.prevButtons = rawButtons;
  p.x = q8(p.x);
  p.y = q8(p.y);
  p.vx = q8(p.vx);
  p.vy = q8(p.vy);
}

/** Vùng bắt phía trước người (AABB). */
export function catchZone(p: PlayerState) {
  const x0 = p.facing > 0 ? p.x - CATCH.back : p.x - CATCH.reach;
  const x1 = p.facing > 0 ? p.x + CATCH.reach : p.x + CATCH.back;
  return { x0, x1, y0: p.y - CATCH.top, y1: p.y + CATCH.bottom };
}

/** Va chạm thân người; nhảy qua đầu hoặc lăn vẫn đổi bên được. */
export function separatePlayers(players: PlayerState[]): void {
  const lo = WORLD.wallLeft + PLAYER.w / 2;
  const hi = WORLD.wallRight - PLAYER.w / 2;
  for (let pass = 0; pass < players.length * 3; pass++) {
    for (let i = 0; i < players.length; i++) for (let j = i + 1; j < players.length; j++) {
      const a = players[i], b = players[j];
      if (!a.active || !b.active || !a.alive || !b.alive || dodging(a) || dodging(b) || Math.abs(a.y - b.y) >= PLAYER.h * 0.75) continue;
      const left = a.x <= b.x ? a : b;
      const right = left === a ? b : a;
      if (right.x - left.x >= PLAYER.minSpacing) continue;
      const center = Math.max(lo + PLAYER.minSpacing / 2, Math.min(hi - PLAYER.minSpacing / 2, (left.x + right.x) / 2));
      left.x = q8(center - PLAYER.minSpacing / 2);
      right.x = q8(center + PLAYER.minSpacing / 2);
      left.vx = Math.min(0, left.vx);
      right.vx = Math.max(0, right.vx);
    }
  }
}
