import type Phaser from 'phaser';
import { CATCH, CHARACTERS, catchZone, dodging, PLAYER, SLIPPER, SlipperState, WORLD } from '@dep/shared';
import type { RenderPlayer, RenderSlipper } from '../net/match';

type G = Phaser.GameObjects.Graphics;

const SKIN = 0xf1c49b;
export const charColor = (c: number) => CHARACTERS[c]?.color ?? 0x999999;

/** Nền hẻm: vẽ một lần. */
export function drawBackground(g: G) {
  const { width: W, height: H, floorY } = WORLD;
  // Nắng cuối chiều, phố nhỏ với bảng màu giấy ấm và xanh lá.
  g.fillStyle(0xcce4da).fillRect(0, 0, W, H);
  g.fillStyle(0xffe6ac).fillCircle(1030, 146, 68);
  for (const [x, y] of [[160, 110], [510, 160], [850, 80]]) {
    g.fillStyle(0xfff7df, 0.7).fillEllipse(x, y, 150, 28).fillEllipse(x + 30, y - 12, 80, 35);
  }
  const houses = [[48, 230, 280, 0xe5b96c], [328, 185, 230, 0xf0d7a1], [558, 260, 252, 0xc3cba5], [810, 210, 230, 0xe9c18c], [1040, 260, 200, 0xd8a17c]];
  for (const [x, top, w, c] of houses) {
    g.fillStyle(0x43665a, 0.09).fillRect(x + 8, top + 10, w, floorY - top);
    g.fillStyle(c).fillRect(x, top, w - 4, floorY - top);
    g.fillStyle(0xb9654a).fillTriangle(x - 10, top, x + w / 2, top - 52, x + w + 5, top);
    g.fillStyle(0x8e4b3c).fillRect(x - 10, top, w + 15, 10);
    g.lineStyle(2, 0xe4a075, 0.7);
    for (let xx = x + 8; xx < x + w; xx += 19) g.lineBetween(xx, top - 3, xx + 10, top - 18);
    for (let xx = x + 30; xx < x + w - 50; xx += 100) {
      g.fillStyle(0xf7e6ba).fillRoundedRect(xx - 5, top + 41, 66, 84, 4);
      g.fillStyle(0x467c6d).fillRect(xx, top + 46, 56, 74);
      g.lineStyle(2, 0x295b50);
      for (let yy = top + 53; yy < top + 119; yy += 9) g.lineBetween(xx + 4, yy, xx + 52, yy);
      g.lineStyle(3, 0xf2d9a2).lineBetween(xx + 28, top + 44, xx + 28, top + 122);
    }
    g.fillStyle(0x668374).fillRoundedRect(x + 55, floorY - 110, 65, 110, 28);
    g.fillStyle(0xede0bc).fillRect(x, floorY - 24, w - 4, 24);
  }
  // Tường thấp giữ phần sân chơi thoáng và rõ nhân vật.
  g.fillStyle(0xedd4a0).fillRect(48, 530, W - 96, 110);
  g.fillStyle(0xd3ac78).fillRect(48, 530, W - 96, 9);
  g.lineStyle(1, 0xc99e71, 0.45);
  for (let yy = 560; yy < floorY; yy += 28) {
    g.lineBetween(48, yy, W - 48, yy);
    for (let xx = 60 + (yy % 56 ? 40 : 0); xx < W - 48; xx += 90) g.lineBetween(xx, yy, xx, yy + 27);
  }
  // Giàn hoa giấy ở hai đầu hẻm.
  for (const cx of [55, 1195]) {
    g.fillStyle(0x786744).fillRect(cx, 230, 13, 410);
    for (let i = 0; i < 14; i++) {
      const xx = cx + Math.sin(i * 2.7) * 75;
      const yy = 240 + Math.cos(i * 1.8) * 60;
      g.fillStyle(i % 2 ? 0x477d60 : 0x62936b).fillCircle(xx, yy, 32);
      g.fillStyle(i % 2 ? 0xd97c87 : 0xf2a4a1).fillCircle(xx + 10, yy - 8, 9);
    }
    g.fillStyle(0xb97050).fillRoundedRect(cx - 20, floorY - 48, 55, 48, 8);
  }
  g.lineStyle(2, 0x5a6c56, 0.6);
  g.beginPath(); g.moveTo(0, 170);
  for (let x = 0; x <= W; x += 20) g.lineTo(x, 170 + Math.sin(x / W * Math.PI) * 70);
  g.strokePath();
  for (let x = 170; x < W; x += 150) {
    const y = 180 + Math.sin(x / W * Math.PI) * 70;
    g.fillStyle(0xc45e47).fillRoundedRect(x, y, 18, 25, 7);
    g.fillStyle(0xf2d087).fillRect(x + 8, y, 2, 25);
  }
  g.fillStyle(0xb6bda2).fillRect(0, floorY, W, H - floorY);
  g.fillStyle(0xe8d9b4).fillRect(0, floorY, W, 7);
  g.lineStyle(2, 0x8e9c88, 0.45);
  for (let x = 30; x < W; x += 180) g.lineBetween(x, floorY + 8, x - 45, H);
  g.lineBetween(0, 685, W, 685);
  g.fillStyle(0x41695a).fillRect(0, 0, WORLD.wallLeft, H).fillRect(WORLD.wallRight, 0, W - WORLD.wallRight, H);

  for (const p of WORLD.platforms) drawPlatform(g, p.x, p.y, p.w, p.kind);
}

