import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

export interface Config {
  /** Where F1 25 sends the Telemetry Feed. Must match the game's UDP Port setting. */
  udpPort: number;
  /** Where the dashboard is served. Open http://<pc-ip>:<httpPort> on the iPad. */
  httpPort: number;
  /** Forwarding targets, "host:port". */
  forward: string[];
  dbPath: string;
  webRoot: string;
}

const projectRoot = resolve(import.meta.dirname, '..');

export function loadConfig(argv = process.argv.slice(2), env = process.env): Config {
  const { values } = parseArgs({
    args: argv,
    options: {
      'udp-port': { type: 'string' },
      'http-port': { type: 'string' },
      forward: { type: 'string', multiple: true },
      db: { type: 'string' },
    },
    allowPositionals: false,
  });
  const forward = [...(values.forward ?? []), ...(env.FORWARD ? env.FORWARD.split(',') : [])]
    .map((t) => t.trim())
    .filter(Boolean);
  return {
    udpPort: Number(values['udp-port'] ?? env.UDP_PORT ?? 20777),
    httpPort: Number(values['http-port'] ?? env.HTTP_PORT ?? 8025),
    forward,
    dbPath: resolve(values.db ?? env.DB_PATH ?? resolve(projectRoot, 'data', 'telemetry.db')),
    webRoot: resolve(projectRoot, 'dist', 'web'),
  };
}
