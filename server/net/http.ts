// Serves the dashboard, a small JSON API for laps, and the live WebSocket at /ws.

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ServerMessage } from '../../shared/protocol.ts';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

/** Clients this far behind on a slow network skip frames instead of queueing them. */
const MAX_BUFFERED_BYTES = 512 * 1024;

export interface ApiHandlers {
  listLaps(limit: number): unknown;
  deleteLap(id: number): boolean;
  info(): unknown;
  /** Messages a newly connected dashboard needs to draw its first frame. */
  snapshot(): ServerMessage[];
}

export class WebServer {
  private readonly server: Server;
  private readonly wss: WebSocketServer;
  private readonly webRoot: string;
  private readonly api: ApiHandlers;

  constructor(webRoot: string, api: ApiHandlers) {
    this.webRoot = webRoot;
    this.api = api;
    this.server = createServer((req, res) => this.handle(req, res));
    this.wss = new WebSocketServer({ noServer: true });
    this.server.on('upgrade', (req, socket, head) => {
      if (new URL(req.url ?? '/', 'http://x').pathname !== '/ws') {
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.onClient(ws));
    });
  }

  listen(port: number): Promise<void> {
    return new Promise((resolveListen, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, '0.0.0.0', () => resolveListen());
    });
  }

  get clientCount(): number {
    return this.wss.clients.size;
  }

  broadcast(message: ServerMessage, droppable = false): void {
    if (this.wss.clients.size === 0) return;
    const data = JSON.stringify(message);
    for (const ws of this.wss.clients) {
      if (ws.readyState !== ws.OPEN) continue;
      if (droppable && ws.bufferedAmount > MAX_BUFFERED_BYTES) continue;
      ws.send(data);
    }
  }

  close(): void {
    for (const ws of this.wss.clients) ws.terminate();
    this.wss.close();
    this.server.close();
  }

  private onClient(ws: WebSocket): void {
    for (const message of this.api.snapshot()) ws.send(JSON.stringify(message));
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://x');
    try {
      if (url.pathname.startsWith('/api/')) return this.handleApi(req, res, url);
      this.serveStatic(url.pathname, res);
    } catch (err) {
      console.error(err);
      sendJson(res, 500, { error: 'Internal error' });
    }
  }

  private handleApi(req: IncomingMessage, res: ServerResponse, url: URL): void {
    if (req.method === 'GET' && url.pathname === '/api/info') return sendJson(res, 200, this.api.info());
    if (req.method === 'GET' && url.pathname === '/api/laps') {
      const limit = Math.min(Number(url.searchParams.get('limit') ?? 300) || 300, 2000);
      return sendJson(res, 200, this.api.listLaps(limit));
    }
    const lapMatch = /^\/api\/laps\/(\d+)$/.exec(url.pathname);
    if (req.method === 'DELETE' && lapMatch) {
      const deleted = this.api.deleteLap(Number(lapMatch[1]));
      return sendJson(res, deleted ? 200 : 404, { deleted });
    }
    sendJson(res, 404, { error: 'Not found' });
  }

  private serveStatic(pathname: string, res: ServerResponse): void {
    if (!existsSync(this.webRoot)) {
      res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('The dashboard is not built yet. Run "npm start" (or "npm run build") first.');
      return;
    }
    const safe = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
    let file = join(this.webRoot, safe);
    if (!file.startsWith(this.webRoot + sep) && file !== this.webRoot) {
      res.writeHead(403).end();
      return;
    }
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(this.webRoot, 'index.html');
    const type = CONTENT_TYPES[extname(file)] ?? 'application/octet-stream';
    const immutable = file.includes(`${sep}assets${sep}`);
    res.writeHead(200, {
      'content-type': type,
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    createReadStream(file).pipe(res);
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
