import { timeAxisMarkup, bindGridKeyboard } from './schedule-grid.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const timeLabel = minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const dateLabel = date => new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', weekday: 'short', timeZone: 'Asia/Seoul' }).format(new Date(date + 'T00:00:00+09:00'));
const filterLabels = { all: '전체 현황', best: '가장 많이 가능' };

export function participantColumns(participants) {
  const totals = new Map(), seen = new Map();
  for (const person of participants) totals.set(person.name, (totals.get(person.name) || 0) + 1);
  return participants.map(person => {
    const index = (seen.get(person.name) || 0) + 1; seen.set(person.name, index);
    return { key: JSON.stringify([person.name, index]), label: totals.get(person.name) > 1 ? `${person.name} (${index})` : person.name, slots: new Set(person.slots || []) };
  });
}

export function buildOverviewModel(meeting, participants) {
  const dates = Array.from({ length: (Date.parse(meeting.end_date) - Date.parse(meeting.start_date)) / 86400000 + 1 }, (_, i) => new Date(Date.parse(meeting.start_date + 'T00:00:00Z') + i * 86400000).toISOString().slice(0, 10));
  const minutes = Array.from({ length: (meeting.end_hour - meeting.start_hour) * 2 }, (_, i) => meeting.start_hour * 60 + i * 30);
  const people = participantColumns(participants);
  const slots = dates.flatMap(date => minutes.map(minute => date + '|' + minute));
  const counts = Object.fromEntries(slots.map(slot => [slot, people.filter(person => person.slots.has(slot)).length]));
  return { dates, minutes, people, slots, counts, total: people.length, maximum: Math.max(0, ...Object.values(counts)) };
}
export function matchesOverviewFilter(count, model, filter) {
  if (filter === 'best') return model.maximum > 0 && count === model.maximum;
  return true;
}
export function overviewSlotDetails(model, slot) {
  if (!Object.hasOwn(model.counts, slot)) return null;
  return {
    available: model.people.filter(person => person.slots.has(slot)).map(person => person.label),
    unselected: model.people.filter(person => !person.slots.has(slot)).map(person => person.label),
  };
}

export function overviewFilterLabel(model, filter) {
  return Object.hasOwn(filterLabels, filter) ? filterLabels[filter] : model.people.find(person => person.key === filter)?.label || filterLabels.all;
}
export function overviewCell(model, slot, filter) {
  const person = model.people.find(person => person.key === filter);
  const count = person ? Number(person.slots.has(slot)) : model.counts[slot];
  const total = person ? 1 : model.total;
  const match = matchesOverviewFilter(count, model, person ? 'all' : filter);
  const level = count > 0 ? Math.min(5, Math.ceil(count / total * 5)) : 0;
  return { count, total, match, level, text: person ? count ? '✓' : '—' : match && total ? `${count}/${total}` : '—' };
}
export function overviewTooltipMarkup(model, slot) {
  const people = overviewSlotDetails(model, slot);
  if (!people) return '';
  const [date, minute] = slot.split('|');
  const names = values => values.length ? `<ul>${values.map(name => `<li>${escape(name)}</li>`).join('')}</ul>` : '<p class="helper">없어요.</p>';
  return `<h4>${escape(dateLabel(date))} ${timeLabel(Number(minute))} ~ ${timeLabel(Number(minute) + 30)}</h4><p class="helper">${people.available.length}명 가능 / 총 ${model.total}명</p><div class="overview-people"><section><h5>가능한 사람 (${people.available.length}명)</h5>${names(people.available)}</section><section><h5>선택하지 않은 사람 (${people.unselected.length}명)</h5>${names(people.unselected)}</section></div>`;
}

