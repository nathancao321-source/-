import type {
  BodyView,
  CanvasRenderer,
  FrameSnapshot,
  GameEvent,
  LevelSpec,
  MissionView,
  NarrativeHint,
  PlayerView,
  RenderFrame,
  Vec2,
} from '../shared/contracts';
import { predictArkPath, predictionColor } from '../game/prediction';

/* ------------------------------------------------------------------ *
 * Palette — kept in one place so a visual pass can retheme safely.
 * ------------------------------------------------------------------ */
const C = {
  bg: '#04080e',
  bgWorld: '#050d16',
  ink: '#dce8f0',
  muted: '#8294a3',
  faint: '#4d5f6e',
  blue: '#54b6ff',
  gold: '#f1c56d',
  green: '#78efb6',
  teal: '#8beadb',
  purple: '#b492e8',
  red: '#ff7f90',
  white: '#f5f7fa',
  grey: '#929ca6',
  orange: '#ffa45c',
} as const;

const EMBEDDED = (() => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
})();

const FONT_UI =
  '"Inter", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif';
const FONT_MONO = '"JetBrains Mono", "SFMono-Regular", Consolas, monospace';

const PLANET_NAMES: Record<string, string> = {
  'planet-01': '行星',
  venus: '金星',
  mercury: '水星',
  mars: '火星',
  jupiter: '木星',
  earth: '地球',
};

const PLANET_COLORS: Record<string, string> = {
  'planet-01': '#9b78d7',
  venus: '#d9c27a',
  mercury: '#9aa4ad',
  mars: '#c96a5a',
  jupiter: '#d9a066',
  earth: '#5aaee8',
};

interface Star {
  x: number;
  y: number;
  r: number;
  a: number;
  phase: number;
  tint: string;
}

interface FlashState {
  color: string;
  until: number;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpPos(prev: Vec2, pos: Vec2, t: number): Vec2 {
  return { x: lerp(prev.x, pos.x, t), y: lerp(prev.y, pos.y, t) };
}

function rgba(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export function createRenderer(canvas: HTMLCanvasElement): CanvasRenderer {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context is unavailable');

  let cssW = 1;
  let cssH = 1;
  let dpr = 1;
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  let ui = 1;

  let lastRunId = -1;
  let lastLevelId = '';
  let lastHeading = 0;
  let lastRunningVisual = 0;
  let trail: Vec2[] = [];
  let seenEvents = new Set<string>();
  let flash: FlashState = { color: C.white, until: 0 };
  const starCache = new Map<string, Star[]>();

  const starsFor = (level: LevelSpec | undefined, levelId: string): Star[] => {
    const key = level ? `${level.id}:${level.seed}` : levelId;
    const cached = starCache.get(key);
    if (cached) return cached;
    const seedBase = level ? level.seed : hashString(levelId || 'ark');
    const rng = mulberry32((seedBase ^ hashString(levelId || 'ark')) >>> 0);
    const width = level?.world.width ?? 1200;
    const height = level?.world.height ?? 720;
    const stars: Star[] = [];
    for (let i = 0; i < 175; i += 1) {
      const roll = rng();
      stars.push({
        x: rng() * width,
        y: rng() * height,
        r: 0.45 + rng() * 1.5,
        a: 0.12 + rng() * 0.62,
        phase: rng() * Math.PI * 2,
        tint: roll > 0.92 ? C.blue : roll > 0.84 ? C.gold : C.white,
      });
    }
    starCache.set(key, stars);
    return stars;
  };

  const resize = (cssWidth: number, cssHeight: number, devicePixelRatio: number): void => {
    cssW = Math.max(1, Number.isFinite(cssWidth) ? cssWidth : 1);
    cssH = Math.max(1, Number.isFinite(cssHeight) ? cssHeight : 1);
    dpr = Math.max(1, Math.min(2, Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1));
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
  };

  const setFont = (size: number, weight: number | string = 400, mono = false): void => {
    ctx.font = `${weight} ${Math.max(1, size)}px ${mono ? FONT_MONO : FONT_UI}`;
  };

  const text = (
    value: string,
    x: number,
    y: number,
    size: number,
    color: string,
    weight: number | string = 400,
    align: CanvasTextAlign = 'left',
    baseline: CanvasTextBaseline = 'alphabetic',
    mono = false,
  ): void => {
    setFont(size, weight, mono);
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    ctx.fillText(value, x, y);
  };

  const wrap = (value: string, maxWidth: number, font: string, maxLines = 4): string[] => {
    ctx.font = font;
    const lines: string[] = [];
    let current = '';
    for (const ch of value) {
      const candidate = current + ch;
      if (ctx.measureText(candidate).width > maxWidth && current.length > 0) {
        lines.push(current);
        current = ch;
        if (lines.length >= maxLines) break;
      } else {
        current = candidate;
      }
    }
    if (lines.length < maxLines && current.length > 0) lines.push(current);
    if (lines.length === maxLines && lines.join('').length < value.replace(/\s/g, '').length) {
      const last = lines[maxLines - 1]!;
      lines[maxLines - 1] = `${last.slice(0, Math.max(0, last.length - 1))}…`;
    }
    return lines;
  };

  const roundRect = (x: number, y: number, w: number, h: number, r: number): void => {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  };

  const panel = (
    x: number,
    y: number,
    w: number,
    h: number,
    accent: string = C.blue,
    fillAlpha = 0.74,
  ): void => {
    roundRect(x, y, w, h, 10 * ui);
    ctx.fillStyle = `rgba(6, 14, 22, ${fillAlpha})`;
    ctx.fill();
    ctx.strokeStyle = rgba(accent, 0.24);
    ctx.lineWidth = 1;
    ctx.stroke();
  };

  const dashedCircle = (
    x: number,
    y: number,
    r: number,
    color: string,
    width: number,
    dash: number[],
  ): void => {
    ctx.save();
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.1, r), 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.restore();
  };

  const arrow = (x: number, y: number, angle: number, size: number, color: string): void => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(size, 0);
    ctx.lineTo(-size * 0.7, size * 0.55);
    ctx.lineTo(-size * 0.7, -size * 0.55);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  };

  /* ------------------------------------------------------------------ */

  const drawBackground = (frame: RenderFrame, visualTime: number): void => {
    const snap = frame.snapshot;
    const world = snap.world;

    const base = ctx.createLinearGradient(0, 0, world.width, world.height);
    base.addColorStop(0, '#07111c');
    base.addColorStop(0.55, C.bgWorld);
    base.addColorStop(1, '#03070c');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, world.width, world.height);

