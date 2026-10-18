import { ERS_MAX_JOULES, FUEL_MIX, SESSION_GROUP_NAMES, visualCompound } from '../../../shared/f1.ts';
import { formatDelta, formatLapTime, formatSector } from '../../../shared/format.ts';
import type { TimingRow } from '../../../shared/protocol.ts';
import { h, icon, setText, setVar, toggle } from '../dom.ts';
import type { ClientState } from '../state.ts';

/** Delta bar range, seconds either side of zero. */
const DELTA_RANGE = 1;

// ---------------------------------------------------------------- Top bar

export class TopBar {
  readonly el: HTMLElement;
  private readonly track = h('span', { class: 'track-name', text: 'F1 25 Telemetry' });
  private readonly session = h('span', { class: 'session-name' });
  private readonly generation = h('span', { class: 'chip' });
  private readonly conditions = h('span', { class: 'chip' });
  private readonly temps = h('span', { class: 'chip num' });
  private readonly lapNow = h('span');
  private readonly lapTotal = h('span', { class: 'muted' });
  private readonly lap = h('span', { class: 'lap-counter num' }, this.lapNow, this.lapTotal);
  private readonly conn = h('span', { class: 'conn' }, h('span', { class: 'dot' }), h('span'));
  private readonly state: ClientState;

  constructor(state: ClientState) {
    this.state = state;
    this.el = h(
      'header',
      { class: 'top' },
      h('div', { class: 'brand' }, h('span', { class: 'brand-mark', text: 'T' })),
      h('div', { class: 'session-title' }, this.track, this.session),
      h('div', { class: 'chips' }, this.generation, this.conditions, this.temps),
      h('div', { class: 'spacer' }),
      this.lap,
      this.conn,
      h('a', { class: 'icon-button', attrs: { href: '#/laps', title: 'Recorded Laps', 'aria-label': 'Recorded Laps' } }, icon('list')),
    );
  }

  render(): void {
    const s = this.state;
    const session = s.session;
    setText(this.track, session?.trackName ?? 'F1 25 Telemetry');
    setText(this.session, session ? session.sessionTypeName : '');
    const showChips = Boolean(session);
    this.generation.style.display = showChips ? '' : 'none';
    this.conditions.style.display = showChips ? '' : 'none';
    this.temps.style.display = showChips ? '' : 'none';
    if (session) {
      setText(this.generation, generationLabel(session.generation));
      setText(this.conditions, session.conditions === 'wet' ? 'Wet' : 'Dry');
      setText(this.temps, `Air ${session.airTemperature}° · Track ${session.trackTemperature}°`);
    }

    const f = s.frame;
    const total = s.timing?.totalLaps ?? 0;
    const showLap = Boolean(f && s.feed?.receiving);
    this.lap.style.display = showLap ? '' : 'none';
    setText(this.lapNow, f ? `Lap ${f.lapNum}` : '');
    setText(this.lapTotal, f && total > 0 && session?.group === 'race' ? ` / ${total}` : '');

    const [, label] = this.conn.children;
    const live = s.socketOpen && Boolean(s.feed?.receiving);
    toggle(this.conn, 'live', live);
    toggle(this.conn, 'waiting', s.socketOpen && !live);
    toggle(this.conn, 'offline', !s.socketOpen);
    setText(label, !s.socketOpen ? 'OFFLINE' : live ? `LIVE · ${s.feed?.format ?? ''}` : 'WAITING');
  }
}

export function generationLabel(g: string): string {
  return g === '2025' || g === '2026' ? `${g} cars` : g;
}

// ---------------------------------------------------------------- Delta

export class DeltaPanel {
  readonly el: HTMLElement;
  private readonly refBadge = h('span', { class: 'ref-badge' });
  private readonly value = h('div', { class: 'delta-value num', text: '—' });
  private readonly fill = h('div', { class: 'delta-fill' });
  private readonly flag = h('span', { class: 'lap-flag', text: '✕ Lap invalid' });
  private readonly current = h('div', { class: 'value num', text: '—' });
  private readonly predicted = h('div', { class: 'value num', text: '—' });
  private readonly last = h('div', { class: 'value num', text: '—' });
  private readonly best = h('div', { class: 'value num', text: '—' });
  private readonly bestLabel = h('span', { class: 'label', text: 'Best lap' });
  private readonly state: ClientState;

