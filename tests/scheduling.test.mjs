import test from 'node:test';
import assert from 'node:assert/strict';
import { isBlocked, effectiveSlots, summarize } from '../worker/scheduling.js';
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
test('results apply changed fixed schedules and require consecutive availability', () => {
  const responses = [{ name: '가', slots_json: JSON.stringify(['2026-11-23|540', '2026-11-23|570', '2026-11-23|600', '2026-11-23|630']), fixed_json: JSON.stringify([{ weekday: 0, start: 570, end: 600 }]) }, { name: '나', slots_json: JSON.stringify(['2026-11-23|540', '2026-11-23|570', '2026-11-23|600', '2026-11-23|630']), fixed_json: '[]' }];
  const summary = summarize(meeting, responses);
  assert.equal(summary.counts['2026-11-23|570'], 1);
  assert.deepEqual(summary.candidates[0], { date: '2026-11-23', start: 600, end: 660, count: 2 });
  assert.equal(summary.candidates.find(candidate => candidate.start === 540)?.count, 1);
});
