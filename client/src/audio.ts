/** Âm thanh tạm bằng WebAudio (không cần file). */
let ctx: AudioContext | null = null;
let muted = localStorage.getItem('dep.mute') === '1';

function ac(): AudioContext | null {
  if (muted) return null;
  if (!ctx) {
    try { ctx = new AudioContext(); } catch { return null; }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(freq: number, dur: number, type: OscillatorType, vol: number, slide = 0) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur);
}

function noise(dur: number, vol: number, hp = 800) {
  const c = ac();
  if (!c) return;
  const n = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = c.createBufferSource();
  s.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = hp;
  const g = c.createGain();
  g.gain.value = vol;
  s.connect(f).connect(g).connect(c.destination);
  s.start();
}

export const sfx = {
  throw: () => noise(0.12, 0.25, 1500),
  hit: () => { tone(140, 0.18, 'square', 0.25, 0.5); noise(0.08, 0.3, 400); },
  catch: () => { tone(880, 0.08, 'triangle', 0.25); setTimeout(() => tone(1320, 0.1, 'triangle', 0.2), 60); },
  bounce: () => tone(420, 0.05, 'triangle', 0.12),
  jump: () => tone(300, 0.08, 'sine', 0.08, 1.8),
  pickup: () => tone(660, 0.06, 'sine', 0.15, 1.3),
  ko: () => tone(220, 0.5, 'sawtooth', 0.2, 0.3),
  beep: (hi = false) => tone(hi ? 880 : 520, 0.12, 'square', 0.12),
  catchStart: () => tone(240, 0.05, 'sine', 0.06),
  dodge: () => noise(0.14, 0.12, 2400),
  perfect: () => { tone(990, 0.07, 'triangle', 0.18, 1.2); setTimeout(() => tone(1480, 0.12, 'triangle', 0.16), 70); },
  get muted() { return muted; },
  setMuted(v: boolean) {
    muted = v;
    try { localStorage.setItem('dep.mute', v ? '1' : '0'); } catch { /* bỏ qua */ }
  },
};