function drawPlatform(g: G, x: number, y: number, w: number, kind: string) {
  const floor = WORLD.floorY;
  if (kind === 'roof') {
    // sạp có mái tôn: 2 cột + mái gợn sóng
    g.fillStyle(0x4a3b2f).fillRect(x + 10, y, 8, floor - y).fillRect(x + w - 18, y, 8, floor - y);
    g.fillStyle(0x4e8d7b).fillRect(x, y, w, 12);
    g.lineStyle(2, 0x326353);
    for (let i = x + 6; i < x + w; i += 12) g.lineBetween(i, y, i, y + 12);
    g.fillStyle(0xb78352).fillRect(x + 20, floor - 70, w - 40, 14); // quầy hàng
  } else if (kind === 'chairs') {
    // Quán nước có sân thượng: mép mái trùng mặt bục vật lý.
    g.fillStyle(0xd8b77e).fillRoundedRect(x + 12, y + 12, w - 24, floor - y - 12, 5);
    g.fillStyle(0xb38f60).fillRect(x + w - 28, y + 12, 16, floor - y - 12);
    g.fillStyle(0x3f7968).fillRoundedRect(x + 35, y + 55, w - 70, 100, 5);
    g.fillStyle(0x264f44).fillRect(x + 45, y + 65, w - 90, 80);
    g.lineStyle(3, 0xd1b57d).lineBetween(x + w / 2, y + 65, x + w / 2, y + 145);
    g.fillStyle(0xf7e8c4).fillRect(x + 26, y + 157, w - 52, 9);
    g.fillStyle(0x55907b).fillRect(x - 6, y, w + 12, 12);
    for (let xx = x; xx < x + w; xx += 24) {
      g.fillStyle(0xf2dfad).fillRect(xx, y + 12, 12, 12);
      g.fillStyle(0x55907b).fillCircle(xx + 18, y + 24, 6);
    }
    g.fillStyle(0xae674c).fillRoundedRect(x + 38, floor - 45, 40, 8, 3);
    g.fillRect(x + 43, floor - 37, 6, 37).fillRect(x + 67, floor - 37, 6, 37);
    g.fillStyle(0x3f7968).fillRoundedRect(x + 120, floor - 45, 40, 8, 3);
    g.fillRect(x + 125, floor - 37, 6, 37).fillRect(x + 149, floor - 37, 6, 37);
  } else {
    // thùng xốp chồng
    for (let yy = y; yy < floor; yy += 40) {
      for (let xx = x; xx < x + w - 10; xx += 58) {
        g.fillStyle(0xeeeae0).fillRect(xx, yy, 54, 38);
        g.lineStyle(1, 0xbdb6a6).strokeRect(xx, yy, 54, 38);
      }
    }
    g.fillStyle(0xf8f5ec).fillRect(x, y, w, 6);
  }
}

export const INK = 0x1e1c1a;
export const PAPER = 0xfffaf0;
export const GOLD = 0xf2b33d;

/** Thẻ giấy viền mực + bóng cứng (cùng hệ với UI ngoài). */
export function paperCard(g: G, x: number, y: number, w: number, h: number, r = 12, fill = PAPER) {
  g.fillStyle(INK, 1).fillRoundedRect(x + 4, y + 4, w, h, r);
  g.fillStyle(fill, 1).fillRoundedRect(x, y, w, h, r);
  g.lineStyle(2.5, INK, 1).strokeRoundedRect(x, y, w, h, r);
}

