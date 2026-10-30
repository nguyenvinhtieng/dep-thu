import { NAME } from './config';

// Ký tự điều khiển, zero-width, bidi
const CTRL_RE = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u206f\\ufeff]', 'g');

const BANNED = ['dm', 'dmm', 'đm', 'đmm', 'vcl', 'vkl', 'clm', 'cc', 'lồn', 'cặc', 'buồi', 'địt'];

/** Làm sạch biệt danh: bỏ ký tự điều khiển/zero-width, gộp khoảng trắng, cắt độ dài, chặn từ cấm. */
export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let s = raw.normalize('NFC').replace(CTRL_RE, '');
  s = s.replace(/\s+/g, ' ').trim();
  s = Array.from(s).slice(0, NAME.max).join('');
  if (Array.from(s).length < NAME.min) return null;
  const words = s.toLowerCase().split(/[\s._-]+/);
  if (words.some((w) => BANNED.includes(w))) return null;
  return s;
}

export function sanitizeText(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.normalize('NFC').replace(CTRL_RE, '').trim();
  if (!s) return null;
  return Array.from(s).slice(0, max).join('');
}

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const isRoomCode = (s: string) => /^[A-HJ-NP-Z2-9]{5}$/.test(s);

export const NICK_SUGGESTIONS = [
  'Chú Tư Xe Ôm', 'Bé Na Lớp 3', 'Cô Ba Bún Bò', 'Ông Bảy Cờ Tướng', 'Anh Sáu Shipper',
  'Dì Năm Bánh Mì', 'Thằng Tèo', 'Con Mén', 'Bác Hai Sửa Xe', 'Chị Út Trà Đá',
];
