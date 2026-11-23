import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const lifetime = 7 * 24 * 60 * 60;
let hashing = 0;
const digest = value => createHash('sha256').update(value).digest('hex');
export const authJson = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
function cookieName(request) { return new URL(request.url).protocol === 'https:' ? '__Host-when2meet_session' : 'when2meet_session'; }
function cookieToken(request) {
  const name = cookieName(request);
  return (request.headers.get('cookie') || '').split(';').map(part => part.trim()).find(part => part.startsWith(name + '='))?.slice(name.length + 1);
}
function sessionCookie(request, token, maxAge = lifetime) {
  return `${cookieName(request)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
export function sessionUser(request, DB) {
  const token = cookieToken(request);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return DB.sqlite.prepare('SELECT u.id, u.email FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?').get(digest(token), Date.now()) || null;
}
async function passwordKey(password, salt) {
  if (hashing >= 2) throw Object.assign(new Error('요청이 많습니다. 잠시 후 다시 시도해 주세요.'), { status: 429 });
  hashing++;
  try { return Buffer.from(await derive(password, salt, 64, options)); }
  finally { hashing--; }
}
function attempt(DB, key, maximum) {
  const now = Date.now();
  const window = 15 * 60 * 1000;
  const row = DB.sqlite.prepare('INSERT INTO auth_limits (key, attempts, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET attempts = CASE WHEN auth_limits.expires_at <= ? THEN 1 ELSE auth_limits.attempts + 1 END, expires_at = CASE WHEN auth_limits.expires_at <= ? THEN excluded.expires_at ELSE auth_limits.expires_at END RETURNING attempts').get(digest(key), now + window, now, now);
  if (row.attempts > maximum) throw Object.assign(new Error('시도 횟수가 많습니다. 15분 후 다시 시도해 주세요.'), { status: 429 });
}
export async function handleAuth(request, DB, address = 'local') {
  const path = new URL(request.url).pathname;
  if (request.method !== 'POST') return authJson({ error: 'POST 요청을 사용해 주세요.' }, 405, { Allow: 'POST' });
  if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') return authJson({ error: '같은 사이트에서 다시 시도해 주세요.' }, 403);
  try {
    DB.sqlite.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(Date.now());
    DB.sqlite.prepare('DELETE FROM auth_limits WHERE expires_at <= ?').run(Date.now());
    if (path === '/api/auth/logout') {
      const token = cookieToken(request);
      if (token) DB.sqlite.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(digest(token));
      return authJson({ ok: true }, 200, { 'Set-Cookie': sessionCookie(request, '', 0) });
    }
    if (!['/api/auth/register', '/api/auth/login'].includes(path)) return authJson({ error: '요청한 기능을 찾을 수 없어요.' }, 404);
    attempt(DB, 'address:' + address, 200);
    if (!request.headers.get('content-type')?.startsWith('application/json')) return authJson({ error: '요청 형식을 확인해 주세요.' }, 415);
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 50000) return authJson({ error: '요청 크기를 초과했어요.' }, 413);
    let data;
    try { data = JSON.parse(raw); } catch { return authJson({ error: '입력 내용을 확인해 주세요.' }, 400); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return authJson({ error: '입력 내용을 확인해 주세요.' }, 400);
    const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof data.password !== 'string' || data.password.length < 8 || data.password.length > 128) return authJson({ error: '이메일 형식과 비밀번호를 확인해 주세요. 비밀번호는 8~128자여야 합니다.' }, 400);
    attempt(DB, 'account:' + email, 20);
    let userId;
    if (path === '/api/auth/register') {
      const name = typeof data.name === 'string' ? data.name.trim() : '';
      if (!name || name.length > 30) return authJson({ error: '이름을 30자 이내로 입력해 주세요.' }, 400);
      const salt = randomBytes(16).toString('hex');
      const key = await passwordKey(data.password, salt);
      userId = randomUUID();
      DB.sqlite.exec('BEGIN IMMEDIATE');
      try {
        DB.sqlite.prepare('INSERT INTO users (id, name, email) VALUES (?, ?, ?)').run(userId, name, email);
        DB.sqlite.prepare('INSERT INTO auth_accounts (email, user_id, password_hash) VALUES (?, ?, ?)').run(email, userId, `scrypt$${salt}$${key.toString('hex')}`);
        DB.sqlite.exec('COMMIT');
      } catch (error) {
        DB.sqlite.exec('ROLLBACK');
        if (error.message.includes('UNIQUE constraint failed: auth_accounts.email')) return authJson({ error: '이미 가입한 이메일입니다. 로그인해 주세요.' }, 409);
        throw error;
      }
    } else {
      const account = DB.sqlite.prepare('SELECT user_id, password_hash FROM auth_accounts WHERE email = ?').get(email);
      const [, salt, expected] = (account?.password_hash || 'scrypt$00000000000000000000000000000000$' + '00'.repeat(64)).split('$');
      const key = await passwordKey(data.password, salt);
      if (!account || !timingSafeEqual(key, Buffer.from(expected, 'hex'))) return authJson({ error: '이메일 또는 비밀번호를 확인해 주세요.' }, 401);
      userId = account.user_id;
    }
    const previous = cookieToken(request);
    if (previous) DB.sqlite.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(digest(previous));
    const token = randomBytes(32).toString('base64url');
    DB.sqlite.prepare('INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(digest(token), userId, Date.now() + lifetime * 1000);
    return authJson({ ok: true }, path.endsWith('register') ? 201 : 200, { 'Set-Cookie': sessionCookie(request, token) });
  } catch (error) {
    return authJson({ error: error.status ? error.message : '계정 정보를 저장하지 못했어요. 다시 시도해 주세요.' }, error.status || 500, error.status === 429 ? { 'Retry-After': '900' } : {});
  }
}
