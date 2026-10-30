import Phaser from 'phaser';
import { DODGE, Ev, MATCH, PLAYER, Phase, SLIPPER, SlipperState, TICK_HZ, WORLD } from '@dep/shared';
import { sfx } from '../audio';
import type { FxEvent, MatchView, NetMatch } from '../net/match';
import { charColor, drawAmmo, drawBackground, drawCooldownRing, drawHeart, drawPlayer, drawSlipper, GOLD, INK, paperCard, PAPER, pill } from '../render/draw';

/** Những gì scene cần từ app (tên, nhân vật theo slot...). */
export interface MatchBinding {
  match: NetMatch;
  names(): string[];
  chars(): number[];
  winsNeeded(): number;
  shake(): boolean;
  /** Tên phím Nhặt đang gán, để hiện gợi ý trên dép. */
  pickupKey(): string;
}

const FONT = '"Baloo 2", "Be Vietnam Pro", system-ui, sans-serif';
const INK_CSS = '#1e1c1a';
const PAPER_CSS = '#fffaf0';

export class MatchScene extends Phaser.Scene {
  private b: MatchBinding | null = null;
  private g!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Graphics;
  private nameTexts: Phaser.GameObjects.Text[] = [];
  private hudTexts: Phaser.GameObjects.Text[] = [];
  private big!: Phaser.GameObjects.Text;
  private small!: Phaser.GameObjects.Text;
  private top!: Phaser.GameObjects.Text;
  private prompt!: Phaser.GameObjects.Text;
  private dbg!: Phaser.GameObjects.Text;
  private debug = false;
  private lastCount = -1;
  private lastPhase = -1;
  private goUntil = 0;
  private fps = 60;

  constructor() {
    super('match');
  }

  bind(b: MatchBinding | null) {
    this.b = b;
    this.lastCount = this.lastPhase = -1;
    if (b) b.match.onFx = (e) => this.onFx(e);
  }

  create() {
    drawBackground(this.add.graphics());
    this.add.text(263, 499, 'QUÁN CÔ BA', { fontFamily: FONT, fontSize: '17px', fontStyle: '800', color: '#fff0c9', backgroundColor: '#337665', padding: { x: 14, y: 4 } }).setOrigin(0.5);
    this.add.text(640, 552, 'TRÀ ĐÁ · 3K', { fontFamily: FONT, fontSize: '16px', fontStyle: '800', color: '#99533e' }).setOrigin(0.5);
    this.add.text(1010, 559, 'HẺM 1986', { fontFamily: FONT, fontSize: '17px', fontStyle: '800', color: '#99533e' }).setOrigin(0.5);
    this.g = this.add.graphics();
    this.hud = this.add.graphics().setDepth(10);
    const st = (size: number, color = INK_CSS, weight = '700'): Phaser.Types.GameObjects.Text.TextStyle => ({
      fontFamily: FONT, fontSize: `${size}px`, fontStyle: weight, color,
    });
    for (let i = 0; i < MATCH.maxPlayers; i++) {
      this.nameTexts.push(this.add.text(0, 0, '', st(14)).setOrigin(0.5, 0.5).setDepth(6));
      this.hudTexts.push(this.add.text(0, 0, '', st(17, INK_CSS, '800')).setDepth(11));
    }
    this.big = this.add.text(WORLD.width / 2, 262, '', { ...st(112, '#f2b33d', '800'), stroke: INK_CSS, strokeThickness: 12 })
      .setShadow(6, 7, INK_CSS, 0, true, false).setOrigin(0.5).setDepth(13);
    this.small = this.add.text(WORLD.width / 2, 346, '', { ...st(30, PAPER_CSS, '700'), stroke: INK_CSS, strokeThickness: 6 }).setOrigin(0.5).setDepth(13);
    this.top = this.add.text(WORLD.width / 2, 0, '', st(15, PAPER_CSS)).setOrigin(0.5, 0.5).setDepth(11);
    this.prompt = this.add.text(0, 0, '', st(14)).setOrigin(0.5, 0.5).setDepth(7);
    // Canvas chỉ vẽ đúng font khi font đã tải xong: vẽ lại chữ sau khi Baloo 2 sẵn sàng.
    const fonts = document.fonts;
    if (fonts) {
      Promise.all(['700 16px "Baloo 2"', '800 16px "Baloo 2"'].map((f) => fonts.load(f))).catch(() => undefined).then(() => {
        for (const o of this.children.list) if (o instanceof Phaser.GameObjects.Text) o.style.update(true);
      });
    }
    this.dbg = this.add.text(56, 520, '', { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '13px', color: '#9ef', backgroundColor: '#000a', padding: { x: 6, y: 4 } })
      .setDepth(20).setVisible(false);
    this.input.keyboard?.on('keydown-F3', (e: KeyboardEvent) => {
      e.preventDefault();
      this.debug = !this.debug;
      this.dbg.setVisible(this.debug);
    });
  }

