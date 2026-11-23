import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { handle } from '../worker/index.js';
import { openDatabase } from './database.mjs';
const root = new URL('../public/', import.meta.url);
const types = { css: 'text/css', js: 'text/javascript', svg: 'image/svg+xml', html: 'text/html' };
mkdirSync(new URL('../.local/', import.meta.url), { recursive: true });
const DB = openDatabase(fileURLToPath(new URL('../.local/when2meet.sqlite', import.meta.url)));
createServer(async (request, response) => {
  const url = new URL(request.url, 'http://' + request.headers.host);
  if (url.pathname === '/signin-with-chatgpt') {
    const target = url.searchParams.get('return_to') || '/app';
    const safe = new URL(target, url.origin);
    response.writeHead(302, { Location: safe.origin === url.origin ? safe.pathname + safe.search : '/app', 'Set-Cookie': 'when2meet_local=local-user; HttpOnly; SameSite=Lax; Path=/' }).end(); return;
  }
  if (url.pathname === '/signout-with-chatgpt') { response.writeHead(302, { Location: '/', 'Set-Cookie': 'when2meet_local=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' }).end(); return; }
  if (url.pathname.startsWith('/api/')) {
    try {
      const headers = new Headers(request.headers);
      headers.delete('oai-authenticated-user-id'); headers.delete('oai-authenticated-user-email');
      const identity = /(?:^|;\s*)when2meet_local=([a-z0-9-]{1,60})(?:;|$)/.exec(request.headers.cookie || '')?.[1];
      if (identity) { headers.set('oai-authenticated-user-id', identity); headers.set('oai-authenticated-user-email', identity + '@example.com'); }
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const result = await handle(new Request(url, { method: request.method, headers, ...(!['GET', 'HEAD'].includes(request.method) ? { body: Buffer.concat(chunks) } : {}) }), { DB });
      response.writeHead(result.status, Object.fromEntries(result.headers)); response.end(Buffer.from(await result.arrayBuffer()));
    } catch { response.writeHead(500).end('Local request failed'); }
    return;
  }
  const name = ['/', '/app'].includes(url.pathname) || /^\/m\/[a-f0-9]{32}$/.test(url.pathname) ? 'index.html' : url.pathname.slice(1);
  if (name.includes('..')) { response.writeHead(404).end(); return; }
  try { const data = await readFile(new URL(name, root)); response.writeHead(200, { 'Content-Type': types[name.split('.').pop()] || 'text/plain' }); response.end(data); }
  catch { response.writeHead(404).end('Not found'); }
}).listen(4173, '127.0.0.1', () => console.log('Local: http://127.0.0.1:4173'));
