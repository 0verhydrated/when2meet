import { bindScheduleGrid } from './schedule-grid.js';
export const weekOrder = [6, 0, 1, 2, 3, 4, 5];
const days = ['월', '화', '수', '목', '금', '토', '일'];
const timeLabel = minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
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
  container.innerHTML = `<section class="fixed-painter" aria-labelledby="fixed-grid-heading"><div class="vote-toolbar"><h2 id="fixed-grid-heading">주간 시간표에 고정 일정을 칠해 보세요</h2><button class="quiet-button" id="fixed-clear" type="button">새로 칠한 시간 지우기</button></div><p id="fixed-grid-help" class="vote-help">일요일부터 토요일까지 반복되는 시간을 칠한 뒤 이름을 붙여 저장하세요. 방향키로 이동하고 Space로 칠하거나 지울 수 있어요.</p><div class="paint-options"><button class="button secondary" id="fixed-paint-toggle" type="button" aria-pressed="false">드래그로 칠하기</button><span class="helper">모바일에서는 칠하기를 켜면 드래그할 수 있어요.</span></div><div class="schedule-scroll fixed-schedule" tabindex="0" role="region" aria-label="일요일부터 토요일까지 주간 시간표"><div class="schedule-grid" id="fixed-grid" aria-describedby="fixed-grid-help"></div></div><form id="fixed-block-form" class="block-form"><div class="field"><label for="fixed-block-name">칠한 블록의 일정 이름</label><input id="fixed-block-name" name="name" maxlength="40" required placeholder="예: 전공 수업, 운동"></div><p id="fixed-paint-count" class="helper" role="status"></p><button type="submit" class="button">이 이름으로 고정 일정 저장</button></form><p class="inline-status" id="fixed-paint-status" role="status"></p></section>`;
  const grid = container.querySelector('#fixed-grid'), scroll = container.querySelector('.schedule-scroll'), form = container.querySelector('form'), message = container.querySelector('#fixed-paint-status'), count = container.querySelector('#fixed-paint-count');
  let selected = new Set(), busy = false, touch = false, controller;
  const blocked = slot => { const [day, minute] = slot.split('|').map(Number); return current().filter(item => item.weekday === day && minute < item.end && minute + 30 > item.start); };
  const report = (text, error = false) => { message.textContent = text; message.classList.toggle('error', error); };
  const preview = () => {
    for (const button of grid.querySelectorAll('[data-slot]')) {
      const active = selected.has(button.dataset.slot), saved = blocked(button.dataset.slot), [weekday, minute] = button.dataset.slot.split('|').map(Number);
      button.setAttribute('aria-pressed', String(active));
      button.classList.toggle('saved-fixed', saved.length > 0);
      if (saved.length) button.setAttribute('aria-disabled', 'true'); else button.removeAttribute('aria-disabled');
      button.textContent = saved.length ? [...new Set(saved.map(item => item.name))].join(' · ') : active ? '✓' : '';
      button.title = saved.map(item => item.name).join(' · ');
      button.setAttribute('aria-label', `${days[weekday]}요일 ${timeLabel(minute)}부터 ${timeLabel(minute + 30)}까지, ${saved.length ? button.title + ' 저장됨' : active ? '선택됨' : '선택 안 됨'}`);
      button.disabled = busy;
    }
    count.textContent = selected.size ? `${selected.size}칸 / ${selected.size / 2}시간을 칠했어요. 이름을 입력하고 저장해 주세요.` : '저장할 시간을 칠해 주세요.';
    form.querySelector('button').disabled = busy || !selected.size;
  };
  const refresh = () => {
    selected = new Set([...selected].filter(slot => !blocked(slot).length));
    if (!grid.children.length) {
      const minutes = Array.from({ length: 48 }, (_, i) => i * 30);
      grid.innerHTML = '<div class="hours-col"><div class="col-head">시간</div>' + minutes.map(minute => `<span class="hour-label">${timeLabel(minute)}</span>`).join('') + '</div>' + weekOrder.map((weekday, index) => `<div class="slot-col"><div class="col-head">${days[weekday]}</div>${minutes.map(minute => `<button type="button" class="slot" data-slot="${weekday}|${minute}" tabindex="${index === 0 && minute === 540 ? '0' : '-1'}"></button>`).join('')}</div>`).join('');
      controller = bindScheduleGrid(grid, scroll, { columns: weekOrder, read: () => selected, write: value => { selected = value; }, blocked: slot => blocked(slot).length > 0, locked: () => busy, touch: () => touch, preview, commit: () => { onDirty(selected.size > 0); report(selected.size ? '칠한 시간에 이름을 붙여 저장해 주세요.' : '새로 칠한 시간을 지웠어요.'); } });
      scroll.scrollTop = 18 * grid.querySelector('[data-slot]').offsetHeight;
    }
    preview(); onDirty(selected.size > 0);
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