  update(_time: number, delta: number) {
    this.fps += (1000 / Math.max(delta, 1) - this.fps) * 0.05;
    const g = this.g;
    g.clear();
    this.hud.clear();
    const b = this.b;
    const now = performance.now();
    const v = b?.match.view(now) ?? null;
    if (!b || !v) {
      for (const t of [...this.nameTexts, ...this.hudTexts]) t.setText('');
      this.big.setText(b ? 'Đang nối mạng…' : '');
      this.small.setText('');
      this.top.setText('');
      this.prompt.setText('');
      return;
    }
    const names = b.names();
    const chars = b.chars();

    for (const s of v.slippers) drawSlipper(g, s, chars[s.owner] ?? 0, this.debug, now);
    v.players.forEach((p, i) => {
      if (p.active) drawPlayer(g, p, chars[i] ?? i, now, this.debug);
    });
    this.drawNameTags(v, names);
    this.drawPickupPrompt(v, b);
    this.drawHud(v, names, chars, b);
    this.drawPhase(v, names, now);
    if (this.debug) this.drawDebug(b.match, now);
  }

  /** Thẻ tên dạng pill trên đầu; của mình màu vàng + mũi nhọn chỉ xuống. */
  private drawNameTags(v: MatchView, names: string[]) {
    const g = this.g;
    v.players.forEach((p, i) => {
      const t = this.nameTexts[i];
      if (!p.active) return t.setText('');
      t.setText(`${names[i] ?? '?'}${p.connected ? '' : ' · mất sóng'}`);
      const crouch = p.pickLock > 0 ? 16 : 0;
      const y = p.y + crouch - PLAYER.h - (p.charge >= 0 ? 44 : 26);
      const w = t.width + 18;
      pill(g, p.x, y - 11, w, 22, p.me ? GOLD : PAPER, p.alive ? 1 : 0.6, false);
      if (p.me) {
        g.fillStyle(INK, 1).fillTriangle(p.x - 7, y + 10, p.x + 7, y + 10, p.x, y + 18);
        g.fillStyle(GOLD, 1).fillTriangle(p.x - 4, y + 10, p.x + 4, y + 10, p.x, y + 14);
      }
      t.setPosition(p.x, y).setAlpha(p.alive ? 1 : 0.6);
    });
    for (let i = v.players.length; i < this.nameTexts.length; i++) this.nameTexts[i].setText('');
  }

  /** Gợi ý "[S] Nhặt" trên chiếc dép gần nhất khi mình nhặt được. */
  private drawPickupPrompt(v: MatchView, b: MatchBinding) {
    const me = v.players.find((p) => p.me);
    let best: { x: number; y: number } | null = null;
    if (me && me.alive && me.onGround && me.pickLock === 0 && me.ammo < PLAYER.maxAmmo && v.phase === Phase.Playing) {
      let bd = Infinity;
      for (const s of v.slippers) {
        if (s.state !== SlipperState.Grounded) continue;
        const dx = Math.abs(s.x - me.x);
        if (dx > SLIPPER.pickupDx || Math.abs(s.y - (me.y - 24)) > SLIPPER.pickupDy) continue;
        if (dx < bd) { bd = dx; best = s; }
      }
    }
    if (!best) return this.prompt.setText('');
    const t = this.prompt.setText(`${b.pickupKey()} · Nhặt`);
    const bob = Math.sin(performance.now() / 160) * 2;
    const y = best.y - 34 + bob;
    pill(this.g, best.x, y - 11, t.width + 18, 22, PAPER);
    t.setPosition(best.x, y);
  }

