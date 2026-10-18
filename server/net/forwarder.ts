// Forwarding (CONTEXT.md): an unchanged copy of every packet goes on to other apps,
// such as SimHub, because only one app on the PC can listen on the game's port.

import { createSocket, type Socket } from 'node:dgram';

interface Target {
  host: string;
  port: number;
  label: string;
}

export class Forwarder {
  readonly targets: Target[];
  private readonly socket: Socket | null;

  constructor(specs: string[], ownUdpPort: number) {
    this.targets = specs.flatMap((spec) => {
      const target = parseTarget(spec);
      if (!target) {
        console.warn(`Ignoring forward target "${spec}": use host:port, e.g. 127.0.0.1:20778`);
        return [];
      }
      if (target.port === ownUdpPort && isLocal(target.host)) {
        console.warn(`Ignoring forward target "${spec}": it is this app's own port and would loop.`);
        return [];
      }
      return [target];
    });
    this.socket = this.targets.length ? createSocket('udp4') : null;
    this.socket?.on('error', (err) => console.warn(`Forwarding error: ${err.message}`));
  }

  get labels(): string[] {
    return this.targets.map((t) => t.label);
  }

  send(packet: Buffer): void {
    if (!this.socket) return;
    for (const t of this.targets) this.socket.send(packet, t.port, t.host);
  }

  close(): void {
    this.socket?.close();
  }
}

function parseTarget(spec: string): Target | null {
  const match = /^([^:\s]+):(\d{1,5})$/.exec(spec.trim());
  if (!match) return null;
  const port = Number(match[2]);
  if (port < 1 || port > 65535) return null;
  return { host: match[1], port, label: `${match[1]}:${port}` };
}

function isLocal(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0';
}