  constructor(state: ClientState) {
    this.state = state;
    this.el = h(
      'section',
      { class: 'panel delta-panel', attrs: { 'aria-label': 'Delta' } },
      h('div', { class: 'panel-head' }, h('span', { class: 'label', text: 'Delta' }), this.refBadge),
      this.value,
      h('div', { class: 'delta-bar' }, this.fill),
      h('div', { class: 'delta-scale num' }, h('span', { text: `−${DELTA_RANGE.toFixed(1)}` }), h('span', { text: 'faster · slower' }), h('span', { text: `+${DELTA_RANGE.toFixed(1)}` })),
      h(
        'div',
        { class: 'times' },
        h('div', { class: 'time current' }, h('span', { class: 'label', text: 'Current' }), this.current),
        h('div', { class: 'time' }, h('span', { class: 'label', text: 'Predicted' }), this.predicted),
        h('div', { class: 'time' }, h('span', { class: 'label', text: 'Last lap' }), this.last),
        h('div', { class: 'time best' }, this.bestLabel, this.best),
      ),
      this.flag,
    );
  }

  render(): void {
    const s = this.state;
    const f = s.frame;
    const ref = s.reference;
    const live = Boolean(s.feed?.receiving);

    const refText = ref ? `vs ${ref.source === 'all-time' ? 'Best Lap' : 'session best'} ${formatLapTime(ref.lapTimeMs)}` : 'No Reference Lap yet';
    if (this.refBadge.dataset.text !== refText) {
      this.refBadge.dataset.text = refText;
      this.refBadge.replaceChildren(...(ref ? [h('span', { class: 'swatch' })] : []), refText);
    }

    const delta = live ? (f?.delta ?? null) : null;
    setText(this.value, delta === null ? (f?.lapNum && live ? 'No Delta on this lap' : '—') : formatDelta(delta));
    toggle(this.value, 'none', delta === null);
    toggle(this.value, 'faster', delta !== null && delta < -0.0005);
    toggle(this.value, 'slower', delta !== null && delta > 0.0005);
    const share = delta === null ? 0 : Math.min(1, Math.abs(delta) / DELTA_RANGE) * 50;
    setVar(this.fill, 'width', `${share}%`);
    setVar(this.fill, 'left', delta !== null && delta < 0 ? `${50 - share}%` : '50%');
    toggle(this.fill, 'faster', delta !== null && delta < 0);
    toggle(this.fill, 'slower', delta !== null && delta > 0);

    toggle(this.flag, 'show', Boolean(live && f?.invalid));
    setText(this.current, live && f ? formatLapTime(f.lapMs) : '—');
    setText(this.predicted, live && f?.predictedMs ? formatLapTime(f.predictedMs) : '—');
    const lastMs = s.timing?.lastLapMs ?? null;
    setText(this.last, lastMs ? formatLapTime(lastMs) : '—');

    const allTime = ref?.source === 'all-time';
    setText(this.bestLabel, allTime ? 'Best lap' : 'Session best');
    const bestMs = allTime ? ref!.lapTimeMs : (s.timing?.sessionBestMs ?? null);
    setText(this.best, bestMs ? formatLapTime(bestMs) : '—');
  }
}

// ---------------------------------------------------------------- Session panel

type SectorState = 'best' | 'faster' | 'slower' | '';

export class SessionPanel {
  readonly el: HTMLElement;
  private readonly title = h('span', { class: 'label', text: 'Sectors' });
  private readonly aside = h('span', { class: 'ref-badge num' });
  private readonly body = h('div');
  private readonly sectorCells: { name: HTMLElement; now: HTMLElement; ref: HTMLElement; diff: HTMLElement }[] = [];
  private readonly sectorsEl: HTMLElement;
  private readonly ideal = h('span', { class: 'value num', text: '—' });
  private readonly towerEl = h('div', { class: 'tower' });
  private towerFor: unknown = null;
  private readonly state: ClientState;

