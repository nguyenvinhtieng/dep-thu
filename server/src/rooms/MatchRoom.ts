import { Client, CloseCode, Room } from '@colyseus/core';
import {
  CHARACTERS, ChatMsg, decodePing, encodePong, JoinOptions, LobbyMeta, MATCH, MemberInfo, MsgBin, NET, Phase,
  ROOM_CODE_ALPHABET, RoomInfo, RoomSettings, sanitizeName, sanitizeText,
} from '@dep/shared';
import { ServerGame } from '../game/ServerGame';
import { Cooldown, isObj, MAX_ROOMS } from '../guard';

interface Member {
  client: Client;
  sid: string;
  guestId: string;
  name: string;
  char: number;
  slot: number; // -1 = người xem
  ready: boolean;
  ping: number;
  connected: boolean;
  order: number;
  strikes: number;
}

export const usedCodes = new Set<string>();
export const stats = { rooms: 0, bytesOut: 0, bytesIn: 0, tickSum: 0, tickN: 0, tickMax: 0 };

function newCode(): string {
  for (;;) {
    let c = '';
    for (let i = 0; i < 5; i++) c += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
    if (!usedCodes.has(c)) return c;
  }
}

export class MatchRoom extends Room {
  maxMessagesPerSecond = 120;

  private settings!: RoomSettings;
  private members = new Map<string, Member>();
  private hostSid = '';
  private order = 0;
  private game: ServerGame | null = null;
  private matchWinner = -1;
  private rematch = new Set<string>();
  private rematchDeadline = 0;
  private rematchTimer: ReturnType<typeof setTimeout> | null = null;
  private infoDirty = false;
  private chatCd = new Cooldown(NET.chatMinIntervalMs);
  private lastMeta = '';
  private snapBody: Uint8Array | null = null;

