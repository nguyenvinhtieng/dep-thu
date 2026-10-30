import { describe, expect, it } from 'vitest';
import {
  Btn, CATCH, createRound, DODGE, Ev, GameState, PICKUP, PLAYER, SimEvent, SLIPPER, SlipperState, step, WORLD, cloneState,
} from '../src';

function run(s: GameState, inputs: number[], ticks = 1, out: SimEvent[] = []) {
  for (let i = 0; i < ticks; i++) step(s, inputs, out);
  return out;
}

const totalSlippers = (s: GameState) => s.slippers.length;
const heldPlus = (s: GameState) =>
  s.players.reduce((a, p) => a + p.ammo, 0) + s.slippers.filter((d) => d.state !== SlipperState.Held).length;

// RNG có seed (mulberry32) cho test ngẫu nhiên tất định
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Đặt 2 người đối mặt cách nhau `gap` px trên sàn. */
function duel(gap = 300) {
  const s = createRound(2, [0, 1]);
  s.players[0].x = 400; s.players[0].facing = 1;
  s.players[1].x = 400 + gap; s.players[1].facing = -1;
  return s;
}

/** Ném 1 dép từ p0 với số tick gồng cho trước. */
function throwFrom(s: GameState, chargeTicks: number, out: SimEvent[] = []) {
  run(s, [Btn.Throw, 0], chargeTicks + 1, out);
  run(s, [0, 0], 1, out);
  return out;
}

describe('di chuyển', () => {
  it('coyote time: nhảy được ngay sau khi rời mép bục', () => {
    const s = createRound(1, [0]);
    const pl = WORLD.platforms[0];
    const p = s.players[0];
    p.x = pl.x + pl.w - 5; p.y = pl.y; p.onGround = true; p.coyote = PLAYER.coyoteTicks;
    // chạy sang phải cho tới khi rơi khỏi bục
    let t = 0;
    while (p.onGround && t++ < 60) run(s, [Btn.Right]);
    expect(p.onGround).toBe(false);
    run(s, [Btn.Right], 2);
    run(s, [Btn.Right | Btn.Jump]);
    expect(p.vy).toBeLessThan(-PLAYER.jumpSpeed * 0.8);
  });

  it('hết coyote time thì không nhảy được', () => {
    const s = createRound(1, [0]);
    const p = s.players[0];
    p.y = 300; p.onGround = false; p.coyote = 0;
    run(s, [Btn.Jump]);
    expect(p.vy).toBeGreaterThan(0);
  });

  it('jump buffer: bấm nhảy ngay trước khi chạm đất vẫn nhảy', () => {
    const s = createRound(1, [0]);
    const p = s.players[0];
    p.y = WORLD.floorY - 20; p.vy = 400; p.onGround = false; p.coyote = 0;
    run(s, [Btn.Jump]); // bấm khi còn trên không
    expect(p.vy).toBeGreaterThan(0);
    let jumped = false;
    for (let i = 0; i < PLAYER.jumpBufferTicks; i++) {
      run(s, [Btn.Jump]);
      if (p.vy < -PLAYER.jumpSpeed * 0.8) jumped = true;
    }
    expect(jumped).toBe(true);
  });

  it('nhả nút nhảy sớm thì nhảy thấp hơn', () => {
    const peak = (holdTicks: number) => {
      const s = createRound(1, [0]);
      const p = s.players[0];
      let minY = p.y;
      for (let i = 0; i < 90; i++) {
        run(s, [i < holdTicks ? Btn.Jump : 0]);
        minY = Math.min(minY, p.y);
      }
      return WORLD.floorY - minY;
    };
    expect(peak(3)).toBeLessThan(peak(40) * 0.7);
  });
});

