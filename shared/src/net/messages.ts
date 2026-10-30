// Mã message nhị phân (room.sendBytes / onMessageBytes)
export const MsgBin = {
  Input: 1, // C→S
  Ping: 2, // C→S
  Snapshot: 10, // S→C
  Pong: 11, // S→C
} as const;

export enum Phase {
  Waiting = 0,
  Countdown = 1,
  Playing = 2,
  RoundEnd = 3,
  MatchEnd = 4,
}

// Message JSON (ít, không thường xuyên)
export interface RoomSettings {
  name: string;
  mode: '1v1';
  maxPlayers: number;
  winsNeeded: number;
  isPrivate: boolean;
  allowSpectate: boolean;
  maxSpectators: number;
}

export interface MemberInfo {
  sid: string;
  name: string;
  char: number;
  slot: number; // -1 = người xem
  ready: boolean;
  ping: number;
  connected: boolean;
  wins: number;
}

export interface RoomInfo {
  code: string;
  hostSid: string;
  settings: RoomSettings;
  members: MemberInfo[];
  status: 'waiting' | 'playing';
  rematch: string[]; // sid đã bấm đấu lại
  rematchDeadline: number; // ms epoch server, 0 = không
  matchWinner: number; // slot thắng trận, -1
}

export interface LobbyMeta {
  name: string;
  host: string;
  mode: '1v1';
  players: number;
  maxPlayers: number;
  spectators: number;
  status: 'waiting' | 'playing' | 'full';
  allowSpectate: boolean;
  code: string;
}

export interface JoinOptions {
  name: string;
  guestId: string;
  char: number;
  spectate?: boolean;
  settings?: Partial<RoomSettings>;
}

export interface ChatMsg {
  from: string;
  text: string;
  emoji?: boolean;
}
