// Setups: the community baseline setup for each circuit, laid out like the game's setup screen.

import { visualCompound } from '../../../shared/f1.ts';
import { h, icon } from '../dom.ts';
import type { ClientState } from '../state.ts';
import { GUIDES, SETUPS, SHEET_URL, TYRE_PSI, TYRE_TEMPS, type Generation, type QualiRace, type Strategy, type TrackSetup } from './data.ts';

const GENERATIONS: [Generation, string, string][] = [
  ['2025', 'F1 25', '2025 cars'],
  ['2026', 'F1 26', '2026 cars'],
];

/** Visual compound ids for S/M/H, so the chips match the dashboard's tyre colours. */
const COMPOUND_IDS: Record<string, number> = { S: 16, M: 17, H: 18 };

interface Row {
  label: string;
  hint?: string;
  q: string;
  r: string;
}

export function mountSetups(root: HTMLElement, state: ClientState): () => void {
  const [, genParam, trackParam] = location.hash.split('/').slice(1);
  const live = state.session;
  let gen: Generation =
    genParam === '2025' || genParam === '2026' ? genParam : live?.generation === '2026' ? '2026' : '2025';
  let trackId = trackParam !== undefined ? Number(trackParam) : (live?.trackId ?? -1);

  const genSwitch = h('div', { class: 'segmented', attrs: { role: 'tablist', 'aria-label': 'Cars' } });
  const trackList = h('nav', { class: 'track-chips', attrs: { 'aria-label': 'Circuit' } });
  const body = h('div');

  root.replaceChildren(
    h(
      'main',
      { class: 'laps-page setups-page' },
      h(
        'div',
        { class: 'laps-head' },
        h('a', { class: 'icon-button', attrs: { href: '#/', title: 'Back to the dashboard', 'aria-label': 'Back to the dashboard' } }, icon('back')),
        h('h1', { text: 'Setups' }),
        genSwitch,
      ),
      trackList,
      body,
    ),
  );

  const render = () => {
    const setups = SETUPS[gen];
    if (!setups.some((s) => s.trackId === trackId)) trackId = setups[0].trackId;
    const setup = setups.find((s) => s.trackId === trackId)!;
    history.replaceState(null, '', `#/setups/${gen}/${trackId}`);

    genSwitch.replaceChildren(
      ...GENERATIONS.map(([g, name, cars]) => {
        const b = h('button', { class: g === gen ? 'on' : '', attrs: { type: 'button', role: 'tab', 'aria-selected': String(g === gen) } }, h('b', { text: name }), h('span', { text: cars }));
        b.addEventListener('click', () => {
          gen = g;
          render();
        });
        return b;
      }),
    );

    const liveTrack = state.session?.generation === gen ? state.session.trackId : -1;
    trackList.replaceChildren(
      ...setups.map((s) => {
        const b = h('button', { class: s.trackId === trackId ? 'on' : '', attrs: { type: 'button' } }, s.name, s.trackId === liveTrack ? h('i', { class: 'live-dot', attrs: { title: 'Current session' } }) : null);
        b.addEventListener('click', () => {
          trackId = s.trackId;
          render();
        });
        return b;
      }),
    );

    body.replaceChildren(setupCard(setup, gen), guide(gen));
  };

  render();
  return () => {};
}

// ---------------------------------------------------------------- Setup card

function setupCard(s: TrackSetup, gen: Generation): HTMLElement {
  const changes = raceChanges(s);
  const status = statusOf(s.tested);
  return h(
    'section',
    { class: 'car-setup' },
    h(
      'div',
      { class: 'setup-head' },
      h('h2', { text: s.name }),
      h('span', { class: `tag ${status.cls}`, text: status.text }),
      s.note ? h('p', { class: 'setup-note', text: `“${s.note}”` }) : null,
    ),
    changes.length
      ? h('p', { class: 'race-changes' }, h('b', { text: 'For the race: ' }), changes.join(' · '))
      : h('p', { class: 'race-changes same', text: 'Same setup for qualifying and the race.' }),
    h(
      'div',
      { class: 'setup-grid' },
      h('div', { class: 'panel setup-table-wrap' }, settingsTable(s, gen)),
      h('div', { class: 'stack' }, racePlan(s), sheetRow(s)),
    ),
  );
}

