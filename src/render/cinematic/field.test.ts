import { describe, expect, it } from 'vitest';
import {
  inverseSpacePoint,
  RIPPLE_LIFETIME,
  sampleSpaceField,
  type FieldKind,
  type FieldSource,
  type SpaceRipple,
} from './field';

const node = (kind: FieldKind = 'attractor', overrides: Partial<FieldSource> = {}): FieldSource => ({
  x: 0, y: 0, fieldRadius: 180, strength: 1.8, active: true, kind, ...overrides,
});
const ripple = (overrides: Partial<SpaceRipple> = {}): SpaceRipple => ({
  x: 0, y: 0, startedAt: 0, strength: 1.8, kind: 'attractor', ...overrides,
});

describe('world-space visual displacement field', () => {
  it('is identity without active fields and honors zero distortion', () => {
    const expected = { dx: 0, dy: 0, shade: 0 };
    expect(sampleSpaceField(17, -8, [], [], 5)).toEqual(expected);
    expect(sampleSpaceField(17, -8, [node('attractor', { active: false })], [], 5)).toEqual(expected);
    expect(sampleSpaceField(17, -8, [node('attractor', { strength: 0 })], [], 5)).toEqual(expected);
    expect(sampleSpaceField(17, -8, [node()], [ripple()], 1, 0)).toEqual(expected);
    expect(inverseSpacePoint(17, -8, [], [], 5)).toEqual({ x: 17, y: -8 });
  });

  it('pulls blue inward, pushes gold outward, and preserves their shade signs', () => {
    const blue = sampleSpaceField(40, 30, [node()], [], 0);
    const gold = sampleSpaceField(40, 30, [node('repulsor')], [], 0);
    expect(blue.dx).toBeLessThan(0);
    expect(blue.dy).toBeLessThan(0);
    expect(blue.shade).toBeLessThan(0);
    expect(gold.dx).toBeGreaterThan(0);
    expect(gold.dy).toBeGreaterThan(0);
    expect(gold.shade).toBeGreaterThan(0);
    expect(blue.dx / blue.dy).toBeCloseTo(4 / 3, 12);
    expect(blue.dx).toBeCloseTo(-gold.dx, 12);
  });

  it('is finite at the core and smoothly vanishes through the core', () => {
    const source = node('attractor', { x: 8, y: -6 });
    const center = sampleSpaceField(8, -6, [source], [ripple({ x: 8, y: -6 })], 1);
    expect(center.dx).toBe(0);
    expect(center.dy).toBe(0);
    expect(Number.isFinite(center.shade)).toBe(true);
    const nearby = sampleSpaceField(8 + 1e-8, -6, [source], [], 1);
    expect(Math.abs(nearby.dx)).toBeLessThan(1e-8);
    expect(nearby.shade).toBeCloseTo(center.shade, 12);
  });

  it('has compact support with no displacement or slope jump at its boundary', () => {
    const source = node();
    const outside = sampleSpaceField(180.001, 0, [source], [], 0);
    const boundary = sampleSpaceField(180, 0, [source], [], 0);
    const inside = sampleSpaceField(179.999, 0, [source], [], 0);
    expect(outside).toEqual({ dx: 0, dy: 0, shade: 0 });
    expect(boundary).toEqual(outside);
    expect(Math.abs(inside.dx)).toBeLessThan(1e-10);
    expect(Math.abs(inside.shade)).toBeLessThan(1e-10);
    expect(Math.abs((boundary.dx - inside.dx) / 0.001)).toBeLessThan(1e-7);
  });

  it('sums vectors before limiting, so equal opposed sources cancel', () => {
    const result = sampleSpaceField(40, 30, [node(), node('repulsor')], [], 0, 100);
    expect(result).toEqual({ dx: 0, dy: 0, shade: 0 });
    const a = node('attractor', { x: -50 });
    const b = node('attractor', { x: 50 });
    expect(sampleSpaceField(0, 0, [a, b], [], 0).dx).toBe(0);
  });

  it('bounds the final vector to 22 world pixels and shade below 0.25', () => {
    const sources = Array.from({ length: 80 }, () => node());
    for (let x = -200; x <= 200; x += 13) {
      for (let y = -200; y <= 200; y += 17) {
        const result = sampleSpaceField(x, y, sources, [ripple()], 1, 10);
        expect(Math.hypot(result.dx, result.dy)).toBeLessThanOrEqual(22 + 1e-12);
        expect(Math.abs(result.shade)).toBeLessThan(0.25);
      }
    }
  });

  it('is translation invariant in world coordinates', () => {
    const sources = [node(), node('repulsor', { x: 100, y: 30 })];
    const events = [ripple()];
    const actual = sampleSpaceField(140, 25, sources, events, 1);
    const translated = sampleSpaceField(1140, -475,
      sources.map(s => ({ ...s, x: s.x + 1000, y: s.y - 500 })),
      events.map(s => ({ ...s, x: s.x + 1000, y: s.y - 500 })), 1);
    expect(translated.dx).toBeCloseTo(actual.dx, 10);
    expect(translated.dy).toBeCloseTo(actual.dy, 10);
    expect(translated.shade).toBeCloseTo(actual.shade, 10);
  });

  it('keeps static forcing independent of time and never emits automatic waves', () => {
    expect(sampleSpaceField(50, 20, [node()], [], 0))
      .toEqual(sampleSpaceField(50, 20, [node()], [], 5000));
  });

  it('reuses caller-provided output objects', () => {
    const sample = { dx: 100, dy: 100, shade: 100 };
    expect(sampleSpaceField(5, 6, [], [], 0, 1, sample)).toBe(sample);
    expect(sample).toEqual({ dx: 0, dy: 0, shade: 0 });
    const point = { x: 0, y: 0 };
    expect(inverseSpacePoint(5, 6, [], [], 0, 1, point)).toBe(point);
    expect(point).toEqual({ x: 5, y: 6 });
  });
});

