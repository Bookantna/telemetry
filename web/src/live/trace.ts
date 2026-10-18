// Input Trace: the last few seconds of throttle and brake on one shared 0–100% chart, so a
// brake release that fades into the corner (Trail Braking) and its hand-over to the throttle
// are easy to see.

import { cssVar, fitCanvas, h, setText } from '../dom.ts';
import { TRACE_SECONDS, type ClientState, type TracePoint } from '../state.ts';

const PAD_TOP = 14;
const PAD_BOTTOM = 22;
const PAD_RIGHT = 16;

export class InputTrace {
  readonly el: HTMLElement;
  private readonly canvas = h('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly throttleValue = h('span', { class: 'value num', text: '—' });
  private readonly brakeValue = h('span', { class: 'value num', text: '—' });
  private readonly state: ClientState;
  private colours: Record<'throttle' | 'brake' | 'grid' | 'axis' | 'panel' | 'ink3', string> | null = null;

  constructor(state: ClientState) {
    this.state = state;
    this.ctx = this.canvas.getContext('2d')!;
    this.el = h(
      'section',
      { class: 'panel trace-panel', attrs: { 'aria-label': 'Input Trace' } },
      h(
        'div',
        { class: 'trace-gutter' },
        h('span', { class: 'label', text: 'Inputs · 5 s' }),
        h('div', { class: 'trace-lane-label', attrs: { style: '--c: var(--throttle)' } }, h('span', { class: 'name', text: 'Throttle' }), this.throttleValue),
        h('div', { class: 'trace-lane-label', attrs: { style: '--c: var(--brake)' } }, h('span', { class: 'name', text: 'Brake' }), this.brakeValue),
      ),
      h('div', { class: 'trace-plot' }, this.canvas),
    );
  }

  render(): void {
    const f = this.state.frame;
    setText(this.throttleValue, f ? `${Math.round(f.thr * 100)}%` : '—');
    setText(this.brakeValue, f ? `${Math.round(f.brk * 100)}%` : '—');

    const { w, h: height, dpr } = fitCanvas(this.canvas);
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, height);
    if (w < 40 || height < 40) return;
    this.colours ??= {
      throttle: cssVar('--throttle'),
      brake: cssVar('--brake'),
      grid: cssVar('--grid'),
      axis: cssVar('--axis'),
      panel: cssVar('--panel'),
      ink3: cssVar('--ink-3'),
    };
    const c = this.colours;

    const plotW = w - PAD_RIGHT;
    const plotH = height - PAD_TOP - PAD_BOTTOM;
    const base = PAD_TOP + plotH;
    const now = f?.t ?? 0;
    const xAt = (t: number) => plotW - ((now - t) / TRACE_SECONDS) * plotW;
    const yAt = (v: number) => base - Math.max(0, Math.min(1, v)) * plotH;

    // Recessive grid: one vertical hairline per second, quarter lines, then the baseline.
    ctx.lineWidth = 1;
    ctx.strokeStyle = c.grid;
    ctx.beginPath();
    for (let s = 1; s < TRACE_SECONDS; s++) {
      const x = Math.round(plotW - (s / TRACE_SECONDS) * plotW) + 0.5;
      ctx.moveTo(x, PAD_TOP);
      ctx.lineTo(x, base);
    }
    for (const v of [0.25, 0.5, 0.75, 1]) {
      const y = Math.round(yAt(v)) + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(plotW, y);
    }
    ctx.stroke();
    ctx.strokeStyle = c.axis;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(base) + 0.5);
    ctx.lineTo(plotW, Math.round(base) + 0.5);
    ctx.stroke();

    ctx.fillStyle = c.ink3;
    ctx.font = '500 10px Inter Variable, system-ui, sans-serif';
    ctx.textBaseline = 'alphabetic';
    for (let s = 0; s <= TRACE_SECONDS; s++) {
      const x = plotW - (s / TRACE_SECONDS) * plotW;
      ctx.textAlign = s === 0 ? 'right' : s === TRACE_SECONDS ? 'left' : 'center';
      ctx.fillText(s === 0 ? 'now' : `−${s} s`, x, height - 6);
    }

    const pts = this.state.trace;
    if (!f || pts.length < 2) return;
    let first = 0;
    while (first < pts.length - 1 && xAt(pts[first + 1].t) < 0) first++;
    const series = [
      { key: 'thr' as const, colour: c.throttle },
      { key: 'brk' as const, colour: c.brake },
    ];

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, PAD_TOP - 3, plotW + 6, plotH + 6);
    ctx.clip();
    // Both washes first so neither line is tinted by the other's fill. Brake is drawn last,
    // on top, since its release into the throttle is what this chart is for.
    for (const s of series) this.drawWash(pts, first, s.key, s.colour, xAt, yAt, base);
    for (const s of series) this.drawLine(pts, first, s.key, s.colour, xAt, yAt);
    ctx.restore();
    for (const s of series) this.drawMarker(pts[pts.length - 1], s.key, s.colour, xAt, yAt);
  }

  private drawWash(
    pts: TracePoint[],
    first: number,
    key: 'thr' | 'brk',
    colour: string,
    xAt: (t: number) => number,
    yAt: (v: number) => number,
    base: number,
  ): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(xAt(pts[first].t), base);
    for (let i = first; i < pts.length; i++) ctx.lineTo(xAt(pts[i].t), yAt(pts[i][key]));
    ctx.lineTo(xAt(pts[pts.length - 1].t), base);
    ctx.closePath();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = colour;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  private drawLine(
    pts: TracePoint[],
    first: number,
    key: 'thr' | 'brk',
    colour: string,
    xAt: (t: number) => number,
    yAt: (v: number) => number,
  ): void {
    const ctx = this.ctx;
    ctx.beginPath();
    for (let i = first; i < pts.length; i++) {
      const x = xAt(pts[i].t);
      const y = yAt(pts[i][key]);
      if (i === first) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = colour;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  /** End marker with a surface ring. */
  private drawMarker(
    last: TracePoint,
    key: 'thr' | 'brk',
    colour: string,
    xAt: (t: number) => number,
    yAt: (v: number) => number,
  ): void {
    const ctx = this.ctx;
    const x = xAt(last.t);
    const y = yAt(last[key]);
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fillStyle = this.colours!.panel;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = colour;
    ctx.fill();
  }
}
