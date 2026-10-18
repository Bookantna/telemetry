import './styles.css';
import { mountLaps } from './laps/laps.ts';
import { mountDashboard } from './live/dashboard.ts';
import { connect } from './net.ts';
import { ClientState } from './state.ts';

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
  unmount = location.hash.startsWith('#/laps') ? mountLaps(root, state) : mountDashboard(root, state);
}

window.addEventListener('hashchange', route);
route();