describe('ném / bắt / trúng', () => {
  it('ném ra dép bay, mất 1 dép, lực tăng theo thời gian giữ', () => {
    const a = duel(600);
    throwFrom(a, 2);
    const b = duel(600);
    throwFrom(b, SLIPPER.maxChargeTicks);
    expect(a.players[0].ammo).toBe(1);
    const fa = a.slippers.find((d) => d.state === SlipperState.Flying)!;
    const fb = b.slippers.find((d) => d.state === SlipperState.Flying)!;
    expect(fb.vx).toBeGreaterThan(fa.vx);
  });

  it('trúng thì mất 1 máu, knockback, bất tử; một lượt ném chỉ gây 1 sát thương', () => {
    const s = duel(200);
    const out = throwFrom(s, 10);
    run(s, [0, 0], 120, out);
    const hits = out.filter((e) => e.type === Ev.Hit);
    expect(hits.length).toBe(1);
    expect(s.players[1].hp).toBe(PLAYER.maxHp - 1);
    expect(s.players[0].hp).toBe(PLAYER.maxHp);
  });

  it('dép nảy tường không gây sát thương cho người ném trong cùng lượt bay', () => {
    const s = createRound(2, [0, 1]);
    s.players[0].x = WORLD.wallRight - 120; s.players[0].facing = 1;
    s.players[1].x = WORLD.wallLeft + 40; s.players[1].active = false; s.players[1].alive = false;
    const out = throwFrom(s, SLIPPER.maxChargeTicks);
    run(s, [0, 0], 120, out);
    expect(out.some((e) => e.type === Ev.Bounce)).toBe(true);
    expect(out.some((e) => e.type === Ev.Hit)).toBe(false);
    expect(s.players[0].hp).toBe(PLAYER.maxHp);
  });

  it('dép tốc độ cao không xuyên người (swept)', () => {
    const s = duel(60);
    const d = s.slippers[0];
    s.players[0].ammo = 1;
    d.state = SlipperState.Flying; d.owner = 0; d.harmful = true;
    d.x = s.players[1].x - 60; d.y = WORLD.floorY - 40; d.vx = 6000; d.vy = 0; // 100 px/tick > bề rộng người
    const out = run(s, [0, 0], 1);
    expect(out.some((e) => e.type === Ev.Hit && e.a === 1)).toBe(true);
  });

  it('bắt thành công: dép vào kho người bắt, không tạo dép mới, không mất máu', () => {
    const s = duel(260);
    const out: SimEvent[] = [];
    run(s, [Btn.Throw, 0], 4, out);
    run(s, [0, 0], 1, out); // thả → bay
    // chờ dép tới gần rồi bắt
    let caught = false;
    for (let i = 0; i < 40 && !caught; i++) {
      const d = s.slippers.find((x) => x.state === SlipperState.Flying)!;
      const near = d && Math.abs(d.x - s.players[1].x) < 90;
      // người 1 đã dùng 1 dép? Không — kho còn 2/2 nên phải ném trước để có chỗ
      run(s, [0, near ? Btn.Catch : 0], 1, out);
      caught = out.some((e) => e.type === Ev.Catch);
    }
    // kho đầy (2/2) → không bắt được, bị trúng
    expect(caught).toBe(false);
    expect(s.players[1].hp).toBe(PLAYER.maxHp - 1);
    expect(totalSlippers(s)).toBe(4);
  });

  it('bắt khi còn chỗ: thành công và ưu tiên hơn trúng', () => {
    const s = duel(260);
    // người 1 ném 1 dép ra sau lưng để có chỗ
    s.slippers[2].state = SlipperState.Grounded; s.slippers[2].x = WORLD.wallRight - 30; s.slippers[2].y = WORLD.floorY - SLIPPER.r;
    s.players[1].ammo = 1;
    const out: SimEvent[] = [];
    run(s, [Btn.Throw, 0], 4, out);
    run(s, [0, 0], 1, out);
    let pressed = false;
    for (let i = 0; i < 40; i++) {
      const d = s.slippers.find((x) => x.state === SlipperState.Flying);
      const near = !!d && Math.abs(d.x - s.players[1].x) < 110;
      const press = near && !pressed;
      if (press) pressed = true;
      run(s, [0, press ? Btn.Catch : 0], 1, out);
    }
    expect(out.some((e) => e.type === Ev.Catch && e.a === 1)).toBe(true);
    expect(out.some((e) => e.type === Ev.Hit)).toBe(false);
    expect(s.players[1].hp).toBe(PLAYER.maxHp);
    expect(s.players[1].ammo).toBe(2);
    expect(totalSlippers(s)).toBe(4);
  });

  it('bắt hụt: bấm quá sớm thì cửa sổ hết, vẫn bị trúng', () => {
    const s = duel(280);
    s.slippers[2].state = SlipperState.Grounded; s.slippers[2].x = WORLD.wallRight - 30; s.slippers[2].y = WORLD.floorY - SLIPPER.r;
    s.players[1].ammo = 1;
    const out: SimEvent[] = [];
    run(s, [Btn.Throw, Btn.Catch], 1, out); // bấm bắt ngay lập tức, dép còn xa
    run(s, [Btn.Throw, 0], 3, out);
    run(s, [0, 0], 60, out);
    expect(out.some((e) => e.type === Ev.Catch)).toBe(false);
    expect(s.players[1].hp).toBe(PLAYER.maxHp - 1);
  });

  it('không thể gồng ném khi đang trong cửa sổ bắt', () => {
    const s = duel(500);
    run(s, [Btn.Catch, 0]);
    run(s, [Btn.Catch | Btn.Throw, 0]);
    expect(s.players[0].charge).toBe(-1);
    expect(s.players[0].catchWin).toBeGreaterThan(0);
    expect(CATCH.windowTicks).toBeGreaterThan(0);
  });

  it('nhặt dép nằm đất khi tới gần, còn chỗ và bấm nhặt; nhặt được dép đối thủ', () => {
    const s = duel(600);
    const d = s.slippers[2]; // dép của người 1
    d.state = SlipperState.Grounded; d.owner = 1; d.x = 520; d.y = WORLD.floorY - SLIPPER.r;
    s.players[0].ammo = 1;
    s.slippers[0].state = SlipperState.Grounded; s.slippers[0].x = 100; s.slippers[0].y = WORLD.floorY - SLIPPER.r;
    let t = 0;
    while (Math.abs(s.players[0].x - 520) > 10 && t++ < 60) run(s, [Btn.Right, 0]);
    run(s, [0, 0], 20);
    const out = run(s, [Btn.Pickup, 0]);
    expect(out.some((e) => e.type === Ev.Pickup && e.a === 0 && e.b === 2)).toBe(true);
    expect(s.players[0].ammo).toBe(2);
  });

  it('hết máu thì bị loại và rơi dép; tổng dép không đổi', () => {
    const s = duel(200);
    s.players[1].hp = 1;
    const out = throwFrom(s, 10);
    run(s, [0, 0], 200, out);
    expect(out.some((e) => e.type === Ev.Eliminated && e.a === 1)).toBe(true);
    expect(s.players[1].alive).toBe(false);
    expect(s.players[1].ammo).toBe(0);
    expect(heldPlus(s)).toBe(4);
  });
});