export function mountAvailabilityOverview(container, data, state) {
  if (data.participants.some(person => !Array.isArray(person.slots))) {
    container.innerHTML = '<h2 id="overview-heading">전체 참여 현황</h2><p class="helper">전체 현황을 불러오려면 결과를 새로고침해 주세요.</p>'; return;
  }
  const model = buildOverviewModel(data.meeting, data.participants);
  const filters = [...Object.entries(filterLabels), ...model.people.map(person => [person.key, person.label])];
  if (!filters.some(([key]) => key === state.filter)) state.filter = 'all';
  if (!model.slots.includes(state.slot)) state.slot = null;
  container.innerHTML = `<div class="overview-heading-row"><h2 id="overview-heading">전체 참여 현황</h2><div class="result-export-controls"><button class="quiet-button" type="button" id="export-result-png" data-export-result="png">이미지 저장</button><button class="quiet-button" type="button" id="export-result-xlsx" data-export-result="xlsx">엑셀 저장</button></div></div><div class="overview-filters" role="tablist" aria-label="결과 보기">${filters.map(([key, label], index) => `<button class="quiet-button" type="button" role="tab" id="overview-tab-${index}" data-filter="${escape(key)}" aria-selected="${state.filter === key}" tabindex="${state.filter === key ? '0' : '-1'}" aria-controls="overview-panel">${escape(label)}</button>`).join('')}</div><div id="overview-panel" role="tabpanel"><p class="sr-only overview-summary" id="overview-summary" role="status"></p><div class="schedule-scroll overview-scroll" tabindex="0" role="region" aria-label="전체 참여 현황 시간표"><div class="schedule-grid overview-grid" id="overview-grid" aria-describedby="overview-summary"></div></div></div><div class="overview-tooltip" id="overview-tooltip" role="tooltip" popover="auto" hidden></div>`;
  const grid = container.querySelector('#overview-grid'), scroll = container.querySelector('.overview-scroll'), tooltip = container.querySelector('#overview-tooltip');
  let anchor = null, closeTimer;
  const hideTooltip = () => {
    clearTimeout(closeTimer);
    anchor?.removeAttribute('aria-describedby');
    anchor = null;
    if (tooltip.matches(':popover-open')) tooltip.hidePopover();
    tooltip.hidden = true;
  };
  const showTooltip = button => {
    clearTimeout(closeTimer);
    anchor?.removeAttribute('aria-describedby');
    anchor = button;
    tooltip.innerHTML = overviewTooltipMarkup(model, button.dataset.slot);
    tooltip.hidden = false;
    tooltip.showPopover?.();
    button.setAttribute('aria-describedby', 'overview-tooltip');
    const cell = button.getBoundingClientRect(), box = tooltip.getBoundingClientRect();
    const right = cell.right + 8, left = cell.left - box.width - 8;
    const beside = right + box.width <= innerWidth - 12 || left >= 12;
    const x = beside ? right + box.width <= innerWidth - 12 ? right : left : cell.left + cell.width / 2 - box.width / 2;
    const above = cell.top - box.height - 8;
    const y = beside ? cell.top : above >= 12 ? above : cell.bottom + 8;
    tooltip.style.left = `${Math.max(12, Math.min(innerWidth - box.width - 12, x))}px`;
    tooltip.style.top = `${Math.max(12, Math.min(innerHeight - box.height - 12, y))}px`;
  };
  const scheduleClose = () => { clearTimeout(closeTimer); closeTimer = setTimeout(hideTooltip, 150); };
  tooltip.ontoggle = event => { if (event.newState === 'closed' && !tooltip.matches(':popover-open')) hideTooltip(); };
  tooltip.onpointerenter = () => clearTimeout(closeTimer);
  tooltip.onpointerleave = scheduleClose;
  container.onkeydown = event => { if (event.key === 'Escape') hideTooltip(); };
  scroll.onscroll = hideTooltip;
  const drawGrid = () => {
    hideTooltip();
    const position = { left: scroll.scrollLeft, top: scroll.scrollTop };
    grid.style.setProperty('--schedule-columns', String(model.dates.length));
    const person = model.people.find(person => person.key === state.filter);
    const stop = state.slot || model.slots[0];
    grid.innerHTML = timeAxisMarkup(model.minutes) + model.dates.map(date => `<div class="slot-col"><div class="col-head">${escape(dateLabel(date))}</div>${model.minutes.map(minute => {
      const slot = date + '|' + minute, cell = overviewCell(model, slot, state.filter);
      const status = person ? `${person.label}, ${cell.count ? '가능' : '선택하지 않음'}` : `${cell.count}명 가능, 총 ${cell.total}명${cell.match ? '' : ', 필터 조건에 맞지 않음'}`;
      return `<button class="slot overview-slot heat-${cell.level}${cell.match ? '' : ' overview-muted'}" type="button" data-slot="${slot}" data-matches="${cell.match}" aria-pressed="${state.slot === slot}" tabindex="${slot === stop ? '0' : '-1'}" aria-label="${escape(dateLabel(date))} ${timeLabel(minute)} ~ ${timeLabel(minute + 30)}, ${escape(status)}">${cell.text}</button>`;
    }).join('')}</div>`).join('') + timeAxisMarkup(model.minutes, true);
    for (const button of grid.querySelectorAll('[data-slot]')) {
      button.onclick = () => {
        state.slot = button.dataset.slot;
        for (const cell of grid.querySelectorAll('[data-slot]')) { cell.setAttribute('aria-pressed', String(cell === button)); cell.tabIndex = cell === button ? 0 : -1; }
        showTooltip(button);
      };
      button.onpointerenter = event => { if (event.pointerType !== 'touch') showTooltip(button); };
      button.onpointerleave = event => { if (event.pointerType !== 'touch') scheduleClose(); };
      button.onfocus = () => showTooltip(button);
      button.onblur = hideTooltip;
    }
    bindGridKeyboard(grid, model.dates);
    const matching = model.slots.filter(slot => person ? person.slots.has(slot) : matchesOverviewFilter(model.counts[slot], model, state.filter)).length;
    const summary = !model.total ? '아직 저장된 응답이 없어요.' : person ? `${person.label}: ${matching ? '✓는 가능, —는 선택하지 않은 시간이에요.' : '가능한 시간을 선택하지 않았어요.'}` : state.filter === 'best' && !matching ? '아직 가능한 시간으로 선택한 사람이 없어요.' : state.filter === 'all' ? `${model.total}명의 저장된 응답을 표시해요.` : `가장 많이 가능: ${matching}칸 / 전체 기간 기준, 최대 ${model.maximum}명`;
    container.querySelector('#overview-summary').textContent = summary;
    const tab = container.querySelector('[role="tab"][aria-selected="true"]');
    container.querySelector('#overview-panel').setAttribute('aria-labelledby', tab.id);
    scroll.scrollLeft = position.left; scroll.scrollTop = position.top;
  };
  const tabs = [...container.querySelectorAll('[data-filter]')];
  for (const button of tabs) {
    button.onclick = () => {
      state.filter = button.dataset.filter;
      for (const tab of tabs) { tab.setAttribute('aria-selected', String(tab === button)); tab.tabIndex = tab === button ? 0 : -1; }
      drawGrid();
    };
    button.onkeydown = event => {
      let index = tabs.indexOf(button);
      if (event.key === 'ArrowRight') index = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') index = (index + tabs.length - 1) % tabs.length;
      else if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = tabs.length - 1;
      else return;
      event.preventDefault(); tabs[index].click(); tabs[index].focus();
    };
  }
  drawGrid();
}
