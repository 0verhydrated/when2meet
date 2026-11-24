import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../worker/index.js';
import { openDatabase } from '../scripts/database.mjs';
import { hashDeletionPassword, verifyDeletionPassword } from '../worker/meeting-password.js';

test('Deletion requires the owner and password, hides the meeting and responses, and preserves unrelated data', async () => {
  const DB = openDatabase();
  try {
    const request = async (path, method = 'GET', data, user = 'owner') => {
      const response = await handle(new Request('https://test.example/api' + path, { method, headers: { Origin: 'https://test.example', 'Content-Type': 'application/json', ...(user ? { 'oai-authenticated-user-id': user } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) }), { DB });
      return { status: response.status, body: await response.json() };
    };
    for (const user of ['owner', 'guest']) await request('/profile', 'POST', { name: user }, user);
    const date = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const input = { title: '삭제 검증', start_date: date, end_date: date, start_hour: 9, end_hour: 10 };
    assert.equal((await request('/meetings', 'POST', input)).status, 400);
    const created = await request('/meetings', 'POST', { ...input, delete_password: 'correct-password' });
    assert.equal(created.status, 201);
    const path = '/meetings/' + created.body.id;
    await request(path + '/response', 'PUT', { slots: [date + '|540'], version: 0 }, 'guest');
    const guestView = await request(path, 'GET', undefined, 'guest');
    assert.equal(guestView.body.can_delete, false);
    assert.equal(JSON.stringify(guestView.body).includes('password_hash'), false);
    assert.equal((await request(path, 'DELETE', { password: 'correct-password' }, 'guest')).status, 403);
    assert.equal((await request(path, 'DELETE', { password: 'wrong-password' })).status, 400);
    assert.equal((await request(path)).status, 200);
    assert.equal((await request(path, 'DELETE', { password: 'correct-password' })).body.deleted, true);
    assert.equal((await request(path, 'DELETE', { password: 'correct-password' })).body.deleted, true);
    assert.equal((await request(path)).status, 404);
    assert.equal((await request(path + '/response', 'PUT', { slots: [], version: 1 }, 'guest')).status, 404);
    assert.deepEqual((await request('/meetings')).body.meetings, []);
    assert.deepEqual((await request('/meetings', 'GET', undefined, 'guest')).body.meetings, []);
    assert.equal(DB.sqlite.prepare('select count(*) amount from users').get().amount, 2);
    // Deletion is a tombstone so a mistaken deletion can be recovered administratively.
    assert.equal(DB.sqlite.prepare('select count(*) amount from responses').get().amount, 1);
    const legacyId = 'a'.repeat(32);
    DB.sqlite.prepare('insert into meetings(id,owner_id,title,start_date,end_date,start_hour,end_hour,duration) values(?,?,?,?,?,?,?,0)').run(legacyId, 'owner', '이전 약속', date, date, 9, 10);
    assert.equal((await request('/meetings/' + legacyId)).body.has_delete_password, false);
    assert.equal((await request('/meetings/' + legacyId + '/delete-password', 'POST', { password: 'legacy-password' }, 'guest')).status, 403);
    assert.equal((await request('/meetings/' + legacyId + '/delete-password', 'POST', { password: 'legacy-password' })).status, 200);
    assert.equal((await request('/meetings/' + legacyId + '/delete-password', 'POST', { password: 'replacement-password' })).status, 409);
    for (let i = 0; i < 5; i++) assert.equal((await request('/meetings/' + legacyId, 'DELETE', { password: 'wrong-password' })).status, 400);
    assert.equal((await request('/meetings/' + legacyId, 'DELETE', { password: 'legacy-password' })).status, 429);
    DB.sqlite.prepare('update meetings set delete_reset_at=0 where id=?').run(legacyId);
    assert.equal((await request('/meetings/' + legacyId, 'DELETE', { password: 'legacy-password' })).status, 200);
  } finally { DB.sqlite.close(); }
});

test('Deletion secrets are salted bcrypt hashes and long Unicode passwords are not truncated', async () => {
  const password = '가'.repeat(100) + '끝';
  const first = await hashDeletionPassword(password), second = await hashDeletionPassword(password);
  assert.notEqual(first, second); assert.match(first, /^\$2[ab]\$10\$/);
  assert.equal(first.includes(password), false);
  assert.equal(await verifyDeletionPassword(password, first), true);
  assert.equal(await verifyDeletionPassword('가'.repeat(100) + '밖', first), false);
});
