import test from 'node:test';
import assert from 'node:assert/strict';
import { participantColumns, buildOverviewModel, overviewCell, overviewTooltipMarkup } from '../public/availability-overview.js';
import { timeAxisMarkup } from '../public/schedule-grid.js';

test('Individual columns keep duplicate names separate and preserve empty responses', () => {
  const columns = participantColumns([{ name: '민준', slots: ['2026-11-23|540'] }, { name: '민준', slots: [] }, { name: '다른 사람', slots: [] }]);
  assert.deepEqual(columns.map(person => person.label), ['민준 (1)', '민준 (2)', '다른 사람']);
  assert.equal(columns[0].slots.has('2026-11-23|540'), true);
  assert.equal(columns[1].slots.size, 0);
});
test('The chosen person sees all dates at once, with escaped names and correct midnight boundaries', () => {
  const meeting = { start_date: '2026-11-23', end_date: '2026-11-25', start_hour: 23, end_hour: 24 };
  const people = [{ name: '<img src=x onerror=alert(1)>', slots: ['2026-11-23|1380', '2026-11-24|1410'] }, { name: '불참', slots: [] }];
  const model = buildOverviewModel(meeting, people);
  const cells = model.slots.map(slot => overviewCell(model, slot, model.people[0].key));
  assert.equal(model.dates.length, 3);
  assert.equal(cells.filter(cell => cell.text === '✓').length, 2);
  assert.equal(cells.filter(cell => cell.text === '—').length, 4);
  assert.equal(model.slots.map(slot => overviewCell(model, slot, model.people[1].key)).filter(cell => cell.count > 0).length, 0);
  const html = overviewTooltipMarkup(model, '2026-11-24|1410');
  assert.doesNotMatch(html, /<img/); assert.match(html, /&lt;img/);
  assert.match(html, /23:30 ~ 24:00/);
  assert.match(html, /가능한 사람 \(1명\)/);
  assert.match(html, /선택하지 않은 사람 \(1명\)/);
  assert.match(html, /불참/);
});
test('Participant selector keys keep duplicate names separate and do not depend on other names', () => {
  const people = [{ name: '민준', slots: [] }, { name: '민준', slots: [] }, { name: '민준 (1)', slots: [] }];
  const columns = participantColumns(people);
  assert.equal(new Set(columns.map(person => person.key)).size, 3);
  assert.deepEqual(participantColumns([{ name: '서연', slots: [] }, ...people]).slice(1).map(person => person.key), columns.map(person => person.key));
});
test('Time axes show half-hour boundaries on both ends, including 24:00', () => {
  const html = timeAxisMarkup([1380, 1410], true);
  assert.match(html, /end-hours-col/); assert.match(html, /23:00/); assert.match(html, /23:30/);
  assert.match(html, /axis-end-label">24:00/);
});