/** Viên thuốc (pill) viền mực, căn giữa theo cx. */
export function pill(g: G, cx: number, y: number, w: number, h: number, fill: number, alpha = 1, shadow = true) {
  const x = cx - w / 2;
  const r = h / 2;
  if (shadow) g.fillStyle(INK, 0.9 * alpha).fillRoundedRect(x + 2, y + 3, w, h, r);
  g.fillStyle(fill, alpha).fillRoundedRect(x, y, w, h, r);
  g.lineStyle(2, INK, alpha).strokeRoundedRect(x, y, w, h, r);
}

export function drawHeart(g: G, x: number, y: number, s: number, full: boolean) {
  const c = full ? 0xe0533d : 0xe6dccb;
  g.fillStyle(INK, 1).fillCircle(x - s * 0.5, y - s * 0.2, s * 0.62).fillCircle(x + s * 0.5, y - s * 0.2, s * 0.62)
    .fillTriangle(x - s * 1.08, y + s * 0.05, x + s * 1.08, y + s * 0.05, x, y + s * 1.12);
  g.fillStyle(c, 1).fillCircle(x - s * 0.5, y - s * 0.2, s * 0.45).fillCircle(x + s * 0.5, y - s * 0.2, s * 0.45)
    .fillTriangle(x - s * 0.9, y + s * 0.0, x + s * 0.9, y + s * 0.0, x, y + s * 0.88);
  if (full) g.fillStyle(0xffffff, 0.55).fillCircle(x - s * 0.55, y - s * 0.32, s * 0.16);
}

/** Vòng hồi chiêu lăn né: frac = phần đã hồi (1 = sẵn sàng). */
export function drawCooldownRing(g: G, x: number, y: number, r: number, frac: number) {
  const ready = frac >= 1;
  g.fillStyle(ready ? 0x6cc46a : 0xe6dccb, 1).fillCircle(x, y, r);
  if (!ready) {
    g.fillStyle(0x9ad59a, 1).slice(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac, false).fillPath();
  }
  g.lineStyle(2, INK, 1).strokeCircle(x, y, r);
  // mũi tên cong = lăn
  g.lineStyle(2, INK, ready ? 1 : 0.45);
  g.beginPath(); g.arc(x, y, r * 0.48, Math.PI * 0.9, Math.PI * 2.2, false); g.strokePath();
  g.fillStyle(INK, ready ? 1 : 0.45).fillTriangle(x + r * 0.62, y - r * 0.05, x + r * 0.18, y + r * 0.02, x + r * 0.42, y + r * 0.42);
}

function slipperShape(g: G, x: number, y: number, ang: number, color: number, alpha: number, scale = 1) {
  g.save();
  g.translateCanvas(x, y);
  g.rotateCanvas(ang);
  g.scaleCanvas(scale, scale);
  g.fillStyle(INK, alpha).fillEllipse(0, 0, 35, 16);
  g.fillStyle(color, alpha).fillEllipse(0, 0, 31, 12);
  g.fillStyle(0xf9deb0, 0.75 * alpha).fillEllipse(0, 0, 22, 7);
  g.lineStyle(3, INK, alpha).lineBetween(-2, -6, 6, 6);
  g.restore();
}

