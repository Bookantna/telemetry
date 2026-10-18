// Everything the dashboard knows, updated from server messages and read by the render loop.

import type { CarInfo, FeedStatus, LiveFrame, ReferenceInfo, ServerMessage, SessionInfo, TimingInfo } from '../../shared/protocol.ts';

/** Input Trace window. */
export const TRACE_SECONDS = 5;
/** Spacing of the live Driving Line points, metres. */
const LINE_STEP = 2;

export interface TracePoint {
  t: number;
  thr: number;
  brk: number;
}

export class ClientState {
  socketOpen = false;
  urls: string[] = [];
  udpPort = 20777;
  feed: FeedStatus | null = null;
  session: SessionInfo | null = null;
  frame: LiveFrame | null = null;
  car: CarInfo | null = null;
  timing: TimingInfo | null = null;
  trackMap: number[] | null = null;
  reference: ReferenceInfo | null = null;
  currentLine: number[] = [];
  currentLapNum = 0;
  trace: TracePoint[] = [];
  /** Bumped when the Track Map or Reference Lap line changes, so cached drawings are rebuilt. */
  mapVersion = 0;
  /** Car colours by index, from the timing rows. */
  colours = new Map<number, string>();
  /** Called when a lap is recorded, changed or removed. */
  readonly lapListeners = new Set<() => void>();

  apply(msg: ServerMessage): void {
    switch (msg.type) {
      case 'hello':
        this.urls = msg.urls;
        this.udpPort = msg.udpPort;
        break;
      case 'status':
        this.feed = msg.feed;
        this.session = msg.session;
        break;
      case 'frame':
        this.onFrame(msg.f);
        break;
      case 'car':
        this.car = msg.car;
        break;
      case 'timing':
        this.timing = msg.timing;
        for (const row of msg.timing.rows) this.colours.set(row.idx, row.colour);
        break;
      case 'trackMap':
        this.trackMap = msg.points;
        this.mapVersion++;
        break;
      case 'reference':
        this.reference = msg.reference;
        this.mapVersion++;
        break;
      case 'currentLine':
        this.currentLapNum = msg.lapNum;
        this.currentLine = msg.points.slice();
        break;
      case 'lap':
      case 'lapRemoved':
        for (const listener of this.lapListeners) listener();
        break;
    }
  }

  private onFrame(f: LiveFrame): void {
    const previous = this.frame;
    this.frame = f;

    // A Flashback rewinds session time: the rolling Input Trace starts over.
    if (previous && f.t < previous.t) this.trace = [];
    this.trace.push({ t: f.t, thr: f.thr, brk: f.brk });
    const cutoff = f.t - TRACE_SECONDS - 0.5;
    let drop = 0;
    while (drop < this.trace.length && this.trace[drop].t < cutoff) drop++;
    if (drop) this.trace.splice(0, drop);

    if (f.lapNum !== this.currentLapNum && this.currentLapNum !== 0 && f.lapNum > this.currentLapNum) {
      // The server also sends currentLine at a new lap; start fresh in case it arrives late.
      this.currentLine = [];
      this.currentLapNum = f.lapNum;
    }
    const n = this.currentLine.length;
    if (n < 2 || Math.hypot(f.x - this.currentLine[n - 2], f.z - this.currentLine[n - 1]) >= LINE_STEP) {
      this.currentLine.push(f.x, f.z);
    }
  }
}
