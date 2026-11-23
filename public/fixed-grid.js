import { bindScheduleGrid, timeAxisMarkup } from './schedule-grid.js';
export const weekOrder = [6, 0, 1, 2, 3, 4, 5];
export const fixedDayStart = 540;
export const fixedDayEnd = 1440;
export function visibleFixedBlock(item) {
  const start = Math.max(item.start, fixedDayStart), end = Math.min(item.end, fixedDayEnd);
  return start < end ? { ...item, start, end } : null;
}
const days = ['월', '화', '수', '목', '금', '토', '일'];
const timeLabel = minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
export function layoutFixedBlocks(items) {
  const colors = new Map(), used = new Set();
  // Saved IDs are random, so their colors are varied but stable on reload.
  for (const item of [...items].sort((a, b) => a.id.localeCompare(b.id))) {
    let hash = 2166136261;
    for (const character of item.id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
    let index = hash % 50;
    while (used.has(index)) index = (index + 17) % 50;
    used.add(index); colors.set(item.id, (index * 137.508) % 360);
  }
  const result = [];
  for (const weekday of weekOrder) {
    const day = items.filter(item => item.weekday === weekday).sort((a, b) => a.start - b.start || b.end - a.end || a.id.localeCompare(b.id));
    let group = [], groupEnd = -1;
    const flush = () => {
      const ends = [], positioned = [];
      for (const item of group) {
        let lane = ends.findIndex(end => end <= item.start);
        if (lane < 0) lane = ends.length;
        ends[lane] = item.end; positioned.push({ ...item, lane, hue: colors.get(item.id) });
      }
      result.push(...positioned.map(item => ({ ...item, lanes: ends.length })));
    };
    for (const item of day) {
      if (group.length && item.start >= groupEnd) { flush(); group = []; groupEnd = -1; }
      group.push(item); groupEnd = Math.max(groupEnd, item.end);
    }
    flush();
  }
  return result;
}
export function fixedRanges(cells, name) {
  const result = [];
  for (const weekday of weekOrder) {
    const minutes = [...cells].filter(value => Number(value.split('|')[0]) === weekday).map(value => Number(value.split('|')[1])).sort((a, b) => a - b);
    for (const minute of minutes) {
      const last = result.at(-1);
      if (last?.weekday === weekday && last.end === minute) last.end += 30;
      else result.push({ id: crypto.randomUUID(), name: name.trim(), weekday, start: minute, end: minute + 30 });
    }
  }
  return result;
}

export function mountFixedGrid(container, { current, save, onSaved, onDirty }) {
  container.innerHTML = `<section class="fixed-painter" aria-labelledby="fixed-grid-heading"><div class="vote-toolbar"><h2 id="fixed-grid-heading">주간 시간표에 고정 일정을 칠해 보세요</h2><div class="fixed-grid-actions"><button class="quiet-button" id="fixed-clear" type="button">새로 칠한 시간 지우기</button><button class="quiet-button zoom-button" id="fixed-zoom" type="button" aria-label="시간표 축소해서 보기" title="시간표 축소해서 보기" aria-pressed="false" aria-controls="fixed-grid"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6"></circle><path d="m15 15 6 6M7 10h6"></path><path class="zoom-plus" d="M10 7v6" hidden></path></svg><span>축소 보기</span></button></div></div><p id="fixed-grid-help" class="vote-help">일요일부터 토요일까지 오전 9시부터 자정(24:00)까지 칠한 뒤 이름을 붙여 저장하세요. 방향키로 이동하고 Space로 칠하거나 지울 수 있어요.</p><div class="paint-options"><button class="button secondary" id="fixed-paint-toggle" type="button" aria-pressed="false">드래그로 칠하기</button><span class="helper">모바일에서는 칠하기를 켜면 드래그할 수 있어요.</span></div><div class="schedule-scroll fixed-schedule" tabindex="0" role="region" aria-label="일요일부터 토요일까지 주간 시간표"><div class="schedule-grid" id="fixed-grid" aria-describedby="fixed-grid-help"></div></div><form id="fixed-block-form" class="block-form"><div class="field"><label for="fixed-block-name">칠한 블록의 일정 이름</label><input id="fixed-block-name" name="name" maxlength="40" required placeholder="예: 전공 수업, 운동"></div><p id="fixed-paint-count" class="helper" role="status"></p><button type="submit" class="button">이 이름으로 고정 일정 저장</button></form><p class="inline-status" id="fixed-paint-status" role="status"></p></section>`;
  const grid = container.querySelector('#fixed-grid'), scroll = container.querySelector('.schedule-scroll'), form = container.querySelector('form'), message = container.querySelector('#fixed-paint-status'), count = container.querySelector('#fixed-paint-count');
  let selected = new Set(), busy = false, touch = false, compact = false, controller;
  const blocked = slot => { const [day, minute] = slot.split('|').map(Number); return current().filter(item => item.weekday === day && minute < item.end && minute + 30 > item.start); };
  const report = (text, error = false) => { message.textContent = text; message.classList.toggle('error', error); };
  const preview = () => {
    for (const button of grid.querySelectorAll('[data-slot]')) {
      const active = selected.has(button.dataset.slot), saved = blocked(button.dataset.slot), [weekday, minute] = button.dataset.slot.split('|').map(Number);
      button.setAttribute('aria-pressed', String(active));
      button.classList.toggle('saved-fixed', saved.length > 0);
      if (saved.length) button.setAttribute('aria-disabled', 'true'); else button.removeAttribute('aria-disabled');
      button.textContent = active ? '✓' : '';
      button.title = saved.map(item => item.name).join(' · ');
      button.setAttribute('aria-label', `${days[weekday]}요일 ${timeLabel(minute)}부터 ${timeLabel(minute + 30)}까지, ${saved.length ? button.title + ' 저장됨' : active ? '선택됨' : '선택 안 됨'}`);
      button.disabled = busy;
    }
    count.textContent = selected.size ? '칠한 블록의 이름을 입력하고 저장해 주세요.' : '저장할 시간을 칠해 주세요.';
    form.querySelector('button').disabled = busy || !selected.size;
  };
  const refresh = () => {
    selected = new Set([...selected].filter(slot => !blocked(slot).length));
    if (!grid.children.length) {
      const minutes = Array.from({ length: (fixedDayEnd - fixedDayStart) / 30 }, (_, i) => fixedDayStart + i * 30);
      grid.style.setProperty('--schedule-columns', String(weekOrder.length));
      grid.innerHTML = timeAxisMarkup(minutes) + weekOrder.map((weekday, index) => `<div class="slot-col"><div class="col-head">${days[weekday]}</div>${minutes.map(minute => `<button type="button" class="slot" data-slot="${weekday}|${minute}" tabindex="${index === 0 && minute === 540 ? '0' : '-1'}"></button>`).join('')}</div>`).join('') + timeAxisMarkup(minutes, true);
      controller = bindScheduleGrid(grid, scroll, { columns: weekOrder, read: () => selected, write: value => { selected = value; }, blocked: slot => blocked(slot).length > 0, locked: () => busy, touch: () => touch, preview, commit: () => { onDirty(selected.size > 0); report(selected.size ? '칠한 시간에 이름을 붙여 저장해 주세요.' : '새로 칠한 시간을 지웠어요.'); } });
    }
    grid.querySelectorAll('.fixed-block').forEach(block => block.remove());
    const rowHeight = grid.querySelector('[data-slot]').offsetHeight;
    const headerHeight = grid.querySelector('.col-head').offsetHeight;
    const columns = [...grid.querySelectorAll('.slot-col')];
    for (const original of layoutFixedBlocks(current())) {
      const item = visibleFixedBlock(original);
      if (!item) continue;
      const block = document.createElement('div'), name = document.createElement('span');
      block.className = 'fixed-block'; block.setAttribute('aria-hidden', 'true'); block.dataset.fixedId = item.id;
      block.style.top = headerHeight + (item.start - fixedDayStart) / 30 * rowHeight + 2 + 'px';
      block.style.height = (item.end - item.start) / 30 * rowHeight - 4 + 'px';
      block.style.left = `calc(${item.lane / item.lanes * 100}% + 2px)`;
      block.style.width = `calc(${100 / item.lanes}% - 4px)`;
      block.style.backgroundColor = `hsl(${item.hue} 56% 85%)`;
      block.style.borderColor = `hsl(${item.hue} 35% 65%)`;
      name.className = 'fixed-block-name'; name.textContent = item.name; block.append(name);
      columns[weekOrder.indexOf(item.weekday)].append(block);
    }
    preview(); onDirty(selected.size > 0);
  };
  const zoomButton = container.querySelector('#fixed-zoom');
  zoomButton.onclick = () => {
    if (busy) return;
    controller.finish(true);
    const topRow = scroll.scrollTop / grid.querySelector('[data-slot]').offsetHeight;
    compact = !compact; scroll.classList.toggle('is-compact', compact);
    const label = compact ? '시간표 원래 크기로 보기' : '시간표 축소해서 보기';
    zoomButton.setAttribute('aria-pressed', String(compact)); zoomButton.setAttribute('aria-label', label); zoomButton.title = label;
    zoomButton.querySelector('span').textContent = compact ? '원래 크기' : '축소 보기';
    zoomButton.querySelector('.zoom-plus').toggleAttribute('hidden', !compact);
    refresh(); scroll.scrollTop = topRow * grid.querySelector('[data-slot]').offsetHeight;
    report(compact ? '시간표를 축소했어요. 돋보기를 다시 누르면 원래 크기로 돌아가요.' : '시간표를 원래 크기로 표시해요.');
  };
  container.querySelector('#fixed-paint-toggle').onclick = event => { touch = !touch; scroll.classList.toggle('painting', touch); event.currentTarget.setAttribute('aria-pressed', String(touch)); event.currentTarget.textContent = touch ? '스크롤로 이동하기' : '드래그로 칠하기'; };
  container.querySelector('#fixed-clear').onclick = () => { if (busy) return; controller.finish(true); selected.clear(); preview(); onDirty(false); report('새로 칠한 시간을 지웠어요.'); };
  form.onsubmit = async event => {
    event.preventDefault(); if (busy || !selected.size) return;
    controller.finish(false);
    const name = form.elements.name.value.trim();
    if (!name) { report('일정 이름을 입력해 주세요.', true); return; }
    const ranges = fixedRanges(selected, name), previous = current();
    if (ranges.length + previous.length > 50) { report('고정 일정은 최대 50개까지 저장할 수 있어요. 칠한 영역을 줄여 주세요.', true); return; }
    busy = true; preview();
    try { await save([...previous, ...ranges]); selected.clear(); form.reset(); onDirty(false); onSaved(); report(`고정 일정 ${ranges.length}개를 저장했어요. 약속에서 자동으로 제외돼요.`); }
    catch (error) { report(error.message, true); }
    finally { busy = false; refresh(); }
  };
  refresh();
  return { refresh };
}