function rowsFor(s: TrackSetup, gen: Generation): [string, Row[]][] {
  const each = <T>(v: QualiRace<T>, pick: (x: T) => string) => ({ q: pick(v.q), r: pick(v.r) });
  const psi = (n: number, [min, max]: readonly [number, number]) => `${n.toFixed(1)}${n === max ? ' (max)' : n === min ? ' (min)' : ''}`;
  const bias = s.brakeBias.length > 1 ? `${s.brakeBias[0]}–${s.brakeBias[1]}%` : `${s.brakeBias[0]}%`;
  return [
    [
      'Aerodynamics',
      [
        { label: 'Front wing', ...each(s.wings, (w) => String(w[0])) },
        { label: 'Rear wing', ...each(s.wings, (w) => String(w[1])) },
      ],
    ],
    [
      'Transmission',
      [
        { label: 'Differential on throttle', ...each(s.diff, (d) => `${d[0]}%`) },
        { label: 'Differential off throttle', ...each(s.diff, (d) => `${d[1]}%`) },
      ],
    ],
    [
      'Suspension geometry',
      [{ label: 'Camber & toe', hint: 'all four sliders', q: 'Fully left', r: 'Fully left' }],
    ],
    [
      'Suspension',
      [
        { label: 'Front suspension', hint: '1–41', ...each(s.suspension, (v) => String(v[0])) },
        { label: 'Rear suspension', hint: '1–41', ...each(s.suspension, (v) => String(v[1])) },
        { label: 'Front anti-roll bar', hint: '1–21', ...each(s.suspension, (v) => String(v[2])) },
        { label: 'Rear anti-roll bar', hint: '1–21', ...each(s.suspension, (v) => String(v[3])) },
        { label: 'Front ride height', ...each(s.suspension, (v) => String(v[4])) },
        { label: 'Rear ride height', ...each(s.suspension, (v) => String(v[5])) },
      ],
    ],
    [
      'Brakes',
      [
        { label: 'Brake pressure', ...each(s.brakePressure, (p) => `${p}%`) },
        { label: 'Front brake bias', q: bias, r: bias },
      ],
    ],
    [
      'Tyres',
      [
        { label: 'Front tyre pressure', hint: 'psi', ...each(s.tyrePressures, (t) => psi(t[0], TYRE_PSI.front)) },
        { label: 'Rear tyre pressure', hint: 'psi', ...each(s.tyrePressures, (t) => psi(t[1], TYRE_PSI.rear)) },
      ],
    ],
    ...(gen === '2026' && s.recharge
      ? ([
          [
            'Energy',
            [{ label: 'ERS recharge limit', hint: 'MJ', q: String(s.recharge.q ?? '—'), r: String(s.recharge.r ?? '—') }],
          ],
        ] as [string, Row[]][])
      : []),
  ];
}

function settingsTable(s: TrackSetup, gen: Generation): HTMLElement {
  const groups = rowsFor(s, gen);
  return h(
    'table',
    { class: 'setup-table' },
    h('thead', {}, h('tr', {}, h('th', { text: 'Setting' }), h('th', { class: 'right', text: 'Quali' }), h('th', { class: 'right', text: 'Race' }))),
    ...groups.map(([group, rows]) =>
      h(
        'tbody',
        {},
        h('tr', { class: 'group-row' }, h('td', { text: group, attrs: { colspan: '3' } })),
        ...rows.map((r) =>
          h(
            'tr',
            {},
            h('td', {}, r.label, r.hint ? h('span', { class: 'hint', text: r.hint }) : null),
            ...(r.q === r.r
              ? [h('td', { class: 'right num same', text: r.q, attrs: { colspan: '2' } })]
              : [h('td', { class: 'right num', text: r.q }), h('td', { class: 'right num changed', text: r.r })]),
          ),
        ),
      ),
    ),
  );
}

function raceChanges(s: TrackSetup): string[] {
  const out: string[] = [];
  const diff = (label: string, q: number, r: number, unit = '') => {
    if (q !== r) out.push(`${label} ${q}${unit} → ${r}${unit}`);
  };
  diff('front wing', s.wings.q[0], s.wings.r[0]);
  diff('rear wing', s.wings.q[1], s.wings.r[1]);
  diff('on-throttle diff', s.diff.q[0], s.diff.r[0], '%');
  diff('off-throttle diff', s.diff.q[1], s.diff.r[1], '%');
  const names = ['front suspension', 'rear suspension', 'front anti-roll bar', 'rear anti-roll bar', 'front ride height', 'rear ride height'];
  names.forEach((n, i) => diff(n, s.suspension.q[i], s.suspension.r[i]));
  diff('brake pressure', s.brakePressure.q, s.brakePressure.r, '%');
  diff('front tyres', s.tyrePressures.q[0], s.tyrePressures.r[0], ' psi');
  diff('rear tyres', s.tyrePressures.q[1], s.tyrePressures.r[1], ' psi');
  return out.map((c, i) => (i === 0 ? c[0].toUpperCase() + c.slice(1) : c));
}

