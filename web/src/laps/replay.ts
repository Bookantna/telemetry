// Lap Replay (CONTEXT.md): plays one Recorded Lap back on the Track Map, with its throttle
// and brake in the Input Trace, at a speed you choose. The live map and trace are reused:
// every frame they are handed the moment of the lap the playhead is at.

import { formatLapTime } from '../../../shared/format.ts';
import type { LapReplay } from '../../../shared/protocol.ts';
import { h, icon, setText } from '../dom.ts';
import { gearLabel } from '../live/panels.ts';
import { InputTrace } from '../live/trace.ts';
import { TrackMapView } from '../live/trackmap.ts';
import { TRACE_SECONDS, type TracePoint } from '../state.ts';
import { lapTags } from './laps.ts';
import { headings, indexAt, momentAt, type Moment } from './timeline.ts';

const SPEEDS = [0.25, 0.5, 1, 2, 4];
/** How far ← and → jump. */
const STEP_SECONDS = 1;
/** Driving Line point spacing, metres, as on the live map. */
const LINE_STEP = 2;

export function mountReplay(root: HTMLElement, lapId: number): () => void {
  const head = h(
    'div',
    { class: 'laps-head' },
    h('a', { class: 'icon-button', attrs: { href: '#/laps', title: 'Back to Recorded Laps', 'aria-label': 'Back to Recorded Laps' } }, icon('back')),
    h('h1', { text: 'Lap Replay' }),
  );
  const message = h('div', { class: 'empty', text: 'Loading…' });
  const page = h('main', { class: 'replay-page' }, head, message);
  root.replaceChildren(page);

  let mounted = true;
  let stop = () => {};
  void (async () => {
    const res = await fetch(`/api/laps/${lapId}`).catch(() => null);
    const data = res?.ok ? ((await res.json()) as LapReplay) : null;
    if (!mounted) return;
    if (!data || data.samples.sessionTime.length < 2) {
      message.textContent =
        res?.status === 404 ? 'This lap no longer exists.' : data ? 'This lap is too short to replay.' : 'Could not load this lap.';
      return;
    }
    stop = play(data, head, message);
  })();

  return () => {
    mounted = false;
    stop();
  };
}

function play(data: LapReplay, head: HTMLElement, placeholder: HTMLElement): () => void {
  const { lap, samples: s } = data;
  const times = s.sessionTime;
  const t0 = times[0];
  const t1 = times[times.length - 1];
  // The game's lap time ends at the line, a frame after the last sample.
  const endLapMs = lap.lapTimeMs ?? s.lapMs[s.lapMs.length - 1];
  const heads = headings(s);
  const points: TracePoint[] = times.map((t, i) => ({ t, thr: s.throttle[i], brk: s.brake[i] }));
  // Driving Line points and the sample each was taken at, so the line grows with the playhead.
  const line: number[] = [];
  const lineAt: number[] = [];
  for (let i = 0; i < times.length; i++) {
    const n = line.length;
    if (n && Math.hypot(s.x[i] - line[n - 2], s.z[i] - line[n - 1]) < LINE_STEP) continue;
    line.push(s.x[i], s.z[i]);
    lineAt.push(i);
  }

  // What the map and trace read. The whole lap is drawn faintly as the "reference" line,
  // with the part already played over it, as on the live map.
  const view = {
    session: { trackId: lap.trackId, trackLength: 0, sector2Start: 0, sector3Start: 0 },
    trackMap: data.trackMap,
    reference: { line },
    currentLine: [] as number[],
    frame: null as (Moment & { cars: number[] }) | null,
    colours: new Map<number, string>(),
    mapVersion: 0,
    trace: [] as TracePoint[],
  };
  const map = new TrackMapView(view);
  const trace = new InputTrace(view);

  const playButton = h('button', { class: 'icon-button play', attrs: { type: 'button' } });
  const speedButtons = SPEEDS.map((x) => h('button', { class: 'num', text: `${x}×`, attrs: { type: 'button' } }));
  const seek = h('input', {
    class: 'seek',
    attrs: { type: 'range', min: '0', max: String(t1 - t0), step: 'any', value: '0', 'aria-label': 'Position in the lap' },
  });
  const clock = h('span', { class: 'replay-clock num' });
  const readout = h('span', { class: 'replay-readout num' });

  head.append(
    h('span', { class: 'replay-title', text: `${lap.trackName} · Lap ${lap.lapNum}` }),
    h('span', { class: 'num', text: lap.lapTimeMs === null ? '' : formatLapTime(lap.lapTimeMs) }),
    ...lapTags(lap),
  );
  placeholder.replaceWith(
    map.el,
    trace.el,
    h(
      'div',
      { class: 'replay-controls' },
      playButton,
      seek,
      clock,
      h('div', { class: 'speeds', attrs: { role: 'group', 'aria-label': 'Playback speed' } }, ...speedButtons),
      readout,
    ),
  );

  let t = t0;
  let playing = false;
  let speed = 1;
  let last = performance.now();

  const seekTo = (to: number) => {
    t = Math.max(t0, Math.min(t1, to));
  };
  const setPlaying = (on: boolean) => {
    if (on && t >= t1) t = t0; // Play at the end starts over.
    playing = on;
    const label = on ? 'Pause' : 'Play';
    playButton.replaceChildren(icon(on ? 'pause' : 'play'));
    playButton.setAttribute('aria-label', label);
    playButton.title = `${label} (Space)`;
  };
  const setSpeed = (x: number) => {
    speed = x;
    speedButtons.forEach((b, k) => b.setAttribute('aria-pressed', String(SPEEDS[k] === x)));
  };
  setPlaying(false);
  setSpeed(1);

  playButton.addEventListener('click', () => setPlaying(!playing));
  speedButtons.forEach((b, k) => b.addEventListener('click', () => setSpeed(SPEEDS[k])));
  seek.addEventListener('input', () => seekTo(t0 + Number(seek.value)));

  const onKey = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ') {
      // A focused button would also click on key-up; take focus off it first.
      (document.activeElement as HTMLElement | null)?.blur();
      setPlaying(!playing);
    } else if (e.key === 'ArrowLeft') seekTo(t - STEP_SECONDS);
    else if (e.key === 'ArrowRight') seekTo(t + STEP_SECONDS);
    else return;
    e.preventDefault();
  };
  window.addEventListener('keydown', onKey);

  let frame = 0;
  const loop = (now: number) => {
    if (playing) {
      seekTo(t + ((now - last) / 1000) * speed);
      if (t >= t1) setPlaying(false);
    }
    last = now;

    const m = momentAt(s, heads, t);
    view.frame = { ...m, cars: [] };
    view.trace = points.slice(indexAt(times, t - TRACE_SECONDS - 0.5), m.i + 1);
    view.trace.push({ t, thr: m.thr, brk: m.brk });
    view.currentLine = line.slice(0, (indexAt(lineAt, m.i) + 1) * 2);
    view.currentLine.push(m.x, m.z);
    map.render(now);
    trace.render();

    seek.value = String(t - t0);
    setText(clock, `${formatLapTime(t >= t1 ? endLapMs : m.lapMs)} / ${formatLapTime(endLapMs)}`);
    setText(readout, `${gearLabel(m.gear)} · ${Math.round(m.speed)} km/h`);
    frame = requestAnimationFrame(loop);
  };
  frame = requestAnimationFrame(loop);

  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener('keydown', onKey);
  };
}