  constructor(state: ClientState) {
    this.state = state;
    const cells = [h('span', { class: 'head', text: '' }), h('span', { class: 'head', text: 'This lap' }), h('span', { class: 'head', text: 'Reference' }), h('span', { class: 'head', text: 'Δ', attrs: { style: 'text-align:right' } })];
    for (let i = 0; i < 3; i++) {
      const row = {
        name: h('span', { class: 'name', text: `S${i + 1}` }),
        now: h('span', { class: 'sector-time num', text: '—' }),
        ref: h('span', { class: 'num muted', text: '—' }),
        diff: h('span', { class: 'sector-diff num', text: '' }),
      };
      this.sectorCells.push(row);
      cells.push(row.name, row.now, row.ref, row.diff);
    }
    this.sectorsEl = h(
      'div',
      {},
      h('div', { class: 'sectors' }, ...cells),
      h(
        'div',
        { class: 'sector-legend' },
        h('span', { text: 'Best ever', attrs: { style: '--c: var(--best)' } }),
        h('span', { text: 'Faster', attrs: { style: '--c: var(--good)' } }),
        h('span', { text: 'Slower', attrs: { style: '--c: var(--warn)' } }),
      ),
      h('div', { class: 'ideal' }, h('span', { class: 'label', text: 'Ideal lap · best sectors' }), this.ideal),
    );
    this.el = h('section', { class: 'panel session-panel' }, h('div', { class: 'panel-head' }, this.title, this.aside), this.body);
  }

  render(): void {
    const s = this.state;
    const race = s.session?.group === 'race';
    if (race) this.renderTower();
    else this.renderSectors();
  }

  private renderSectors(): void {
    const s = this.state;
    if (this.body.firstChild !== this.sectorsEl) this.body.replaceChildren(this.sectorsEl);
    setText(this.title, 'Sectors');
    const t = s.timing;
    const pos = t && t.position > 0 && s.session?.group !== 'time-trial' ? `P${t.position} · ` : '';
    setText(this.aside, s.session ? `${pos}${SESSION_GROUP_NAMES[s.session.group]}` : '');

    const f = s.frame;
    const live = Boolean(s.feed?.receiving && f);
    const current = t?.currentSectors ?? [null, null];
    const ref = t?.referenceSectors ?? [null, null, null];
    const best = t?.bestSectors ?? [null, null, null];
    for (let i = 0; i < 3; i++) {
      const cell = this.sectorCells[i];
      toggle(cell.name, 'active', live && f!.sector === i);
      let time: number | null = i < 2 ? current[i] : null;
      let running = false;
      if (time === null && live && f!.sector === i) {
        // The sector you are in: a running clock, shown muted.
        const done = (i >= 1 ? (current[0] ?? 0) : 0) + (i >= 2 ? (current[1] ?? 0) : 0);
        time = Math.max(0, f!.lapMs - done);
        running = true;
      }
      setText(cell.now, time === null ? '—' : formatSector(time));
      setText(cell.ref, formatSector(ref[i]));
      let state: SectorState = '';
      let diff = '';
      if (time !== null && !running) {
        if (best[i] !== null && time <= best[i]!) state = 'best';
        else if (ref[i] !== null) state = time < ref[i]! ? 'faster' : 'slower';
        if (ref[i] !== null) diff = formatDelta((time - ref[i]!) / 1000);
      }
      for (const cls of ['best', 'faster', 'slower']) toggle(cell.now, cls, state === cls);
      cell.now.style.opacity = running ? '0.55' : '1';
      setText(cell.diff, diff);
    }
    const ideal = best.every((v) => v !== null) ? best.reduce((sum, v) => sum! + v!, 0)! : null;
    setText(this.ideal, ideal ? formatLapTime(ideal) : '—');
  }

  private renderTower(): void {
    const s = this.state;
    if (this.body.firstChild !== this.towerEl) this.body.replaceChildren(this.towerEl);
    setText(this.title, 'Race order');
    const t = s.timing;
    setText(this.aside, t && t.position > 0 ? `P${t.position} / ${t.numCars}` : '');
    if (!t || t === this.towerFor) return;
    this.towerFor = t;
    const rows = t.rows;
    const me = rows.findIndex((r) => r.isPlayer);
    if (me < 0) {
      this.towerEl.replaceChildren();
      return;
    }
    const start = Math.max(0, Math.min(me - 2, rows.length - 5));
    const visible = rows.slice(start, start + 5);
    const myGap = rows[me].gapToLeaderMs;
    this.towerEl.replaceChildren(...visible.map((row) => towerRow(row, myGap)));
  }
}