function statusOf(tested: string | null): { text: string; cls: string } {
  if (!tested) return { text: 'Untested', cls: '' };
  if (/^\d{4}-\d{2}-\d{2}$/.test(tested)) {
    const date = new Date(`${tested}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    return { text: `Tested ${date}`, cls: 'tested' };
  }
  if (/^theory/i.test(tested)) return { text: 'Theorycrafted', cls: '' };
  return { text: tested, cls: 'invalid' };
}

// ---------------------------------------------------------------- Race plan

function tyreChip(letter: string, cNumber?: number): HTMLElement {
  const c = visualCompound(COMPOUND_IDS[letter] ?? -1);
  return h('span', { class: 'compound', text: c.short, attrs: { style: `--c:${c.colour}`, title: cNumber ? `${c.name} (C${cNumber})` : c.name } });
}

function racePlan(s: TrackSetup): HTMLElement {
  const [hard, medium, soft] = s.compounds;
  const cFor: Record<string, number> = { H: hard, M: medium, S: soft };
  return h(
    'div',
    { class: 'panel plan' },
    h('div', { class: 'label', text: 'Tyres this weekend' }),
    h(
      'div',
      { class: 'compounds' },
      ...(['S', 'M', 'H'] as const).map((l) => h('span', {}, tyreChip(l, cFor[l]), h('b', { class: 'num', text: `C${cFor[l]}` }))),
    ),
    h('div', { class: 'label', text: `Strategies · ${s.raceLaps} laps (50% race)` }),
    h('ul', { class: 'strategies' }, ...s.strategies.map((st) => strategyItem(st, cFor))),
    s.fuel ? h('div', { class: 'fuel' }, h('span', { class: 'label', text: 'Fuel' }), h('span', { class: 'num', text: fuelText(s.fuel) })) : null,
  );
}

function strategyItem(st: Strategy, cFor: Record<string, number>): HTMLElement {
  const stops = st.tyres.length - 1;
  let when: string;
  if (st.when) when = st.when.replace(/\bSCs?\b/, 'Safety Car');
  else if (stops === 1) when = `Pit lap ${st.stops[0]}${st.ideal ? ` (best ${st.ideal})` : ''}`;
  else when = `Pit laps ${st.stops.join(' and ')}`;
  return h(
    'li',
    {},
    h('span', { class: 'stints' }, ...[...st.tyres].map((l) => tyreChip(l, cFor[l]))),
    h('span', { class: 'stops', text: stops === 1 ? '1 stop' : `${stops} stops` }),
    h('span', { class: 'num', text: when }),
  );
}

function fuelText(fuel: string): string {
  const m = /^([\d.]+) laps \/ (-?[\d.]+)$/.exec(fuel);
  if (m) return `${m[1]} laps of fuel (${m[2].replace('-', '−')})`;
  if (fuel === 'Yes') return 'Fuel saving needed';
  return fuel;
}

/** The original shorthand, so the sheet can still be cross-checked. */
function sheetRow(s: TrackSetup): HTMLElement {
  return h(
    'details',
    { class: 'panel sheet-row' },
    h('summary', { text: 'Sheet shorthand' }),
    h('dl', {}, ...Object.entries(s.sheet).flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { class: 'num', text: String(v) })])),
    h(
      'p',
      { class: 'muted' },
      'Suspension reads front susp – rear susp – front ARB – rear ARB – front ride height – rear ride height. ',
      'q is qualifying, r is race: 21(5r) means 21, but 5 for the race. LLLL is camber and toe, all fully left.',
    ),
  );
}

// ---------------------------------------------------------------- Guide

function guide(gen: Generation): HTMLElement {
  const g = GUIDES[gen];
  return h(
    'section',
    { class: 'guide' },
    h('h2', { text: 'Notes from the sheet' }),
    g.banner ? h('p', { class: 'banner', text: g.banner }) : null,
    ...g.intro.map((t) => h('p', { text: t })),
    h(
      'div',
      { class: 'guide-grid' },
      h(
        'div',
        { class: 'panel' },
        h('div', { class: 'label', text: 'Tyre operating windows' }),
        h('table', { class: 'mini' }, h('tbody', {}, ...TYRE_TEMPS.map(([c, t]) => h('tr', {}, h('td', { text: c }), h('td', { class: 'right num', text: `${t} °C` }))))),
        g.engine
          ? h(
              'div',
              {},
              h('div', { class: 'label', text: 'Engine temperature → power' }),
              h('table', { class: 'mini' }, h('tbody', {}, ...g.engine.map(([t, p]) => h('tr', { class: p === 100 ? 'best' : '' }, h('td', { class: 'num', text: `${t} °C` }), h('td', { class: 'right num', text: `${p}%` }))))),
            )
          : null,
      ),
      g.fixes
        ? h(
            'div',
            { class: 'panel' },
            h('div', { class: 'label', text: 'Handling fixes' }),
            h('dl', { class: 'fixes' }, ...g.fixes.flatMap(([p, f]) => [h('dt', { text: p }), h('dd', { text: f })])),
          )
        : null,
      h('div', { class: 'panel' }, h('div', { class: 'label', text: 'FAQ' }), h('dl', { class: 'fixes' }, ...g.faq.flatMap(([q, a]) => [h('dt', { text: q }), h('dd', { text: a })]))),
    ),
    h('p', { class: 'muted' }, 'Source: ', h('a', { text: 'community setup sheet', attrs: { href: SHEET_URL, target: '_blank', rel: 'noreferrer' } }), '.'),
  );
}
