import { Btn } from '@dep/shared';

export type Action = 'left' | 'right' | 'jump' | 'throw' | 'catch' | 'pickup' | 'dodge';

export const ACTIONS: { id: Action; label: string; btn: Btn }[] = [
  { id: 'left', label: 'Sang trái', btn: Btn.Left },
  { id: 'right', label: 'Sang phải', btn: Btn.Right },
  { id: 'jump', label: 'Nhảy', btn: Btn.Jump },
  { id: 'throw', label: 'Ném (giữ để gồng)', btn: Btn.Throw },
  { id: 'catch', label: 'Bắt dép', btn: Btn.Catch },
  { id: 'pickup', label: 'Nhặt dép (cúi)', btn: Btn.Pickup },
  { id: 'dodge', label: 'Lăn né', btn: Btn.Dodge },
];

const DEFAULT: Record<Action, string[]> = {
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['KeyW', 'ArrowUp', 'Space'],
  throw: ['KeyJ', 'KeyF'],
  catch: ['KeyK', 'KeyG'],
  pickup: ['KeyS', 'ArrowDown'],
  dodge: ['KeyL', 'ShiftLeft'],
};

const STORE = 'dep.keys.v1';

/** Bàn phím → bitmask action. Chặn cuộn trang bằng phím chơi, trừ khi đang gõ trong ô nhập. */
export class Input {
  binds: Record<Action, string[]>;
  enabled = false;
  private down = new Set<string>();
  private codeMap = new Map<string, Btn>();
  private onCapture: ((code: string) => void) | null = null;

  constructor() {
    this.binds = load();
    this.rebuild();
    window.addEventListener('keydown', this.kd, { capture: true });
    window.addEventListener('keyup', this.ku, { capture: true });
    window.addEventListener('blur', () => this.clear());
    document.addEventListener('visibilitychange', () => document.hidden && this.clear());
  }

  buttons(): number {
    if (!this.enabled) return 0;
    let b = 0;
    for (const c of this.down) b |= this.codeMap.get(c) ?? 0;
    // trái + phải cùng lúc = đứng yên
    if ((b & (Btn.Left | Btn.Right)) === (Btn.Left | Btn.Right)) b &= ~(Btn.Left | Btn.Right);
    return b;
  }

  clear() {
    this.down.clear();
  }

  /** Chờ phím kế tiếp để gán (Esc = hủy). */
  capture(cb: (code: string | null) => void) {
    this.onCapture = (code) => {
      this.onCapture = null;
      cb(code === 'Escape' ? null : code);
    };
  }

  setBind(a: Action, slot: number, code: string) {
    for (const k of Object.keys(this.binds) as Action[]) this.binds[k] = this.binds[k].filter((c) => c !== code);
    const list = this.binds[a];
    list[slot] = code;
    this.binds[a] = list.filter(Boolean);
    this.save();
  }

  reset() {
    this.binds = structuredClone(DEFAULT);
    this.save();
  }

  private save() {
    this.rebuild();
    try { localStorage.setItem(STORE, JSON.stringify(this.binds)); } catch { /* bỏ qua */ }
  }

  private rebuild() {
    this.codeMap.clear();
    for (const a of ACTIONS) for (const c of this.binds[a.id]) this.codeMap.set(c, a.btn);
  }

  private kd = (e: KeyboardEvent) => {
    if (this.onCapture) {
      e.preventDefault();
      e.stopPropagation();
      this.onCapture(e.code);
      return;
    }
    if (isTyping(e.target)) return;
    if (!this.codeMap.has(e.code)) return;
    if (this.enabled) e.preventDefault();
    this.down.add(e.code);
  };

  private ku = (e: KeyboardEvent) => {
    this.down.delete(e.code);
  };
}

function isTyping(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

function load(): Record<Action, string[]> {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? 'null');
    if (v && typeof v === 'object') {
      // Gộp với mặc định: action mới (nhặt, lăn) lấy phím mặc định nếu phím đó chưa bị dùng
      const binds = structuredClone(DEFAULT);
      const used = new Set<string>();
      for (const a of ACTIONS) {
        const list = v[a.id];
        if (Array.isArray(list) && list.every((c: unknown) => typeof c === 'string')) {
          binds[a.id] = list;
          list.forEach((c: string) => used.add(c));
        } else binds[a.id] = [];
      }
      for (const a of ACTIONS) if (!Array.isArray(v[a.id])) binds[a.id] = DEFAULT[a.id].filter((c) => !used.has(c));
      return binds;
    }
  } catch { /* dùng mặc định */ }
  return structuredClone(DEFAULT);
}

/** Tên phím dễ đọc cho màn hướng dẫn. */
export function keyName(code: string): string {
  const map: Record<string, string> = {
    ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Space: 'Space', Enter: 'Enter',
    ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Ctrl', ControlRight: 'Ctrl', AltLeft: 'Alt', AltRight: 'Alt',
    Slash: '/', Period: '.', Comma: ',', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']',
  };
  if (map[code]) return map[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num' + code.slice(6);
  return code;
}
