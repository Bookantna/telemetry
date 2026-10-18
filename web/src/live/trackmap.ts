// Track Map with your Driving Line over the Reference Lap's line, every car, and a
// close-up that follows your car with the direction of travel pointing up.

import { cssVar, fitCanvas, h, icon, toggle } from '../dom.ts';
import type { ClientState } from '../state.ts';

interface Orientation {
  rot: number;
  mirror: boolean;
}

interface View {
  /** World-to-screen matrix in CSS pixels: [a, b, c, d, e, f]. */
  m: [number, number, number, number, number, number];
  scale: number;
}

const PAD = 28;
/** Close-up window width, metres. */
const CLOSE_UP_METRES = 150;
/** Track surface width in the close-up, metres. */
const TRACK_WIDTH_METRES = 13;

export class TrackMapView {
  readonly el: HTMLElement;
  private readonly canvas = h('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly layer = document.createElement('canvas');
  private readonly layerCtx: CanvasRenderingContext2D;
  private readonly message = h('div', { class: 'map-message' });
  private readonly refKey = h('span', {}, h('span', { class: 'key', attrs: { style: '--c: var(--ref)' } }), 'Reference Lap');
  private readonly closeUpButton: HTMLButtonElement;
  private readonly state: ClientState;

  private trackId = -1;
  private orientation: Orientation = { rot: 0, mirror: false };
  private closeUp = true;
  private view: View | null = null;
  private layerKey = '';
  private autoAngle = 0;
  private fitKey = '';
  private lastFitAt = 0;
  /** Top-left of the close-up, in the corner of the panel with the least track under it. */
  private closeUpAt: { x: number; y: number } | null = null;
  private colours = { track: '', trackEdge: '', you: '', ref: '', panel: '', ink: '', ink3: '' };

  constructor(state: ClientState) {
    this.state = state;
    this.ctx = this.canvas.getContext('2d')!;
    this.layerCtx = this.layer.getContext('2d')!;

    const rotate = this.tool('rotate', 'Rotate map', () => this.setOrientation({ ...this.orientation, rot: (this.orientation.rot + 1) % 4 }));
    const mirror = this.tool('flip', 'Mirror map', () => this.setOrientation({ ...this.orientation, mirror: !this.orientation.mirror }));
    this.closeUpButton = this.tool('target', 'Show or hide the close-up', () => {
      this.closeUp = !this.closeUp;
      localStorage.setItem('map:closeUp', this.closeUp ? '1' : '0');
      toggle(this.closeUpButton, 'off', !this.closeUp);
    });
    this.closeUp = localStorage.getItem('map:closeUp') !== '0';
    toggle(this.closeUpButton, 'off', !this.closeUp);

    this.el = h(
      'section',
      { class: 'panel map-panel', attrs: { 'aria-label': 'Track Map' } },
      this.canvas,
      this.message,
      h(
        'div',
        { class: 'map-overlay' },
        h('div', { class: 'map-top' }, h('span', { class: 'label', text: 'Track Map' }), h('div', { class: 'map-tools' }, rotate, mirror, this.closeUpButton)),
        h('div', { class: 'legend' }, h('span', {}, h('span', { class: 'key', attrs: { style: '--c: var(--you)' } }), 'This lap'), this.refKey),
      ),
    );
  }

  private tool(name: string, title: string, onClick: () => void): HTMLButtonElement {
    const button = h('button', { class: 'icon-button', attrs: { type: 'button', title, 'aria-label': title } }, icon(name));
    button.addEventListener('click', onClick);
    return button;
  }

  private setOrientation(o: Orientation): void {
    this.orientation = o;
    localStorage.setItem(`map:${this.trackId}`, JSON.stringify(o));
    this.fitKey = '';
  }

  render(now: number): void {
    const s = this.state;
    const trackId = s.session?.trackId ?? -1;
    if (trackId !== this.trackId) {
      this.trackId = trackId;
      const saved = localStorage.getItem(`map:${trackId}`);
      this.orientation = saved ? (JSON.parse(saved) as Orientation) : { rot: 0, mirror: false };
      this.fitKey = '';
    }
    if (!this.colours.track) this.readColours();

    const { w, h: height, dpr, changed } = fitCanvas(this.canvas);
    if (w < 10 || height < 10) return;
    if (changed) {
      this.layer.width = this.canvas.width;
      this.layer.height = this.canvas.height;
      this.fitKey = '';
    }

    const outline = s.trackMap;
    const fitPoints = outline ?? (s.reference?.line.length ? s.reference.line : s.currentLine);
    this.message.textContent = outline
      ? ''
      : s.frame
        ? 'Drawing the Track Map from your first full lap here…'
        : 'The Track Map appears once you are on track.';
    this.refKey.style.display = s.reference ? '' : 'none';

    // Refit when the map, size or orientation changes; while the map is still being drawn, once a second.
    const fitKey = `${s.mapVersion}|${w}x${height}|${this.orientation.rot}|${this.orientation.mirror}|${outline ? 'map' : 'line'}`;
    if (fitPoints.length >= 4 && (fitKey !== this.fitKey || (!outline && now - this.lastFitAt > 1000))) {
      if (fitKey !== this.fitKey || !outline) this.autoAngle = bestAngle(fitPoints, w, height, this.orientation.mirror);
      this.fitKey = fitKey;
      this.lastFitAt = now;
      this.view = fit(fitPoints, w, height, this.autoAngle + (this.orientation.rot * Math.PI) / 2, this.orientation.mirror);
      this.closeUpAt = emptiestCorner(this.view, fitPoints, w, height);
    }
    const view = this.view;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!view) return;

    const layerKey = `${this.fitKey}|${this.lastFitAt}`;
    if (layerKey !== this.layerKey) {
      this.layerKey = layerKey;
      this.drawLayer(view, dpr);
    }
    ctx.drawImage(this.layer, 0, 0);

    // This lap's Driving Line.
    applyView(ctx, view, dpr);
    strokeLine(ctx, s.currentLine, this.colours.you, 2.25 / view.scale, false);

    // Cars, in screen space so they stay the same size at any zoom.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const f = s.frame;
    if (f) {
      for (let i = 0; i < f.cars.length; i += 3) {
        const [x, y] = project(view, f.cars[i + 1], f.cars[i + 2]);
        dot(ctx, x, y, 4, s.colours.get(f.cars[i]) ?? this.colours.ink3, this.colours.panel);
      }
      const [px, py] = project(view, f.x, f.z);
      dot(ctx, px, py, 6.5, this.colours.ink, this.colours.you, 3);
      if (this.closeUp && outline) this.drawCloseUp(w, height, dpr);
    }
  }