  private drawHud(v: MatchView, names: string[], chars: number[], b: MatchBinding) {
    const h = this.hud;
    const need = b.winsNeeded();
    const active = v.players.filter((p) => p.active);
    const n = active.length;
    const W = WORLD.width;
    const cw = n <= 2 ? 250 : Math.min(250, (W - 40 - (n - 1) * 10) / n);
    const ch = 76;
    active.forEach((p, k) => {
      const x = n <= 2 ? (k === 0 ? 20 : W - 20 - cw) : 20 + k * (cw + 10);
      const y = 14;
      const col = charColor(chars[p.slot] ?? 0);
      paperCard(h, x, y, cw, ch, 14, p.alive ? PAPER : 0xe9e1d2);
      // dải màu nhân vật bên trái
      h.fillStyle(col, 1).fillRoundedRect(x + 3, y + 3, 8, ch - 6, 4);
      // tên + chấm thắng
      const t = this.hudTexts[k];
      const label = `${names[p.slot] ?? '?'}${p.me ? ' (bạn)' : ''}`;
      t.setPosition(x + 20, y + 5).setText(label);
      const maxW = cw - 30 - need * 15;
      if (t.width > maxW) t.setCrop(0, 0, maxW, 40); else t.setCrop();
      for (let i = 0; i < need; i++) {
        const px = x + cw - 16 - (need - 1 - i) * 15;
        h.fillStyle(i < p.wins ? GOLD : 0xe6dccb, 1).fillCircle(px, y + 18, 5.5);
        h.lineStyle(1.8, INK, 1).strokeCircle(px, y + 18, 5.5);
      }
      // hàng dưới: máu · dép · lăn né
      const ry = y + 52;
      for (let i = 0; i < PLAYER.maxHp; i++) drawHeart(h, x + 30 + i * 24, ry - 3, 9, i < p.hp);
      drawAmmo(h, x + 30 + PLAYER.maxHp * 24 + 14, ry, p.ammo, PLAYER.maxAmmo, col);
      const frac = 1 - p.dodgeCd / DODGE.cooldownTicks;
      drawCooldownRing(h, x + cw - 24, ry, 12, p.alive ? frac : 0);
    });
    for (let i = n; i < this.hudTexts.length; i++) this.hudTexts[i].setText('');
    const ping = b.match.spectator ? 'đang xem' : `${Math.round(b.match.rtt)} ms`;
    this.top.setText(`HIỆP ${v.round}  ·  chạm ${need}  ·  ${ping}`);
    const ty = n <= 2 ? 34 : 14 + ch + 26;
    pill(h, W / 2, ty - 15, this.top.width + 28, 30, INK, 0.92, false);
    this.top.setPosition(W / 2, ty);
  }

  private drawPhase(v: MatchView, names: string[], now: number) {
    if (v.phase !== this.lastPhase) {
      if (v.phase === Phase.Playing && this.lastPhase === Phase.Countdown) {
        this.goUntil = now + 600;
        sfx.beep(true);
      }
      this.lastPhase = v.phase;
    }
    let big = '';
    let small = '';
    if (v.phase === Phase.Countdown) {
      const n = Math.ceil(v.phaseLeft / TICK_HZ);
      big = n > 0 ? String(n) : '';
      small = `Hiệp ${v.round}`;
      if (n !== this.lastCount && n > 0) {
        sfx.beep();
        this.bump(this.big);
      }
      this.lastCount = n;
    } else if (v.phase === Phase.Playing && now < this.goUntil) {
      big = 'ĐÁNH!';
    } else if (v.phase === Phase.RoundEnd || v.phase === Phase.MatchEnd) {
      const w = v.players.find((p) => p.active && p.alive);
      big = v.phase === Phase.MatchEnd ? 'HẾT TRẬN' : 'HẾT HIỆP';
      small = w ? `${names[w.slot] ?? '?'} thắng ${v.phase === Phase.MatchEnd ? 'trận' : 'hiệp'}!` : 'Hòa';
    }
    if (big !== this.big.text && big === 'ĐÁNH!') this.bump(this.big);
    this.big.setText(big);
    this.small.setText(small);
    if (big) {
      // dải mực mờ phía sau chữ lớn
      const h = this.hud;
      h.fillStyle(INK, 0.5).fillRect(0, 186, WORLD.width, small ? 190 : 150);
      h.fillStyle(GOLD, 0.9).fillRect(0, 186, WORLD.width, 4).fillRect(0, 186 + (small ? 190 : 150) - 4, WORLD.width, 4);
    }
  }