function towerRow(row: TimingRow, myGapToLeader: number): HTMLElement {
  const compound = visualCompound(row.visualCompound);
  const gap = row.isPlayer ? 'You' : formatDelta((row.gapToLeaderMs - myGapToLeader) / 1000, 1);
  return h(
    'div',
    { class: `tower-row${row.isPlayer ? ' player' : ''}` },
    h('span', { class: 'pos num', text: String(row.pos) }),
    h('span', { class: 'team', attrs: { style: `background:${row.colour}` } }),
    h('span', { class: 'code', text: row.code }),
    row.inPit ? h('span', { class: 'pit', text: 'PIT' }) : h('span', { class: 'gap num', text: gap }),
    h('span', { class: 'compound', text: compound.short, attrs: { style: `--c:${compound.colour}`, title: compound.name } }),
  );
}

// ---------------------------------------------------------------- Car column

const WHEELS = [
  { idx: 2, name: 'FL' },
  { idx: 3, name: 'FR' },
  { idx: 0, name: 'RL' },
  { idx: 1, name: 'RR' },
];

function tyreBand(temp: number): { name: string; colour: string } {
  if (temp < 80) return { name: 'Cold', colour: 'var(--cold)' };
  if (temp <= 105) return { name: 'Optimal', colour: 'var(--good)' };
  if (temp <= 115) return { name: 'Hot', colour: 'var(--warn)' };
  return { name: 'Overheating', colour: 'var(--bad)' };
}

export class CarPanel {
  readonly el: HTMLElement;
  private readonly revs: HTMLElement[] = [];
  private readonly gear = h('div', { class: 'gear num', text: 'N' });
  private readonly speed = h('div', { class: 'speed num' }, h('span', { text: '0' }), h('small', { text: 'km/h' }));
  private readonly drs = h('span', { class: 'pill', text: 'DRS' });
  private readonly ersMode = h('span', { class: 'pill', text: 'ERS' });
  private readonly limiter = h('span', { class: 'pill', text: 'PIT' });
  private readonly tyreSet = h('span', { class: 'tyre-set' });
  private readonly tyres: {
    el: HTMLElement;
    band: HTMLElement;
    temp: HTMLElement;
    core: HTMLElement;
    psi: HTMLElement;
    brake: HTMLElement;
    wear: HTMLElement;
    wearText: HTMLElement;
  }[] = [];
  private readonly fuel = h('div', { class: 'value num', text: '—' });
  private readonly fuelSub = h('div', { class: 'sub num', text: '' });
  private readonly ers = h('div', { class: 'value num', text: '—' });
  private readonly battery = h('i');
  private readonly ersSub = h('div', { class: 'sub num', text: '' });
  private readonly damage = h('div', { class: 'damage' });
  private readonly state: ClientState;

  constructor(state: ClientState) {
    this.state = state;
    const revs = h('div', { class: 'revs' });
    for (let i = 0; i < 15; i++) {
      const led = h('i', { class: i < 5 ? 'g' : i < 10 ? 'r' : 'b' });
      this.revs.push(led);
      revs.append(led);
    }
    const tyreGrid = h('div', { class: 'tyres' });
    for (const wheel of WHEELS) {
      const cell = {
        el: h('div', { class: 'tyre' }),
        band: h('span', { class: 'band', text: '' }),
        temp: h('span', { class: 'temp num', text: '—' }),
        core: h('dd', { class: 'num', text: '—' }),
        psi: h('dd', { class: 'num', text: '—' }),
        brake: h('dd', { class: 'num', text: '—' }),
        wear: h('i'),
        wearText: h('span', { class: 'sub num', text: '' }),
      };
      cell.el.append(
        h('div', { class: 'row' }, h('span', { class: 'where', text: wheel.name }), cell.band),
        cell.temp,
        h('dl', { class: 'stats' }, h('dt', { text: 'Core' }), cell.core, h('dt', { text: 'PSI' }), cell.psi, h('dt', { text: 'Brake' }), cell.brake),
        h('div', {}, h('div', { class: 'row' }, h('span', { class: 'sub', text: 'Wear' }), cell.wearText), h('div', { class: 'wear' }, cell.wear)),
      );
      this.tyres.push(cell);
      tyreGrid.append(cell.el);
    }

    this.el = h(
      'aside',
      { class: 'car' },
      h(
        'section',
        { class: 'panel drive', attrs: { 'aria-label': 'Gear and speed' } },
        revs,
        this.gear,
        h('div', { class: 'drive-side' }, this.speed, h('div', { class: 'pills' }, this.drs, this.ersMode, this.limiter)),
      ),
      h(
        'section',
        { class: 'panel tyres-panel', attrs: { 'aria-label': 'Tyres' } },
        h('div', { class: 'tyres-head' }, h('span', { class: 'label', text: 'Tyres' }), this.tyreSet),
        tyreGrid,
      ),
      h(
        'section',
        { class: 'panel energy', attrs: { 'aria-label': 'Fuel and ERS' } },
        h('div', {}, h('span', { class: 'label', text: 'Fuel' }), this.fuel, this.fuelSub),
        h('div', {}, h('span', { class: 'label', text: 'ERS' }), this.ers, h('div', { class: 'battery' }, this.battery), this.ersSub),
        this.damage,
      ),
    );
  }

