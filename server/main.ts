// Entry point: receive the Telemetry Feed on UDP, serve the Live Dashboard over HTTP.

import { createSocket } from 'node:dgram';
import { readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';
import { App } from './app.ts';
import { loadConfig } from './config.ts';
import { Forwarder } from './net/forwarder.ts';
import { WebServer } from './net/http.ts';
import { Store } from './record/store.ts';

const config = loadConfig();
const { version } = JSON.parse(readFileSync(resolve(import.meta.dirname, '..', 'package.json'), 'utf8')) as { version: string };
const urls = lanUrls(config.httpPort);

const store = new Store(config.dbPath);
const forwarder = new Forwarder(config.forward, config.udpPort);
const app = new App(store, forwarder, { urls, udpPort: config.udpPort, httpPort: config.httpPort, version, dbPath: config.dbPath });
const web = new WebServer(config.webRoot, app.api);
app.attach(web);

try {
  await web.listen(config.httpPort);
} catch (err) {
  fail(`Could not open the dashboard on port ${config.httpPort}: ${(err as Error).message}. Is the app already running?`);
}

const udp = createSocket('udp4');
udp.on('message', (msg) => app.onDatagram(msg));
udp.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    fail(
      `UDP port ${config.udpPort} is already in use, probably by SimHub or another telemetry app.\n` +
        `  Close it, or let this app receive the data first and forward a copy to it:\n` +
        `  npm run serve -- --forward 127.0.0.1:20778   (then set that app to listen on 20778)`,
    );
  }
  fail(`UDP error: ${err.message}`);
});
udp.bind(config.udpPort, '0.0.0.0', () => {
  app.start();
  printBanner();
});

let stopping = false;
function stop(): void {
  if (stopping) return;
  stopping = true;
  app.shutdown();
  udp.close();
  forwarder.close();
  web.close();
  store.close();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

function printBanner(): void {
  const lines = [
    '',
    `  F1 25 Telemetry ${version}`,
    '',
    '  Open the dashboard on your iPad (same Wi-Fi as this PC):',
    ...(urls.length ? urls.map((u) => `    ${u}`) : ['    (no network address found; check that this PC is on Wi-Fi or Ethernet)']),
    `  On this PC: http://localhost:${config.httpPort}`,
    '',
    `  Listening for F1 25 on UDP port ${config.udpPort}. In the game:`,
    '    Settings > Telemetry Settings > UDP Telemetry: On, UDP Broadcast Mode: Off,',
    `    UDP IP Address: 127.0.0.1, UDP Port: ${config.udpPort}, UDP Send Rate: 60Hz, UDP Format: 2025 or 2026`,
    ...(forwarder.labels.length ? ['', `  Forwarding a copy of every packet to: ${forwarder.labels.join(', ')}`] : []),
    '',
    `  Laps are saved in ${config.dbPath}`,
    '  If the iPad cannot connect, allow Node.js on private networks in Windows Firewall.',
    '  Press Ctrl+C to stop.',
    '',
  ];
  console.log(lines.join('\n'));
}

function lanUrls(port: number): string[] {
  // Virtual adapters an iPad can never reach; Windows often names them just "Ethernet 4".
  const VIRTUAL_NAME = /vethernet|virtualbox|vmware|hyper-v|loopback|wsl|docker/i;
  const VIRTUAL_MAC = /^(0a:00:27|08:00:27|00:50:56|00:0c:29|00:05:69|00:1c:14|00:15:5d)/i;
  const out: { url: string; rank: number }[] = [];
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    if (VIRTUAL_NAME.test(name)) continue;
    for (const a of addresses ?? []) {
      if (a.family !== 'IPv4' || a.internal || VIRTUAL_MAC.test(a.mac)) continue;
      const rank = /^192\.168\./.test(a.address) ? 0 : /^10\./.test(a.address) ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(a.address) ? 2 : 3;
      out.push({ url: `http://${a.address}:${port}`, rank });
    }
  }
  return out.sort((a, b) => a.rank - b.rank).map((o) => o.url);
}

function fail(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}
