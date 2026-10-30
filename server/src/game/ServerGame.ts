import {
  aliveCount, CATCH, createRound, decodeInput, encodeSnapshot, Ev, GameState, MATCH, NET, NetEvent, Phase,
  seqDiff, SimEvent, SlipperState, step, StepHooks, TICK_HZ, writeAck,
} from '@dep/shared';

const HISTORY = 16; // tick (~266 ms) — đủ cho tua tối đa 120 ms

interface SlotInput {
  queue: Map<number, number>; // seq → nút
  expected: number; // seq kế tiếp cần xử lý; -1 = chưa có input nào
  lastAck: number;
  lastButtons: number;
  rewind: number; // tick tua lại khi xét bắt (lag compensation)
  packets: number; // gói trong giây hiện tại
}

export interface GameCallbacks {
  onRoundEnd(winnerSlot: number): void;
  onMatchEnd(winnerSlot: number): void;
}

/** Vòng tick 60 Hz của một trận: input buffer, mô phỏng, lịch sử cho lag comp, snapshot nhị phân. */
export class ServerGame {
  state: GameState;
  phase = Phase.Countdown;
  phaseLeft = 0;
  round = 0;
  wins: number[];
  connected: boolean[];
  winsNeeded: number;
  tickTimeMs = { sum: 0, max: 0, n: 0 };

  private inputs: SlotInput[];
  private acc = 0;
  private tick = 0;
  private events: (NetEvent & { tick: number })[] = [];
  private eventId = 0;
  private simOut: SimEvent[] = [];
  private inputArr: number[];
  private history: { x: number; y: number; state: SlipperState }[][] = [];
  private hooks: StepHooks;

  constructor(private slotCount: number, private activeSlots: number[], winsNeeded: number, private cb: GameCallbacks) {
    this.winsNeeded = winsNeeded;
    this.wins = new Array(slotCount).fill(0);
    this.connected = new Array(slotCount).fill(true);
    this.inputArr = new Array(slotCount).fill(0);
    this.inputs = Array.from({ length: slotCount }, () => ({
      queue: new Map(), expected: -1, lastAck: 0, lastButtons: 0, rewind: 0, packets: 0,
    }));
    this.state = createRound(slotCount, activeSlots, 0);
    this.hooks = {
      pastSlipper: (p, s) => {
        const r = this.inputs[p].rewind;
        if (r <= 0) return undefined;
        return this.history[(this.state.tick - r + HISTORY * 1000) % HISTORY]?.[s];
      },
    };
    this.startRound();
  }

  startRound() {
    this.round++;
    this.state = createRound(this.slotCount, this.activeSlots, this.tick);
    this.state.frozen = true;
    this.phase = Phase.Countdown;
    this.phaseLeft = MATCH.countdownTicks;
    this.history.length = 0;
  }

  /** Nhận gói input. Trả false nếu gói sai/spam (để room cảnh báo/kick). */
  onInput(slot: number, buf: Uint8Array): boolean {
    const si = this.inputs[slot];
    if (!si) return false;
    if (++si.packets > NET.maxInputPacketsPerSec) return false;
    const pkt = decodeInput(buf);
    if (!pkt) return false;
    const n = pkt.buttons.length;
    const first = (pkt.seq - (n - 1)) & 0xffff;
    if (si.expected < 0) si.expected = first;
    for (let i = 0; i < n; i++) {
      const seq = (first + i) & 0xffff;
      const d = seqDiff(seq, si.expected);
      if (d >= 0 && d < 64) si.queue.set(seq, pkt.buttons[i]);
    }
    // Lag compensation: client đang nhìn thấy thế giới tại viewTick
    const behind = seqDiff(this.state.tick & 0xffff, pkt.viewTick);
    si.rewind = Math.max(0, Math.min(behind, CATCH.maxRewindTicks));
    return true;
  }

  resetPacketCounters() {
    for (const si of this.inputs) si.packets = 0;
  }

  setConnected(slot: number, on: boolean) {
    this.connected[slot] = on;
    if (!on) {
      const si = this.inputs[slot];
      si.lastButtons = 0;
      si.queue.clear();
      si.expected = -1;
    }
  }

  ackFor(slot: number) {
    return this.inputs[slot]?.lastAck ?? 0;
  }