  private readColours(): void {
    this.colours = {
      track: '#20242a',
      trackEdge: '#2b3038',
      you: cssVar('--you'),
      ref: cssVar('--ref'),
      panel: cssVar('--panel'),
      ink: cssVar('--ink'),
      ink3: cssVar('--ink-3'),
    };
  }

  private drawLayer(view: View, dpr: number): void {
    const ctx = this.layerCtx;
    const s = this.state;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.layer.width, this.layer.height);
    applyView(ctx, view, dpr);
    const outline = s.trackMap;
    if (outline) {
      strokeLine(ctx, outline, this.colours.trackEdge, 11 / view.scale, true);
      strokeLine(ctx, outline, this.colours.track, 8 / view.scale, true);
    }
    if (s.reference) strokeLine(ctx, s.reference.line, this.colours.ref, 1.75 / view.scale, false);

    if (outline) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.drawMarker(ctx, view, outline, 0, 'S/F', true);
      const length = s.session?.trackLength ?? 0;
      if (length > 0) {
        if (s.session!.sector2Start > 0) this.drawMarker(ctx, view, outline, s.session!.sector2Start / length, 'S2', false);
        if (s.session!.sector3Start > 0) this.drawMarker(ctx, view, outline, s.session!.sector3Start / length, 'S3', false);
      }
    }
  }

  /** A tick across the track at a fraction of the lap, with a small label. */
  private drawMarker(ctx: CanvasRenderingContext2D, view: View, line: number[], fraction: number, label: string, strong: boolean): void {
    const n = line.length / 2;
    const i = Math.min(n - 2, Math.max(0, Math.round(fraction * (n - 1))));
    const [x0, y0] = project(view, line[i * 2], line[i * 2 + 1]);
    const [x1, y1] = project(view, line[i * 2 + 2], line[i * 2 + 3]);
    const len = Math.hypot(x1 - x0, y1 - y0) || 1;
    const nx = -(y1 - y0) / len;
    const ny = (x1 - x0) / len;
    ctx.strokeStyle = strong ? this.colours.ink : this.colours.ink3;
    ctx.lineWidth = strong ? 2.5 : 1.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x0 - nx * 8, y0 - ny * 8);
    ctx.lineTo(x0 + nx * 8, y0 + ny * 8);
    ctx.stroke();
    ctx.fillStyle = this.colours.ink3;
    ctx.font = '600 10px Inter Variable, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x0 + nx * 20, y0 + ny * 20);
  }

  private drawCloseUp(w: number, height: number, dpr: number): void {
    const s = this.state;
    const f = s.frame!;
    const outline = s.trackMap!;
    const { bw, bh } = closeUpSize(w, height);
    if (bw < 120 || bh < 90 || !this.closeUpAt) return;
    const { x: bx, y: by } = this.closeUpAt;
    const ctx = this.ctx;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save();
    roundRect(ctx, bx, by, bw, bh, 10);
    ctx.fillStyle = '#0b0c0f';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.09)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.clip();

    const m = this.orientation.mirror ? -1 : 1;
    const heading = this.orientation.mirror ? Math.PI - f.heading : f.heading;
    const theta = -Math.PI / 2 - heading;
    const scale = bw / CLOSE_UP_METRES;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const a = m * cos * scale;
    const b = m * sin * scale;
    const c = -sin * scale;
    const d = cos * scale;
    const cx = bx + bw / 2;
    const cy = by + bh * 0.66;
    const view: View = { m: [a, b, c, d, cx - (a * f.x + c * f.z), cy - (b * f.x + d * f.z)], scale };

    applyView(ctx, view, dpr);
    strokeLine(ctx, outline, this.colours.trackEdge, TRACK_WIDTH_METRES + 1.2, true);
    strokeLine(ctx, outline, this.colours.track, TRACK_WIDTH_METRES, true);
    if (s.reference) strokeLine(ctx, s.reference.line, this.colours.ref, 2 / scale, false);
    strokeLine(ctx, s.currentLine.slice(-600), this.colours.you, 2.5 / scale, false);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (let i = 0; i < f.cars.length; i += 3) {
      const [x, y] = project(view, f.cars[i + 1], f.cars[i + 2]);
      dot(ctx, x, y, 4.5, s.colours.get(f.cars[i]) ?? this.colours.ink3, this.colours.panel);
    }
    // Your car: an arrow pointing up, the direction of travel.
    ctx.beginPath();
    ctx.moveTo(cx, cy - 9);
    ctx.lineTo(cx + 6, cy + 7);
    ctx.lineTo(cx, cy + 4);
    ctx.lineTo(cx - 6, cy + 7);
    ctx.closePath();
    ctx.fillStyle = this.colours.ink;
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = this.colours.ink3;
    ctx.font = '600 10px Inter Variable, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('CLOSE-UP', bx + 10, by + 9);
  }
}

