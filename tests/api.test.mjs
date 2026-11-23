import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../worker/index.js';
import { openDatabase } from '../scripts/database.mjs';
test('signup, persistence, link participation, authorization and stale-write protection', async () => {
  const DB = openDatabase();
  const request = async (path, { user = 'alice', method = 'GET', data, origin = 'https://when2meet.example' } = {}) => {
    const headers = { 'Content-Type': 'application/json', origin };
    if (user) { headers['oai-authenticated-user-id'] = user; headers['oai-authenticated-user-email'] = user + '@example.com'; }
    const response = await handle(new Request('https://when2meet.example/api' + path, { method, headers, ...(data ? { body: JSON.stringify(data) } : {}) }), { DB });
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await request('/meetings', { user: null })).status, 401);
  for (const user of ['alice', 'bob']) assert.equal((await request('/profile', { user, method: 'POST', data: { name: user } })).status, 200);
  assert.equal((await request('/profile', { method: 'POST', data: { name: 'bad' }, origin: 'https://evil.example' })).status, 403);
  const date = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const weekday = (new Date(date).getUTCDay() + 6) % 7;
  const created = await request('/meetings', { method: 'POST', data: { title: '스터디', start_date: date, end_date: date, start_hour: 9, end_hour: 12, duration: 60 } });
  assert.equal(created.status, 201);
  const path = '/meetings/' + created.body.id;
  assert.match(created.body.path, /^\/m\/[a-f0-9]{32}$/);
  const slots = [540, 570, 600, 630, 660, 690].map(minute => date + '|' + minute);
  for (const user of ['alice', 'bob']) assert.equal((await request(path + '/response', { user, method: 'PUT', data: { slots, version: 0 } })).status, 200);
  assert.equal((await request(path + '/response', { method: 'PUT', data: { slots, version: 0 } })).status, 409);
  assert.equal((await request(path + '/response', { method: 'PUT', data: { slots: ['1999-01-01|540'], version: 1 } })).status, 400);
  const fixed = { items: [{ id: 'private', name: '개인 상담', weekday, start: 540, end: 600 }], version: 0 };
  assert.equal((await request('/fixed', { method: 'PUT', data: fixed })).status, 200);
  assert.equal((await request('/fixed', { method: 'PUT', data: fixed })).status, 409);
  assert.equal((await request('/me', { user: 'bob' })).body.fixed.length, 0);
  const results = (await request(path, { user: 'bob' })).body;
  assert.equal(results.counts[date + '|540'], 1);
  assert.equal(results.candidates[0].count, 2);
  assert.equal(results.candidates[0].start, 600);
  assert.equal(JSON.stringify(results).includes('개인 상담'), false);
  assert.equal((await request('/meetings/ffffffffffffffffffffffffffffffff')).status, 404);
  DB.sqlite.close();
});
