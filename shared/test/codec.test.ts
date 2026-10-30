import { describe, expect, it } from 'vitest';
import {
  Btn, createRound, decodeInput, decodePing, decodeSnapshot, encodeInput, encodePing, encodeSnapshot,
  NetEvent, Phase, seqDiff, seqNewer, SlipperState, step, writeAck, Ev,
} from '../src';

describe('codec', () => {
  it('input encode → decode khớp, gói nhỏ', () => {
    const buf = encodeInput(65535, 1234, [1, 2, 3, 4, 5, 31], 6);
    expect(buf.byteLength).toBe(11);
    const d = decodeInput(buf)!;
    expect(d.seq).toBe(65535);
    expect(d.viewTick).toBe(1234);
    expect(d.buttons).toEqual([1, 2, 3, 4, 5, 31]);
  });

  it('input sai độ dài bị từ chối', () => {
    expect(decodeInput(new Uint8Array([0, 1, 0, 1, 9, 1]))).toBeNull();
    expect(decodeInput(new Uint8Array(3))).toBeNull();
    expect(decodeInput(new Uint8Array([0, 1, 0, 1, 0]))).toBeNull();
  });

  it('ping', () => {
    expect(decodePing(encodePing(123.5))).toBe(123.5);
    expect(decodePing(new Uint8Array(3))).toBeNull();
  });

  it('snapshot encode → decode khớp state', () => {
    const s = createRound(2, [0, 1]);
    for (let t = 0; t < 40; t++) step(s, [t < 20 ? Btn.Throw | Btn.Right : Btn.Jump, Btn.Left], []);
    expect(s.slippers.some((d) => d.state === SlipperState.Flying)).toBe(true);
    const events: NetEvent[] = [{ id: 7, type: Ev.Hit, a: 1, b: 2, c: 0, x: 500, y: 600 }];
    const buf = encodeSnapshot(s, { phase: Phase.Playing, phaseLeft: 99, round: 2, connected: [true, false], wins: [1, 2] }, events);
    writeAck(buf, 4321);
    const d = decodeSnapshot(buf);
    expect(d.tick).toBe(s.tick);
    expect(d.ackSeq).toBe(4321);
    expect(d.phase).toBe(Phase.Playing);
    expect(d.round).toBe(2);
    expect(d.players[1].connected).toBe(false);
    expect(d.players[1].wins).toBe(2);
    for (let i = 0; i < 2; i++) {
      const { connected: _c, wins: _w, ...p } = d.players[i];
      expect(p).toEqual(s.players[i]);
    }
    s.slippers.forEach((sl, i) => {
      if (sl.state === SlipperState.Held) {
        expect(d.slippers[i].owner).toBe(sl.owner);
      } else {
        expect(d.slippers[i]).toEqual(sl);
      }
    });
    expect(d.events).toEqual(events);
  });

  it('snapshot 1v1 trong ngân sách băng thông (< 4 KB/s ở 30 Hz)', () => {
    const s = createRound(2, [0, 1]);
    for (const d of s.slippers) { d.state = SlipperState.Flying; d.x = 100; d.y = 100; }
    const ev: NetEvent[] = Array.from({ length: 3 }, (_, i) => ({ id: i, type: Ev.Throw, a: 0, b: 0, c: 0, x: 1, y: 1 }));
    const buf = encodeSnapshot(s, { phase: Phase.Playing, phaseLeft: 0, round: 1, connected: [true, true], wins: [0, 0] }, ev);
    // + ~8 byte khung WebSocket/Colyseus
    expect((buf.byteLength + 8) * 30).toBeLessThan(4096);
  });

  it('seq u16 quấn vòng', () => {
    expect(seqNewer(2, 65534)).toBe(true);
    expect(seqNewer(65534, 2)).toBe(false);
    expect(seqDiff(3, 65535)).toBe(4);
    expect(seqDiff(65535, 3)).toBe(-4);
  });
});