function closeUpSize(w: number, h: number): { bw: number; bh: number } {
  const bw = Math.min(w * 0.4, 270);
  return { bw, bh: Math.min(bw * 0.78, h * 0.5) };
}

/** Of the four corners (clear of the title, tools and legend), the one covering the fewest track points. */
function emptiestCorner(view: View, pts: number[], w: number, h: number): { x: number; y: number } {
  const { bw, bh } = closeUpSize(w, h);
  const corners = [
    { x: w - bw - 12, y: h - bh - 12 },
    { x: 12, y: h - bh - 40 },
    { x: w - bw - 12, y: 54 },
    { x: 12, y: 38 },
  ];
  let best = corners[0];
  let bestCount = Infinity;
  for (const c of corners) {
    let count = 0;
    for (let i = 0; i < pts.length; i += 2) {
      const [x, y] = project(view, pts[i], pts[i + 1]);
      if (x > c.x - 8 && x < c.x + bw + 8 && y > c.y - 8 && y < c.y + bh + 8) count++;
    }
    if (count < bestCount) {
      bestCount = count;
      best = c;
    }
  }
  return best;
}

function applyView(ctx: CanvasRenderingContext2D, view: View, dpr: number): void {
  const [a, b, c, d, e, f] = view.m;
  ctx.setTransform(a * dpr, b * dpr, c * dpr, d * dpr, e * dpr, f * dpr);
}

function project(view: View, x: number, z: number): [number, number] {
  const [a, b, c, d, e, f] = view.m;
  return [a * x + c * z + e, b * x + d * z + f];
}

function strokeLine(ctx: CanvasRenderingContext2D, pts: number[], colour: string, width: number, closed: boolean): void {
  if (pts.length < 4) return;
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  if (closed) ctx.closePath();
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
}

/** A filled dot with a ring in the surface colour, so it stays legible where it crosses a line. */
function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, ring: string, ringWidth = 2): void {
  ctx.beginPath();
  ctx.arc(x, y, r + ringWidth, 0, Math.PI * 2);
  ctx.fillStyle = ring;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function bounds(pts: number[], angle: number, mirror: boolean) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const m = mirror ? -1 : 1;
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    const x = m * pts[i];
    const z = pts[i + 1];
    const u = x * cos - z * sin;
    const v = x * sin + z * cos;
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  return { minU, maxU, minV, maxV };
}

/** The rotation that lets the circuit fill the panel best. */
function bestAngle(pts: number[], w: number, h: number, mirror: boolean): number {
  let best = 0;
  let bestScale = 0;
  for (let deg = 0; deg < 180; deg += 3) {
    const angle = (deg * Math.PI) / 180;
    const b = bounds(pts, angle, mirror);
    const scale = Math.min((w - PAD * 2) / Math.max(b.maxU - b.minU, 1), (h - PAD * 2) / Math.max(b.maxV - b.minV, 1));
    if (scale > bestScale * 1.02) {
      bestScale = scale;
      best = angle;
    }
  }
  return best;
}

function fit(pts: number[], w: number, h: number, angle: number, mirror: boolean): View {
  const b = bounds(pts, angle, mirror);
  const scale = Math.min((w - PAD * 2) / Math.max(b.maxU - b.minU, 1), (h - PAD * 2) / Math.max(b.maxV - b.minV, 1));
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const m = mirror ? -1 : 1;
  const ox = w / 2 - ((b.minU + b.maxU) / 2) * scale;
  const oy = h / 2 - ((b.minV + b.maxV) / 2) * scale;
  return { m: [m * cos * scale, m * sin * scale, -sin * scale, cos * scale, ox, oy], scale };
}
