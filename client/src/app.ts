import { Client, Room } from '@colyseus/sdk';
import Phaser from 'phaser';
import {
  CHARACTERS, ChatMsg, MemberInfo, decodePong, encodePing, isRoomCode, JoinOptions, LobbyMeta, MATCH, MsgBin, NAME, NICK_SUGGESTIONS,
  NET, Phase, RoomInfo, RoomSettings, sanitizeName, WORLD,
} from '@dep/shared';
import { Input, keyName } from './input/input';
import { NetMatch } from './net/match';
import { parseNetSim, Pipe } from './net/netsim';
import { MatchScene } from './scenes/MatchScene';
import { h, hex, mount, toast } from './ui/dom';
import { helpModal, prefs } from './ui/help';

interface Listing {
  roomId: string;
  clients: number;
  maxClients: number;
  metadata?: LobbyMeta;
}

const EMOJIS = ['👏', '😂', '😡', '🩴', '👍', 'GG'];
const ROLES = ['Tay lái đầu hẻm', 'Cao thủ quán bún', 'Nhỏ mà có võ', 'Gừng càng già càng cay', 'Giao dép siêu tốc'];

const characterArt = (id: number) => h('span', {
  class: 'character-art', 'aria-hidden': 'true',
  style: `--art-x:${(id % 3) * 50}%;--art-y:${Math.floor(id / 3) * 100}%;background-image:url("${import.meta.env.BASE_URL}art/alley-cast-v2.png")`,
});
const avatar = (id: number, lg = false) =>
  h('span', { class: 'ava' + (lg ? ' lg' : ''), style: `--c:${hex(CHARACTERS[id]?.color ?? 0x999999)}` }, characterArt(id));
const RC_KEY = 'dep.rc';

function endpoint() {
  const q = new URLSearchParams(location.search).get('server');
  if (q) return q;
  if (import.meta.env.DEV) return `${location.protocol}//${location.hostname}:2567`;
  return location.origin;
}

/** Điều phối màn hình DOM + kết nối Colyseus + scene Phaser. */
export class App {
  private client = new Client(endpoint());
  private input = new Input();
  private ui = document.getElementById('ui')!;
  private hudbar = document.getElementById('hudbar')!;
  private game: Phaser.Game;
  private scene!: MatchScene;
  private sim = parseNetSim(location.search);
  private pipeIn = new Pipe(this.sim);
  private pipeOut = new Pipe(this.sim);

  private profile = loadProfile();
  private lobby: Room | null = null;
  private rooms = new Map<string, Listing>();
  private room: Room | null = null;
  private info: RoomInfo | null = null;
  private chatLog: ChatMsg[] = [];
  private match: NetMatch | null = null;
  private rtt = 0;
  private lastPing = 0;
  private lastRttSent = 0;
  private screen: 'name' | 'lobby' | 'room' | 'match' = 'name';
  private leaving = false;
  private joining = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshRoom: (() => void) | null = null;
  private refreshLobby: (() => void) | null = null;
  private appendChat: ((m: ChatMsg) => void) | null = null;
  private resultBox: HTMLElement | null = null;

