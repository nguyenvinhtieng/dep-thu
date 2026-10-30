import { LobbyRoom, Server } from '@colyseus/core';
import { uWebSocketsTransport } from '@colyseus/uwebsockets-transport';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MatchRoom, stats } from './rooms/MatchRoom';

const PORT = Number(process.env.PORT ?? 2567);
const prod = process.env.NODE_ENV === 'production';

const transport = new uWebSocketsTransport({ maxPayloadLength: 4 * 1024, idleTimeout: 30 });
const server = new Server({ transport, greet: false });

server.define('lobby', LobbyRoom);
server.define('match', MatchRoom).enableRealtimeListing();

// Prod: một tiến trình phục vụ cả client tĩnh (client/dist) + WebSocket
if (prod) {
  const dist = resolve(fileURLToPath(import.meta.url), '../../../client/dist');
  const types: Record<string, string> = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.json': 'application/json', '.ico': 'image/x-icon',
  };
  const app = await transport.getExpressApp();
  app.get('/healthz', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ status: 'ok' });
  });
  app.use((req: { path?: string; url: string }, res: { setHeader(k: string, v: string): void; statusCode: number; end(b?: unknown): void }, next: () => void) => {
    const path = decodeURIComponent((req.path ?? req.url).split('?')[0]);
    if (path.startsWith('/matchmake')) return next();
    let file = normalize(join(dist, path));
    if (!file.startsWith(dist)) { res.statusCode = 403; return res.end(); }
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(dist, 'index.html');
    res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
    if (file.includes('/assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.end(readFileSync(file));
  });
  // Colyseus tự gắn "/" (trang chào) → đăng ký thẳng trên uWS trước listen() để trả index.html
  const index = readFileSync(join(dist, 'index.html'));
  (transport as unknown as { app: { get(p: string, h: (res: { writeHeader(k: string, v: string): unknown; end(b: Buffer): void }) => void): void } })
    .app.get('/', (res) => { res.writeHeader('Content-Type', types['.html']); res.end(index); });
}

await server.listen(PORT);
console.log(`[dep-thu] server :${PORT} ${prod ? '(prod, phục vụ client/dist)' : '(dev)'}`);

setInterval(() => {
  const avg = stats.tickN ? (stats.tickSum / stats.tickN).toFixed(3) : '-';
  console.log(
    `[stats] rooms=${stats.rooms} out=${(stats.bytesOut / 10 / 1024).toFixed(1)}KB/s in=${(stats.bytesIn / 10 / 1024).toFixed(1)}KB/s ` +
      `tick avg=${avg}ms max=${stats.tickMax.toFixed(3)}ms`,
  );
  stats.bytesOut = stats.bytesIn = stats.tickSum = stats.tickN = stats.tickMax = 0;
}, 10_000).unref();
