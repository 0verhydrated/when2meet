import { participantColumns } from './participant-table.js';
import { timeAxisMarkup, bindGridKeyboard } from './schedule-grid.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const timeLabel = minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const dateLabel = date => new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', weekday: 'short', timeZone: 'Asia/Seoul' }).format(new Date(date + 'T00:00:00+09:00'));
const filterLabels = { all: '전체 현황', best: '가장 많이 가능' };

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

export function mountAvailabilityOverview(container, data, state) {
  if (data.participants.some(person => !Array.isArray(person.slots))) {
    container.innerHTML = '<h2 id="overview-heading">전체 참여 현황</h2><p class="helper">전체 현황을 불러오려면 결과를 새로고침해 주세요.</p>'; return;
  }
  const model = buildOverviewModel(data.meeting, data.participants);
  if (!Object.hasOwn(filterLabels, state.filter)) state.filter = 'all';
  if (!model.slots.includes(state.slot)) state.slot = null;
  container.innerHTML = `<div class="overview-heading-row"><h2 id="overview-heading">전체 참여 현황</h2><div class="result-export-controls"><button class="quiet-button" type="button" id="export-result-png" data-export-result="png">이미지 저장</button><button class="quiet-button" type="button" id="export-result-xlsx" data-export-result="xlsx">엑셀 저장</button></div></div><div class="overview-filters" role="group" aria-label="결과 필터">${Object.entries(filterLabels).map(([key, label]) => `<button class="quiet-button" type="button" data-filter="${key}" aria-pressed="${state.filter === key}" aria-controls="overview-grid">${label}</button>`).join('')}</div><p class="sr-only overview-summary" id="overview-summary" role="status"></p><div class="schedule-scroll overview-scroll" tabindex="0" role="region" aria-label="전체 참여 현황 시간표"><div class="schedule-grid overview-grid" id="overview-grid" aria-labelledby="overview-heading" aria-describedby="overview-summary"></div></div><section class="overview-detail" id="overview-detail" aria-labelledby="overview-detail-heading" tabindex="0" hidden></section>`;
  const grid = container.querySelector('#overview-grid'), scroll = container.querySelector('.overview-scroll'), detail = container.querySelector('#overview-detail');
  const drawDetail = () => {
    const people = overviewSlotDetails(model, state.slot);
    detail.hidden = !people;
    if (!people) { detail.innerHTML = ''; return; }
    const [date, minute] = state.slot.split('|');
    const names = values => values.length ? `<ul>${values.map(name => `<li>${escape(name)}</li>`).join('')}</ul>` : '<p class="helper">없어요.</p>';
    detail.innerHTML = `<h4 id="overview-detail-heading">${escape(dateLabel(date))} ${timeLabel(Number(minute))} ~ ${timeLabel(Number(minute) + 30)}</h4><p class="helper" role="status">${people.available.length}명 가능 / 총 ${model.total}명 응답</p><div class="overview-people"><section><h5>가능한 사람 (${people.available.length}명)</h5>${names(people.available)}</section><section><h5>선택하지 않은 사람 (${people.unselected.length}명)</h5>${names(people.unselected)}</section></div><p class="privacy-note">선택하지 않은 이유와 고정 일정의 내용은 표시하지 않아요.</p>`;
  };
  const drawGrid = () => {
    const position = { left: scroll.scrollLeft, top: scroll.scrollTop };
    grid.style.setProperty('--schedule-columns', String(model.dates.length));
    const stop = state.slot || model.slots[0];
    grid.innerHTML = timeAxisMarkup(model.minutes) + model.dates.map(date => `<div class="slot-col"><div class="col-head">${escape(dateLabel(date))}</div>${model.minutes.map(minute => {
      const slot = date + '|' + minute, count = model.counts[slot], match = matchesOverviewFilter(count, model, state.filter);
      const level = count > 0 ? Math.min(5, Math.ceil(count / model.total * 5)) : 0;
      return `<button class="slot overview-slot heat-${level}${match ? '' : ' overview-muted'}" type="button" data-slot="${slot}" data-matches="${match}" aria-pressed="${state.slot === slot}" aria-controls="overview-detail" tabindex="${slot === stop ? '0' : '-1'}" aria-label="${escape(dateLabel(date))} ${timeLabel(minute)} ~ ${timeLabel(minute + 30)}, ${count}명 가능, 총 ${model.total}명${match ? '' : ', 필터 조건에 맞지 않음'}">${match && model.total ? `${count}/${model.total}` : '—'}</button>`;
    }).join('')}</div>`).join('') + timeAxisMarkup(model.minutes, true);
    for (const button of grid.querySelectorAll('[data-slot]')) button.onclick = () => {
      state.slot = button.dataset.slot;
      for (const cell of grid.querySelectorAll('[data-slot]')) { cell.setAttribute('aria-pressed', String(cell === button)); cell.tabIndex = cell === button ? 0 : -1; }
      drawDetail();
    };
    bindGridKeyboard(grid, model.dates);
    const matching = model.slots.filter(slot => matchesOverviewFilter(model.counts[slot], model, state.filter)).length;
    const summary = !model.total ? '아직 저장된 응답이 없어요.' : state.filter === 'best' && !matching ? '아직 가능한 시간으로 선택한 사람이 없어요.' : state.filter === 'all' ? `${model.total}명의 저장된 응답을 표시해요.` : `${filterLabels[state.filter]}: ${matching}칸 / 전체 기간 기준${state.filter === 'best' ? `, 최대 ${model.maximum}명` : ''}`;
    container.querySelector('#overview-summary').textContent = summary + ' 흐린 칸도 눌러 상세 내용을 볼 수 있어요.';
    scroll.scrollLeft = position.left; scroll.scrollTop = position.top;
    drawDetail();
  };
  for (const button of container.querySelectorAll('[data-filter]')) button.onclick = () => {
    state.filter = button.dataset.filter;
    for (const filter of container.querySelectorAll('[data-filter]')) filter.setAttribute('aria-pressed', String(filter === button));
    drawGrid();
  };
  drawGrid();
}
