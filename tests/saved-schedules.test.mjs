import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../worker/index.js';
import { openDatabase } from '../scripts/database.mjs';
import { applySavedSchedule } from '../public/saved-schedules.js';

test('Saved schedules preserve dates, partial time windows, empty selections and unrelated edits', () => {
  const meeting = { start_date: '2026-11-28', end_date: '2026-11-30', start_hour: 9, end_hour: 24 };
  const saved = { start_date: '2026-11-28', end_date: '2026-11-29', start_hour: 9, end_hour: 12, slots: ['2026-11-28|540', '2026-11-29|600'] };
  const current = ['2026-11-28|570', '2026-11-28|1260', '2026-11-29|660', '2026-11-30|540'];
  const result = applySavedSchedule(current, saved, meeting, slot => slot === '2026-11-29|600');
  assert.equal(result.overlaps, true);
  assert.deepEqual(result.slots.sort(), ['2026-11-28|540', '2026-11-28|1260', '2026-11-30|540'].sort());
  assert.deepEqual(current, ['2026-11-28|570', '2026-11-28|1260', '2026-11-29|660', '2026-11-30|540']);
  assert.deepEqual(applySavedSchedule(current, { ...saved, slots: [] }, meeting).slots.sort(), ['2026-11-28|1260', '2026-11-30|540'].sort());
  assert.deepEqual(applySavedSchedule(current, { ...saved, start_date: '2027-01-01', end_date: '2027-01-02' }, meeting), { slots: current, overlaps: false });
  assert.equal(applySavedSchedule(current, { ...saved, start_hour: 0, end_hour: 8 }, meeting).overlaps, false);
});

test('Saved schedules are account-private, validate the source range, exclude fixed times and survive source deletion', async () => {
  const DB = openDatabase();
  try {
    const request = async (path, method = 'GET', data, actor = 'owner') => {
      const response = await handle(new Request('https://test.example/api' + path, { method, headers: { Origin: 'https://test.example', 'Content-Type': 'application/json', ...(actor ? { 'oai-authenticated-user-id': actor } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) }), { DB });
      return { status: response.status, body: await response.json() };
    };
    for (const actor of ['owner', 'other']) await request('/profile', 'POST', { name: actor }, actor);
    const date = new Date(Date.now() + 86400000).toISOString().slice(0, 10), weekday = (new Date(date).getUTCDay() + 6) % 7;
    const { body: meeting } = await request('/meetings', 'POST', { title: '원본', start_date: date, end_date: date, start_hour: 9, end_hour: 24, delete_password: 'test-password' });
    await request('/fixed', 'PUT', { version: 0, items: [{ name: '비공개', weekday, start: 540, end: 570 }] });
    assert.equal((await request('/saved-schedules', 'GET', undefined, null)).status, 401);
    assert.equal((await request('/saved-schedules', 'POST', { name: '', meeting_id: meeting.id, slots: [] })).status, 400);
    assert.equal((await request('/saved-schedules', 'POST', { name: '범위 밖', meeting_id: meeting.id, slots: [date + '|1440'] })).status, 400);
    const saved = await request('/saved-schedules', 'POST', { name: '주말 일정', meeting_id: meeting.id, slots: [date + '|540', date + '|1410'] });
    assert.equal(saved.status, 201);
    const items = (await request('/saved-schedules')).body.schedules;
    assert.deepEqual(items[0].slots, [date + '|1410']);
    assert.equal(items[0].start_date, date); assert.equal(items[0].end_hour, 24);
    assert.equal(JSON.stringify(items).includes('비공개'), false);
    assert.deepEqual((await request('/saved-schedules', 'GET', undefined, 'other')).body.schedules, []);
    assert.equal((await request('/saved-schedules/' + saved.body.id, 'DELETE', {}, 'other')).status, 404);
    await request('/meetings/' + meeting.id, 'DELETE', { password: 'test-password' });
    assert.equal((await request('/saved-schedules')).body.schedules.length, 1);
    assert.equal((await request('/saved-schedules', 'POST', { name: '삭제된 약속', meeting_id: meeting.id, slots: [] })).status, 404);
    assert.equal((await request('/saved-schedules/' + saved.body.id, 'DELETE', {})).status, 200);
    assert.deepEqual((await request('/saved-schedules')).body.schedules, []);
  } finally { DB.sqlite.close(); }
});
