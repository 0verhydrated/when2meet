import { meetingSlots, effectiveSlots, summarize } from './scheduling.js';
import { fetchEverytime, EverytimeError } from './everytime.js';
import { validDeletionPassword, hashDeletionPassword, verifyDeletionPassword } from './meeting-password.js';

const STATIC_ASSETS = {};
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const check = (condition, message, status = 400) => { if (!condition) throw new HttpError(status, message); };
const text = (value, limit) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= limit;
async function body(request) {
  check(request.headers.get('content-type')?.startsWith('application/json'), '요청 형식을 확인해 주세요.', 415);
  check(Number(request.headers.get('content-length') || 0) <= 50000, '한 번에 저장할 수 있는 크기를 초과했어요.', 413);
  const raw = await request.text();
  check(raw.length <= 50000, '한 번에 저장할 수 있는 크기를 초과했어요.', 413);
  try { const value = JSON.parse(raw); check(value && typeof value === 'object' && !Array.isArray(value), '요청 내용을 확인해 주세요.'); return value; }
  catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, '요청 내용을 확인해 주세요.'); }
}
function validDate(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value; }
function validateMeeting(value) {
  check(text(value.title, 80), '약속 이름을 80자 이내로 입력해 주세요.');
  check(validDate(value.start_date) && validDate(value.end_date), '올바른 날짜를 선택해 주세요.');
  const difference = (Date.parse(value.end_date) - Date.parse(value.start_date)) / 86400000;
  check(difference >= 0 && difference <= 13, '날짜는 시작일부터 최대 14일까지 선택할 수 있어요.');
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  check(value.start_date >= today, '오늘 이후의 날짜를 선택해 주세요.');
  check(Number.isInteger(value.start_hour) && Number.isInteger(value.end_hour) && value.start_hour >= 0 && value.end_hour <= 24 && value.start_hour < value.end_hour, '시작 시간과 종료 시간을 확인해 주세요.');
}
function validateFixed(items) {
  check(Array.isArray(items) && items.length <= 50, '고정 일정은 최대 50개까지 등록할 수 있어요.');
  return items.map(item => {
    check(item && text(item.name, 40) && Number.isInteger(item.weekday) && item.weekday >= 0 && item.weekday <= 6 && Number.isInteger(item.start) && Number.isInteger(item.end) && item.start >= 0 && item.end <= 1440 && item.start < item.end && item.start % 30 === 0 && item.end % 30 === 0, '고정 일정의 이름, 요일과 시간을 확인해 주세요.');
    return { id: text(item.id, 80) ? item.id : crypto.randomUUID(), name: item.name.trim(), weekday: item.weekday, start: item.start, end: item.end };
  });
}
export async function handle(request, env, assets = STATIC_ASSETS) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) {
    const path = url.pathname === '/' || url.pathname === '/app' || /^\/m\/[a-f0-9]{32}$/.test(url.pathname) ? '/index.html' : url.pathname;
    const asset = assets[path];
    if (!asset) return new Response('페이지를 찾을 수 없어요.', { status: 404 });
    return new Response(request.method === 'HEAD' ? null : asset.body, { headers: { 'Content-Type': asset.type, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; object-src 'none'", 'Cache-Control': 'no-cache' } });
  }
  try {
    if (!['GET', 'HEAD'].includes(request.method)) {
      check(request.headers.get('origin') === url.origin, '다른 사이트에서 보낸 요청은 허용하지 않아요.', 403);
      check(request.headers.get('sec-fetch-site') !== 'cross-site', '다시 로그인한 뒤 시도해 주세요.', 403);
    }
    const identity = request.headers.get('oai-authenticated-user-id');
    const user = identity ? await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(identity).first() : null;
    const publicUser = user ? { id: user.id, name: user.name, email: user.email } : null;
    if (url.pathname === '/api/me' && request.method === 'GET') return json({ authenticated: Boolean(identity), auth_mode: env.AUTH_MODE || 'platform', user: publicUser, fixed: user ? JSON.parse(user.fixed_json) : [], fixed_version: user?.fixed_version || 0 });
    check(identity, '로그인 후 이용해 주세요.', 401);
    if (url.pathname === '/api/profile' && request.method === 'POST') {
      const value = await body(request);
      check(text(value.name, 30), '이름을 30자 이내로 입력해 주세요.');
      const saved = await env.DB.prepare('INSERT INTO users (id, name, email) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name RETURNING id, name, email').bind(identity, value.name.trim(), request.headers.get('oai-authenticated-user-email') || '').first();
      return json({ user: saved });
    }
    check(user, '이름을 등록하고 회원가입을 완료해 주세요.', 403);
    if (url.pathname === '/api/imports/everytime' && request.method === 'POST') {
      const value = await body(request);
      try { return json(await fetchEverytime(value.url)); }
      catch (error) { if (error instanceof EverytimeError) throw new HttpError(400, error.message); throw error; }
    }
    if (url.pathname === '/api/fixed' && request.method === 'PUT') {
      const value = await body(request);
      check(Number.isInteger(value.version) && value.version >= 0, '저장 버전을 확인해 주세요.');
      const items = validateFixed(value.items);
      const saved = await env.DB.prepare('UPDATE users SET fixed_json = ?, fixed_version = fixed_version + 1 WHERE id = ? AND fixed_version = ? RETURNING fixed_version').bind(JSON.stringify(items), identity, value.version).first();
      check(saved, '다른 창에서 일정이 변경됐어요. 새로고침 후 다시 저장해 주세요.', 409);
      return json({ fixed: items, fixed_version: saved.fixed_version });
    }
    if (url.pathname === '/api/saved-schedules' && request.method === 'GET') {
      const rows = await env.DB.prepare('SELECT id, name, start_date, end_date, start_hour, end_hour, slots_json, created_at FROM saved_schedules WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC, rowid DESC').bind(identity).all();
      return json({ schedules: rows.results.map(({ slots_json, ...item }) => ({ ...item, slots: JSON.parse(slots_json) })) });
    }
    if (url.pathname === '/api/saved-schedules' && request.method === 'POST') {
      const value = await body(request);
      check(text(value.name, 60), '저장할 일정 이름을 60자 이내로 입력해 주세요.');
      check(typeof value.meeting_id === 'string' && /^[a-f0-9]{32}$/.test(value.meeting_id), '약속을 확인해 주세요.');
      const original = await env.DB.prepare('SELECT start_date, end_date, start_hour, end_hour FROM meetings WHERE id = ? AND deleted_at IS NULL').bind(value.meeting_id).first();
      check(original, '약속 링크를 찾을 수 없어요.', 404);
      const allowed = new Set(meetingSlots(original));
      check(Array.isArray(value.slots) && value.slots.length <= allowed.size && value.slots.every(slot => typeof slot === 'string' && allowed.has(slot)), '저장할 시간이 약속 범위를 벗어났어요.');
      const slots = effectiveSlots([...new Set(value.slots)], JSON.parse(user.fixed_json));
      const id = crypto.randomUUID().replaceAll('-', '');
      const saved = await env.DB.prepare('INSERT INTO saved_schedules (id, user_id, name, start_date, end_date, start_hour, end_hour, slots_json) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM saved_schedules WHERE user_id = ? AND deleted_at IS NULL) < 30 RETURNING id').bind(id, identity, value.name.trim(), original.start_date, original.end_date, original.start_hour, original.end_hour, JSON.stringify(slots), identity).first();
      check(saved, '일정은 최대 30개까지 저장할 수 있어요. 사용하지 않는 일정을 지워 주세요.', 409);
      return json({ id }, 201);
    }
    const savedRoute = /^\/api\/saved-schedules\/([a-f0-9]{32})$/.exec(url.pathname);
    if (savedRoute && request.method === 'DELETE') {
      const removed = await env.DB.prepare('UPDATE saved_schedules SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND deleted_at IS NULL RETURNING id').bind(savedRoute[1], identity).first();
      check(removed, '저장한 일정을 찾을 수 없어요.', 404);
      return json({ deleted: true });
    }
    if (url.pathname === '/api/meetings' && request.method === 'GET') {
      const rows = await env.DB.prepare('SELECT m.id, m.owner_id, m.title, m.start_date, m.end_date, m.start_hour, m.end_hour, m.created_at, m.owner_id = ? AS can_delete, m.delete_password_hash IS NOT NULL AS has_delete_password, (SELECT COUNT(*) FROM responses r WHERE r.meeting_id = m.id) AS response_count FROM meetings m WHERE m.deleted_at IS NULL AND (m.owner_id = ? OR EXISTS (SELECT 1 FROM responses r WHERE r.meeting_id = m.id AND r.user_id = ?)) ORDER BY m.created_at DESC, m.rowid DESC LIMIT 100').bind(identity, identity, identity).all();
      return json({ meetings: rows.results });
    }
    if (url.pathname === '/api/meetings' && request.method === 'POST') {
      const value = await body(request);
      validateMeeting(value);
      check(validDeletionPassword(value.delete_password), '삭제 비밀번호는 8~128자로 입력해 주세요.');
      const passwordHash = await hashDeletionPassword(value.delete_password);
      const id = crypto.randomUUID().replaceAll('-', '');
      await env.DB.prepare('INSERT INTO meetings (id, owner_id, title, start_date, end_date, start_hour, end_hour, duration, delete_password_hash) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)').bind(id, identity, value.title.trim(), value.start_date, value.end_date, value.start_hour, value.end_hour, passwordHash).run();
      return json({ id, path: '/m/' + id }, 201);
    }
    const match = /^\/api\/meetings\/([a-f0-9]{32})(\/(?:response|delete-password))?$/.exec(url.pathname);
    if (match) {
      const meeting = await env.DB.prepare('SELECT id, owner_id, title, start_date, end_date, start_hour, end_hour, created_at FROM meetings WHERE id = ? AND (deleted_at IS NULL OR ? = 1)').bind(match[1], Number(!match[2] && request.method === 'DELETE')).first();
      check(meeting, '약속 링크를 찾을 수 없어요. 주소를 다시 확인해 주세요.', 404);
      if ((!match[2] && request.method === 'DELETE') || (match[2] === '/delete-password' && request.method === 'POST')) {
        check(meeting.owner_id === identity, '약속을 만든 사람만 삭제할 수 있어요.', 403);
        const value = await body(request);
        check(validDeletionPassword(value.password), '삭제 비밀번호는 8~128자로 입력해 주세요.');
        const secret = await env.DB.prepare('SELECT delete_password_hash, delete_failures, delete_reset_at FROM meetings WHERE id = ?').bind(meeting.id).first();
        if (match[2]) {
          check(!secret.delete_password_hash, '이미 삭제 비밀번호가 설정돼 있어요.', 409);
          const stored = await hashDeletionPassword(value.password);
          const saved = await env.DB.prepare('UPDATE meetings SET delete_password_hash = ? WHERE id = ? AND delete_password_hash IS NULL AND deleted_at IS NULL RETURNING id').bind(stored, meeting.id).first();
          check(saved, '다른 창에서 약속이 변경됐어요. 새로고침해 주세요.', 409);
          return json({ ok: true });
        }
        check(secret.delete_password_hash, '먼저 삭제 비밀번호를 설정해 주세요.', 409);
        const now = Date.now();
        check(!(secret.delete_failures >= 5 && secret.delete_reset_at > now), '비밀번호 확인 횟수를 초과했어요. 15분 뒤 다시 시도해 주세요.', 429);
        if (!await verifyDeletionPassword(value.password, secret.delete_password_hash)) {
          await env.DB.prepare('UPDATE meetings SET delete_failures = CASE WHEN delete_reset_at <= ? THEN 1 ELSE delete_failures + 1 END, delete_reset_at = CASE WHEN delete_reset_at <= ? THEN ? ELSE delete_reset_at END WHERE id = ?').bind(now, now, now + 900000, meeting.id).run();
          throw new HttpError(400, '삭제 비밀번호를 확인해 주세요.');
        }
        await env.DB.prepare('UPDATE meetings SET deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP) WHERE id = ?').bind(meeting.id).run();
        return json({ deleted: true });
      }
      if (match[2] === '/response' && request.method === 'PUT') {
        const value = await body(request);
        const allowed = new Set(meetingSlots(meeting));
        check(Array.isArray(value.slots) && value.slots.length <= allowed.size && value.slots.every(slot => typeof slot === 'string' && allowed.has(slot)), '선택한 시간이 약속 범위를 벗어났어요.');
        check(Number.isInteger(value.version) && value.version >= 0, '참여 정보 버전을 확인해 주세요.');
        const slots = effectiveSlots([...new Set(value.slots)], JSON.parse(user.fixed_json));
        const saved = await env.DB.prepare('INSERT INTO responses (meeting_id, user_id, slots_json) VALUES (?, ?, ?) ON CONFLICT(meeting_id, user_id) DO UPDATE SET slots_json = excluded.slots_json, version = responses.version + 1, updated_at = CURRENT_TIMESTAMP WHERE responses.version = ? RETURNING version').bind(meeting.id, identity, JSON.stringify(slots), value.version).first();
        check(saved, '다른 창에서 참여 정보가 바뀌었어요. 새로고침 후 다시 제출해 주세요.', 409);
        return json({ slots, version: saved.version });
      }
      if (!match[2] && request.method === 'GET') {
        const rows = await env.DB.prepare('SELECT r.user_id, r.slots_json, r.version, u.name, u.fixed_json FROM responses r JOIN users u ON u.id = r.user_id WHERE r.meeting_id = ? ORDER BY r.updated_at, r.user_id').bind(meeting.id).all();
        const mine = rows.results.find(response => response.user_id === identity);
        const secret = await env.DB.prepare('SELECT delete_password_hash IS NOT NULL AS configured FROM meetings WHERE id = ?').bind(meeting.id).first();
        return json({ meeting, can_delete: meeting.owner_id === identity, has_delete_password: Boolean(secret.configured), ...summarize(meeting, rows.results), mine: mine ? { slots: JSON.parse(mine.slots_json), version: mine.version } : null });
      }
    }
    throw new HttpError(404, '요청한 기능을 찾을 수 없어요.');
  } catch (error) {
    if (!(error instanceof HttpError)) console.error('Request failed:', error.message);
    return json({ error: error instanceof HttpError ? error.message : '저장소에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.' }, error.status || 500);
  }
}
export default { fetch(request, env) { return handle(request, env); } };
