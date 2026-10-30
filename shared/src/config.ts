// Mọi thông số gameplay + mạng. Đơn vị ghi ở tên/ghi chú: px, px/s, px/s², tick (1 tick = 1/60 s), ms.

export const TICK_HZ = 60;
export const DT = 1 / TICK_HZ; // s
export const msToTicks = (ms: number) => Math.round((ms * TICK_HZ) / 1000);

export const WORLD = {
  width: 1280, // px
  height: 720, // px
  floorY: 640, // px — mặt sàn
  wallLeft: 48, // px — mép trong tường trái
  wallRight: 1232, // px — mép trong tường phải
  ceilingY: 16, // px
  // Bục một chiều (nhảy xuyên từ dưới, đứng được từ trên): x trái, y mặt trên, rộng
  platforms: [
    { x: 150, y: 470, w: 230, kind: 'roof' }, // mái tôn sạp
    { x: 535, y: 360, w: 210, kind: 'chairs' }, // chồng ghế nhựa
    { x: 900, y: 470, w: 230, kind: 'foam' }, // thùng xốp
  ],
} as const;

export const PLAYER = {
  w: 40, // px — hitbox giống nhau mọi nhân vật
  h: 72, // px
  maxHp: 3,
  maxAmmo: 2,
  runSpeed: 380, // px/s
  groundAccel: 4200, // px/s²
  groundDecel: 5200, // px/s²
  airAccel: 2600, // px/s²
  gravity: 2700, // px/s²
  fallGravity: 3300, // px/s² — rơi nhanh hơn lên cho cảm giác chắc
  maxFall: 1400, // px/s
  jumpSpeed: 860, // px/s
  jumpCutMul: 0.45, // nhả nút nhảy sớm → nhân vy
  coyoteTicks: msToTicks(80),
  jumpBufferTicks: msToTicks(100),
  chargeMoveMul: 0.6, // tốc độ chạy khi đang gồng ném
  knockbackX: 460, // px/s
  knockbackY: 420, // px/s
  stunTicks: msToTicks(300),
  invulnTicks: msToTicks(1000),
} as const;

export const SLIPPER = {
  r: 14, // px — bán kính va chạm
  gravity: 1500, // px/s²
  minSpeed: 720, // px/s — ném nhẹ
  maxSpeed: 1500, // px/s — gồng đầy
  liftRatio: 0.3, // vy ban đầu = -speed × liftRatio
  maxChargeTicks: msToTicks(750),
  throwCooldownTicks: msToTicks(200),
  spawnOffsetX: 26, // px trước mặt
  spawnOffsetY: 50, // px trên chân
  wallRestitution: 0.65,
  floorRestitution: 0.4,
  floorFriction: 0.7, // nhân vx mỗi lần chạm sàn
  restSpeed: 90, // px/s — dưới mức này coi như nằm yên
  hitBounceVx: -0.25, // nhân vx sau khi trúng người
  hitBounceVy: -260, // px/s
  spinPerTick: 22, // đơn vị góc (256 = 1 vòng)
  pickupDx: 40, // px
  pickupDy: 70, // px
} as const;

export const DODGE = {
  ticks: msToTicks(250), // tổng thời gian lăn
  recoverTicks: 3, // mấy tick cuối: hết lướt, hết i-frame
  speed: 880, // px/s — lướt ~180 px
  airLift: 220, // px/s — lăn trên không nảy nhẹ lên
  cooldownTicks: msToTicks(900),
  perfectCdTicks: msToTicks(250), // né sát (dép xuyên qua i-frame) → hồi chiêu còn tối đa chừng này
} as const;

export const PICKUP = {
  lockTicks: msToTicks(150), // cúi nhặt: đứng khựng, không ném/bắt/lăn
} as const;

export const CATCH = {
  windowTicks: msToTicks(150),
  cooldownTicks: msToTicks(500),
  reach: 74, // px trước mặt
  back: 10, // px sau lưng
  top: 96, // px trên chân
  bottom: 4, // px dưới chân
  maxRewindTicks: msToTicks(120), // lag compensation tối đa
} as const;

export const MATCH = {
  countdownTicks: msToTicks(3000),
  roundEndTicks: msToTicks(2000),
  defaultWinsNeeded: 3,
  winsOptions: [2, 3, 5],
  ffaRoundTicks: msToTicks(90_000),
  rematchTimeoutMs: 15_000,
  maxPlayers: 5,
  defaultMaxSpectators: 20,
} as const;

export const NET = {
  inputSendEveryTicks: 2, // 30 Hz
  inputRedundancy: 6, // số input gần nhất gửi kèm mỗi gói
  snapshotEveryTicks: 2, // 30 Hz cho người chơi
  spectatorSnapshotEveryTicks: 3, // 20 Hz
  serverInputBufferMax: 6, // tick — thừa hơn thì bỏ bớt input cũ
  maxInputPacketsPerSec: 80,
  interpMinMs: 50,
  interpMaxMs: 150,
  spectatorInterpMs: 150,
  extrapolateMaxMs: 100,
  reconcileSnapPx: 48, // lệch lớn hơn thì snap
  reconcileSmoothMs: 100,
  pingIntervalMs: 500,
  reconnectSeconds: 30,
  emptyRoomDisposeMs: 30_000,
  chatMinIntervalMs: 700,
  eventRepeat: 4, // số snapshot lặp lại một event
} as const;

export const NAME = { min: 2, max: 16 } as const;

export const CHARACTERS = [
  { id: 0, name: 'Chú Tư Xe Ôm', color: 0x3f7fd0, mark: 'helmet' },
  { id: 1, name: 'Cô Ba Bún Bò', color: 0x8e4fb8, mark: 'nonla' },
  { id: 2, name: 'Bé Na', color: 0xe04848, mark: 'scarf' },
  { id: 3, name: 'Ông Bảy Cờ Tướng', color: 0x4f9a52, mark: 'glasses' },
  { id: 4, name: 'Anh Sáu Shipper', color: 0xf08a24, mark: 'box' },
] as const;