  render(): void {
    const s = this.state;
    const f = s.feed?.receiving ? s.frame : null;
    const car = s.feed?.receiving ? s.car : null;

    const lit = f ? Math.round((f.revPct / 100) * 15) : 0;
    this.revs.forEach((led, i) => toggle(led, 'on', i < lit));
    setText(this.gear, !f ? '–' : f.gear === 0 ? 'N' : f.gear < 0 ? 'R' : String(f.gear));
    setText(this.speed.firstChild as Element, f ? String(f.speed) : '0');

    toggle(this.drs, 'active', Boolean(f?.drs));
    toggle(this.drs, 'ready', Boolean(!f?.drs && car?.drsAllowed));
    setText(this.ersMode, car ? car.ersMode.toUpperCase() : 'ERS');
    toggle(this.ersMode, 'ready', Boolean(car && car.ersMode !== 'None'));
    this.limiter.style.display = car?.pitLimiter ? '' : 'none';
    toggle(this.limiter, 'active', Boolean(car?.pitLimiter));

    if (!car) {
      this.tyreSet.dataset.text = '';
      this.tyreSet.replaceChildren();
      for (const cell of this.tyres) {
        setText(cell.temp, '—');
        setText(cell.band, '');
        setText(cell.core, '—');
        setText(cell.psi, '—');
        setText(cell.brake, '—');
        setText(cell.wearText, '');
        setVar(cell.wear, 'width', '0%');
        setVar(cell.el, '--t', 'var(--grid)');
      }
      setText(this.fuel, '—');
      setText(this.fuelSub, '');
      setText(this.ers, '—');
      setText(this.ersSub, '');
      setVar(this.battery, 'width', '0%');
      toggle(this.damage, 'show', false);
      return;
    }

    const compound = visualCompound(car.visualCompound);
    const tyreLabel = `${compound.name} · ${car.tyreAge} ${car.tyreAge === 1 ? 'lap' : 'laps'}`;
    if (this.tyreSet.dataset.text !== tyreLabel) {
      this.tyreSet.dataset.text = tyreLabel;
      this.tyreSet.replaceChildren(h('span', { class: 'compound', text: compound.short, attrs: { style: `--c:${compound.colour}` } }), tyreLabel);
    }
    WHEELS.forEach((wheel, i) => {
      const cell = this.tyres[i];
      const surface = car.tyreSurface[wheel.idx];
      const band = tyreBand(surface);
      setText(cell.temp, `${surface}°`);
      setText(cell.band, band.name);
      setVar(cell.el, '--t', band.colour);
      setText(cell.core, `${car.tyreInner[wheel.idx]}°`);
      setText(cell.psi, car.tyrePressure[wheel.idx].toFixed(1));
      setText(cell.brake, `${car.brakeTemp[wheel.idx]}°`);
      const wear = car.tyreWear[wheel.idx];
      setText(cell.wearText, `${Math.round(wear)}%`);
      setVar(cell.wear, 'width', `${Math.min(100, wear)}%`);
    });

    const fuelLaps = car.fuelLaps;
    setText(this.fuel, `${fuelLaps >= 0 ? '+' : '−'}${Math.abs(fuelLaps).toFixed(2)} laps`);
    toggle(this.fuel, 'good', fuelLaps >= 0.2);
    toggle(this.fuel, 'warn', fuelLaps < 0);
    setText(this.fuelSub, `${car.fuelKg.toFixed(1)} kg · ${FUEL_MIX[car.fuelMix] ?? ''}`);

    setText(this.ers, `${Math.round(car.ersStorePct)}%`);
    setVar(this.battery, 'width', `${Math.max(0, Math.min(100, car.ersStorePct))}%`);
    const deployedMj = (car.ersDeployedPct / 100) * (ERS_MAX_JOULES / 1e6);
    setText(this.ersSub, `${car.ersMode} · used ${deployedMj.toFixed(1)} MJ`);

    const d = car.damage;
    const items = [
      ['Front wing L', d.frontLeftWing],
      ['Front wing R', d.frontRightWing],
      ['Rear wing', d.rearWing],
      ['Floor', d.floor],
      ['Diffuser', d.diffuser],
      ['Sidepod', d.sidepod],
      ['Gearbox', d.gearbox],
      ['Engine', d.engine],
    ].filter(([, v]) => (v as number) > 0) as [string, number][];
    const faults = [d.drsFault ? 'DRS fault' : null, d.ersFault ? 'ERS fault' : null].filter(Boolean) as string[];
    toggle(this.damage, 'show', items.length + faults.length > 0);
    const text = [...items.map(([n, v]) => `${n} ${v}%`), ...faults].join('|');
    if (this.damage.dataset.text !== text) {
      this.damage.dataset.text = text;
      this.damage.replaceChildren(...text.split('|').filter(Boolean).map((t) => h('span', { text: `⚠ ${t}` })));
    }
  }
}