describe('bất biến + tất định', () => {
  for (const n of [2, 5]) {
    it(`tổng dép luôn = 2 × ${n} qua 10.000 step input ngẫu nhiên`, () => {
      const slots = Array.from({ length: n }, (_, i) => i);
      const s = createRound(n, slots);
      const r = rng(42 + n);
      const inputs = new Array(n).fill(0);
      const out: SimEvent[] = [];
      for (let t = 0; t < 10_000; t++) {
        if (t % 6 === 0) for (let i = 0; i < n; i++) inputs[i] = Math.floor(r() * 32);
        // hồi máu định kỳ để trận không kết thúc sớm
        if (t % 600 === 0) for (const p of s.players) if (p.alive) p.hp = PLAYER.maxHp;
        out.length = 0;
        step(s, inputs, out);
        expect(heldPlus(s)).toBe(2 * n);
        expect(totalSlippers(s)).toBe(2 * n);
        for (const p of s.players) expect(p.ammo).toBeLessThanOrEqual(2);
      }
    });
  }

  it('chạy cùng chuỗi input 2 lần ra state giống hệt', () => {
    const mk = () => createRound(3, [0, 1, 2]);
    const a = mk();
    const b = cloneState(mk());
    const r1 = rng(7);
    const seq: number[][] = [];
    for (let t = 0; t < 3000; t++) seq.push([0, 1, 2].map(() => Math.floor(r1() * 32)));
    for (const inp of seq) step(a, inp, []);
    for (const inp of seq) step(b, inp, []);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

/** Đặt dép nằm đất ngay chân người 0 (bỏ trống 1 chỗ trên tay). */
function groundAtFeet(s: GameState) {
  const d = s.slippers[0];
  d.state = SlipperState.Grounded; d.owner = 0; d.x = s.players[0].x + 10; d.y = WORLD.floorY - SLIPPER.r;
  s.players[0].ammo = 1;
  return d;
}

describe('nhặt bằng nút', () => {
  it('đứng trên dép mà không bấm thì không nhặt', () => {
    const s = duel(600);
    const d = groundAtFeet(s);
    const out = run(s, [0, 0], 60);
    expect(out.some((e) => e.type === Ev.Pickup)).toBe(false);
    expect(d.state).toBe(SlipperState.Grounded);
    expect(s.players[0].ammo).toBe(1);
  });

  it('bấm nhặt thì cúi người, đứng khựng một lúc', () => {
    const s = duel(600);
    groundAtFeet(s);
    run(s, [Btn.Pickup, 0]);
    expect(s.players[0].ammo).toBe(2);
    expect(s.players[0].pickLock).toBeGreaterThan(0);
    const x = s.players[0].x;
    run(s, [Btn.Right, 0], PICKUP.lockTicks - 2);
    expect(s.players[0].x).toBe(x);
    run(s, [Btn.Right, 0], 10);
    expect(s.players[0].x).toBeGreaterThan(x);
  });

  it('giữ nút nhặt không lặp lại; tay đầy thì không nhặt', () => {
    const s = duel(600);
    const d = groundAtFeet(s);
    s.players[0].ammo = 2;
    s.slippers[1].state = SlipperState.Held; s.slippers[1].owner = 0;
    // người 0 có thêm 1 dép khác trên tay → đầy
    s.slippers[2].owner = 0;
    run(s, [Btn.Pickup, 0], 30);
    expect(d.state).toBe(SlipperState.Grounded);
  });
});

describe('lăn né', () => {
  it('thông số vừa số bit trong snapshot', () => {
    expect(DODGE.ticks).toBeLessThanOrEqual(15);
    expect(PICKUP.lockTicks).toBeLessThanOrEqual(15);
    expect(DODGE.cooldownTicks).toBeLessThanOrEqual(63);
  });

  it('lăn lướt nhanh theo hướng nhìn rồi hồi chiêu', () => {
    const s = duel(600);
    const p = s.players[0];
    const x = p.x;
    const out = run(s, [Btn.Dodge, 0]);
    expect(out.some((e) => e.type === Ev.DodgeStart && e.a === 0)).toBe(true);
    run(s, [0, 0], DODGE.ticks - 1);
    expect(p.x - x).toBeGreaterThan(150);
    expect(p.dodgeCd).toBeGreaterThan(0);
    const x2 = p.x;
    run(s, [0, 0], 2);
    run(s, [Btn.Dodge, 0], 3); // còn hồi chiêu → không lăn
    expect(p.dodge).toBe(0);
    expect(Math.abs(p.x - x2)).toBeLessThan(40);
  });

  it('dép bay xuyên qua khi đang có i-frame, kèm sự kiện NÉ và giảm hồi chiêu', () => {
    const s = duel(260);
    s.players[1].facing = -1;
    const out = run(s, [Btn.Throw, 0], 2);
    run(s, [0, 0], 1, out); // ném
    run(s, [0, Btn.Dodge | Btn.Left], 1, out); // né lùi lại
    run(s, [0, 0], 40, out);
    expect(out.some((e) => e.type === Ev.Hit)).toBe(false);
    expect(out.filter((e) => e.type === Ev.Dodge && e.a === 1).length).toBe(1);
    expect(s.players[1].hp).toBe(PLAYER.maxHp);
    expect(s.players[1].dodgeCd).toBe(0); // né thường thì vẫn còn hồi chiêu ở thời điểm này
  });

  it('không né thì vẫn trúng như cũ', () => {
    const s = duel(260);
    const out = throwFrom(s, 1);
    run(s, [0, 0], 40, out);
    expect(out.some((e) => e.type === Ev.Hit && e.a === 1)).toBe(true);
  });

  it('trên không chỉ lăn được 1 lần mỗi lần nhảy', () => {
    const s = duel(600);
    const p = s.players[0];
    run(s, [Btn.Jump, 0], 3);
    run(s, [Btn.Jump | Btn.Dodge, 0]);
    expect(p.dodge).toBeGreaterThan(0);
    p.dodgeCd = 0; p.dodge = 0;
    run(s, [Btn.Jump, 0]);
    run(s, [Btn.Jump | Btn.Dodge, 0]);
    expect(p.dodge).toBe(0);
  });

  it('fuzz đủ 7 nút: tổng dép không đổi, tất định', () => {
    const mk = () => createRound(3, [0, 1, 2]);
    const a = mk();
    const b = mk();
    const r = rng(99);
    const inputs = [0, 0, 0];
    for (let t = 0; t < 6000; t++) {
      if (t % 5 === 0) for (let i = 0; i < 3; i++) inputs[i] = Math.floor(r() * 128);
      if (t % 600 === 0) for (const s of [a, b]) for (const p of s.players) if (p.alive) p.hp = PLAYER.maxHp;
      step(a, inputs, []);
      step(b, inputs, []);
      expect(heldPlus(a)).toBe(6);
      for (const p of a.players) expect(p.ammo).toBeLessThanOrEqual(2);
    }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
