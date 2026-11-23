import test from 'node:test';
import assert from 'node:assert/strict';
import { isBlocked, effectiveSlots, summarize, meetingSlots } from '../worker/scheduling.js';
const meeting = { start_date: '2026-11-23', end_date: '2026-11-23', start_hour: 9, end_hour: 12, duration: 60 };
test('recurring exclusions use Seoul calendar weekday and half-open intervals', () => {
  const fixed = [{ weekday: 0, start: 570, end: 630 }];
  assert.equal(isBlocked('2026-11-23|540', fixed), false);
  assert.equal(isBlocked('2026-11-23|570', fixed), true);
  assert.equal(isBlocked('2026-11-23|600', fixed), true);
  assert.equal(isBlocked('2026-11-23|630', fixed), false);
  assert.equal(isBlocked('2026-11-24|570', fixed), false);
  assert.deepEqual(effectiveSlots(['2026-11-23|540', '2026-11-23|570', '2026-11-23|630'], fixed), ['2026-11-23|540', '2026-11-23|630']);
});
test('results join continuous equal-count slots without enforcing legacy duration', () => {
  const responses = [{ name: '가', slots_json: JSON.stringify(['2026-11-23|540', '2026-11-23|570', '2026-11-23|600', '2026-11-23|630']), fixed_json: JSON.stringify([{ weekday: 0, start: 570, end: 600 }]) }, { name: '나', slots_json: JSON.stringify(['2026-11-23|540', '2026-11-23|570', '2026-11-23|600', '2026-11-23|630']), fixed_json: '[]' }];
  const summary = summarize(meeting, responses);
  assert.equal(summary.counts['2026-11-23|570'], 1);
  assert.deepEqual(summary.candidates.find(candidate => candidate.start === 600), { date: '2026-11-23', start: 600, end: 660, count: 2 });
  assert.equal(summary.candidates.find(candidate => candidate.start === 540)?.count, 2);
  assert.deepEqual(summarize({ ...meeting, duration: 120 }, responses).candidates, summary.candidates);
});
test('continuous ranges retain 30-minute periods and split at gaps and midnight', () => {
  const response = { name: '가', fixed_json: '[]', slots_json: JSON.stringify(['2026-11-23|540', '2026-11-23|600', '2026-11-23|630', '2026-11-24|540']) };
  const summary = summarize({ ...meeting, end_date: '2026-11-24' }, [response]);
  assert.deepEqual(summary.candidates, [
    { date: '2026-11-23', start: 540, end: 570, count: 1 },
    { date: '2026-11-23', start: 600, end: 660, count: 1 },
    { date: '2026-11-24', start: 540, end: 570, count: 1 }
  ]);
});
test('equal counts from different participants do not form one continuous range', () => {
  const responses = [
    { name: '가', fixed_json: '[]', slots_json: JSON.stringify(['2026-11-23|540']) },
    { name: '나', fixed_json: '[]', slots_json: JSON.stringify(['2026-11-23|570']) }
  ];
  assert.deepEqual(summarize(meeting, responses).candidates, [
    { date: '2026-11-23', start: 540, end: 570, count: 1 },
    { date: '2026-11-23', start: 570, end: 600, count: 1 }
  ]);
});
test('Participant availability uses current fixed schedules, preserves duplicate names and omits private details', () => {
  const result = summarize(meeting, [
    { name: '민준', user_id: 'private-one', email: 'private@example.com', slots_json: JSON.stringify(['2026-11-23|540', '2026-11-23|570', '2026-11-23|570', '2026-11-24|540']), fixed_json: JSON.stringify([{ name: '개인 상담', weekday: 0, start: 570, end: 600 }]) },
    { name: '민준', user_id: 'private-two', slots_json: '[]', fixed_json: '[]' },
  ]);
  assert.deepEqual(result.participants, [{ name: '민준', slots: ['2026-11-23|540'] }, { name: '민준', slots: [] }]);
  assert.equal(JSON.stringify(result).includes('개인 상담'), false);
  assert.equal(JSON.stringify(result).includes('private'), false);
  for (const slot of meetingSlots(meeting)) assert.equal(result.counts[slot], result.participants.filter(person => person.slots.includes(slot)).length);
});