  onCreate(options: JoinOptions) {
    if (stats.rooms >= MAX_ROOMS) throw new Error('Server đầy phòng, thử lại sau');
    stats.rooms++;
    const code = newCode();
    usedCodes.add(code);
    this.roomId = code;
    // Colyseus giữ seat khi đang nối lại và tự xoá khi hết client + seat.
    this.autoDispose = true;
    const name = sanitizeName(options?.name) ?? 'Khách';
    this.settings = this.cleanSettings(options?.settings, {
      name: `Hẻm của ${name}`, mode: '1v1', maxPlayers: 2, winsNeeded: MATCH.defaultWinsNeeded,
      isPrivate: false, allowSpectate: true, maxSpectators: MATCH.defaultMaxSpectators,
    });
    this.maxClients = this.settings.maxPlayers + (this.settings.allowSpectate ? this.settings.maxSpectators : 0);
    if (this.settings.isPrivate) this.setPrivate(true);

    this.onMessageBytes(MsgBin.Input, (client: Client, bytes: Uint8Array) => this.handleInput(client, bytes));
    this.onMessageBytes(MsgBin.Ping, (client: Client, bytes: Uint8Array) => {
      const t = decodePing(bytes);
      if (t === null) return;
      client.sendBytes(MsgBin.Pong, encodePong(t, this.game?.state.tick ?? 0));
    });
    this.onMessage('rtt', (client, v) => {
      const m = this.members.get(client.sessionId);
      if (!m || typeof v !== 'number' || !Number.isFinite(v)) return;
      const ping = Math.max(0, Math.min(9999, Math.round(v)));
      if (Math.abs(ping - m.ping) >= 5) { m.ping = ping; this.infoDirty = true; }
    });
    this.onMessage('ready', (client, v) => this.setReady(client, v === true));
    this.onMessage('char', (client, v) => {
      const m = this.members.get(client.sessionId);
      if (!m || this.game || typeof v !== 'number' || !CHARACTERS[v]) return;
      m.char = v;
      this.markInfo();
    });
    this.onMessage('settings', (client, v) => {
      if (client.sessionId !== this.hostSid || this.game || !isObj(v)) return;
      this.settings = this.cleanSettings(v as Partial<RoomSettings>, this.settings);
      this.setPrivate(this.settings.isPrivate);
      this.maxClients = this.settings.maxPlayers + (this.settings.allowSpectate ? this.settings.maxSpectators : 0);
      for (const m of this.members.values()) m.ready = false;
      this.markInfo();
    });
    this.onMessage('kick', (client, sid) => {
      if (client.sessionId !== this.hostSid || typeof sid !== 'string' || sid === this.hostSid) return;
      const m = this.members.get(sid);
      if (!m) return;
      m.client.send('notice', { text: 'Bạn đã bị mời ra khỏi hẻm.' });
      m.client.leave(CloseCode.CONSENTED);
    });
    this.onMessage('host', (client, sid) => {
      if (client.sessionId !== this.hostSid || typeof sid !== 'string' || !this.members.has(sid)) return;
      this.hostSid = sid;
      this.markInfo();
    });
    this.onMessage('toPlay', (client) => {
      const m = this.members.get(client.sessionId);
      if (!m || m.slot >= 0 || this.game) return;
      const slot = this.freeSlot();
      if (slot < 0) return client.send('notice', { text: 'Hết chỗ chơi rồi, xem tiếp nha.' });
      m.slot = slot;
      m.ready = false;
      this.markInfo();
    });
    this.onMessage('toSpectate', (client) => {
      const m = this.members.get(client.sessionId);
      if (!m || m.slot < 0 || this.game) return;
      if (!this.settings.allowSpectate) return client.send('notice', { text: 'Phòng này không cho xem.' });
      m.slot = -1;
      m.ready = false;
      this.markInfo();
    });
    this.onMessage('chat', (client, v) => {
      const m = this.members.get(client.sessionId);
      if (!m || !isObj(v) || !this.chatCd.ok(client.sessionId)) return;
      const text = sanitizeText(v.text, 80);
      if (!text) return;
      const msg: ChatMsg = { from: m.name, text, emoji: v.emoji === true };
      this.broadcast('chat', msg);
    });
    this.onMessage('rematch', (client) => this.voteRematch(client));
    this.onMessage('*', () => {}); // bỏ qua message lạ

    // Vòng tick: setSimulationInterval gọi ~60 Hz; ServerGame tự chia tick cố định theo thời gian thực
    this.setSimulationInterval((dt) => this.update(dt), 1000 / 60);
    this.clock.setInterval(() => {
      this.game?.resetPacketCounters();
      if (this.infoDirty) this.flushInfo();
    }, 1000);
    this.clock.setInterval(() => { if (this.infoDirty) this.flushInfo(); }, 250);
    this.updateMeta();
  }

  // ---------- thành viên ----------

  onJoin(client: Client, options: JoinOptions) {
    let name = sanitizeName(options?.name);
    if (!name) throw new Error('Biệt danh không hợp lệ');
    const taken = new Set([...this.members.values()].map((m) => m.name));
    if (taken.has(name)) {
      let k = 2;
      while (taken.has(`${name} #${k}`)) k++;
      name = `${name} #${k}`;
    }
    const wantPlay = options?.spectate !== true;
    let slot = wantPlay && !this.game ? this.freeSlot() : -1;
    if (slot < 0 && !this.settings.allowSpectate) throw new Error('Phòng đầy và không cho xem');
    if (slot < 0 && this.spectatorCount() >= this.settings.maxSpectators) throw new Error('Phòng đầy');
    const char = typeof options?.char === 'number' && CHARACTERS[options.char] ? options.char : 0;
    const m: Member = {
      client, sid: client.sessionId, guestId: String(options?.guestId ?? '').slice(0, 64), name, char, slot,
      ready: false, ping: 0, connected: true, order: this.order++, strikes: 0,
    };
    this.members.set(client.sessionId, m);
    if (!this.hostSid) this.hostSid = client.sessionId;
    if (wantPlay && slot < 0) {
      client.send('notice', { text: this.game ? 'Trận đang đánh — bạn vào xem trước nha.' : 'Phòng đầy — bạn đang xem.' });
    }
    this.flushInfo();
    if (this.game) client.sendBytes(MsgBin.Snapshot, this.game.personalize(this.game.buildSnapshot(), slot));
  }

