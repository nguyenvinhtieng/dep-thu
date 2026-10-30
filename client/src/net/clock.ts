import { NET, TICK_HZ } from '@dep/shared';

const TPM = TICK_HZ / 1000; // tick mỗi ms

/**
 * Ước lượng tick server hiện tại từ snapshot đến và chọn độ trễ nội suy theo jitter.
 * offset nhảy nhanh khi snapshot đến sớm hơn dự đoán (mẫu tốt), trôi chậm khi đến trễ (do jitter).
 */
export class Clock {
  offset = NaN;
  jitter = 0; // tick
  delay = 4; // tick
  private lastFull = -1;

  constructor(private spectator: boolean) {}

  /** Mở rộng tick u16 thành số tăng dần. */
  unwrap(tick16: number): number {
    if (this.lastFull < 0) return (this.lastFull = tick16);
    let d = (tick16 - (this.lastFull & 0xffff)) & 0xffff;
    if (d >= 0x8000) d -= 0x10000;
    const full = this.lastFull + d;
    if (full > this.lastFull) this.lastFull = full;
    return full;
  }

  sample(tick: number, now: number) {
    const s = tick - now * TPM;
    if (Number.isNaN(this.offset) || Math.abs(s - this.offset) > 60) {
      this.offset = s;
      return;
    }
    const d = s - this.offset;
    this.jitter += (Math.abs(d) - this.jitter) * 0.08;
    this.offset += d * (d > 0 ? 0.25 : 0.02);
    const every = this.spectator ? NET.spectatorSnapshotEveryTicks : NET.snapshotEveryTicks;
    const want = this.spectator
      ? (NET.spectatorInterpMs * TICK_HZ) / 1000
      : Math.min(Math.max(every + 1 + 2 * this.jitter, (NET.interpMinMs * TICK_HZ) / 1000 + 0.5), (NET.interpMaxMs * TICK_HZ) / 1000);
    this.delay += (want - this.delay) * 0.05;
  }

  ready() {
    return !Number.isNaN(this.offset);
  }

  serverTick(now: number) {
    return now * TPM + this.offset;
  }

  renderTick(now: number) {
    return this.serverTick(now) - this.delay;
  }
}
