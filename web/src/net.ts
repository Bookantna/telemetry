import type { ServerMessage } from '../../shared/protocol.ts';

/** Keeps a WebSocket to the PC program open, reconnecting with backoff when it drops. */
export function connect(onMessage: (msg: ServerMessage) => void, onConnection: (open: boolean) => void): void {
  let delay = 500;
  const open = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => {
      delay = 500;
      onConnection(true);
    };
    ws.onmessage = (event) => onMessage(JSON.parse(event.data as string) as ServerMessage);
    ws.onclose = () => {
      onConnection(false);
      setTimeout(open, delay);
      delay = Math.min(delay * 2, 5000);
    };
    ws.onerror = () => ws.close();
  };
  open();
}
