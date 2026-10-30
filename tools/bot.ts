/**
 * Bot headless dùng đúng NetMatch của client (dự đoán, nội suy, input buffer) để thử online không cần trình duyệt.
 *   npm run bots                                  # 2 bot tự tạo phòng và đánh nhau
 *   npm run bots -- --lag 120 --jitter 30 --loss 2 --matches 2
 *   npm run bots -- --join ABCDE                  # 1 bot vào phòng do người tạo
 */
import { Client, Room } from '@colyseus/sdk';
import { Btn, Ev, MsgBin, Phase, RoomInfo, SlipperState } from '@dep/shared';
import { NetMatch } from '../client/src/net/match';
import { Pipe } from '../client/src/net/netsim';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) args.set(a.slice(2), process.argv[i + 1]?.startsWith('--') ? '1' : process.argv[++i] ?? '1');
}
const num = (k: string, d: number) => (args.has(k) ? Number(args.get(k)) : d);
const SERVER = args.get('server') ?? 'http://localhost:2567';
const SIM = { lag: num('lag', 0), jitter: num('jitter', 0), loss: num('loss', 0) };
const MATCHES = num('matches', 1);
const MAX_SEC = num('duration', 300);

class Bot {
  room!: Room;
  info: RoomInfo | null = null;
  match: NetMatch | null = null;
  fx: Record<string, number> = {};
  matchesDone = 0;
  done = false;
  private pin = new Pipe(SIM.lag || SIM.jitter || SIM.loss ? SIM : null);
  private pout = new Pipe(SIM.lag || SIM.jitter || SIM.loss ? SIM : null);
  private hold = 0;
  private holdFor = 0;
  private dir = 0;
  private dirUntil = 0;
  private t = 0;
  private wasEnd = false;
  private errMax = 0;
  private errMaxClean = 0; // bỏ lúc mình đang bị choáng vì trúng dép (knockback do server quyết)

  constructor(readonly name: string, private rnd: () => number) {}

  async connect(fn: (c: Client) => Promise<Room>) {
    this.room = await fn(new Client(SERVER));
    const r = this.room;
    r.onMessage('info', (i: RoomInfo) => this.onInfo(i));
    r.onMessage('chat', () => {});
    r.onMessage('notice', (m: { text: string }) => this.log('notice:', m.text));
    r.onMessage(MsgBin.Snapshot, (b: Uint8Array) => this.pin.push(() => this.onSnap(b)));
    r.onMessage(MsgBin.Pong, (b: Uint8Array) => this.pin.push(() => this.match?.handlePong(b, performance.now())));
    r.onLeave((code: number) => { this.log('rời phòng', code); this.done = true; });
    return r;
  }

  log(...a: unknown[]) {
    console.log(`[${this.name}]`, ...a);
  }

  private me() {
    return this.info?.members.find((m) => m.sid === this.room.sessionId);
  }

  private onInfo(i: RoomInfo) {
    this.info = i;
    const me = this.me();
    if (me && me.slot >= 0 && !me.ready && i.status === 'waiting') this.room.send('ready', true);
  }

  private onSnap(b: Uint8Array) {
    if (!this.match) {
      const me = this.me();
      if (!me) return;
      this.match = new NetMatch({
        sendInput: (x) => this.pout.push(() => this.room.sendBytes(MsgBin.Input, x)),
        sendPing: (x) => this.pout.push(() => this.room.sendBytes(MsgBin.Ping, x)),
      }, me.slot);
      this.match.onFx = (e) => {
        if (e.local) return;
        const k = Ev[e.type];
        this.fx[k] = (this.fx[k] ?? 0) + 1;
      };
      this.log('trận bắt đầu, slot', me.slot);
    }
    this.match.handleSnapshot(b, performance.now());
    if (process.env.DBG && this.match.stats.reconcileErr > 20) {
      const L = this.match.latest!;
      this.log('DBG err', this.match.stats.reconcileErr.toFixed(1), 'tick', L.full, 'phase', Phase[L.phase], 'frozen', L.frozen, 'round', L.round,
        'ack', L.ackSeq, 'seq', this.match.pred.seq, 'p', L.players[this.match.slot].x, L.players[this.match.slot].y, 'hp', L.players[this.match.slot].hp, 'stun', L.players[this.match.slot].stun);
    }
    const end = this.match.latest?.phase === Phase.MatchEnd;
    if (end && !this.wasEnd) {
      this.matchesDone++;
      const w = this.info?.members.find((m) => m.slot === this.match!.latest!.players.findIndex((p) => p.active && p.alive));
      this.log(`HẾT TRẬN #${this.matchesDone} — thắng: ${w?.name ?? '?'}; tỉ số`, this.match.latest!.players.map((p) => p.wins).join('-'));
      if (this.matchesDone < MATCHES) setTimeout(() => this.room.send('rematch'), 300 + this.rnd() * 500);
      else this.done = true;
    }
    this.wasEnd = end;
  }

