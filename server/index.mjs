import { exportWriterSource } from '../scripts/export-writer.mjs';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { handle } from '../worker/index.js';
import { openDatabase } from '../scripts/database.mjs';
import { handleAuth, sessionUser, authJson } from './auth.mjs';

const types = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', svg: 'image/svg+xml' };
const assets = Object.fromEntries(['index.html', 'styles.css', 'tokens.css', 'app.js', 'demo.js', 'auth-ui.js', 'backend.js', 'everytime-import.js', 'fixed-grid.js', 'schedule-grid.js', 'availability-overview.js', 'response-editor.js', 'meeting-deletion.js', 'dialog.js', 'saved-schedules.js', 'result-export.js', 'navigation.js', 'favicon.svg'].map(name => ['/' + name, { body: readFileSync(new URL('../public/' + name, import.meta.url), 'utf8'), type: types[name.split('.').pop()] }]));
assets['/xlsx-writer.js'] = { body: await exportWriterSource(), type: types.js };
export async function handleNative(request, DB, address) {
  if (new URL(request.url).pathname.startsWith('/api/auth/')) return handleAuth(request, DB, address);
  const headers = new Headers(request.headers);
  for (const name of [...headers.keys()]) if (name.startsWith('oai-authenticated-')) headers.delete(name);
  const user = sessionUser(request, DB);
  if (user) { headers.set('oai-authenticated-user-id', user.id); headers.set('oai-authenticated-user-email', user.email); }
  return handle(new Request(request, { headers }), { DB, AUTH_MODE: 'password' }, assets);
}
export function startServer() {
  const production = process.env.NODE_ENV === 'production';
  const port = Number(process.env.PORT || 4173);
  const origin = process.env.PUBLIC_ORIGIN || (!production ? `http://127.0.0.1:${port}` : '');
  if (!origin || (production && new URL(origin).protocol !== 'https:') || new URL(origin).origin !== origin) throw new Error('Set PUBLIC_ORIGIN to the exact public HTTPS origin');
  const databasePath = process.env.DATABASE_PATH || fileURLToPath(new URL('../.local/when2meet.sqlite', import.meta.url));
  mkdirSync(dirname(databasePath), { recursive: true });
  const DB = openDatabase(databasePath);
  const server = createServer(async (incoming, outgoing) => {
    try {
      const chunks = []; let length = 0;
      for await (const chunk of incoming) { length += chunk.length; if (length > 50000) { outgoing.writeHead(413, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: '요청 크기를 초과했어요.' })); return; } chunks.push(chunk); }
      const target = new URL(incoming.url, origin);
      if (target.origin !== origin) { outgoing.writeHead(400).end(); return; }
      const request = new Request(target, { method: incoming.method, headers: incoming.headers, ...(!['GET', 'HEAD'].includes(incoming.method) ? { body: Buffer.concat(chunks) } : {}) });
      const response = await handleNative(request, DB, incoming.socket.remoteAddress);
      outgoing.writeHead(response.status, { ...Object.fromEntries(response.headers), ...(production ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}) });
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch { const response = authJson({ error: '요청을 처리하지 못했어요.' }, 500); outgoing.writeHead(response.status, Object.fromEntries(response.headers)).end(await response.text()); }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  server.listen(port, production ? '0.0.0.0' : '127.0.0.1', () => console.log(`Local: ${origin}`));
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startServer();