    const tintA = frame.level?.id === 'solar-exodus' ? C.orange : C.purple;
    const tintB = frame.level?.id === 'beyond-horizon' ? C.purple : C.teal;
    const g1 = ctx.createRadialGradient(
      world.width * 0.18,
      world.height * 0.18,
      0,
      world.width * 0.18,
      world.height * 0.18,
      world.width * 0.62,
    );
    g1.addColorStop(0, rgba(tintA, 0.055));
    g1.addColorStop(1, rgba(tintA, 0));
    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, world.width, world.height);

    const g2 = ctx.createRadialGradient(
      world.width * 0.86,
      world.height * 0.82,
      0,
      world.width * 0.86,
      world.height * 0.82,
      world.width * 0.55,
    );
    g2.addColorStop(0, rgba(tintB, 0.045));
    g2.addColorStop(1, rgba(tintB, 0));
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, world.width, world.height);

    const stars = starsFor(frame.level, snap.levelId);
    for (const star of stars) {
      const twinkle = 0.72 + 0.28 * Math.sin(visualTime * 0.7 + star.phase);
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
      ctx.fillStyle = rgba(star.tint, star.a * twinkle);
      ctx.fill();
    }

    // World frame.
    ctx.strokeStyle = rgba(C.ink, 0.09);
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, world.width, world.height);

    const bracket = 28;
    ctx.strokeStyle = rgba(C.teal, 0.28);
    ctx.lineWidth = 2;
    const corners: Array<[number, number, number, number]> = [
      [0, 0, 1, 1],
      [world.width, 0, -1, 1],
      [0, world.height, 1, -1],
      [world.width, world.height, -1, -1],
    ];
    for (const [cx, cy, sx, sy] of corners) {
      ctx.beginPath();
      ctx.moveTo(cx + sx * bracket, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + sy * bracket);
      ctx.stroke();
    }
  };

  const drawGravityHints = (snap: FrameSnapshot): void => {
    for (const body of snap.bodies) {
      if (!body.gravity) continue;
      if (body.kind !== 'star' && body.kind !== 'blackHole') continue;
      ctx.beginPath();
      ctx.arc(body.position.x, body.position.y, body.gravity.radius, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(body.kind === 'star' ? C.orange : C.purple, 0.06);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  };

  const drawResonance = (frame: RenderFrame): void => {
    const level = frame.level;
    const zones = level?.mission?.resonanceZones;
    if (!zones) return;
    const flags = frame.snapshot.mission?.resonanceFlags;
    zones.forEach((zone, index) => {
      const visited = flags?.[index] ?? false;
      const color = visited ? C.green : C.purple;
      ctx.beginPath();
      ctx.arc(zone.center.x, zone.center.y, zone.radius, 0, Math.PI * 2);
      ctx.fillStyle = rgba(color, visited ? 0.055 : 0.025);
      ctx.fill();
      dashedCircle(zone.center.x, zone.center.y, zone.radius, rgba(color, visited ? 0.5 : 0.26), visited ? 2 : 1.2, [8, 10]);
      text(
        `${index + 1} · ${zone.label}`,
        zone.center.x,
        zone.center.y - zone.radius - 10,
        13,
        rgba(color, visited ? 0.95 : 0.66),
        600,
        'center',
      );
      if (visited) {
        text('✓', zone.center.x, zone.center.y + 5, 18, rgba(C.green, 0.9), 700, 'center');
      }
    });
  };

  const drawJet = (frame: RenderFrame, visualTime: number): void => {
    const jet = frame.level?.mission?.jet;
    if (!jet) return;
    const active = frame.snapshot.mission?.jetActive ?? false;
    const x = jet.center.x - jet.halfWidth;
    const y = jet.center.y - jet.halfHeight;
    const w = jet.halfWidth * 2;
    const h = jet.halfHeight * 2;
    const gradient = ctx.createLinearGradient(0, y + h, 0, y);
    gradient.addColorStop(0, rgba(C.teal, active ? 0.22 : 0.035));
    gradient.addColorStop(0.55, rgba(C.white, active ? 0.11 : 0.02));
    gradient.addColorStop(1, rgba(C.white, active ? 0.02 : 0));
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, w, h);

    ctx.save();
    ctx.setLineDash([10, 12]);
    ctx.strokeStyle = rgba(C.teal, active ? 0.55 : 0.14);
    ctx.lineWidth = active ? 2 : 1;
    ctx.strokeRect(x, y, w, h);
    ctx.restore();

    if (active) {
      for (let i = 0; i < 18; i += 1) {
        const phase = (visualTime * (0.22 + (i % 5) * 0.025) + i * 0.137) % 1;
        const px = x + 8 + ((i * 37) % Math.max(1, w - 16));
        const py = y + h - phase * h;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px, py - 10);
        ctx.strokeStyle = rgba(i % 3 === 0 ? C.white : C.teal, 0.16 + 0.34 * (1 - phase));
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
    }

    text(
      active ? '伽马喷流 · ACTIVE' : '伽马喷流 · 待机',
      jet.center.x,
      y - 12,
      13,
      rgba(active ? C.white : C.teal, active ? 0.95 : 0.45),
      600,
      'center',
    );
  };

  const drawShockwave = (frame: RenderFrame): void => {
    const wave = frame.level?.mission?.shockwave;
    const radius = frame.snapshot.mission?.waveRadius ?? 0;
    if (!wave || radius <= 0) return;
    const alpha = clamp(0.7 - radius / 2400, 0.2, 0.7);
    ctx.beginPath();
    ctx.arc(wave.origin.x, wave.origin.y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = rgba(C.orange, alpha);
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(wave.origin.x, wave.origin.y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = rgba(C.red, alpha * 0.5);
    ctx.lineWidth = 12;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(wave.origin.x, wave.origin.y, Math.max(0, radius - 3), 0, Math.PI * 2);
    ctx.fillStyle = rgba(C.orange, 0.018);
    ctx.fill();
  };

  const drawStar = (body: BodyView, visualTime: number): void => {
    const p = body.position;
    const r = body.radius;
    const pulse = 1 + 0.018 * Math.sin(visualTime * 1.35);

    const corona = ctx.createRadialGradient(p.x, p.y, r * 0.6, p.x, p.y, r * 2.25 * pulse);
    corona.addColorStop(0, rgba(C.orange, 0.45));
    corona.addColorStop(0.32, rgba(C.gold, 0.17));
    corona.addColorStop(1, rgba(C.orange, 0));
    ctx.fillStyle = corona;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 2.25 * pulse, 0, Math.PI * 2);
    ctx.fill();

    const core = ctx.createRadialGradient(p.x - r * 0.2, p.y - r * 0.25, r * 0.1, p.x, p.y, r);
    core.addColorStop(0, '#fff7df');
    core.addColorStop(0.45, '#ffd27a');
    core.addColorStop(1, '#f07a32');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();

    for (let i = 0; i < 18; i += 1) {
      const angle = (i / 18) * Math.PI * 2 + visualTime * 0.035;
      const inner = r * 1.06;
      const outer = r * (1.12 + 0.07 * Math.sin(visualTime * 1.7 + i));
      ctx.beginPath();
      ctx.moveTo(p.x + Math.cos(angle) * inner, p.y + Math.sin(angle) * inner);
      ctx.lineTo(p.x + Math.cos(angle) * outer, p.y + Math.sin(angle) * outer);
      ctx.strokeStyle = rgba(C.gold, 0.32);
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }

    dashedCircle(p.x, p.y, r + 3, rgba(C.red, 0.42), 1.4, [6, 7]);
    text('太阳', p.x, p.y + r + 26, 14, rgba(C.gold, 0.85), 600, 'center');
  };

  const drawBlackHole = (body: BodyView, visualTime: number): void => {
    const p = body.position;
    const r = body.radius;

    const halo = ctx.createRadialGradient(p.x, p.y, r * 0.8, p.x, p.y, r * 2.6);
    halo.addColorStop(0, rgba(C.purple, 0.2));
    halo.addColorStop(0.55, rgba(C.purple, 0.06));
    halo.addColorStop(1, rgba(C.purple, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 2.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(-0.35 + visualTime * 0.03);
    for (let i = 0; i < 4; i += 1) {
      ctx.beginPath();
      ctx.ellipse(0, 0, r * (1.35 + i * 0.16), r * (0.34 + i * 0.045), 0, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(i % 2 === 0 ? C.orange : C.purple, 0.34 - i * 0.06);
      ctx.lineWidth = 2.2 - i * 0.35;
      ctx.stroke();
    }
    ctx.restore();

    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#010205';
    ctx.fill();
    ctx.strokeStyle = rgba(C.white, 0.72);
    ctx.lineWidth = 1.4;
    ctx.stroke();

    const consume = body.consumeRadius;
    if (consume !== undefined) {
      dashedCircle(p.x, p.y, consume, rgba(C.red, 0.5), 1.6, [5, 7]);
      text('视界', p.x + consume + 8, p.y - 6, 12, rgba(C.red, 0.72), 500);
    }
    text('SAGITTARIUS A*', p.x, p.y + r + 34, 13, rgba(C.purple, 0.82), 600, 'center', 'alphabetic', true);
  };

  const drawPlanet = (body: BodyView, visualTime: number): void => {
    const p = body.position;
    const r = body.radius;
    const base = PLANET_COLORS[body.id] ?? '#9b78d7';
    const name = PLANET_NAMES[body.id] ?? body.id;

    const glow = ctx.createRadialGradient(p.x, p.y, r, p.x, p.y, r * 1.9);
    glow.addColorStop(0, rgba(base, 0.16));
    glow.addColorStop(1, rgba(base, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 1.9, 0, Math.PI * 2);
    ctx.fill();

    const surface = ctx.createRadialGradient(
      p.x - r * 0.35,
      p.y - r * 0.4,
      r * 0.1,
      p.x,
      p.y,
      r,
    );
    surface.addColorStop(0, '#ffffff');
    surface.addColorStop(0.16, base);
    surface.addColorStop(1, '#202b36');
    ctx.fillStyle = surface;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.16)';
    ctx.lineWidth = Math.max(1, r * 0.12);
    for (let i = -1; i <= 1; i += 1) {
      ctx.beginPath();
      ctx.moveTo(p.x - r, p.y + i * r * 0.32);
      ctx.lineTo(p.x + r, p.y + i * r * 0.4);
      ctx.stroke();
    }
    ctx.restore();

    if (body.hazardousToArk) {
      dashedCircle(p.x, p.y, r + 3, rgba(C.red, 0.22), 1, [4, 6]);
    }

    const label = body.gravity ? `${name} · 引力环` : name;
    text(label, p.x, p.y - r - 12, 12, rgba(base, 0.9), 600, 'center');

    if (body.gravity) {
      dashedCircle(p.x, p.y, body.gravity.radius, rgba(base, 0.07), 1, [3, 16]);
    }

    void visualTime;
  };

  const drawAsteroid = (body: BodyView, visualTime: number): void => {
    const p = body.position;
    const r = body.radius;
    const seed = hashString(body.id);
    const points = 9;
    ctx.beginPath();
    for (let i = 0; i < points; i += 1) {
      const angle = (i / points) * Math.PI * 2;
      const wobble = 0.86 + 0.16 * Math.sin(seed * 0.001 + i * 2.3 + visualTime * 0.1);
      const x = p.x + Math.cos(angle) * r * wobble;
      const y = p.y + Math.sin(angle) * r * wobble;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = C.grey;
    ctx.fill();
    ctx.strokeStyle = 'rgba(28, 40, 50, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(p.x - r * 0.24, p.y - r * 0.12, r * 0.2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(45, 58, 70, 0.55)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(p.x + r * 0.26, p.y + r * 0.2, r * 0.13, 0, Math.PI * 2);
    ctx.fill();
  };

  const drawDock = (snap: FrameSnapshot, visualTime: number): void => {
    const dock = snap.dock;
    const mission = snap.mission;
    const locked =
      mission?.script === 'solar' &&
      mission.resonanceCount !== undefined &&
      mission.resonanceRequired !== undefined &&
      mission.resonanceCount < mission.resonanceRequired;
    const color = locked ? C.gold : C.green;
    const p = dock.center;
    const r = dock.radius;

    const halo = ctx.createRadialGradient(p.x, p.y, r * 0.2, p.x, p.y, r * 1.5);
    halo.addColorStop(0, rgba(color, 0.14));
    halo.addColorStop(0.6, rgba(color, 0.05));
    halo.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 1.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.strokeStyle = rgba(color, 0.9);
    ctx.lineWidth = 2.4;
    ctx.stroke();

    ctx.save();
    ctx.translate(p.x, p.y);
    const rotation = visualTime * (dock.kind === 'wormhole' ? 0.45 : 0.16);
    ctx.rotate(rotation);
    for (let i = 0; i < 16; i += 1) {
      if (dock.kind === 'wormhole' && i % 3 === 0) continue;
      const angle = (i / 16) * Math.PI * 2;
      const inner = r - (i % 2 === 0 ? 9 : 5);
      const outer = r + (i % 2 === 0 ? 7 : 3);
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
      ctx.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
      ctx.strokeStyle = rgba(color, 0.5);
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
    ctx.restore();

    if (dock.kind === 'wormhole') {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(-visualTime * 0.6);
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.62, 0.2, Math.PI * 1.2);
      ctx.strokeStyle = rgba(C.white, 0.5);
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.44, Math.PI * 1.1, Math.PI * 2.25);
      ctx.strokeStyle = rgba(color, 0.8);
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.restore();
    } else if (dock.kind === 'gate') {
      dashedCircle(p.x, p.y, r * 0.72, rgba(color, 0.4), 1.2, [4, 6]);
      arrow(p.x, p.y, Math.PI / 2, r * 0.18, rgba(color, 0.55));
    } else {
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - r * 0.5);
      ctx.lineTo(p.x + r * 0.4, p.y + r * 0.35);
      ctx.lineTo(p.x - r * 0.4, p.y + r * 0.35);
      ctx.closePath();
      ctx.strokeStyle = rgba(color, 0.55);
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }

    const label = dock.label ?? (dock.kind === 'wormhole' ? '跃迁门' : '泊位');
    text(label, p.x, p.y + r + 24, 14, rgba(color, 0.95), 600, 'center');
    const limit =
      dock.maxEntrySpeed >= 900 ? '不限入港速度' : `入港速度 ≤ ${dock.maxEntrySpeed}`;
    text(limit, p.x, p.y + r + 42, 11, rgba(locked ? C.gold : C.muted, 0.9), 500, 'center');

    if (locked) {
      text('共振不足 · 门未开启', p.x, p.y - r - 16, 12, rgba(C.gold, 0.95), 600, 'center');
    }

    if (snap.dockOverspeed) {
      const pulse = 0.5 + 0.5 * Math.sin(visualTime * 5);
      dashedCircle(p.x, p.y, r + 8, rgba(C.red, 0.45 + 0.4 * pulse), 2, [7, 6]);
      text('速度过高 · 减速', p.x, p.y - r - 18, 14, rgba(C.red, 0.95), 700, 'center');
    }
  };

  const drawField = (player: PlayerView, visualTime: number): void => {
    if (!player.fieldActive) return;
    const color = player.id === 'attractor' ? C.blue : C.gold;
    const p = player.position;
    const r = player.field.radius;
    const inward = player.id === 'attractor';

    const fill = ctx.createRadialGradient(p.x, p.y, r * 0.1, p.x, p.y, r);
    fill.addColorStop(0, rgba(color, 0.008));
    fill.addColorStop(0.72, rgba(color, 0.024));
    fill.addColorStop(1, rgba(color, 0.06));
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();

    ctx.save();
    ctx.setLineDash([9, 11]);
    ctx.lineDashOffset = (inward ? -1 : 1) * visualTime * 16;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.strokeStyle = rgba(color, 0.48);
    ctx.lineWidth = 1.3;
    ctx.stroke();
    ctx.restore();

    for (let i = 0; i < 8; i += 1) {
      const angle = (i / 8) * Math.PI * 2 + (inward ? -1 : 1) * visualTime * 0.05;
      const dist = r * (inward ? 0.78 : 0.88);
      const ax = p.x + Math.cos(angle) * dist;
      const ay = p.y + Math.sin(angle) * dist;
      arrow(ax, ay, inward ? angle + Math.PI : angle, 5.2, rgba(color, 0.34));
    }
  };

  const drawPlayer = (player: PlayerView, visualTime: number): void => {
    const color = player.id === 'attractor' ? C.blue : C.gold;
    const p = player.position;
    const r = player.radius;
    const pulse = player.fieldActive ? 0.5 + 0.5 * Math.sin(visualTime * 4) : 0;

    const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.6);
    glow.addColorStop(0, rgba(color, 0.32));
    glow.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 2.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = rgba(color, 0.92);
    ctx.fill();
    ctx.strokeStyle = rgba(C.white, 0.75);
    ctx.lineWidth = 1.2;
    ctx.stroke();

    if (player.fieldActive) {
      dashedCircle(p.x, p.y, r + 6 + pulse * 3, rgba(color, 0.7), 1.4, [3, 5]);
    }

    const label = player.id === 'attractor' ? 'P1' : 'P2';
    const role = player.id === 'attractor' ? '收束' : '划界';
    text(label, p.x, p.y - r - 12, 12, rgba(color, 0.95), 700, 'center');
    text(role, p.x, p.y - r - 26, 10, rgba(color, 0.6), 500, 'center');
  };

  const drawArk = (frame: RenderFrame, visualTime: number): void => {
    const snap = frame.snapshot;
    const ark = snap.bodies.find((body) => body.kind === 'ark');
    if (!ark) return;
    const p = ark.position;
    const speed = Math.hypot(ark.velocity.x, ark.velocity.y);
    if (speed > 2) lastHeading = Math.atan2(ark.velocity.y, ark.velocity.x);

    if (snap.phase === 'running') {
      trail.push({ x: p.x, y: p.y });
      if (trail.length > 24) trail.shift();
    }

    for (let i = 0; i < trail.length; i += 1) {
      const point = trail[i]!;
      const next = trail[i + 1];
      if (!next) continue;
      const t = i / Math.max(1, trail.length - 1);
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
      ctx.lineTo(next.x, next.y);
      ctx.strokeStyle = rgba(C.teal, 0.03 + t * 0.15);
      ctx.lineWidth = 1 + t * 2;
      ctx.stroke();
    }

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(lastHeading);

    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, ark.radius * 3);
    glow.addColorStop(0, rgba(C.white, 0.24));
    glow.addColorStop(1, rgba(C.white, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, ark.radius * 3, 0, Math.PI * 2);
    ctx.fill();

    const r = ark.radius;
    ctx.beginPath();
    ctx.moveTo(r * 1.05, 0);
    ctx.lineTo(-r * 0.7, r * 0.75);
    ctx.lineTo(-r * 0.42, 0);
    ctx.lineTo(-r * 0.7, -r * 0.75);
    ctx.closePath();
    ctx.fillStyle = C.white;
    ctx.fill();
    ctx.strokeStyle = rgba(C.teal, 0.9);
    ctx.lineWidth = 1.3;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(r * 0.15, 0, r * 0.16, 0, Math.PI * 2);
    ctx.fillStyle = rgba(C.blue, 0.9);
    ctx.fill();

    if (snap.phase === 'running') {
      const flicker = 0.5 + 0.5 * Math.sin(visualTime * 12);
      ctx.beginPath();
      ctx.moveTo(-r * 0.42, r * 0.22);
      ctx.lineTo(-r * (0.9 + flicker * 0.25), 0);
      ctx.lineTo(-r * 0.42, -r * 0.22);
      ctx.closePath();
      ctx.fillStyle = rgba(C.teal, 0.18 + flicker * 0.12);
      ctx.fill();
    }
    ctx.restore();

    dashedCircle(p.x, p.y, ark.radius + 3, rgba(C.white, 0.16), 0.8, [2, 4]);
    text('ARK-01', p.x, p.y + ark.radius + 18, 10, rgba(C.muted, 0.8), 500, 'center', 'alphabetic', true);
  };

  const drawPrediction = (frame: RenderFrame, visualTime: number): void => {
    const snap = frame.snapshot;
    const level = frame.level;
    if (snap.phase !== 'running' || !level) return;

    const points = predictArkPath(level, snap, 3.4, 1 / 30);
    if (points.length < 2) return;
    const end = points[points.length - 1]!;
    const endTone = predictionColor(end.outcome);
    const endColor =
      endTone === 'danger' ? C.red : endTone === 'success' ? C.green : C.teal;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.shadowColor = rgba(C.teal, 0.45);
    ctx.shadowBlur = 7;
    for (let i = 0; i < points.length - 1; i += 1) {
      const from = points[i]!;
      const to = points[i + 1]!;
      const tone = predictionColor(to.outcome);
      const color =
        tone === 'danger' ? C.red : tone === 'success' ? C.green : C.white;
      const alpha = (0.82 * (1 - i / Math.max(1, points.length - 1))) + 0.14;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.strokeStyle = rgba(color, alpha);
      ctx.lineWidth = 2.2;
      ctx.stroke();
    }
    ctx.restore();

    // Direction ticks help read the line as motion, not a boundary.
    for (let i = 8; i < points.length - 2; i += 12) {
      const a = points[i]!;
      const b = points[i + 1]!;
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      arrow(b.x, b.y, angle, 3.2, rgba(C.white, 0.45));
    }

    ctx.beginPath();
    ctx.arc(end.x, end.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = rgba(endColor, 0.9);
    ctx.fill();
    ctx.strokeStyle = rgba(endColor, 0.4);
    ctx.lineWidth = 1;
    ctx.stroke();

    const labelX = Math.min(level.world.width - 76, Math.max(8, end.x + 10));
    const labelY = Math.min(level.world.height - 10, Math.max(16, end.y - 8));
    if (end.outcome === 'dock') {
      text('预计入港', labelX, labelY, 10, rgba(C.green, 0.95), 600);
    } else if (end.outcome === 'out-of-bounds') {
      text('预计越界', labelX, labelY, 10, rgba(C.red, 0.95), 600);
    } else if (end.outcome === 'collision' || end.outcome === 'consumed') {
      text('预计撞击', labelX, labelY, 10, rgba(C.red, 0.95), 600);
    } else {
      const mid = points[Math.min(points.length - 1, Math.floor(points.length * 0.35))]!;
      text('预计轨道', mid.x + 9, mid.y - 9, 9, rgba(C.white, 0.52), 500);
    }
  };

  const drawWorld = (frame: RenderFrame, visualTime: number): void => {
    const snap = frame.snapshot;
    drawBackground(frame, visualTime);
    drawGravityHints(snap);
    drawResonance(frame);
    drawJet(frame, visualTime);
    drawShockwave(frame);

    const ark = snap.bodies.find((body) => body.kind === 'ark');
    for (const body of snap.bodies) {
      if (body === ark) continue;
      if (body.kind === 'star') drawStar(body, visualTime);
      else if (body.kind === 'blackHole') drawBlackHole(body, visualTime);
      else if (body.kind === 'planet') drawPlanet(body, visualTime);
      else drawAsteroid(body, visualTime);
    }

    drawDock(snap, visualTime);

    for (const player of snap.players) drawField(player, visualTime);
    drawPrediction(frame, visualTime);
    drawArk(frame, visualTime);
    for (const player of snap.players) drawPlayer(player, visualTime);
  };

  /* -------------------------------- HUD -------------------------------- */

  const drawSpeedPanel = (frame: RenderFrame): void => {
    const snap = frame.snapshot;
    const w = 196 * ui;
    const x = cssW - 14 * ui - w;
    const y = 14 * ui;
    const h = 88 * ui;
    panel(x, y, w, h, C.teal);

    text('方舟速度', x + 14 * ui, y + 22 * ui, 11 * ui, C.muted, 500);
    const limit = snap.dock.maxEntrySpeed;
    const over = limit < 900 && snap.arkSpeed > limit;
    text(
      snap.arkSpeed.toFixed(1),
      x + 14 * ui,
      y + 54 * ui,
      25 * ui,
      over ? C.red : C.ink,
      700,
      'left',
      'alphabetic',
      true,
    );
    text('px/s', x + 14 * ui + 58 * ui, y + 52 * ui, 10 * ui, C.muted, 500, 'left', 'alphabetic', true);

    const limitText =
      limit >= 900 ? '不限入港速度' : `入港限速 ≤ ${limit}`;
    text(limitText, x + w - 14 * ui, y + 28 * ui, 11 * ui, over ? C.red : C.muted, 600, 'right');

    const barX = x + 14 * ui;
    const barY = y + h - 18 * ui;
    const barW = w - 28 * ui;
    ctx.beginPath();
    roundRect(barX, barY, barW, 4 * ui, 2 * ui);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fill();
    const fraction =
      limit >= 900 ? clamp(snap.arkSpeed / 160, 0, 1) : clamp(snap.arkSpeed / Math.max(1, limit), 0, 1);
    ctx.beginPath();
    roundRect(barX, barY, Math.max(2, barW * fraction), 4 * ui, 2 * ui);
    ctx.fillStyle = over ? C.red : fraction > 0.82 ? C.gold : C.green;
    ctx.fill();

    text(limit >= 900 ? '跃迁门' : '泊位', x + w - 14 * ui, y + 54 * ui, 10 * ui, C.faint, 500, 'right');
  };

  const drawObjectivePanel = (frame: RenderFrame): void => {
    const snap = frame.snapshot;
    const narrative = frame.narrative;
    const level = frame.level;
    const mission = snap.mission;
    const x = 14 * ui;
    const y = 14 * ui;
    const w = 330 * ui;
    const h = 106 * ui;
    panel(x, y, w, h, C.purple);

    text(
      (narrative.chapter ?? level?.title ?? 'THE LAST ARK').toUpperCase(),
      x + 14 * ui,
      y + 20 * ui,
      9.5 * ui,
      rgba(C.purple, 0.92),
      700,
    );
    text(level?.title ?? '最后的方舟', x + 14 * ui, y + 44 * ui, 21 * ui, C.ink, 700);
    text(narrative.sector ?? '', x + 14 * ui, y + 60 * ui, 9.5 * ui, C.muted, 500, 'left', 'alphabetic', true);

    ctx.beginPath();
    ctx.moveTo(x + 14 * ui, y + 70 * ui);
    ctx.lineTo(x + w - 14 * ui, y + 70 * ui);
    ctx.strokeStyle = rgba(C.teal, 0.16);
    ctx.lineWidth = 1;
    ctx.stroke();

    text(mission?.objective ?? '护送方舟', x + 14 * ui, y + 88 * ui, 12 * ui, C.teal, 600);
    text(mission?.progress ?? '', x + w - 14 * ui, y + 88 * ui, 11 * ui, C.muted, 500, 'right');
    if (mission?.status) {
      text(mission.status, x + 14 * ui, y + 102 * ui, 10 * ui, rgba(C.faint, 1), 500);
    }
  };

  const drawAlertBar = (frame: RenderFrame): void => {
    const mission = frame.snapshot.mission;
    if (!mission?.alert) return;
    const maxW = Math.max(180, Math.min(560 * ui, cssW - 32 * ui));
    const w = maxW;
    const x = (cssW - w) / 2;
    const y = 126 * ui;
    const h = 34 * ui;
    const urgent = /冲击波|潮汐|视界|坍缩/.test(mission.alert);
    const color = urgent ? C.red : C.gold;

    roundRect(x, y, w, h, 8 * ui);
    ctx.fillStyle = 'rgba(12, 16, 22, 0.86)';
    ctx.fill();
    ctx.strokeStyle = rgba(color, 0.55);
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x, y + 8 * ui);
    ctx.lineTo(x, y + h - 8 * ui);
    ctx.strokeStyle = rgba(color, 0.9);
    ctx.lineWidth = 3;
    ctx.stroke();

    text(mission.alert, x + 16 * ui, y + h / 2 + 4 * ui, 12.5 * ui, rgba(color, 0.98), 600, 'left', 'alphabetic');
  };

  const drawSolarChain = (frame: RenderFrame): void => {
    const level = frame.level;
    const mission = frame.snapshot.mission;
    if (mission?.script !== 'solar' || !level?.mission?.resonanceZones) return;
    const zones = level.mission.resonanceZones;
    const x = 14 * ui;
    const y = 132 * ui;
    const w = 330 * ui;
    const h = 50 * ui;
    panel(x, y, w, h, C.gold, 0.62);
    text('行星链', x + 14 * ui, y + 19 * ui, 10 * ui, C.muted, 600);
    const startX = x + 70 * ui;
    const gap = (w - 84 * ui) / Math.max(1, zones.length);
    zones.forEach((zone, index) => {
      const done = mission.resonanceFlags?.[index] ?? false;
      const cx = startX + gap * index + gap * 0.25;
      const cy = y + 27 * ui;
      ctx.beginPath();
      ctx.arc(cx, cy, 8 * ui, 0, Math.PI * 2);
      ctx.fillStyle = done ? rgba(C.green, 0.9) : 'rgba(255,255,255,0.06)';
      ctx.fill();
      ctx.strokeStyle = done ? C.green : rgba(C.muted, 0.6);
      ctx.lineWidth = 1.2;
      ctx.stroke();
      if (done) {
        text('✓', cx, cy + 3.4 * ui, 9 * ui, '#06110d', 700, 'center');
      }
      text(zone.label, cx, y + 44 * ui, 9 * ui, done ? rgba(C.green, 0.9) : C.muted, 500, 'center');
    });
  };

  const drawBlackHoleStatus = (frame: RenderFrame): void => {
    const level = frame.level;
    const mission = frame.snapshot.mission;
    const jet = level?.mission?.jet;
    if (mission?.script !== 'blackhole' || !jet) return;
    const x = 14 * ui;
    const y = 132 * ui;
    const w = 330 * ui;
    const h = 46 * ui;
    panel(x, y, w, h, C.purple, 0.62);

    const dt = level.physics.fixedDt;
    const t = (frame.snapshot.tick * dt) % jet.periodSeconds;
    const active = t < jet.activeSeconds;
    const remaining = active ? jet.activeSeconds - t : jet.periodSeconds - t;
    const fraction = active ? 1 - remaining / jet.activeSeconds : 0;

    text('伽马喷流', x + 14 * ui, y + 19 * ui, 10 * ui, C.muted, 600);
    text(
      active ? '开启中' : `${remaining.toFixed(1)}s 后开启`,
      x + 14 * ui,
      y + 35 * ui,
      12 * ui,
      active ? C.teal : C.muted,
      600,
    );

    const barX = x + 110 * ui;
    const barW = w - 124 * ui;
    const barY = y + 26 * ui;
    ctx.beginPath();
    roundRect(barX, barY, barW, 5 * ui, 2.5 * ui);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fill();
    if (active) {
      ctx.beginPath();
      roundRect(barX, barY, Math.max(2, barW * fraction), 5 * ui, 2.5 * ui);
      ctx.fillStyle = C.teal;
      ctx.fill();
    }
  };

  const drawHintBand = (frame: RenderFrame): void => {
    const hintId = frame.snapshot.hintId;
    if (!hintId) return;
    const hint = frame.narrative.hints.find((item) => item.id === hintId);
    if (!hint) return;

    const color =
      hint.voice === 'court' ? C.purple : hint.voice === 'ark' ? C.teal : C.gold;
    const maxW = Math.max(180, Math.min(680 * ui, cssW - 32 * ui));
    const textW = Math.max(80, maxW - 30 * ui);
    const font = `500 ${13 * ui}px ${FONT_UI}`;
    const lines = wrap(hint.text, textW, font, 3);
    const lineH = 20 * ui;
    const h = 30 * ui + lines.length * lineH;
    const x = (cssW - maxW) / 2;
    const y = cssH - 78 * ui - h;

    roundRect(x, y, maxW, h, 10 * ui);
    ctx.fillStyle = 'rgba(6, 12, 19, 0.9)';
    ctx.fill();
    ctx.strokeStyle = rgba(color, 0.42);
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x + 1, y + 10 * ui);
    ctx.lineTo(x + 1, y + h - 10 * ui);
    ctx.strokeStyle = rgba(color, 0.95);
    ctx.lineWidth = 3;
    ctx.stroke();

    if (hint.title) {
      text(hint.title, x + 16 * ui, y + 20 * ui, 10 * ui, rgba(color, 0.95), 700);
    }
    setFont(13 * ui, 500);
    ctx.fillStyle = C.ink;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    lines.forEach((line, index) => {
      ctx.fillText(line, x + 16 * ui, y + 30 * ui + index * lineH);
    });
  };

  const drawControls = (frame: RenderFrame): void => {
    const y = cssH - 20 * ui;
    const label =
      'P1  WASD / F 吸引开关     P2  ↑↓←→ / Enter 排斥开关     Space 开始 / 暂停     R 重试     M 章节';
    text(label, 16 * ui, y, 10.5 * ui, rgba(C.muted, 0.9), 500, 'left', 'alphabetic');

    const p1 = frame.snapshot.players.find((p) => p.id === 'attractor');
    const p2 = frame.snapshot.players.find((p) => p.id === 'repulsor');
    const chipW = 96 * ui;
    const gap = 8 * ui;
    const x2 = cssW - 16 * ui - chipW;
    const x1 = x2 - gap - chipW;
    const chipY = cssH - 42 * ui;
    const drawChip = (x: number, labelText: string, color: string, active: boolean): void => {
      roundRect(x, chipY, chipW, 24 * ui, 6 * ui);
      ctx.fillStyle = active ? rgba(color, 0.18) : 'rgba(255,255,255,0.03)';
      ctx.fill();
      ctx.strokeStyle = rgba(color, active ? 0.7 : 0.2);
      ctx.lineWidth = 1;
      ctx.stroke();
      text(
        `${labelText}  ${active ? 'ON' : 'OFF'}`,
        x + chipW / 2,
        chipY + 16 * ui,
        10 * ui,
        active ? color : C.faint,
        700,
        'center',
      );
    };
    drawChip(x1, 'P1 吸引', C.blue, p1?.fieldActive ?? false);
    drawChip(x2, 'P2 排斥', C.gold, p2?.fieldActive ?? false);
  };

  const drawHud = (frame: RenderFrame): void => {
    drawObjectivePanel(frame);
    drawSpeedPanel(frame);
    drawSolarChain(frame);
    drawBlackHoleStatus(frame);
    drawAlertBar(frame);
    drawHintBand(frame);
    drawControls(frame);
  };

  /* ------------------------------- cards ------------------------------- */

  const drawCard = (options: {
    eyebrow: string;
    title: string;
    lines: string[];
    cta: string;
    accent: string;
    footer?: string;
    stats?: Array<[string, string]>;
    dim?: number;
  }): void => {
    const { eyebrow, title, lines, cta, accent, footer, stats, dim = 0.66 } = options;

    ctx.fillStyle = `rgba(3, 7, 12, ${dim})`;
    ctx.fillRect(0, 0, cssW, cssH);

    const maxW = Math.max(220, Math.min(680 * ui, cssW - 36 * ui));
    const lineFont = `400 ${13.5 * ui}px ${FONT_UI}`;
    const lineH = 23 * ui;
    const wrapped: string[] = [];
    for (const line of lines) {
      wrapped.push(...wrap(line, maxW - 56 * ui, lineFont, 3));
    }
    const statsH = stats ? 36 * ui : 0;
    const h =
      118 * ui +
      wrapped.length * lineH +
      statsH +
      (footer ? 24 * ui : 0) +
      54 * ui;
    const x = (cssW - maxW) / 2;
    const y = Math.max(16 * ui, (cssH - h) / 2);

    ctx.save();
    ctx.shadowColor = rgba(accent, 0.18);
    ctx.shadowBlur = 40 * ui;
    roundRect(x, y, maxW, h, 16 * ui);
    ctx.fillStyle = 'rgba(7, 14, 22, 0.96)';
    ctx.fill();
    ctx.restore();

    roundRect(x, y, maxW, h, 16 * ui);
    ctx.strokeStyle = rgba(accent, 0.4);
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x + 26 * ui, y + 1);
    ctx.lineTo(x + 120 * ui, y + 1);
    ctx.strokeStyle = rgba(accent, 0.9);
    ctx.lineWidth = 2;
    ctx.stroke();

    text(eyebrow, x + 28 * ui, y + 34 * ui, 10 * ui, rgba(accent, 0.95), 700);
    text(title, x + 28 * ui, y + 70 * ui, 27 * ui, C.ink, 700);

    ctx.beginPath();
    ctx.moveTo(x + 28 * ui, y + 88 * ui);
    ctx.lineTo(x + maxW - 28 * ui, y + 88 * ui);
    ctx.strokeStyle = 'rgba(255,255,255,0.09)';
    ctx.lineWidth = 1;
    ctx.stroke();

    setFont(13.5 * ui, 400);
    ctx.fillStyle = rgba(C.ink, 0.88);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    let cursorY = y + 106 * ui;
    for (const line of wrapped) {
      ctx.fillText(line, x + 28 * ui, cursorY);
      cursorY += lineH;
    }

    if (stats) {
      let statX = x + 28 * ui;
      for (const [label, value] of stats) {
        text(label, statX, cursorY + 8 * ui, 9.5 * ui, C.muted, 500);
        text(value, statX, cursorY + 26 * ui, 15 * ui, C.ink, 600, 'left', 'alphabetic', true);
        statX += 130 * ui;
      }
      cursorY += statsH;
    }

    if (footer) {
      text(footer, x + 28 * ui, cursorY + 16 * ui, 10 * ui, C.faint, 500);
      cursorY += 24 * ui;
    }

    const ctaY = y + h - 38 * ui;
    setFont(11.5 * ui, 700);
    const ctaW = Math.max(170 * ui, ctx.measureText(cta).width + 44 * ui);
    roundRect(x + maxW - 28 * ui - ctaW, ctaY - 14 * ui, ctaW, 30 * ui, 15 * ui);
    ctx.fillStyle = rgba(accent, 0.14);
    ctx.fill();
    ctx.strokeStyle = rgba(accent, 0.65);
    ctx.lineWidth = 1;
    ctx.stroke();
    text(
      cta,
      x + maxW - 28 * ui - ctaW / 2,
      ctaY + 6 * ui,
      11.5 * ui,
      accent,
      700,
      'center',
    );
  };

  const drawLevelMenu = (frame: RenderFrame): void => {
    const menu = frame.menu;
    if (!menu?.open) return;

    ctx.fillStyle = 'rgba(3, 7, 12, 0.86)';
    ctx.fillRect(0, 0, cssW, cssH);

    const maxW = Math.max(300, Math.min(780 * ui, cssW - 40 * ui));
    const rowH = 78 * ui;
    const h = 124 * ui + menu.levels.length * rowH + 48 * ui;
    const x = (cssW - maxW) / 2;
    const y = Math.max(16 * ui, (cssH - h) / 2);

    panel(x, y, maxW, h, C.teal, 0.96);
    text('章节目录', x + 30 * ui, y + 44 * ui, 26 * ui, C.ink, 700);
    text('CHAPTERS · 选择任意关卡', x + 30 * ui, y + 70 * ui, 10 * ui, C.muted, 600);

    menu.levels.forEach((level, index) => {
      const rowY = y + 98 * ui + index * rowH;
      const selected = index === menu.index;
      const current = level.id === frame.snapshot.levelId;

      if (selected) {
        roundRect(x + 16 * ui, rowY - 8 * ui, maxW - 32 * ui, rowH - 10 * ui, 8 * ui);
        ctx.fillStyle = rgba(C.teal, 0.1);
        ctx.fill();
        ctx.strokeStyle = rgba(C.teal, 0.42);
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      text(
        level.label ?? '',
        x + 32 * ui,
        rowY + 27 * ui,
        12 * ui,
        selected ? C.teal : C.faint,
        700,
        'left',
        'alphabetic',
        true,
      );
      text(
        level.title,
        x + 88 * ui,
        rowY + 27 * ui,
        17 * ui,
        selected ? C.ink : rgba(C.ink, 0.82),
        700,
      );
      text(
        `${level.chapter ?? ''}${level.sector ? ` · ${level.sector}` : ''}`,
        x + 88 * ui,
        rowY + 46 * ui,
        9 * ui,
        C.muted,
        500,
      );
      text(
        level.objective ?? '',
        x + 88 * ui,
        rowY + 63 * ui,
        10 * ui,
        selected ? C.teal : rgba(C.teal, 0.62),
        500,
      );

      if (current) {
        const chipW = 52 * ui;
        roundRect(x + maxW - 32 * ui - chipW, rowY + 9 * ui, chipW, 20 * ui, 10 * ui);
        ctx.fillStyle = rgba(C.green, 0.14);
        ctx.fill();
        ctx.strokeStyle = rgba(C.green, 0.55);
        ctx.lineWidth = 1;
        ctx.stroke();
        text(
          '当前',
          x + maxW - 32 * ui - chipW / 2,
          rowY + 23 * ui,
          9 * ui,
          C.green,
          700,
          'center',
        );
      }
    });

    text(
      '↑↓ 选择 · Enter 进入 · M / Esc 关闭',
      x + 30 * ui,
      y + h - 20 * ui,
      10.5 * ui,
      C.muted,
      500,
    );
  };

  const drawOverlays = (frame: RenderFrame): void => {
    if (frame.menu?.open) {
      drawLevelMenu(frame);
      return;
    }

    const snap = frame.snapshot;
    const narrative = frame.narrative;
    const level = frame.level;
    const mission = snap.mission;

    if (snap.phase === 'ready') {
      const controls = [
        'P1：WASD 移动，按一次 F 开关吸引。P2：方向键移动，按一次 Enter 开关排斥。',
        '引力是对话：吸引让方舟靠近，排斥为它留出距离。两人可以同时施力。',
        'M 打开章节目录，可直接进入任意关卡。',
      ];
      drawCard({
        eyebrow: `${narrative.chapter ?? 'THE LAST ARK'} · ${narrative.sector ?? ''}`,
        title: level?.title ?? '最后的方舟',
        lines: [
          ...narrative.briefing,
          '',
          mission?.objective ? `目标：${mission.objective}` : '',
          ...controls,
          '',
          '准备阶段可以先把两个节点移动到合适位置。',
        ].filter((line) => line !== undefined),
        cta: 'SPACE 启航',
        accent: C.teal,
        footer: EMBEDDED
          ? '点击画面获取键盘焦点 · M 章节目录 · R 重试 · 失焦自动暂停'
          : 'M 章节目录 · R 重试 · 失焦自动暂停',
        dim: 0.62,
      });
      return;
    }

    if (snap.phase === 'paused') {
      drawCard({
        eyebrow: 'PAUSED',
        title: '暂停',
        lines: ['力场与天体都已冻结。', '按 Space 继续，或按 R 从本章开头重试。'],
        cta: 'SPACE 继续',
        accent: C.blue,
        footer: 'R 重试本章',
        dim: 0.55,
      });
      return;
    }

    if (snap.phase === 'won') {
      const isLast = frame.campaign ? !frame.campaign.hasNext : false;
      drawCard({
        eyebrow: isLast ? 'CAMPAIGN COMPLETE' : 'CHAPTER CLEAR',
        title: isLast ? '群星之间' : `${level?.title ?? '章节'} · 完成`,
        lines: [narrative.success],
        cta: isLast ? 'SPACE 回到第一关' : 'SPACE 进入下一章',
        accent: C.green,
        stats: [
          ['用时', formatTime(snap.elapsedSeconds)],
          ['入港速度', `${snap.arkSpeed.toFixed(1)} px/s`],
          ...(mission?.resonanceRequired
            ? ([['共振', `${mission.resonanceCount ?? 0} / ${mission.resonanceRequired}`]] as Array<
                [string, string]
              >)
            : []),
        ],
        footer: isLast
          ? 'THE LAST ARK · 感谢试玩这个垂直切片'
          : '方舟会继续飞。下一章，仍在你们手中。',
        dim: 0.7,
      });
      return;
    }

    if (snap.phase === 'lost') {
      const reason = snap.failureReason ?? 'collision';
      drawCard({
        eyebrow: 'MISSION FAILED',
        title: '方舟失联',
        lines: [narrative.failure[reason] ?? '方舟没能通过这段航程。'],
        cta: 'R 重试本章',
        accent: C.red,
        stats: [
          ['坚持', formatTime(snap.elapsedSeconds)],
          ['速度', `${snap.arkSpeed.toFixed(1)} px/s`],
        ],
        footer: '失败会回到本章开头；先观察，再施力。',
        dim: 0.7,
      });
    }
  };

  /* ------------------------------- render ------------------------------ */

  const render = (frame: RenderFrame): void => {
    const snap = frame.snapshot;
    if (!Number.isFinite(cssW) || !Number.isFinite(cssH) || cssW <= 0 || cssH <= 0) return;
    if (!Number.isFinite(snap.world.width) || !Number.isFinite(snap.world.height)) return;

    if (snap.phase === 'running') lastRunningVisual = frame.visualTimeSeconds;
    const visualTime = snap.phase === 'running' ? frame.visualTimeSeconds : lastRunningVisual;

    if (snap.runId !== lastRunId || snap.levelId !== lastLevelId) {
      lastRunId = snap.runId;
      lastLevelId = snap.levelId;
      trail = [];
      seenEvents = new Set<string>();
      lastHeading = 0;
    }

    for (const event of frame.events) {
      const key = `${event.runId}:${event.eventId}`;
      if (seenEvents.has(key)) continue;
      seenEvents.add(key);
      if (event.type === 'failed') {
        flash = { color: C.red, until: frame.visualTimeSeconds + 0.55 };
      } else if (event.type === 'docked') {
        flash = { color: C.green, until: frame.visualTimeSeconds + 0.55 };
      }
    }

    scale = Math.min(cssW / snap.world.width, cssH / snap.world.height);
    offsetX = (cssW - snap.world.width * scale) / 2;
    offsetY = (cssH - snap.world.height * scale) / 2;
    ui = clamp(Math.min(cssW / 1200, cssH / 720), 0.72, 1.4);

    const interpolation = clamp(frame.interpolationAlpha, 0, 1);
    const interpolated: FrameSnapshot = {
      ...snap,
      players: snap.players.map((player) => ({
        ...player,
        position: lerpPos(player.previousPosition, player.position, interpolation),
      })),
      bodies: snap.bodies.map((body) => ({
        ...body,
        position: lerpPos(body.previousPosition, body.position, interpolation),
      })),
    };

    const scene: RenderFrame = { ...frame, snapshot: interpolated };

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, cssW, cssH);

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);
    ctx.beginPath();
    ctx.rect(0, 0, snap.world.width, snap.world.height);
    ctx.clip();
    drawWorld(scene, visualTime);
    ctx.restore();

    if (flash.until > frame.visualTimeSeconds) {
      const remaining = clamp((flash.until - frame.visualTimeSeconds) / 0.55, 0, 1);
      ctx.fillStyle = rgba(flash.color, remaining * 0.18);
      ctx.fillRect(0, 0, cssW, cssH);
    }

    drawHud(scene);
    drawOverlays(scene);

    if (cssW / cssH < 1.1) {
      text(
        '建议横向全屏游玩',
        cssW / 2,
        cssH - 4 * ui,
        9 * ui,
        rgba(C.faint, 0.9),
        500,
        'center',
        'bottom',
      );
    }
  };

  return {
    resize,
    render,
    dispose() {
      starCache.clear();
      trail = [];
      seenEvents.clear();
    },
  };
}
