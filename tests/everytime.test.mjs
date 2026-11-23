import test from 'node:test';
import assert from 'node:assert/strict';
import { everytimeIdentifier, parseEverytime, fetchEverytime } from '../worker/everytime.js';
import { mergeImportedFixed } from '../public/everytime-import.js';
import { effectiveSlots, meetingSlots } from '../worker/scheduling.js';

const xml = `<response><table year="2026" semester="2"><subject><name value="자료 &amp; 구조"/><time><data day="0" starttime="111" endtime="131"/><data day="2" starttime="108" endtime="126"/></time></subject><subject><name value="온라인 수업"/><time/></subject></table></response>`;
test('Everytime imports days and five-minute times, rounding overlapping slots outward', () => {
  const result = parseEverytime(xml);
  assert.deepEqual(result, { items: [{ name: '자료 & 구조', weekday: 0, start: 540, end: 660 }, { name: '자료 & 구조', weekday: 2, start: 540, end: 630 }], skipped: 1, year: '2026', semester: '2' });
  const meeting = { start_date: '2026-11-23', end_date: '2026-11-23', start_hour: 9, end_hour: 12 };
  assert.deepEqual(effectiveSlots(meetingSlots(meeting), result.items), ['2026-11-23|660', '2026-11-23|690']);
});
test('Only exact HTTPS Everytime share links can choose an identifier', () => {
  assert.equal(everytimeIdentifier('https://everytime.kr/@Oz0XXwY32vCmfi5zNHU2'), 'Oz0XXwY32vCmfi5zNHU2');
  for (const value of ['http://everytime.kr/@abcdefghijkl', 'https://everytime.kr.evil.test/@abcdefghijkl', 'https://everytime.kr@evil.test/@abcdefghijkl', 'https://everytime.kr:444/@abcdefghijkl', 'https://everytime.kr/@abcdefghijkl?next=evil', 'https://127.0.0.1/@abcdefghijkl', null]) assert.throws(() => everytimeIdentifier(value));
});
test('Private, malformed, oversized and invalid timetable data fails without partial import', () => {
  for (const value of ['<response><error>private</error></response>', '<response><table/></response>', xml.replace('day="0"', 'day="7"'), xml.replace('endtime="131"', 'endtime="100"'), '<!DOCTYPE response>' + xml, 'x'.repeat(1000001)]) assert.throws(() => parseEverytime(value));
});
test('Repeated imports preserve existing schedules and avoid duplicates; capacity errors are atomic', () => {
  const items = parseEverytime(xml).items;
  const existing = [{ id: 'manual', name: '운동', weekday: 4, start: 600, end: 660 }];
  const first = mergeImportedFixed(existing, items);
  assert.equal(first.added, 2); assert.deepEqual(first.items[0], existing[0]);
  assert.equal(mergeImportedFixed(first.items, items).added, 0);
  assert.throws(() => mergeImportedFixed(Array.from({ length: 49 }, (_, i) => ({ ...existing[0], name: '일정' + i })), items), /50개/);
  assert.equal(existing.length, 1);
});
test('Fetching only contacts the fixed public endpoint, without login data or redirects', async () => {
  let calls = 0;
  const result = await fetchEverytime('https://everytime.kr/@Oz0XXwY32vCmfi5zNHU2', async (url, options) => {
    calls++; assert.equal(url, 'https://api.everytime.kr/find/timetable/table/friend');
    assert.equal(options.body.get('identifier'), 'Oz0XXwY32vCmfi5zNHU2');
    assert.equal(options.body.get('friendInfo'), 'false'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, undefined);
    return new Response(xml);
  });
  assert.equal(result.items.length, 2); assert.equal(calls, 1);
  await assert.rejects(fetchEverytime('https://evil.test/@abcdefghijkl', () => { throw new Error('must not run'); }));
  await assert.rejects(fetchEverytime('https://everytime.kr/@Oz0XXwY32vCmfi5zNHU2', async () => new Response('blocked', { status: 403 })), /가져오지/);
});