export function drawPlayer(g: G, p: RenderPlayer, char: number, time: number, debug: boolean) {
  const color = charColor(char);
  const mark = CHARACTERS[char]?.mark ?? 'helmet';
  const blink = p.invuln > 0 && Math.floor(time / 80) % 2 === 0;
  const a = !p.connected ? 0.45 : blink ? 0.35 : 1;
  const x = p.x;
  const y = p.y;
  const f = p.facing;

  g.fillStyle(0x294a3c, 0.2 * a).fillEllipse(x, y + 3, 50, 12);
  if (p.me) g.lineStyle(3, GOLD, 0.95).strokeEllipse(x, y + 2, 58, 15);

  if (!p.alive) {
    // nằm sấp
    g.fillStyle(INK, 0.5).fillRoundedRect(x - 38, y - 20, 68, 22, 8);
    g.fillStyle(0x8a8378, 0.9).fillRoundedRect(x - 36, y - 18, 64, 18, 6);
    g.fillStyle(SKIN, 0.9).fillCircle(x + 36, y - 10, 11);
    g.lineStyle(2, INK, 0.6).strokeCircle(x + 36, y - 10, 11);
    return;
  }

  // lăn né: cuộn tròn + bóng mờ phía sau
  if (dodging(p)) {
    const spin = (time / 45) * f;
    for (let k = 3; k >= 1; k--) {
      g.fillStyle(color, 0.16 * a * (4 - k)).fillCircle(x - f * k * 20, y - 24, 22 - k * 2);
    }
    g.fillStyle(INK, a).fillCircle(x, y - 24, 25);
    g.fillStyle(color, a).fillCircle(x, y - 24, 22);
    g.fillStyle(SKIN, a).fillCircle(x + Math.cos(spin) * 11, y - 24 + Math.sin(spin) * 11, 9);
    g.lineStyle(3, 0xffffff, 0.5 * a);
    g.beginPath(); g.arc(x, y - 24, 15, spin + 2, spin + 3.6, false); g.strokePath();
    return;
  }

  const crouch = p.pickLock > 0 ? 16 : 0;
  const by = y + crouch; // thân/đầu hạ xuống khi cúi
  const squash = p.onGround ? 0 : -3;
  // chân
  g.fillStyle(0x2b2a33, a);
  const step = p.onGround && !crouch && Math.abs(p.vx) > 40 ? Math.sin(time / 60) * 6 : 0;
  const legH = Math.max(17 + squash - crouch * 0.6, 6);
  g.fillRoundedRect(x - 13 + step, y - 8 - legH, 11, legH, 3);
  g.fillRoundedRect(x + 2 - step, y - 8 - legH, 11, legH, 3);
  g.fillStyle(SKIN, a).fillRect(x - 12 + step, y - 10, 9, 9).fillRect(x + 3 - step, y - 10, 9, 9);
  g.fillStyle(0xc99b4b, a).fillRoundedRect(x - 16 + step, y - 4, 17, 6, 3).fillRoundedRect(x + 1 - step, y - 4, 17, 6, 3);
  // thân
  g.fillStyle(color, a).fillRoundedRect(x - PLAYER.w / 2, by - 56, PLAYER.w, 36, 8);
  g.lineStyle(2.5, INK, a).strokeRoundedRect(x - PLAYER.w / 2, by - 56, PLAYER.w, 36, 8);
  g.lineStyle(2, 0xffffff, 0.6 * a).lineBetween(x - 7, by - 53, x, by - 47).lineBetween(x, by - 47, x + 7, by - 53);
  g.fillStyle(0xffffff, 0.16 * a).fillRoundedRect(x - 14, by - 44, 7, 17, 3);
  // tay: gồng thì giơ ra sau, bắt thì đưa ra trước, cúi thì với xuống đất
  g.fillStyle(SKIN, a);
  if (crouch) g.fillRoundedRect(x + f * 18 - 4, by - 46, 8, 34, 3);
  else if (p.charge >= 0) g.fillRect(x - f * 26 - 4, by - 66, 8, 18);
  else if (p.catchWin > 0) g.fillRect(x + (f > 0 ? 18 : -34), by - 52, 16, 8);
  else g.fillRect(x + f * 14 - 4, by - 50, 8, 20);
  // đầu
  g.fillStyle(0x293b32, a).fillCircle(x, by - 69, 15);
  g.fillStyle(SKIN, a).fillEllipse(x, by - 65, 27, 28);
  g.lineStyle(2, INK, 0.8 * a).strokeEllipse(x, by - 65, 27, 28);
  g.fillStyle(0x293b32, a).slice(x - 2, by - 73, 13, Math.PI, 0, false).fillPath();
  g.fillStyle(0xd8876d, a * 0.6).fillEllipse(x + f * 9, by - 62, 6, 3);
  g.lineStyle(1.5, 0x864e39, a).lineBetween(x + f * 4, by - 58, x + f * 9, by - 59);
  g.fillStyle(0x222222, a).fillCircle(x + f * 6, by - 68, 2.2);

  switch (mark) {
    case 'helmet':
      g.fillStyle(0xf2d12e, a).slice(x, by - 68, 15, Math.PI, 0, false).fillPath();
      g.lineStyle(2, INK, 0.8 * a).beginPath(); g.arc(x, by - 68, 15, Math.PI, 0, false); g.strokePath();
      break;
    case 'nonla':
      g.fillStyle(0xe8d9a8, a).fillTriangle(x - 24, by - 70, x + 24, by - 70, x, by - 92);
      g.lineStyle(2, INK, 0.8 * a).strokeTriangle(x - 24, by - 70, x + 24, by - 70, x, by - 92);
      break;
    case 'scarf':
      g.fillStyle(0xffe066, a).fillRect(x - 14, by - 56, 28, 6);
      g.fillStyle(0x3a2318, a).fillCircle(x - f * 10, by - 74, 7);
      break;
    case 'glasses':
      g.lineStyle(2, 0x111111, a).strokeCircle(x + f * 4, by - 68, 4).strokeCircle(x + f * 11, by - 68, 3);
      g.fillStyle(0xdddddd, a).fillRect(x - 12, by - 80, 24, 4);
      break;
    case 'box':
      g.fillStyle(0xc89a5a, a).fillRect(x - f * 34 - 10, by - 62, 20, 22);
      g.lineStyle(2, INK, 0.8 * a).strokeRect(x - f * 34 - 10, by - 62, 20, 22);
      g.fillStyle(0x2f8f5b, a).fillRect(x - 13, by - 82, 26, 6);
      break;
  }

  // thanh gồng
  if (p.charge >= 0) {
    const t = Math.min(p.charge / SLIPPER.maxChargeTicks, 1);
    const full = t >= 1;
    const pulse = full ? Math.sin(time / 50) * 1.5 : 0;
    g.fillStyle(INK, 1).fillRoundedRect(x - 28 - pulse, y - 108 - pulse, 56 + pulse * 2, 12 + pulse * 2, 6);
    g.fillStyle(PAPER, 1).fillRoundedRect(x - 26, y - 106, 52, 8, 4);
    if (t > 0.04) g.fillStyle(full ? 0xe0533d : GOLD, 1).fillRoundedRect(x - 26, y - 106, Math.max(52 * t, 8), 8, 4);
  }
  // cửa sổ bắt
  if (p.catchWin > 0 || debug) {
    const z = catchZone(p);
    g.fillStyle(0x6cc46a, p.catchWin > 0 ? 0.22 : 0.06).fillRoundedRect(z.x0, z.y0, z.x1 - z.x0, z.y1 - z.y0, 8);
    if (p.catchWin > 0) g.lineStyle(2.5, 0x3c8f3a, 0.9).strokeRoundedRect(z.x0, z.y0, z.x1 - z.x0, z.y1 - z.y0, 8);
  }
  // choáng
  if (p.stun > 0) {
    for (let i = 0; i < 3; i++) {
      const ang = time / 150 + (i * Math.PI * 2) / 3;
      const sx = x + Math.cos(ang) * 16;
      const sy = by - 90 + Math.sin(ang) * 4;
      g.fillStyle(INK).fillCircle(sx, sy, 4.5);
      g.fillStyle(0xffe066).fillCircle(sx, sy, 3);
    }
  }
  if (debug) {
    g.lineStyle(1, 0x00ffff, 0.8).strokeRect(x - PLAYER.w / 2, y - PLAYER.h, PLAYER.w, PLAYER.h);
  }
}