  /** AI đơn giản: giữ khoảng cách, gồng rồi ném về phía đối thủ, bấm bắt khi dép bay tới gần. */
  tick(now: number) {
    const m = this.match;
    if (!m) return;
    const v = m.view(now);
    let b = 0;
    if (v && v.phase === Phase.Playing && m.slot >= 0) {
      this.t++;
      const me = v.players[m.slot];
      const op = v.players.find((p) => p.active && !p.me);
      if (me?.alive && op) {
        const dx = op.x - me.x;
        const face = dx > 0 ? Btn.Right : Btn.Left;
        if (this.t > this.dirUntil) {
          const d = Math.abs(dx);
          this.dir = d > 520 ? face : d < 220 ? (face === Btn.Right ? Btn.Left : Btn.Right) : this.rnd() < 0.5 ? 0 : this.rnd() < 0.5 ? Btn.Left : Btn.Right;
          this.dirUntil = this.t + 10 + this.rnd() * 40;
        }
        let pick = false;
        if (me.ammo < 2) {
          // thiếu dép → đi tới chiếc nằm đất gần nhất rồi bấm nhặt
          let best: number | null = null;
          for (const s of v.slippers) if (s.state === SlipperState.Grounded && Math.abs(s.y - me.y) < 60 && (best === null || Math.abs(s.x - me.x) < Math.abs(best - me.x))) best = s.x;
          if (best !== null && (me.ammo === 0 || Math.abs(best - me.x) < 200)) {
            if (Math.abs(best - me.x) > 20) this.dir = best > me.x ? Btn.Right : Btn.Left;
            else { this.dir = 0; pick = this.t % 8 === 0; }
          }
        }
        b |= this.dir;
        if (pick && me.pickLock === 0) b |= Btn.Pickup;
        if (this.rnd() < 0.008) b |= Btn.Jump;
        if (me.ammo > 0 && me.throwCd === 0) {
          if (!this.hold) { this.hold = 1; this.holdFor = 6 + this.rnd() * 40; }
          if (this.hold++ < this.holdFor) b = (b & ~(Btn.Left | Btn.Right)) | Btn.Throw | (this.hold < 4 ? face : 0);
          else this.hold = 0;
        } else this.hold = 0;
        for (const s of v.slippers) {
          if (s.state !== SlipperState.Flying || !s.harmful || s.owner === m.slot) continue;
          const sx = s.x - me.x;
          if (Math.abs(sx) < 140 && Math.sign(s.vx) === -Math.sign(sx)) {
            const r = this.rnd();
            if (r < 0.5) b |= Btn.Catch;
            else if (r < 0.65 && me.dodgeCd === 0) b |= Btn.Dodge;
          }
        }
      }
      this.errMax = Math.max(this.errMax, m.stats.reconcileErr);
      if (m.latest?.phase === Phase.Playing && !m.latest.frozen && m.latest.players[m.slot].stun === 0) this.errMaxClean = Math.max(this.errMaxClean, m.stats.reconcileErr);
    }
    m.update(now, b);
  }

  report() {
    const m = this.match;
    if (!m) return this.log('chưa vào trận');
    const s = m.stats;
    const c = m.clock;
    this.log(`rtt ${m.rtt.toFixed(0)}ms jitter ${(c.jitter * 1000 / 60).toFixed(1)}ms interp ${(c.delay * 1000 / 60).toFixed(0)}ms`
      + ` buf ${s.bufferLen} snap/s ${s.snapsPerSec.toFixed(0)} in ${(s.inBps / 1024).toFixed(2)}KB/s out ${(s.outBps / 1024).toFixed(2)}KB/s`
      + ` reconcile max ${this.errMax.toFixed(1)}px (ngoài lúc bị trúng ${this.errMaxClean.toFixed(1)}px) phase ${Phase[m.latest?.phase ?? 0]} hp ${m.latest?.players.map((p) => p.hp).join('/')}`
      + ` fx ${JSON.stringify(this.fx)}`);
    this.errMax = this.errMaxClean = 0;
  }
}

function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

async function main() {
  console.log(`server ${SERVER} · netsim ${JSON.stringify(SIM)} · ${MATCHES} trận`);
  const bots: Bot[] = [];
  const join = args.get('join');
  if (join) {
    const b = new Bot('bot', rng(7));
    await b.connect((c) => c.joinById(join.toUpperCase(), { name: 'Bot Hẻm', guestId: 'bot-1', char: 2 }));
    bots.push(b);
  } else {
    const a = new Bot('A', rng(1));
    const r = await a.connect((c) => c.create('match', { name: 'Bot A', guestId: 'bot-a', char: 0, settings: { name: 'Bot test', winsNeeded: num('wins', 2), isPrivate: true } }));
    console.log('mã phòng', r.roomId, '(mở trình duyệt ?room=' + r.roomId + ' để xem)');
    const b = new Bot('B', rng(2));
    await b.connect((c) => c.joinById(r.roomId, { name: 'Bot B', guestId: 'bot-b', char: 1 }));
    bots.push(a, b);
  }
  const loop = setInterval(() => {
    const now = performance.now();
    for (const b of bots) b.tick(now);
  }, 4);
  const rep = setInterval(() => bots.forEach((b) => b.report()), 5000);
  const t0 = Date.now();
  await new Promise<void>((res) => {
    const chk = setInterval(() => {
      if (bots.every((b) => b.done) || Date.now() - t0 > MAX_SEC * 1000) { clearInterval(chk); res(); }
    }, 200);
  });
  clearInterval(loop);
  clearInterval(rep);
  bots.forEach((b) => b.report());
  const ok = bots.every((b) => b.matchesDone >= MATCHES);
  console.log(ok ? 'XONG: đủ số trận.' : 'HẾT GIỜ trước khi xong trận.');
  await Promise.all(bots.map((b) => b.room.leave().catch(() => {})));
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