  async onDrop(client: Client) {
    const m = this.members.get(client.sessionId);
    if (!m) return;
    m.connected = false;
    if (this.game && m.slot >= 0) this.game.setConnected(m.slot, false);
    this.markInfo();
    try {
      const nc = await this.allowReconnection(client, NET.reconnectSeconds);
      m.client = nc;
    } catch {
      this.removeMember(client.sessionId, true);
    }
  }

  onReconnect(client: Client) {
    const m = this.members.get(client.sessionId);
    if (!m) return;
    m.client = client;
    m.connected = true;
    if (this.game && m.slot >= 0) this.game.setConnected(m.slot, true);
    this.flushInfo();
    if (this.game) client.sendBytes(MsgBin.Snapshot, this.game.personalize(this.game.buildSnapshot(), m.slot));
  }

  onLeave(client: Client) {
    this.removeMember(client.sessionId, false);
  }

  onDispose() {
    usedCodes.delete(this.roomId);
    stats.rooms--;
    if (this.rematchTimer) clearTimeout(this.rematchTimer);
  }

  private removeMember(sid: string, timedOut: boolean) {
    const m = this.members.get(sid);
    if (!m) return;
    this.members.delete(sid);
    this.chatCd.delete(sid);
    this.rematch.delete(sid);
    if (this.game && m.slot >= 0 && this.game.phase !== Phase.MatchEnd) {
      // 1v1: người còn lại thắng trận
      const other = [...this.members.values()].find((o) => o.slot >= 0);
      if (other) {
        this.broadcast('notice', { text: `${m.name} ${timedOut ? 'mất sóng quá lâu' : 'đã bỏ chạy'} — ${other.name} thắng!` });
        this.game.forfeit(other.slot);
      } else {
        this.endGame();
      }
    }
    if (this.hostSid === sid) {
      const next = [...this.members.values()].sort((a, b) => a.order - b.order)[0];
      this.hostSid = next?.sid ?? '';
    }
    if (this.members.size === 0) {
      this.endGame();
    }
    this.flushInfo();
  }

  private freeSlot(): number {
    const used = new Set([...this.members.values()].map((m) => m.slot));
    for (let i = 0; i < this.settings.maxPlayers; i++) if (!used.has(i)) return i;
    return -1;
  }

  private spectatorCount() {
    let n = 0;
    for (const m of this.members.values()) if (m.slot < 0) n++;
    return n;
  }

  private players() {
    return [...this.members.values()].filter((m) => m.slot >= 0);
  }

  private cleanSettings(v: Partial<RoomSettings> | undefined, base: RoomSettings): RoomSettings {
    const s = { ...base };
    if (!isObj(v)) return s;
    const name = sanitizeText(v.name, 28);
    if (name) s.name = name;
    if (typeof v.winsNeeded === 'number' && (MATCH.winsOptions as readonly number[]).includes(v.winsNeeded)) s.winsNeeded = v.winsNeeded;
    if (typeof v.isPrivate === 'boolean') s.isPrivate = v.isPrivate;
    if (typeof v.allowSpectate === 'boolean') s.allowSpectate = v.allowSpectate;
    if (typeof v.maxSpectators === 'number') s.maxSpectators = Math.max(0, Math.min(MATCH.defaultMaxSpectators, Math.floor(v.maxSpectators)));
    s.mode = '1v1';
    s.maxPlayers = 2;
    return s;
  }

  // ---------- trận ----------

  private setReady(client: Client, ready: boolean) {
    const m = this.members.get(client.sessionId);
    if (!m || m.slot < 0 || this.game) return;
    m.ready = ready;
    this.markInfo();
    const ps = this.players();
    if (ps.length === this.settings.maxPlayers && ps.every((p) => p.ready && p.connected)) this.startGame();
  }

  private startGame() {
    const ps = this.players();
    this.matchWinner = -1;
    this.rematch.clear();
    this.rematchDeadline = 0;
    this.game = new ServerGame(this.settings.maxPlayers, ps.map((p) => p.slot), this.settings.winsNeeded, {
      onRoundEnd: () => {},
      onMatchEnd: (w) => {
        this.matchWinner = w;
        this.rematchDeadline = Date.now() + MATCH.rematchTimeoutMs;
        if (this.rematchTimer) clearTimeout(this.rematchTimer);
        this.rematchTimer = setTimeout(() => this.endGame(), MATCH.rematchTimeoutMs);
        this.markInfo();
      },
    });
    for (const p of ps) this.game.setConnected(p.slot, p.connected);
    this.flushInfo();
  }