  /** Gọi với thời gian thực đã trôi; chạy số tick cố định tương ứng (tối đa 5). */
  update(deltaMs: number, onTick: (tick: number) => void) {
    this.acc += deltaMs;
    let steps = 0;
    while (this.acc >= 1000 / TICK_HZ && steps < 5) {
      this.acc -= 1000 / TICK_HZ;
      steps++;
      const t0 = performance.now();
      this.fixedTick();
      const dt = performance.now() - t0;
      this.tickTimeMs.sum += dt;
      this.tickTimeMs.n++;
      if (dt > this.tickTimeMs.max) this.tickTimeMs.max = dt;
      onTick(this.tick);
    }
    if (this.acc > 1000) this.acc = 0;
  }

  private popInputs() {
    for (let i = 0; i < this.slotCount; i++) {
      const si = this.inputs[i];
      if (si.expected >= 0) {
        // client chạy nhanh hơn → bỏ bớt input cũ để không tích trễ
        while (si.queue.size > NET.serverInputBufferMax) {
          si.queue.delete(si.expected);
          si.expected = (si.expected + 1) & 0xffff;
        }
        const b = si.queue.get(si.expected);
        if (b !== undefined) {
          si.queue.delete(si.expected);
          si.lastAck = si.expected;
          si.expected = (si.expected + 1) & 0xffff;
          si.lastButtons = b;
        }
        // thiếu input: lặp nút đang giữ (cạnh nhấn/thả không lặp vì so với prevButtons)
      }
      this.inputArr[i] = this.connected[i] ? si.lastButtons : 0;
    }
  }

  private fixedTick() {
    this.tick++;
    this.popInputs();
    const s = this.state;

    // lịch sử vị trí dép (trước khi step) cho lag compensation
    const h = (this.history[s.tick % HISTORY] ??= []);
    for (let i = 0; i < s.slippers.length; i++) {
      const d = s.slippers[i];
      const e = (h[i] ??= { x: 0, y: 0, state: SlipperState.Held });
      e.x = d.x; e.y = d.y; e.state = d.state;
    }
    h.length = s.slippers.length;

    this.simOut.length = 0;
    step(s, this.inputArr, this.simOut, this.hooks);
    for (const e of this.simOut) {
      if (e.type === Ev.Land) continue; // client tự suy ra, tiết kiệm băng thông
      this.events.push({ ...e, id: (this.eventId = (this.eventId + 1) & 0xffff), tick: this.tick });
    }
    const keepTicks = NET.eventRepeat * NET.snapshotEveryTicks + NET.spectatorSnapshotEveryTicks;
    while (this.events.length && this.tick - this.events[0].tick > keepTicks) this.events.shift();
    if (this.events.length > 24) this.events.splice(0, this.events.length - 24);

    if (this.phaseLeft > 0) this.phaseLeft--;
    switch (this.phase) {
      case Phase.Countdown:
        if (this.phaseLeft === 0) {
          this.phase = Phase.Playing;
          s.frozen = false;
        }
        break;
      case Phase.Playing:
        if (aliveCount(s) <= 1) {
          const w = s.players.findIndex((p) => p.active && p.alive);
          this.endRound(w);
        }
        break;
      case Phase.RoundEnd:
        if (this.phaseLeft === 0) this.startRound();
        break;
    }
  }

  private endRound(winner: number) {
    this.state.frozen = true;
    if (winner >= 0) this.wins[winner]++;
    this.cb.onRoundEnd(winner);
    if (winner >= 0 && this.wins[winner] >= this.winsNeeded) {
      this.phase = Phase.MatchEnd;
      this.phaseLeft = 0;
      this.cb.onMatchEnd(winner);
    } else {
      this.phase = Phase.RoundEnd;
      this.phaseLeft = MATCH.roundEndTicks;
    }
  }

  /** Kết thúc trận ngay (đối thủ rời/mất kết nối quá 30 s). */
  forfeit(winner: number) {
    if (this.phase === Phase.MatchEnd) return;
    this.state.frozen = true;
    this.wins[winner] = Math.max(this.wins[winner], this.winsNeeded);
    this.phase = Phase.MatchEnd;
    this.phaseLeft = 0;
    this.cb.onMatchEnd(winner);
  }

  /** Thân snapshot dùng chung; mỗi người nhận ghi ackSeq riêng. */
  buildSnapshot(): Uint8Array {
    return encodeSnapshot(
      this.state,
      { phase: this.phase, phaseLeft: this.phaseLeft, round: this.round, connected: this.connected, wins: this.wins },
      this.events,
    );
  }

  personalize(body: Uint8Array, slot: number): Uint8Array {
    const b = body.slice();
    writeAck(b, slot >= 0 ? this.ackFor(slot) : 0);
    return b;
  }
}
