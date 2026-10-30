/** Rate limit đơn giản theo khoảng cách tối thiểu giữa 2 lần (ms). */
export class Cooldown {
  private last = new Map<string, number>();
  constructor(private minIntervalMs: number) {}
  ok(key: string, now = Date.now()): boolean {
    const t = this.last.get(key) ?? 0;
    if (now - t < this.minIntervalMs) return false;
    this.last.set(key, now);
    return true;
  }
  delete(key: string) {
    this.last.delete(key);
  }
}

export const MAX_ROOMS = Number(process.env.MAX_ROOMS ?? 500);

export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
