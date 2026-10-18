// The Live Dashboard: lays out the panels and redraws them once per display frame.

import { h } from '../dom.ts';
import type { ClientState } from '../state.ts';
import { CarPanel, DeltaPanel, SessionPanel, SetupOverlay, TopBar } from './panels.ts';
import { InputTrace } from './trace.ts';
import { TrackMapView } from './trackmap.ts';

export function mountDashboard(root: HTMLElement, state: ClientState): () => void {
  const top = new TopBar(state);
  const delta = new DeltaPanel(state);
  const session = new SessionPanel(state);
  const map = new TrackMapView(state);
  const trace = new InputTrace(state);
  const car = new CarPanel(state);
  const overlay = new SetupOverlay(state);

  root.replaceChildren(
    h(
      'main',
      { class: 'dash' },
      top.el,
      h('div', { class: 'left stack' }, delta.el, session.el),
      map.el,
      trace.el,
      car.el,
    ),
    overlay.el,
  );

  let frame = 0;
  let running = true;
  const loop = (now: number) => {
    if (!running) return;
    top.render();
    delta.render();
    session.render();
    map.render(now);
    trace.render();
    car.render();
    overlay.render();
    frame = requestAnimationFrame(loop);
  };
  frame = requestAnimationFrame(loop);

  return () => {
    running = false;
    cancelAnimationFrame(frame);
  };
}
