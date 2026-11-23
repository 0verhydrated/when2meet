import test from 'node:test';
import assert from 'node:assert/strict';
import { participantColumns, participantTableMarkup } from '../public/participant-table.js';
import { timeAxisMarkup } from '../public/schedule-grid.js';

test('Individual columns keep duplicate names separate and preserve empty responses', () => {
  const columns = participantColumns([{ name: '민준', slots: ['2026-11-23|540'] }, { name: '민준', slots: [] }, { name: '다른 사람', slots: [] }]);
  assert.deepEqual(columns.map(person => person.label), ['민준 (1)', '민준 (2)', '다른 사람']);
  assert.equal(columns[0].slots.has('2026-11-23|540'), true);
  assert.equal(columns[1].slots.size, 0);
});
test('The participant table displays only the chosen date, escapes names and labels midnight correctly', () => {
  const meeting = { start_hour: 23, end_hour: 24 };
  const people = [{ name: '<img src=x onerror=alert(1)>', slots: ['2026-11-23|1380', '2026-11-24|1410'] }, { name: '불참', slots: [] }];
  const html = participantTableMarkup(meeting, people, '2026-11-23');
  assert.doesNotMatch(html, /<img/); assert.match(html, /&lt;img/);
  assert.match(html, /23:30 ~ 24:00/);
  assert.equal((html.match(/class="person-available"/g) || []).length, 1);
  assert.match(html, /0.5시간/); assert.match(html, /0시간/);
  assert.match(html, /scope="col"/); assert.match(html, /scope="row"/);
});
test('Time axes show half-hour boundaries on both ends, including 24:00', () => {
  const html = timeAxisMarkup([1380, 1410], true);
  assert.match(html, /end-hours-col/); assert.match(html, /23:00/); assert.match(html, /23:30/);
  assert.match(html, /axis-end-label">24:00/);
});