describe('transient irregular wave packets', () => {
  it('is absent before birth and disappears exactly after three seconds', () => {
    expect(RIPPLE_LIFETIME).toBe(3);
    for (const time of [-1, 0, RIPPLE_LIFETIME, RIPPLE_LIFETIME + 1]) {
      for (const x of [0, 25, 100, 200, 360]) {
        expect(sampleSpaceField(x, 0, [], [ripple()], time))
          .toEqual({ dx: 0, dy: 0, shade: 0 });
      }
    }
  });

  it('produces a small nonzero packet with angularly irregular propagation', () => {
    let maximum = 0;
    let angularDifference = 0;
    for (let r = 110; r <= 175; r += 2) {
      const east = sampleSpaceField(r, 0, [], [ripple()], 1);
      const north = sampleSpaceField(0, r, [], [ripple()], 1);
      maximum = Math.max(maximum, Math.hypot(east.dx, east.dy));
      angularDifference = Math.max(angularDifference, Math.abs(east.dx - north.dy));
    }
    expect(maximum).toBeGreaterThan(0.1);
    expect(maximum).toBeLessThan(3);
    expect(angularDifference).toBeGreaterThan(0.02);
    expect(sampleSpaceField(0, 0, [], [ripple()], 1)).toEqual({ dx: 0, dy: 0, shade: 0 });
  });

  it('fades smoothly at birth and death without persistent residue', () => {
    for (const time of [1e-5, RIPPLE_LIFETIME - 1e-5]) {
      for (let r = 0; r < 450; r += 3) {
        const result = sampleSpaceField(r, 0, [], [ripple()], time);
        expect(Math.hypot(result.dx, result.dy)).toBeLessThan(1e-8);
        expect(Math.abs(result.shade)).toBeLessThan(1e-8);
      }
    }
  });

  it('keeps ripple luminance blue-negative and gold-positive across both wave lobes', () => {
    for (let r = 110; r <= 175; r += 2) {
      expect(sampleSpaceField(r, 0, [], [ripple()], 1).shade).toBeLessThanOrEqual(0);
      expect(sampleSpaceField(r, 0, [], [ripple({ kind: 'repulsor' })], 1).shade).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('inverse texture sampling', () => {
  it('round-trips a deformed world grid through overlapping fields and ripples', () => {
    const sources = [
      node('attractor', { x: -45, y: -12, fieldRadius: 180 }),
      node('repulsor', { x: 70, y: 25, fieldRadius: 150 }),
    ];
    const events = [ripple({ x: -45, y: -12 }), ripple({ x: 70, y: 25, kind: 'repulsor', startedAt: 0.2 })];
    for (const time of [0, 0.6, 1.4, 2.8, 4]) {
      for (let x = -250; x <= 250; x += 25) {
        for (let y = -200; y <= 200; y += 25) {
          const displacement = sampleSpaceField(x, y, sources, events, time);
          const recovered = inverseSpacePoint(x + displacement.dx, y + displacement.dy, sources, events, time);
          expect(Math.hypot(recovered.x - x, recovered.y - y)).toBeLessThan(0.01);
        }
      }
    }
  });

  it('forward-maps inverse coordinates back to the requested destination', () => {
    const sources = [node('attractor', { fieldRadius: 90 }), node('attractor', { fieldRadius: 90 })];
    for (const x of [-80, -50, -20, -5, 0, 5, 20, 50, 80]) {
      const source = inverseSpacePoint(x, x * 0.2, sources, [], 0);
      const displacement = sampleSpaceField(source.x, source.y, sources, [], 0);
      expect(Math.hypot(source.x + displacement.dx - x, source.y + displacement.dy - x * 0.2)).toBeLessThan(0.03);
    }
  });
});