// ---------------------------------------------------------------- Waiting overlay

export class SetupOverlay {
  readonly el: HTMLElement;
  private readonly title = h('h1');
  private readonly intro = h('p');
  private readonly error = h('p', { class: 'error' });
  private readonly urls = h('div', { class: 'urls' });
  private readonly port = h('dd', { class: 'num' });
  private dismissedFor = '';
  private readonly state: ClientState;

  constructor(state: ClientState) {
    this.state = state;
    const settings = h(
      'dl',
      { class: 'settings' },
      h('dt', { text: 'UDP Telemetry' }),
      h('dd', { text: 'On' }),
      h('dt', { text: 'UDP Broadcast Mode' }),
      h('dd', { text: 'Off' }),
      h('dt', { text: 'UDP IP Address' }),
      h('dd', { text: '127.0.0.1 (the game runs on this PC)' }),
      h('dt', { text: 'UDP Port' }),
      this.port,
      h('dt', { text: 'UDP Send Rate' }),
      h('dd', { text: '60 Hz' }),
      h('dt', { text: 'UDP Format' }),
      h('dd', { text: '2025, or 2026 with the 2026 Season Pack' }),
    );
    this.el = h(
      'div',
      { class: 'overlay', attrs: { role: 'dialog', 'aria-modal': 'true' } },
      h(
        'div',
        { class: 'setup' },
        this.title,
        this.intro,
        this.error,
        settings,
        h('span', { class: 'label', text: 'Open this dashboard on your iPad' }),
        h('div', { class: 'urls', attrs: { style: 'margin-top:8px' } }, this.urls),
        h('div', { class: 'dismiss', text: 'Tap anywhere to look at the dashboard anyway.' }),
      ),
    );
    this.el.addEventListener('click', () => {
      this.dismissedFor = this.key();
      toggle(this.el, 'show', false);
    });
  }

  private key(): string {
    const s = this.state;
    return `${s.socketOpen}|${s.feed?.receiving}|${s.feed?.unsupportedFormat}`;
  }

  render(): void {
    const s = this.state;
    const waiting = !s.socketOpen || !s.feed?.receiving || s.feed.unsupportedFormat !== null;
    const show = waiting && this.dismissedFor !== this.key();
    toggle(this.el, 'show', show);
    if (!show) return;
    if (!s.socketOpen) {
      setText(this.title, 'Can’t reach the PC');
      setText(this.intro, 'Start the app on your gaming PC with “npm start”, and make sure this device is on the same Wi-Fi. This page reconnects by itself.');
    } else {
      setText(this.title, 'Waiting for F1 25');
      setText(this.intro, 'Start a session in F1 25. If nothing appears, check the game’s Telemetry Settings:');
    }
    const unsupported = s.feed?.unsupportedFormat ?? null;
    setText(this.error, unsupported ? `F1 25 is sending UDP Format ${unsupported}, which this app cannot read. Set UDP Format to 2025 or 2026.` : '');
    this.error.style.display = unsupported ? '' : 'none';
    setText(this.port, String(s.udpPort));
    const urls = s.urls.length ? s.urls : [location.origin];
    if (this.urls.dataset.urls !== urls.join()) {
      this.urls.dataset.urls = urls.join();
      this.urls.replaceChildren(...urls.map((u) => h('code', { text: u })));
    }
  }
}
