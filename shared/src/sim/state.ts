import { DODGE, PLAYER, WORLD } from '../config';

export enum Btn {
  Left = 1,
  Right = 2,
  Jump = 4,
  Throw = 8,
  Catch = 16,
  Pickup = 32,
  Dodge = 64,
}
export const BTN_MASK = 127;

export enum SlipperState {
  Held = 0,
  Flying = 1,
  Grounded = 2,
}

export interface PlayerState {
  x: number; // px — giữa chân
  y: number; // px — đáy chân
  vx: number; // px/s
  vy: number; // px/s
  facing: 1 | -1;
  onGround: boolean;
  coyote: number; // tick còn lại được nhảy sau khi rời mép
  jumpBuffer: number; // tick còn nhớ lần bấm nhảy
  prevButtons: number;
  charge: number; // tick đã gồng; -1 = không gồng
  throwCd: number;
  catchWin: number; // tick còn lại của cửa sổ bắt
  catchCd: number;
  stun: number;
  invuln: number;
  dodge: number; // tick lăn còn lại (> DODGE.recoverTicks: đang lướt + i-frame)
  dodgeCd: number;
  airDodged: boolean; // đã lăn trên không trong lần nhảy này
  dodgePerfect: boolean; // lần lăn này đã né sát một chiếc dép
  pickLock: number; // tick cúi nhặt còn lại
  hp: number;
  ammo: number; // suy ra từ slippers mỗi step
  alive: boolean;
  active: boolean; // slot có người chơi trong hiệp
}

export interface SlipperObj {
  state: SlipperState;
  owner: number; // Held: người cầm; Flying/Grounded: người ném cuối (-1 nếu chưa ai ném)
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number; // 0..255
  harmful: boolean;
}

export interface GameState {
  tick: number;
  frozen: boolean; // đếm ngược / kết hiệp: không nhận input
  players: PlayerState[];
  slippers: SlipperObj[];
}

export function makePlayer(x: number, facing: 1 | -1, active = true): PlayerState {
  return {
    x, y: WORLD.floorY, vx: 0, vy: 0, facing, onGround: true,
    coyote: 0, jumpBuffer: 0, prevButtons: 0, charge: -1, throwCd: 0,
    catchWin: 0, catchCd: 0, stun: 0, invuln: 0,
    dodge: 0, dodgeCd: 0, airDodged: false, dodgePerfect: false, pickLock: 0,
    hp: active ? PLAYER.maxHp : 0, ammo: 0, alive: active, active,
  };
}

/** Vị trí xuất phát đối xứng theo số người. */
export function spawnX(slot: number, count: number): number {
  const left = WORLD.wallLeft + 120;
  const right = WORLD.wallRight - 120;
  if (count <= 1) return (left + right) / 2;
  return left + ((right - left) * slot) / (count - 1);
}

/** Tạo hiệp mới: activeSlots = các slot có người chơi. Tổng dép = 2 × số người. */
export function createRound(slotCount: number, activeSlots: number[], tick = 0): GameState {
  const players: PlayerState[] = [];
  const order = [...activeSlots].sort((a, b) => a - b);
  for (let i = 0; i < slotCount; i++) {
    const k = order.indexOf(i);
    const x = k >= 0 ? spawnX(k, order.length) : WORLD.width / 2;
    players.push(makePlayer(x, x < WORLD.width / 2 ? 1 : -1, k >= 0));
  }
  const slippers: SlipperObj[] = [];
  for (const p of order) {
    for (let j = 0; j < 2; j++) {
      slippers.push({ state: SlipperState.Held, owner: p, x: players[p].x, y: players[p].y, vx: 0, vy: 0, angle: 0, harmful: false });
    }
    players[p].ammo = 2;
  }
  return { tick, frozen: false, players, slippers };
}

export function cloneState(s: GameState): GameState {
  return {
    tick: s.tick,
    frozen: s.frozen,
    players: s.players.map((p) => ({ ...p })),
    slippers: s.slippers.map((d) => ({ ...d })),
  };
}

export function copyPlayer(dst: PlayerState, src: PlayerState) {
  Object.assign(dst, src);
}

/** Lượng tử hóa 1/8 px (và 1/8 px/s) — chạy cuối mỗi step ở cả server và client. */
/** Đang lướt lăn: có i-frame với dép. */
export const dodging = (p: PlayerState) => p.dodge > DODGE.recoverTicks;

export const q8 = (v: number) => Math.round(v * 8) / 8;
