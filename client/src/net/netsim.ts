/**
 * Giả lập mạng xấu cho dev: ?lag=120&jitter=30&loss=2
 * - lag: ms thêm vào RTT (mỗi chiều lag/2)
 * - jitter: ± ms ngẫu nhiên mỗi gói
 * - loss: % gói "mất". WebSocket là TCP nên gói mất thực tế = trễ thêm (truyền lại) và giữ thứ tự (head-of-line).
 */
export interface NetSimOpts {
  lag: number;
  jitter: number;
  loss: number;
}

export function parseNetSim(search: string): NetSimOpts | null {
  const q = new URLSearchParams(search);
  const n = (k: string) => Math.max(0, Number(q.get(k)) || 0);
  const o = { lag: n('lag'), jitter: n('jitter'), loss: Math.min(n('loss'), 50) };
  return o.lag || o.jitter || o.loss ? o : null;
}

/** Một chiều truyền: hàng đợi giữ thứ tự. */
export class Pipe {
  private last = 0;
  constructor(private o: NetSimOpts | null) {}
  push(fn: () => void) {
    const o = this.o;
    if (!o) return fn();
    let d = o.lag / 2 + (Math.random() * 2 - 1) * o.jitter;
    if (Math.random() * 100 < o.loss) d += Math.max(o.lag, 100) + 50; // truyền lại
    const now = performance.now();
    const at = Math.max(now + Math.max(0, d), this.last);
    this.last = at;
    setTimeout(fn, at - now);
  }
}