  private bump(t: Phaser.GameObjects.Text) {
    this.tweens.killTweensOf(t);
    t.setScale(1.35);
    this.tweens.add({ targets: t, scale: 1, duration: 260, ease: 'Back.easeOut' });
  }

  private drawDebug(m: NetMatch, now: number) {
    const c = m.clock;
    const s = m.stats;
    this.dbg.setText([
      `FPS ${this.fps.toFixed(0)}  ping ${m.rtt.toFixed(0)} ms  jitter ${(c.jitter * 1000 / TICK_HZ).toFixed(1)} ms`,
      `interp ${(c.delay * 1000 / TICK_HZ).toFixed(0)} ms  buffer ${s.bufferLen} snap  ${s.snapsPerSec.toFixed(0)} snap/s`,
      `reconcile lệch ${s.reconcileErr.toFixed(1)} px  seq ${m.pred.seq}`,
      `in ${(s.inBps / 1024).toFixed(2)} KB/s  out ${(s.outBps / 1024).toFixed(2)} KB/s`,
      `tick server ${m.latest?.full ?? '-'}  render ${c.renderTick(now).toFixed(1)}  ack ${m.latest?.ackSeq ?? '-'}`,
    ].join('\n'));
  }

  private onFx(e: FxEvent) {
    const m = this.b?.match;
    if (!m) return;
    const mine = e.a === m.slot && m.slot >= 0;
    // cú ném/bắt/lăn của mình đã phát lúc dự đoán
    if (!e.local && mine && (e.type === Ev.Throw || e.type === Ev.CatchStart || e.type === Ev.DodgeStart)) return;
    switch (e.type) {
      case Ev.Throw: sfx.throw(); break;
      case Ev.CatchStart: sfx.catchStart(); break;
      case Ev.Catch: sfx.catch(); this.pop(e.x, e.y - 30, 'BẮT!', '#6cc46a'); break;
      case Ev.Hit:
        sfx.hit();
        this.pop(e.x, e.y - 30, 'BỐP!', '#ff6a50');
        if (this.b?.shake() && (mine || m.spectator)) this.cameras.main.shake(140, 0.006);
        break;
      case Ev.DodgeStart: sfx.dodge(); this.dust(e.x, e.y); break;
      case Ev.Dodge: sfx.perfect(); this.pop(e.x, e.y - 60, 'NÉ!', '#7cc3f2'); break;
      case Ev.Bounce: sfx.bounce(); break;
      case Ev.Pickup: sfx.pickup(); break;
      case Ev.Eliminated: sfx.ko(); break;
      case Ev.Land: if (e.a === -2) sfx.jump(); break;
    }
  }

  /** Chữ nổi kiểu sticker: bật to rồi bay lên mờ dần. */
  private pop(x: number, y: number, text: string, color: string) {
    const t = this.add.text(x, y, text, {
      fontFamily: FONT, fontSize: '36px', fontStyle: '800', color, stroke: INK_CSS, strokeThickness: 7,
    }).setShadow(3, 4, INK_CSS, 0, true, false).setOrigin(0.5).setDepth(15)
      .setScale(0.4).setAngle(Phaser.Math.Between(-10, 10));
    this.tweens.chain({
      targets: t,
      tweens: [
        { scale: 1.15, duration: 140, ease: 'Back.easeOut' },
        { y: y - 46, alpha: 0, scale: 1, duration: 520, delay: 160, ease: 'Cubic.easeIn' },
      ],
      onComplete: () => t.destroy(),
    });
  }

  /** Bụi tung lên khi bắt đầu lăn. */
  private dust(x: number, y: number) {
    for (let i = 0; i < 5; i++) {
      const c = this.add.circle(x + Phaser.Math.Between(-14, 14), y - 6, Phaser.Math.Between(6, 10), 0xf3ead8, 0.9)
        .setStrokeStyle(2, INK, 0.5).setDepth(4);
      this.tweens.add({
        targets: c, x: c.x + Phaser.Math.Between(-36, 36), y: y - Phaser.Math.Between(10, 30),
        scale: 1.8, alpha: 0, duration: 380, ease: 'Cubic.easeOut', onComplete: () => c.destroy(),
      });
    }
  }
}