export function drawSlipper(g: G, s: RenderSlipper, ownerChar: number, debug: boolean, time = 0) {
  if (s.state === SlipperState.Held) return;
  const ang = (s.angle / 256) * Math.PI * 2;
  const alpha = s.ghost ? 0.85 : 1;
  if (s.harmful && s.state === SlipperState.Flying) {
    g.lineStyle(5, 0xffffff, 0.35).lineBetween(s.x, s.y, s.x - s.vx * 0.035, s.y - s.vy * 0.035);
    g.lineStyle(2, charColor(ownerChar), 0.5).lineBetween(s.x, s.y, s.x - s.vx * 0.05, s.y - s.vy * 0.05);
  }
  if (s.state === SlipperState.Grounded) {
    // dép nằm đất: quầng sáng nhịp để dễ thấy chỗ nhặt
    const k = 0.5 + 0.5 * Math.sin(time / 220);
    g.fillStyle(0xfff3c4, 0.25 + 0.25 * k).fillEllipse(s.x, s.y + 4, 56 + 8 * k, 18 + 3 * k);
    g.lineStyle(2, GOLD, 0.4 + 0.4 * k).strokeEllipse(s.x, s.y + 4, 56 + 8 * k, 18 + 3 * k);
  }
  slipperShape(g, s.x, s.y, ang, charColor(ownerChar), alpha);
  if (debug) g.lineStyle(1, s.harmful ? 0xff4040 : 0x40ff40).strokeCircle(s.x, s.y, SLIPPER.r);
}

/** Dép đang cầm trên HUD: có màu = còn, viền đứt = hết. */
export function drawAmmo(g: G, x: number, y: number, n: number, max: number, color: number) {
  for (let i = 0; i < max; i++) {
    const cx = x + i * 30;
    if (i < n) slipperShape(g, cx, y, -0.35, color, 1, 0.78);
    else {
      g.fillStyle(0xe6dccb, 1).fillEllipse(cx, y, 26, 11);
      g.lineStyle(1.5, INK, 0.35).strokeEllipse(cx, y, 26, 11);
    }
  }
}

export const CATCH_REACH = CATCH.reach;