  private voteRematch(client: Client) {
    const m = this.members.get(client.sessionId);
    if (!m || m.slot < 0 || !this.game || this.game.phase !== Phase.MatchEnd) return;
    this.rematch.add(m.sid);
    const ps = this.players();
    if (ps.length === this.settings.maxPlayers && ps.every((p) => this.rematch.has(p.sid))) {
      if (this.rematchTimer) clearTimeout(this.rematchTimer);
      this.rematchTimer = null;
      this.startGame();
    } else {
      this.markInfo();
    }
  }

  /** Về phòng chờ. */
  private endGame() {
    if (this.rematchTimer) clearTimeout(this.rematchTimer);
    this.rematchTimer = null;
    if (!this.game) return;
    this.game = null;
    this.matchWinner = -1;
    this.rematch.clear();
    this.rematchDeadline = 0;
    for (const m of this.members.values()) m.ready = false;
    this.markInfo();
  }

  private handleInput(client: Client, bytes: Uint8Array) {
    const m = this.members.get(client.sessionId);
    if (!m || m.slot < 0 || !this.game) return; // người xem: bỏ qua input gameplay
    stats.bytesIn += bytes.byteLength;
    if (!this.game.onInput(m.slot, bytes)) {
      if (++m.strikes > 200) client.leave(CloseCode.WITH_ERROR);
    }
  }

  private update(dt: number) {
    const g = this.game;
    if (!g) return;
    g.update(dt, (tick) => {
      const toPlayers = tick % NET.snapshotEveryTicks === 0;
      const toSpecs = tick % NET.spectatorSnapshotEveryTicks === 0;
      if (!toPlayers && !toSpecs) return;
      this.snapBody = g.buildSnapshot();
      for (const m of this.members.values()) {
        if (!m.connected) continue;
        if (m.slot >= 0 ? !toPlayers : !toSpecs) continue;
        const b = g.personalize(this.snapBody, m.slot);
        stats.bytesOut += b.byteLength;
        m.client.sendBytes(MsgBin.Snapshot, b);
      }
    });
    if (g.tickTimeMs.n >= 60) {
      stats.tickSum += g.tickTimeMs.sum;
      stats.tickN += g.tickTimeMs.n;
      stats.tickMax = Math.max(stats.tickMax, g.tickTimeMs.max);
      g.tickTimeMs.sum = g.tickTimeMs.n = g.tickTimeMs.max = 0;
    }
  }

  // ---------- thông tin phòng ----------

  private markInfo() {
    this.infoDirty = true;
  }

  private flushInfo() {
    this.infoDirty = false;
    const members: MemberInfo[] = [...this.members.values()]
      .sort((a, b) => a.order - b.order)
      .map((m) => ({
        sid: m.sid, name: m.name, char: m.char, slot: m.slot, ready: m.ready, ping: m.ping, connected: m.connected,
        wins: m.slot >= 0 && this.game ? this.game.wins[m.slot] : 0,
      }));
    const info: RoomInfo = {
      code: this.roomId, hostSid: this.hostSid, settings: this.settings, members,
      status: this.game ? 'playing' : 'waiting', rematch: [...this.rematch], rematchDeadline: this.rematchDeadline,
      matchWinner: this.matchWinner,
    };
    this.broadcast('info', info);
    this.updateMeta();
  }

  private updateMeta() {
    const ps = this.players().length;
    const host = this.members.get(this.hostSid)?.name ?? '';
    const meta: LobbyMeta = {
      name: this.settings.name, host, mode: '1v1', players: ps, maxPlayers: this.settings.maxPlayers,
      spectators: this.spectatorCount(), allowSpectate: this.settings.allowSpectate, code: this.roomId,
      status: this.game ? 'playing' : ps >= this.settings.maxPlayers ? 'full' : 'waiting',
    };
    const key = JSON.stringify(meta);
    if (key === this.lastMeta) return;
    this.lastMeta = key;
    this.setMetadata(meta);
  }
}
