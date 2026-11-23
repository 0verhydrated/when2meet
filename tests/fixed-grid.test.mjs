import test from 'node:test';
import assert from 'node:assert/strict';
import { fixedRanges, weekOrder, layoutFixedBlocks } from '../public/fixed-grid.js';
import { rectangleSlots } from '../public/schedule-grid.js';
import { effectiveSlots } from '../worker/scheduling.js';

test('Weekly paint starts on Sunday while preserving Monday-based storage weekdays', () => {
  assert.deepEqual(weekOrder, [6, 0, 1, 2, 3, 4, 5]);
  const cells = rectangleSlots(weekOrder, '6|540', '0|600');
  assert.deepEqual(cells, ['6|540', '6|570', '6|600', '0|540', '0|570', '0|600']);
  const ranges = fixedRanges(new Set(cells), ' 수업 ');
  assert.deepEqual(ranges.map(({ id, ...item }) => item), [{ name: '수업', weekday: 6, start: 540, end: 630 }, { name: '수업', weekday: 0, start: 540, end: 630 }]);
  assert.equal(new Set(ranges.map(item => item.id)).size, 2);
  assert.deepEqual(effectiveSlots(['2026-11-29|540', '2026-11-29|630'], ranges), ['2026-11-29|630']);
});
test('Separate painted blocks retain gaps, Saturday and midnight; reverse painting matches forward painting', () => {
  const cells = new Set(['5|1410', '0|540', '0|600', '0|630']);
  assert.deepEqual(fixedRanges(cells, '운동').map(({ weekday, start, end }) => ({ weekday, start, end })), [{ weekday: 0, start: 540, end: 570 }, { weekday: 0, start: 600, end: 660 }, { weekday: 5, start: 1410, end: 1440 }]);
  assert.deepEqual(rectangleSlots(weekOrder, '2|630', '6|540'), rectangleSlots(weekOrder, '6|540', '2|630'));
  assert.deepEqual(fixedRanges(new Set(), '운동'), []);
});
test('Saved blocks have stable distinct colors and overlapping schedules get separate lanes', () => {
  const items = [{ id: 'a', name: '수업', weekday: 0, start: 540, end: 660 }, { id: 'b', name: '회의', weekday: 0, start: 600, end: 690 }, { id: 'c', name: '운동', weekday: 0, start: 690, end: 750 }];
  const result = layoutFixedBlocks(items);
  assert.equal(result[0].lanes, 2); assert.equal(result[1].lanes, 2);
  assert.notEqual(result[0].lane, result[1].lane); assert.equal(result[2].lanes, 1);
  assert.equal(new Set(result.map(item => item.hue)).size, 3);
  assert.deepEqual(layoutFixedBlocks([...items].reverse()), result);
  const many = layoutFixedBlocks(Array.from({ length: 50 }, (_, i) => ({ ...items[0], id: String(i) })));
  assert.equal(new Set(many.map(item => item.hue)).size, 50);
});
