import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOverviewModel, matchesOverviewFilter, overviewSlotDetails } from '../public/availability-overview.js';
import { toggleColumnSelection } from '../public/schedule-grid.js';

const meeting = { start_date: '2026-11-24', end_date: '2026-11-25', start_hour: 9, end_hour: 10 };
const people = [{ name: '민준', slots: ['2026-11-24|540', '2026-11-25|540'] }, { name: '민준', slots: ['2026-11-24|540', '2026-11-24|570'] }, { name: '서연', slots: [] }];
test('Overview counts and detail names agree, including duplicate names and empty responses', () => {
  const model = buildOverviewModel(meeting, people);
  assert.equal(model.total, 3); assert.equal(model.maximum, 2);
  assert.deepEqual(model.counts, { '2026-11-24|540': 2, '2026-11-24|570': 1, '2026-11-25|540': 1, '2026-11-25|570': 0 });
  assert.deepEqual(overviewSlotDetails(model, '2026-11-24|570'), { available: ['민준 (2)'], unselected: ['민준 (1)', '서연'] });
  assert.equal(overviewSlotDetails(model, '1999-01-01|540'), null);
  assert.deepEqual(people[2].slots, []);
});
test('All and best filters operate across the whole meeting and include unanimous times and exclude empty responses', () => {
  const model = buildOverviewModel(meeting, people);
  assert.deepEqual(model.slots.filter(slot => matchesOverviewFilter(model.counts[slot], model, 'best')), ['2026-11-24|540']);
  assert.equal(model.slots.filter(slot => matchesOverviewFilter(model.counts[slot], model, 'all')).length, 4);
  const two = buildOverviewModel(meeting, people.slice(0, 2));
  assert.equal(matchesOverviewFilter(2, two, 'best'), true);
  for (const empty of [[], [{ name: '불참', slots: [] }]]) {
    const noTimes = buildOverviewModel(meeting, empty);
    assert.equal(matchesOverviewFilter(0, noTimes, 'best'), false);
  }
});
test('Date selection fills a partial day, skips fixed commitments and preserves other dates', () => {
  const day = ['2026-11-24|540', '2026-11-24|570', '2026-11-24|600'];
  const current = new Set([day[0], '2026-11-25|540']);
  const blocked = slot => slot === day[1];
  const selected = toggleColumnSelection(current, day, blocked);
  assert.deepEqual([...selected], [day[0], '2026-11-25|540', day[2]]);
  assert.deepEqual([...toggleColumnSelection(selected, day, blocked)], ['2026-11-25|540']);
  assert.deepEqual([...current], [day[0], '2026-11-25|540']);
  assert.deepEqual([...toggleColumnSelection(current, day, () => true)], [...current]);
});
