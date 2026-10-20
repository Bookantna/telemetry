// Recorded Laps: every lap, newest session first, with a delete button.

import { SESSION_GROUP_NAMES, visualCompound } from '../../../shared/f1.ts';
import { formatLapTime, formatSector } from '../../../shared/format.ts';
import type { LapSummary } from '../../../shared/protocol.ts';
import { h, icon } from '../dom.ts';
import { generationLabel } from '../live/panels.ts';
import type { ClientState } from '../state.ts';
import { themePicker } from '../theme.ts';

export function mountLaps(root: HTMLElement, state: ClientState): () => void {
  let laps: LapSummary[] = [];
  let loading = true;
  const trackFilter = h('select', { attrs: { 'aria-label': 'Circuit' } });
  const groupFilter = h(
    'select',
    { attrs: { 'aria-label': 'Session Type' } },
    h('option', { text: 'All session types', attrs: { value: '' } }),
    ...Object.entries(SESSION_GROUP_NAMES).map(([value, name]) => h('option', { text: name, attrs: { value } })),
  );
  const validOnly = h('input', { attrs: { type: 'checkbox' } });
  const count = h('span', { class: 'muted' });
  const body = h('div');

  root.replaceChildren(
    h(
      'main',
      { class: 'laps-page' },
      h(
        'div',
        { class: 'laps-head' },
        h('a', { class: 'icon-button', attrs: { href: '#/', title: 'Back to the dashboard', 'aria-label': 'Back to the dashboard' } }, icon('back')),
        h('h1', { text: 'Recorded Laps' }),
        count,
        themePicker(),
      ),
      h('div', { class: 'filters' }, trackFilter, groupFilter, h('label', {}, validOnly, 'Valid laps only')),
      body,
    ),
  );

  const render = () => {
    const tracks = [...new Map(laps.map((l) => [l.trackId, l.trackName])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
    const selected = trackFilter.value;
    trackFilter.replaceChildren(
      h('option', { text: 'All circuits', attrs: { value: '' } }),
      ...tracks.map(([id, name]) => h('option', { text: name, attrs: { value: String(id) } })),
    );
    trackFilter.value = tracks.some(([id]) => String(id) === selected) ? selected : '';

    const shown = laps.filter(
      (l) =>
        (!trackFilter.value || String(l.trackId) === trackFilter.value) &&
        (!groupFilter.value || l.sessionGroup === groupFilter.value) &&
        (!validOnly.checked || (l.valid && l.complete)),
    );
    count.textContent = loading ? '' : `${shown.length} of ${laps.length}`;
    if (loading) {
      body.replaceChildren(h('div', { class: 'empty', text: 'Loading…' }));
      return;
    }
    if (!shown.length) {
      body.replaceChildren(h('div', { class: 'empty', text: laps.length ? 'No laps match these filters.' : 'No laps yet. Drive a lap in F1 25 and it appears here.' }));
      return;
    }

    const rows: HTMLElement[] = [];
    let session = '';
    for (const lap of shown) {
      if (lap.sessionUid !== session) {
        session = lap.sessionUid;
        const when = new Date(lap.recordedAt).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
        const what = [lap.trackName, SESSION_GROUP_NAMES[lap.sessionGroup], generationLabel(lap.generation), lap.conditions === 'wet' ? 'Wet' : 'Dry'].join(' · ');
        rows.push(h('tr', { class: 'session-row' }, h('td', { text: `${when} — ${what}`, attrs: { colspan: '8' } })));
      }
      rows.push(lapRow(lap));
    }
    body.replaceChildren(
      h(
        'table',
        { class: 'laps-table' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            h('th', { text: 'Lap' }),
            h('th', { class: 'right', text: 'Time' }),
            h('th', { class: 'right', text: 'S1' }),
            h('th', { class: 'right', text: 'S2' }),
            h('th', { class: 'right', text: 'S3' }),
            h('th', { text: 'Tyre' }),
            h('th', { text: '' }),
            h('th', { text: '' }),
          ),
        ),
        h('tbody', {}, ...rows),
      ),
    );
  };

  const lapRow = (lap: LapSummary): HTMLElement => {
    const tags = [
      lap.isBest ? ['best', 'Best Lap'] : null,
      !lap.valid ? ['invalid', 'Invalid'] : null,
      !lap.complete ? ['', 'Incomplete'] : null,
      lap.outLap ? ['', 'Out-lap'] : null,
      lap.inLap ? ['', 'In-lap'] : null,
    ].filter(Boolean) as [string, string][];
    const compound = visualCompound(lap.visualCompound);
    const timeClass = lap.isBest ? 'time-best' : !lap.valid ? 'time-invalid' : '';
    const del = h('button', { class: 'delete', text: 'Delete', attrs: { type: 'button' } });
    let armed: ReturnType<typeof setTimeout> | null = null;
    del.addEventListener('click', async () => {
      if (!armed) {
        del.classList.add('confirm');
        del.textContent = 'Delete?';
        armed = setTimeout(() => {
          armed = null;
          del.classList.remove('confirm');
          del.textContent = 'Delete';
        }, 3000);
        return;
      }
      clearTimeout(armed);
      del.disabled = true;
      const res = await fetch(`/api/laps/${lap.id}`, { method: 'DELETE' });
      if (res.ok) {
        laps = laps.filter((l) => l.id !== lap.id);
        render();
      } else {
        del.disabled = false;
        del.textContent = 'Failed';
      }
    });
    return h(
      'tr',
      {},
      h('td', { class: 'num', text: String(lap.lapNum) }),
      h('td', { class: `right num ${timeClass}`, text: lap.lapTimeMs === null ? '—' : formatLapTime(lap.lapTimeMs) }),
      ...lap.sectorsMs.map((ms) => h('td', { class: 'right num muted', text: formatSector(ms) })),
      h('td', {}, h('span', { class: 'compound', text: compound.short, attrs: { style: `--c:${compound.colour}`, title: compound.name } })),
      h('td', {}, ...tags.map(([cls, text]) => h('span', { class: `tag ${cls}`, text }))),
      h('td', { class: 'right' }, del),
    );
  };

  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  const load = async () => {
    const res = await fetch('/api/laps?limit=1000');
    laps = res.ok ? ((await res.json()) as LapSummary[]) : [];
    loading = false;
    render();
  };
  const onLapsChanged = () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(load, 400);
  };
  for (const control of [trackFilter, groupFilter, validOnly]) control.addEventListener('change', render);
  state.lapListeners.add(onLapsChanged);
  render();
  void load();

  return () => {
    state.lapListeners.delete(onLapsChanged);
    if (refreshTimer) clearTimeout(refreshTimer);
  };
}
