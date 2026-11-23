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
test('The chosen person sees all dates at once, with escaped names and correct midnight boundaries', () => {
  const meeting = { start_date: '2026-11-23', end_date: '2026-11-25', start_hour: 23, end_hour: 24 };
  const people = [{ name: '<img src=x onerror=alert(1)>', slots: ['2026-11-23|1380', '2026-11-24|1410'] }, { name: '불참', slots: [] }];
  const html = participantTableMarkup(meeting, participantColumns(people)[0]);
  assert.doesNotMatch(html, /<img/); assert.match(html, /&lt;img/);
  assert.match(html, /23:30 ~ 24:00/);
  assert.equal((html.match(/class="person-available"/g) || []).length, 2);
  assert.equal((html.match(/scope="col"/g) || []).length, 4);
  assert.doesNotMatch(html, /불참/);
  assert.doesNotMatch(html, /<tfoot|전체 기간 가능한|한국 표준|UTC\+9|\d+(?:\.\d+)?시간/);
  assert.match(html, /scope="col"/); assert.match(html, /scope="row"/);
  const empty = participantTableMarkup(meeting, participantColumns(people)[1]);
  assert.equal((empty.match(/class="person-available"/g) || []).length, 0);
  assert.equal((empty.match(/class="person-unselected"/g) || []).length, 6);
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