  constructor() {
    this.game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: 'game',
      width: WORLD.width,
      height: WORLD.height,
      backgroundColor: '#1d1a24',
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      scene: [MatchScene],
      fps: { smoothStep: true },
      banner: false,
      disableContextMenu: true,
    });
    this.game.events.once(Phaser.Core.Events.READY, () => {
      this.scene = this.game.scene.getScene('match') as MatchScene;
    });
    setInterval(() => this.netTick(), 4);
    if (this.sim) toast(`Giả lập mạng: +${this.sim.lag} ms, jitter ±${this.sim.jitter} ms, mất ${this.sim.loss}%`, 5000);
    window.addEventListener('beforeunload', () => {
      // giữ token để F5 vào lại đúng phòng
      if (this.room) sessionStorage.setItem(RC_KEY, this.room.reconnectionToken);
    });
  }

  async start() {
    const token = sessionStorage.getItem(RC_KEY);
    if (token && this.profile.name) {
      sessionStorage.removeItem(RC_KEY);
      try {
        const r = await this.client.reconnect(token);
        toast('Đã vào lại phòng.');
        return this.enterRoom(r);
      } catch { /* hết hạn → vào sảnh */ }
    }
    if (this.profile.name) this.showLobby();
    else this.showName();
  }

  // ---------------- Vòng mạng ----------------

  private netTick() {
    if (!this.room?.connection?.isOpen) return;
    const now = performance.now();
    const m = this.match;
    if (m) m.update(now, this.input.buttons());
    else if (this.room && now - this.lastPing > 1000) {
      this.lastPing = now;
      const b = encodePing(now);
      const room = this.room;
      this.pipeOut.push(() => { if (this.room === room && room.connection.isOpen) room.sendBytes(MsgBin.Ping, b); });
    }
    if (this.room && now - this.lastRttSent > 2000) {
      this.lastRttSent = now;
      const r = Math.round(m ? m.rtt : this.rtt);
      if (r > 0) this.room.send('rtt', r);
    }
  }

  // ---------------- Màn nhập tên ----------------

  private showName(after?: () => void) {
    this.screen = 'name';
    this.setGameVisible(false);
    const name = h('input', {
      value: this.profile.name || NICK_SUGGESTIONS[Math.floor(Math.random() * NICK_SUGGESTIONS.length)],
      maxlength: NAME.max, placeholder: 'Biệt danh', class: 'grow big', autofocus: true, 'aria-label': 'Biệt danh',
    });
    let char = this.profile.char;
    const chars = h('div', { class: 'chars' });
    const drawChars = () => chars.replaceChildren(...CHARACTERS.map((c) => h('button', {
      class: c.id === char ? 'sel' : '', style: `--c:${hex(c.color)}`, 'aria-pressed': c.id === char ? 'true' : 'false', onclick: () => { char = c.id; drawChars(); },
    }, h('span', { class: 'portrait' }, characterArt(c.id)), h('span', { class: 'character-name' }, c.name), h('span', { class: 'character-role' }, ROLES[c.id]))));
    drawChars();
    const err = h('div', { class: 'small', style: 'min-height:20px;margin-top:6px;color:var(--red-d);font-weight:600' });
    const go = () => {
      const n = sanitizeName(name.value);
      if (!n) return void (err.textContent = `Tên ${NAME.min}–${NAME.max} ký tự, không chứa từ cấm.`);
      this.profile.name = n;
      this.profile.char = char;
      saveProfile(this.profile);
      if (after) after(); else this.showLobby();
    };
    name.addEventListener('keydown', (e) => e.key === 'Enter' && go());
    mount(this.ui, h('div', { class: 'narrow' },
      h('div', { class: 'hero' },
        h('h1', { class: 'logo' }, h('img', { class: 'brand-mark', src: '/brand/slipper.svg', alt: '', width: 64, height: 64 }), 'DÉP THỦ'),
        h('div', null, h('span', { class: 'sticker' }, 'ĐẤU DÉP 1v1 ONLINE')),
        h('p', null, 'Tan ca rồi, ra hẻm làm một trận! Gồng, ném, bắt dép — ai trúng 3 phát là gục.')),
      h('div', { class: 'card' },
        h('h3', null, 'Biệt danh của bạn'),
        h('div', { class: 'row' }, name),
        err,
        h('h3', null, 'Chọn cao thủ'),
        chars,
        h('div', { class: 'row', style: 'margin-top:26px' },
          h('button', { class: 'ghost', onclick: () => helpModal(this.input) }, 'Cách chơi & phím'),
          h('span', { class: 'grow' }),
          h('button', { class: 'primary big', onclick: go }, 'Vào hẻm →'))),
    ));
    name.focus();
    name.select();
  }

  // ---------------- Sảnh ----------------

  private async showLobby() {
    this.screen = 'lobby';
    this.setGameVisible(false);
    const code = new URLSearchParams(location.search).get('room')?.toUpperCase();
    if (code && isRoomCode(code)) {
      history.replaceState(null, '', location.pathname + stripParam(location.search, 'room'));
      return this.joinRoom(() => this.client.joinById(code, this.joinOpts()));
    }

    const list = h('div', { class: 'rooms' });
    const codeIn = h('input', { placeholder: 'VD: AB12C', maxlength: 5, class: 'grow', 'aria-label': 'Mã phòng', style: 'text-transform:uppercase;font:800 18px ui-monospace,Menlo,monospace;letter-spacing:3px' });
    const roomName = h('input', { placeholder: `Hẻm của ${this.profile.name}`, maxlength: 24, class: 'grow', 'aria-label': 'Tên phòng' });
    const wins = h('select', null, ...MATCH.winsOptions.map((w) => h('option', { value: String(w), selected: w === MATCH.defaultWinsNeeded }, `Chạm ${w}`)));
    const priv = h('input', { type: 'checkbox' });
    const spec = h('input', { type: 'checkbox', checked: true });
    const joinCode = () => {
      const c = codeIn.value.trim().toUpperCase();
      if (!isRoomCode(c)) return toast('Mã phòng gồm 5 ký tự.');
      this.joinRoom(() => this.client.joinById(c, this.joinOpts()));
    };
    codeIn.addEventListener('keydown', (e) => e.key === 'Enter' && joinCode());
    const create = () => this.joinRoom(() => this.client.create('match', this.joinOpts({
      settings: {
        name: roomName.value.trim() || undefined, winsNeeded: Number(wins.value), isPrivate: priv.checked, allowSpectate: spec.checked,
      } as Partial<RoomSettings>,
    })));

    this.refreshLobby = () => {
      const rows = [...this.rooms.values()].filter((r) => r.metadata);
      if (!rows.length) {
        list.replaceChildren(h('div', { class: 'empty' }, h('b', null, 'Hẻm đang vắng'), 'Chưa có phòng nào mở — bấm Chơi nhanh để tự mở một phòng.'));
        return;
      }
      list.replaceChildren(...rows.map((r) => {
        const m = r.metadata!;
        const st = m.status === 'waiting' ? h('span', { class: 'tag ok' }, 'Đang chờ') : m.status === 'full' ? h('span', { class: 'tag warn' }, 'Đủ người') : h('span', { class: 'tag bad' }, 'Đang đánh');
        return h('div', { class: 'room-row' },
          h('div', { class: 'grow' },
            h('div', { class: 'name' }, m.name),
            h('div', { class: 'muted small' }, `Chủ phòng ${m.host} · mã ${m.code}`)),
          h('span', { class: 'tag' }, `👤 ${m.players}/${m.maxPlayers}`, m.spectators ? ` · 👀 ${m.spectators}` : ''),
          st,
          h('div', { class: 'row actions', style: 'gap:6px' },
            h('button', { class: 'small', disabled: !m.allowSpectate, onclick: () => this.joinRoom(() => this.client.joinById(r.roomId, this.joinOpts({ spectate: true }))) }, 'Xem'),
            h('button', { class: 'small primary', disabled: m.status !== 'waiting', onclick: () => this.joinRoom(() => this.client.joinById(r.roomId, this.joinOpts())) }, 'Vào chơi')),
        );
      }));
    };

    const c = CHARACTERS[this.profile.char];
    mount(this.ui, h('div', { class: 'shell' },
      h('div', { class: 'topbar' },
        h('h1', { class: 'logo sm grow' }, h('img', { class: 'brand-mark', src: '/brand/slipper.svg', alt: '', width: 36, height: 36 }), 'DÉP THỦ'),
        h('button', { class: 'small', onclick: () => helpModal(this.input) }, '⌨️ Phím'),
        h('div', { class: 'profile' },
          avatar(this.profile.char),
          h('div', null, h('b', null, this.profile.name), h('div', { class: 'muted', style: 'font-size:11px;line-height:1.1' }, c.name)),
          h('button', { class: 'small', onclick: () => this.showName() }, 'Đổi'))),
      h('div', { class: 'cols' },
        h('div', { class: 'stack' },
          h('div', { class: 'tiles' },
            h('div', { class: 'card tile quick' },
              h('div', null, h('div', { class: 'display' }, 'Chơi nhanh'), h('div', { class: 'small', style: 'color:#5a4310' }, 'Ghép ngay vào phòng đang chờ, không có thì tự mở phòng.')),
              h('button', { class: 'primary big', onclick: () => this.quickPlay() }, '⚡ Vào trận')),
            h('div', { class: 'card tile' },
              h('div', null, h('div', { class: 'display' }, 'Có mã phòng?'), h('div', { class: 'muted small' }, 'Nhập mã 5 ký tự bạn bè gửi.')),
              h('div', { class: 'row', style: 'flex-wrap:nowrap' }, codeIn, h('button', { onclick: joinCode }, 'Vào')))),
          h('div', { class: 'card' },
            h('h3', null, 'Phòng đang mở'),
            list)),
        h('div', { class: 'stack' },
          h('div', { class: 'card' },
            h('h3', null, 'Mở phòng riêng'),
            h('div', { class: 'row' }, roomName),
            h('div', { class: 'row', style: 'margin-top:10px' }, wins, h('label', null, priv, 'Riêng tư'), h('label', null, spec, 'Cho xem')),
            h('button', { class: 'grow', style: 'width:100%;margin-top:14px', onclick: create }, 'Tạo phòng')),
          h('div', { class: 'card' },
            h('button', { class: 'ghost', onclick: () => helpModal(this.input) }, '⚙ Cài đặt & phím tắt'))),
      ),
    ));
    this.refreshLobby();
    await this.connectLobby();
  }

  private async connectLobby() {
    if (this.lobby) return;
    try {
      const lobby = await this.client.joinOrCreate('lobby');
      if (this.screen !== 'lobby') return void lobby.leave();
      this.lobby = lobby;
      lobby.onMessage('rooms', (rooms: Listing[]) => {
        this.rooms.clear();
        for (const r of rooms) this.rooms.set(r.roomId, r);
        this.refreshLobby?.();
      });
      lobby.onMessage('+', ([id, r]: [string, Listing]) => {
        this.rooms.set(id, r);
        this.refreshLobby?.();
      });
      lobby.onMessage('-', (id: string) => {
        this.rooms.delete(id);
        this.refreshLobby?.();
      });
      lobby.onLeave(() => { this.lobby = null; });
    } catch (e) {
      toast('Không nối được server: ' + errMsg(e));
    }
  }

  private leaveLobby() {
    const l = this.lobby;
    this.lobby = null;
    this.rooms.clear();
    if (l) void l.leave();
  }

  private async quickPlay() {
    return this.joinRoom(async () => {
      const open = [...this.rooms.values()].filter((r) => r.metadata?.status === 'waiting' && r.metadata.players < r.metadata.maxPlayers);
      open.sort((a, b) => b.metadata!.players - a.metadata!.players);
      for (const r of open) {
        try {
          return await this.client.joinById(r.roomId, this.joinOpts());
        } catch { /* phòng vừa đầy → thử phòng khác */ }
      }
      return this.client.create('match', this.joinOpts());
    });
  }

  private joinOpts(extra: Partial<JoinOptions> = {}): JoinOptions {
    return { name: this.profile.name, guestId: this.profile.guestId, char: this.profile.char, ...extra };
  }

  private async joinRoom(fn: () => Promise<Room>) {
    if (this.joining || this.room) return;
    this.joining = true;
    try {
      this.enterRoom(await fn());
    } catch (e) {
      toast('Không vào được phòng: ' + errMsg(e));
      if (this.screen !== 'lobby') this.showLobby();
    } finally {
      this.joining = false;
    }
  }

  // ---------------- Phòng ----------------

  private enterRoom(room: Room) {
    if (this.room === room) return;
    this.clearReconnectTimer();
    const previous = this.room;
    this.room = null;
    if (previous) {
      this.endMatch();
      void previous.leave(true).catch(() => {});
    }
    this.leaveLobby();
    this.room = room;
    this.info = null;
    this.chatLog = [];
    this.leaving = false;
    room.onMessage('info', (info: RoomInfo) => { if (this.room === room) this.onInfo(info); });
    room.onMessage('chat', (m: ChatMsg) => {
      if (this.room !== room) return;
      this.chatLog.push(m);
      if (this.chatLog.length > 60) this.chatLog.shift();
      this.appendChat?.(m);
    });
    room.onMessage('notice', (m: { text: string }) => { if (this.room === room) toast(m.text, 4000); });
    room.onMessage(MsgBin.Snapshot, (b: Uint8Array) => this.pipeIn.push(() => { if (this.room === room) this.onSnapshot(b); }));
    room.onMessage(MsgBin.Pong, (b: Uint8Array) => this.pipeIn.push(() => { if (this.room === room) this.onPong(b); }));
    room.onDrop?.(() => {
      if (this.room !== room || this.reconnectTimer) return;
      toast('Mất sóng — đang nối lại…', 6000);
      this.reconnectTimer = setTimeout(() => {
        if (this.room !== room) return;
        toast('Không nối lại được — đã về sảnh.', 4000);
        this.leaveRoom();
      }, NET.reconnectSeconds * 1000);
    });
    room.onReconnect?.(() => {
      if (this.room !== room) return;
      this.clearReconnectTimer();
      toast('Đã nối lại.');
    });
    room.onLeave((code: number) => {
      if (this.room !== room) return;
      this.clearReconnectTimer();
      this.room = null;
      this.endMatch();
      sessionStorage.removeItem(RC_KEY);
      if (!this.leaving && code !== 1000) toast('Rời phòng (mã ' + code + ').', 4000);
      this.showLobby();
    });
    history.replaceState(null, '', location.pathname + stripParam(location.search, 'room'));
    this.showRoom();
  }

  private leaveRoom() {
    const room = this.room;
    if (!room) return;
    this.leaving = true;
    this.clearReconnectTimer();
    this.room = null;
    sessionStorage.removeItem(RC_KEY);
    this.endMatch();
    void room.leave(true).catch(() => {});
    void this.showLobby();
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private me() {
    return this.info?.members.find((m) => m.sid === this.room?.sessionId);
  }

  private onInfo(info: RoomInfo) {
    const was = this.info?.status;
    this.info = info;
    if (was === 'playing' && info.status === 'waiting') {
      this.endMatch();
      this.showRoom();
      return;
    }
    if (this.screen === 'room') this.refreshRoom?.();
    if (this.screen === 'match') this.refreshResult();
  }

  private showRoom() {
    this.screen = 'room';
    this.setGameVisible(false);
    this.hudbar.classList.remove('on');
    this.game.scale.refresh();
    const stage = h('div', { class: 'stage' });
    const watchers = h('div');
    const settingsBox = h('div');
    const actions = h('div', { class: 'stack' });
    const head = h('div', { class: 'room-head' });
    const log = h('div', { class: 'log' }, h('div', { class: 'empty' }, 'Chưa ai nói gì. Chào đối thủ một câu đi!'));
    const chatIn = h('input', { class: 'grow', maxlength: 80, placeholder: 'Nhắn gì đó… (Enter)' });
    const send = (text: string, emoji = false) => {
      if (!text.trim()) return;
      this.room?.send('chat', { text, emoji });
    };
    chatIn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { send(chatIn.value); chatIn.value = ''; }
    });
    this.appendChat = (m) => {
      log.querySelector('.empty')?.remove();
      const mine = m.from === this.me()?.name;
      log.append(h('div', { class: mine ? 'mine' : '' }, mine ? '' : h('b', null, m.from + ': '), m.emoji ? h('span', { style: 'font-size:22px' }, m.text) : m.text));
      log.scrollTop = log.scrollHeight;
    };
    for (const m of this.chatLog) this.appendChat(m);

    this.refreshRoom = () => {
      const info = this.info;
      const me = this.me();
      if (!info || !me) return;
      const isHost = info.hostSid === me.sid;
      const s = info.settings;
      const link = `${location.origin}${location.pathname}?room=${info.code}`;
      head.replaceChildren(
        h('div', { class: 'grow' },
          h('h2', null, s.name),
          h('div', { class: 'chips' },
            h('span', { class: 'tag' }, '1v1'), h('span', { class: 'tag' }, `Chạm ${s.winsNeeded}`),
            h('span', { class: 'tag' }, s.isPrivate ? '🔒 Riêng tư' : '🌐 Công khai'), h('span', { class: 'tag' }, s.allowSpectate ? '👀 Cho xem' : 'Không cho xem'))),
        h('div', { class: 'ticket' },
          h('div', null, h('div', { class: 'muted' }, 'MÃ PHÒNG'), h('div', { class: 'code' }, info.code)),
          h('button', { class: 'small', onclick: () => copy(link) }, 'Chép link mời')),
      );

      const hostBtns = (m: MemberInfo) => isHost && m.sid !== me.sid
        ? h('div', { class: 'slot-actions' },
          h('button', { class: 'small', onclick: () => this.room?.send('host', m.sid) }, 'Trao chủ'),
          h('button', { class: 'small danger', onclick: () => this.room?.send('kick', m.sid) }, 'Mời ra'))
        : '';
      const slotCard = (slot: number) => {
        const m = info.members.find((x) => x.slot === slot);
        if (!m) {
          return h('div', { class: 'slot vacant' }, h('div', { class: 'q' }, '?'), h('b', null, 'Đang chờ đối thủ'),
            h('div', { class: 'small' }, `Gửi mã ${info.code} cho bạn bè`));
        }
        const c = CHARACTERS[m.char] ?? CHARACTERS[0];
        return h('div', { class: 'slot' + (m.ready ? ' ready' : ''), style: `--c:${hex(c.color)}` },
          h('div', { class: 'slot-top' },
            h('span', { class: 'tag' }, `P${slot + 1}`, m.sid === info.hostSid ? ' 👑' : ''),
            h('span', { class: 'muted small' }, m.ping ? `${m.ping} ms` : '')),
          h('div', { class: 'portrait' }, characterArt(m.char)),
          h('div', { class: 'slot-name' }, m.name, m.sid === me.sid ? h('span', { class: 'muted', style: 'font-size:14px' }, ' (bạn)') : ''),
          h('div', { class: 'muted small' }, c.name),
          h('div', { style: 'margin-top:6px' }, !m.connected ? h('span', { class: 'tag bad' }, '📶 Mất sóng') : m.ready ? h('span', { class: 'tag ok' }, '✓ Sẵn sàng') : h('span', { class: 'tag' }, 'Chưa sẵn sàng')),
          hostBtns(m));
      };
      stage.replaceChildren(slotCard(0), h('div', { class: 'vs' }, 'VS'), slotCard(1));

      const specs = info.members.filter((m) => m.slot < 0);
      watchers.replaceChildren();
      if (specs.length) {
        watchers.append(h('h3', null, `Người xem (${specs.length})`), h('div', { class: 'rooms' }, ...specs.map((m) => h('div', { class: 'room-row', style: 'padding:8px 12px' },
          avatar(m.char), h('div', { class: 'grow' }, h('b', null, m.name), m.sid === info.hostSid ? ' 👑' : '', m.sid === me.sid ? h('span', { class: 'muted' }, ' (bạn)') : ''),
          !m.connected ? h('span', { class: 'tag bad' }, 'Mất sóng') : '', hostBtns(m)))));
      }

      settingsBox.replaceChildren();
      if (isHost && info.status === 'waiting') {
        const wins = h('select', { onchange: (e: Event) => this.room?.send('settings', { winsNeeded: Number((e.target as HTMLSelectElement).value) }) },
          ...MATCH.winsOptions.map((w) => h('option', { value: String(w), selected: w === s.winsNeeded }, `Chạm ${w}`)));
        const priv = h('input', { type: 'checkbox', checked: s.isPrivate, onchange: (e: Event) => this.room?.send('settings', { isPrivate: (e.target as HTMLInputElement).checked }) });
        const spec = h('input', { type: 'checkbox', checked: s.allowSpectate, onchange: (e: Event) => this.room?.send('settings', { allowSpectate: (e.target as HTMLInputElement).checked }) });
        settingsBox.append(h('h3', null, 'Cài đặt phòng'), h('div', { class: 'row' }, wins, h('label', null, priv, 'Riêng tư'), h('label', null, spec, 'Cho xem')));
      }

      const players = info.members.filter((m) => m.slot >= 0);
      const playing = me.slot >= 0;
      const waiting = info.status === 'waiting';
      const pickChar = (id: number) => {
        this.profile.char = id;
        saveProfile(this.profile);
        this.room?.send('char', id);
      };
      const status = info.status === 'playing' ? 'Trận đang diễn ra…' : players.length < 2 ? 'Chờ thêm người chơi…'
        : players.every((p) => p.ready) ? 'Chuẩn bị vào trận!' : me.ready ? 'Chờ đối thủ sẵn sàng…' : playing ? 'Bấm Sẵn sàng khi bạn chuẩn bị xong.' : 'Chờ hai người chơi sẵn sàng.';
      actions.replaceChildren(
        h('div', { class: 'actionbar' },
          playing
            ? h('button', { class: 'big ' + (me.ready ? '' : 'primary'), style: 'min-width:200px', onclick: () => this.room?.send('ready', !me.ready) }, me.ready ? 'Hủy sẵn sàng' : 'Sẵn sàng!')
            : h('button', { class: 'big primary', disabled: players.length >= s.maxPlayers, onclick: () => this.room?.send('toPlay') }, 'Vào chơi'),
          h('span', { class: 'status grow' }, status),
          playing && s.allowSpectate ? h('button', { class: 'small', onclick: () => this.room?.send('toSpectate') }, 'Chuyển sang xem') : ''),
        h('div', null,
          h('h3', null, 'Đổi nhân vật'),
          h('div', { class: 'mini-chars' }, ...CHARACTERS.map((c) => h('button', {
            class: c.id === me.char ? 'sel' : '', style: `--c:${hex(c.color)}`, title: c.name, 'aria-label': c.name, 'aria-pressed': c.id === me.char ? 'true' : 'false',
            disabled: !waiting, onclick: () => pickChar(c.id),
          }, characterArt(c.id))))),
      );
    };

    mount(this.ui, h('div', { class: 'shell stack' },
      h('div', { class: 'topbar', style: 'margin:0' },
        h('button', { class: 'small', onclick: () => this.leaveRoom() }, '← Rời phòng'),
        h('span', { class: 'grow' }),
        h('h1', { class: 'logo sm' }, h('img', { class: 'brand-mark', src: '/brand/slipper.svg', alt: '', width: 36, height: 36 }), 'DÉP THỦ')),
      h('div', { class: 'card' }, head),
      h('div', { class: 'cols' },
        h('div', { class: 'stack' },
          stage,
          h('div', { class: 'card' }, actions, settingsBox, watchers,
            h('button', { class: 'ghost', style: 'margin-top:16px', onclick: () => helpModal(this.input) }, '⚙ Cài đặt & phím tắt'))),
        h('div', { class: 'card chat' },
          h('h3', null, 'Trò chuyện'),
          log,
          h('div', { class: 'emojis' }, ...EMOJIS.map((e) => h('button', { class: 'small', onclick: () => send(e, true) }, e))),
          h('div', { class: 'row', style: 'margin-top:10px' }, chatIn)),
      ),
    ));
    this.refreshRoom();
  }

  // ---------------- Trận ----------------

  private onSnapshot(b: Uint8Array) {
    if (!this.room) return;
    if (!this.match) {
      const me = this.me();
      if (!me) return; // chưa có info → bỏ snapshot này
      this.startMatch(me.slot);
    }
    this.match!.handleSnapshot(b, performance.now());
    const ph = this.match!.latest?.phase;
    if (ph === Phase.MatchEnd && !this.resultBox) this.showResult();
    if (ph !== Phase.MatchEnd && this.resultBox) this.hideResult();
  }

  private onPong(b: Uint8Array) {
    if (this.match) return this.match.handlePong(b, performance.now());
    const r = performance.now() - decodePong(b).t;
    this.rtt = this.rtt ? this.rtt + (r - this.rtt) * 0.3 : r;
  }

  private startMatch(slot: number) {
    const room = this.room!;
    this.match = new NetMatch({
      sendInput: (b) => this.pipeOut.push(() => { if (this.room === room && room.connection.isOpen) room.sendBytes(MsgBin.Input, b); }),
      sendPing: (b) => this.pipeOut.push(() => { if (this.room === room && room.connection.isOpen) room.sendBytes(MsgBin.Ping, b); }),
    }, slot);
    this.screen = 'match';
    this.input.clear();
    this.input.enabled = slot >= 0;
    mount(this.ui);
    this.ui.classList.add('hidden');
    this.setGameVisible(true);
    this.showHudbar();
    const slotNames = () => {
      const a: string[] = [];
      for (const m of this.info?.members ?? []) if (m.slot >= 0) a[m.slot] = m.name;
      return a;
    };
    const slotChars = () => {
      const a: number[] = [];
      for (const m of this.info?.members ?? []) if (m.slot >= 0) a[m.slot] = m.char;
      return a;
    };
    this.scene?.bind({
      match: this.match,
      names: slotNames,
      chars: slotChars,
      winsNeeded: () => this.info?.settings.winsNeeded ?? MATCH.defaultWinsNeeded,
      shake: () => prefs.shake,
      pickupKey: () => keyName(this.input.binds.pickup[0] ?? ''),
    });
  }

  private endMatch() {
    this.match = null;
    this.input.enabled = false;
    this.input.clear();
    this.scene?.bind(null);
    this.hideResult();
    this.hudbar.classList.remove('on');
    this.game.scale.refresh();
    this.ui.classList.remove('hidden', 'over-game');
  }

  private showHudbar() {
    this.appendChat = () => {};
    const menu = h('details', { class: 'match-menu' });
    const settings = () => {
      menu.removeAttribute('open');
      this.input.clear();
      this.input.enabled = false;
      helpModal(this.input, () => {
        this.input.clear();
        this.input.enabled = this.screen === 'match' && (this.match?.slot ?? -1) >= 0;
      });
    };
    menu.append(
      h('summary', { 'aria-label': 'Menu trận đấu' }, '☰ Menu'),
      h('div', { class: 'match-menu-panel' },
        h('button', { onclick: settings }, '⚙ Cài đặt & phím tắt'),
        h('button', { onclick: () => this.leaveRoom() }, '← Rời trận'),
      ),
    );
    mount(this.hudbar,
      h('span', { class: 'match-hint' }, 'Giữ khoảng cách · Canh nhịp ném · Lăn né phản công'),
      menu,
    );
    this.hudbar.classList.add('on');
    this.game.scale.refresh();
  }

  private showResult() {
    this.resultBox = h('div', { class: 'card narrow result' });
    mount(this.ui, this.resultBox);
    this.ui.classList.remove('hidden');
    this.ui.classList.add('over-game');
    this.refreshResult();
  }

  private refreshResult() {
    const box = this.resultBox;
    const info = this.info;
    if (!box || !info) return;
    const me = this.me();
    const winner = info.members.find((m) => m.slot === info.matchWinner);
    const players = info.members.filter((m) => m.slot >= 0);
    const left = Math.max(0, Math.ceil((info.rematchDeadline - Date.now()) / 1000));
    const voted = me ? info.rematch.includes(me.sid) : false;
    const won = !!winner && winner.sid === me?.sid;
    const need = Math.max(1, players.length);
    box.replaceChildren(
      h('span', { class: 'sticker' }, 'HẾT TRẬN'),
      h('div', { class: 'display', style: `color:${won ? 'var(--red)' : 'var(--ink)'}` }, winner ? (won ? '🏆 Bạn thắng!' : `${winner.name} thắng!`) : 'Trận kết thúc'),
      h('div', { class: 'score' }, ...players.sort((a, b) => a.slot - b.slot).flatMap((p, i) => [
        i ? h('span', { class: 'n muted' }, '–') : '',
        h('div', { class: 'p' }, avatar(p.char, true), h('span', { class: 'n' }, p.wins), p.name),
      ])),
      h('div', { class: 'small muted' }, `Đấu lại: ${info.rematch.length}/${players.length}` + (info.rematchDeadline ? ` · còn ${left}s` : '')),
      h('div', { class: 'meter' }, h('i', { style: `width:${Math.min(100, info.rematch.length / need * 100)}%` })),
      h('div', { class: 'row', style: 'justify-content:center' },
        h('button', { class: 'big', onclick: () => this.leaveRoom() }, 'Về sảnh'),
        me && me.slot >= 0 ? h('button', { class: 'primary big', disabled: voted, onclick: () => this.room?.send('rematch') }, voted ? 'Chờ đối thủ…' : 'Đấu lại') : ''),
    );
  }

  private hideResult() {
    if (!this.resultBox) return;
    this.resultBox = null;
    if (this.screen === 'match') {
      mount(this.ui);
      this.ui.classList.add('hidden');
      this.ui.classList.remove('over-game');
    }
  }

  private setGameVisible(on: boolean) {
    document.getElementById('game')!.style.visibility = on ? 'visible' : 'hidden';
    if (!on) this.ui.classList.remove('hidden', 'over-game');
  }
}

function loadProfile() {
  let p: { name: string; char: number; guestId: string } = { name: '', char: 0, guestId: '' };
  try { p = { ...p, ...JSON.parse(localStorage.getItem('dep.profile') ?? '{}') }; } catch { /* mặc định */ }
  if (!p.guestId) p.guestId = crypto.randomUUID?.() ?? String(Math.random()).slice(2);
  if (!CHARACTERS[p.char]) p.char = 0;
  return p;
}

function saveProfile(p: ReturnType<typeof loadProfile>) {
  try { localStorage.setItem('dep.profile', JSON.stringify(p)); } catch { /* bỏ qua */ }
}

function stripParam(search: string, key: string) {
  const q = new URLSearchParams(search);
  q.delete(key);
  const s = q.toString();
  return s ? '?' + s : '';
}

function copy(text: string) {
  navigator.clipboard?.writeText(text).then(() => toast('Đã chép link mời.'), () => toast(text, 8000));
}

function errMsg(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}
