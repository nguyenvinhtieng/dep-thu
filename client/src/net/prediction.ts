import { copyPlayer, NET, PlayerState, PlayerStepResult, seqDiff, stepPlayer } from '@dep/shared';

const MAX_HISTORY = 120;

/** Dự đoán nhân vật của mình: chạy stepPlayer ngay với input, server trả ackSeq thì đặt lại + chạy lại input chưa ack. */
export class Predictor {
  p: PlayerState | null = null;
  seq = 0;
  frozen = true;
  /** Lệch hình ảnh còn lại sau reconcile (px), giảm dần về 0. */
  errX = 0;
  errY = 0;
  lastError = 0; // px, cho debug
  private hist: { seq: number; b: number }[] = [];
  private out: PlayerStepResult = { jumped: false, catchStart: false, throwCharge: -1, dodgeStart: false, pickup: false };

  /** Chạy một tick cục bộ. Trả kết quả (ném/bắt/nhảy) để phát hiệu ứng tức thì. */
  tick(buttons: number): PlayerStepResult | null {
    this.seq = (this.seq + 1) & 0xffff;
    this.hist.push({ seq: this.seq, b: buttons });
    if (this.hist.length > MAX_HISTORY) this.hist.shift();
    if (!this.p) return null;
    this.run(buttons);
    return this.out;
  }

  /** Các input gần nhất (cũ → mới) để gửi kèm dư thừa. */
  recent(n: number): number[] {
    return this.hist.slice(-n).map((h) => h.b);
  }

  reconcile(server: PlayerState, ackSeq: number, frozen: boolean) {
    this.frozen = frozen;
    const had = this.p;
    const ox = had ? had.x + this.errX : 0;
    const oy = had ? had.y + this.errY : 0;
    if (!this.p) this.p = { ...server };
    else copyPlayer(this.p, server);
    while (this.hist.length && seqDiff(this.hist[0].seq, ackSeq) <= 0) this.hist.shift();
    for (const h of this.hist) this.run(h.b);
    if (!had) return;
    // ox,oy = chỗ đang vẽ (p + err); giữ chỗ vẽ liên tục rồi trượt dần về giá trị mới
    const ex = ox - this.p.x;
    const ey = oy - this.p.y;
    const e = Math.hypot(ex, ey);
    this.lastError = e;
    if (e > NET.reconcileSnapPx) this.errX = this.errY = 0;
    else { this.errX = ex; this.errY = ey; }
  }

  /** Giảm lệch hình ảnh theo thời gian (ms). */
  decay(dtMs: number) {
    const k = Math.exp(-dtMs / (NET.reconcileSmoothMs / 3));
    this.errX *= k;
    this.errY *= k;
    if (Math.abs(this.errX) < 0.05) this.errX = 0;
    if (Math.abs(this.errY) < 0.05) this.errY = 0;
  }

  reset() {
    this.p = null;
    this.hist.length = 0;
    this.errX = this.errY = 0;
  }

  private run(b: number) {
    const p = this.p!;
    const o = this.out;
    stepPlayer(p, b, this.frozen, o);
    if (o.throwCharge >= 0 && p.ammo > 0) p.ammo--;
  }
}
