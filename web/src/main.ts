import './styles.css';
import { mountLaps } from './laps/laps.ts';
import { mountReplay } from './laps/replay.ts';
import { mountDashboard } from './live/dashboard.ts';
import { connect } from './net.ts';
import { mountSetups } from './setups/setups.ts';
import { ClientState } from './state.ts';
import { applyTheme } from './theme.ts';

applyTheme();

const root = document.getElementById('app')!;
const state = new ClientState();

connect(
  (msg) => state.apply(msg),
  (open) => {
    state.socketOpen = open;
  },
);

let unmount: (() => void) | null = null;

function route(): void {
  unmount?.();
  const hash = location.hash;
  const replay = /^#\/laps\/(\d+)$/.exec(hash);
  unmount = replay
    ? mountReplay(root, Number(replay[1]))
    : hash.startsWith('#/laps')
      ? mountLaps(root, state)
      : hash.startsWith('#/setups')
        ? mountSetups(root, state)
        : mountDashboard(root, state);
}

window.addEventListener('hashchange', route);
window.addEventListener('themechange', route);
route();
