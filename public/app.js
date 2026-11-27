import './demo.js';
import { saveScheduleDialog, loadScheduleDialog } from './saved-schedules.js';
import { exportMeetingResult } from './result-export.js';
import { openMeetingDeletion } from './meeting-deletion.js';
import { renderAuth } from './auth-ui.js';
import { requestApi } from './backend.js';
import { pageUrl, pageMarkup } from './navigation.js';
import { mountEverytimeImport } from './everytime-import.js';
import { mountFixedGrid, weekOrder, fixedDayStart, fixedDayEnd } from './fixed-grid.js';
import { bindScheduleGrid, timeAxisMarkup, toggleColumnSelection } from './schedule-grid.js';
import { mountParticipantTable } from './participant-table.js';
import { mountAvailabilityOverview } from './availability-overview.js';
import { createResponseEditor, persistResponse } from './response-editor.js';
const overviewState = { filter: 'all', slot: null };
let fixedPainter;
const days = ['월', '화', '수', '목', '금', '토', '일'];

const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const timeLabel = minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const dateLabel = date => `${Number(date.slice(5, 7))}/${Number(date.slice(8))} (${days[(new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7]})`;
const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
const offsetDate = (date, offset) => new Date(Date.parse(date + 'T00:00:00Z') + offset * 86400000).toISOString().slice(0, 10);
const hoursOptions = (selected, last = 24) => Array.from({ length: last + 1 }, (_, hour) => `<option value="${hour}" ${hour === selected ? 'selected' : ''}>${timeLabel(hour * 60)}</option>`).join('');
const halfHourOptions = (selected, first, last) => Array.from({ length: (last - first) / 30 + 1 }, (_, index) => { const minute = first + index * 30; return `<option value="${minute}" ${minute === selected ? 'selected' : ''}>${timeLabel(minute)}</option>`; }).join('');
const params = new URLSearchParams(location.search);
const appContent = document.querySelector('#app-content');
const meetingId = /^\/m\/([a-f0-9]{32})$/.exec(location.pathname)?.[1] || (/^[a-f0-9]{32}$/.test(params.get('meeting') || '') ? params.get('meeting') : null);
const isApp = location.pathname === '/app' || params.get('view') === 'app' || Boolean(meetingId);
let me;
let dirty = false;
let savedMeeting;
let selected = new Set();
let responseEditor;
let loadingResponse = false;
let resultsRequest = 0;
let exportingResult = false;
if (isApp) { document.querySelector('#home-view').hidden = true; document.querySelector('#app-view').hidden = false; }
const api = requestApi;
function renderPage(markup) { appContent.innerHTML = pageMarkup(markup); }
function status(message, error = false, selector = '#form-status') {
  const element = document.querySelector(selector);
  if (element) { element.textContent = message; element.classList.toggle('error', error); }
}
function appTop(title, description, action = '') { return `<div class="app-top"><div><h1 id="app-heading" tabindex="-1">${escape(title)}</h1><p>${escape(description)}</p></div>${action}</div>`; }
function appTabs(tab) { return `<nav class="app-tabs" aria-label="일정 메뉴"><a href="/app" ${tab === 'meetings' ? 'aria-current="page"' : ''}>내 약속</a><a href="/app?tab=fixed" ${tab === 'fixed' ? 'aria-current="page"' : ''}>내 고정 일정</a><a href="/app?tab=account" ${tab === 'account' ? 'aria-current="page"' : ''}>내 계정</a></nav>`; }
function errorView(error) { renderPage( appTop('불러오지 못했어요', error.message) + '<div class="error-panel"><p>연결 상태와 링크 주소를 확인한 뒤 다시 시도해 주세요.</p><div class="form-actions"><button class="button" type="button" id="retry">다시 시도</button><a class="quiet-button" href="/app">내 약속으로</a></div></div>'); document.querySelector('#retry').onclick = () => location.reload(); }
function authView() {
  const requested = new URL(params.get('return_to') || location.pathname + location.search, location.origin);
  const returnTo = requested.origin === location.origin && (requested.pathname === new URL('.', import.meta.url).pathname || requested.pathname === '/app' || /^\/m\/[a-f0-9]{32}$/.test(requested.pathname)) ? pageUrl(requested.pathname + requested.search) : pageUrl('/app');
  const signup = params.has('signup');
  renderAuth(appContent, { signup, loginUrl: pageUrl('/app?return_to=' + encodeURIComponent(returnTo)), signupUrl: pageUrl('/app?signup=1&return_to=' + encodeURIComponent(returnTo)), homeUrl: pageUrl('/'), unavailable: me.auth_mode === 'password' ? '' : '자체 회원가입 서버가 연결되지 않았습니다. 현재는 계정을 만들 수 없습니다.', onSubmit: async values => { await api('/auth/' + (signup ? 'register' : 'login'), { method: 'POST', body: JSON.stringify(values) }); location.href = returnTo; } });
}
function profileView(editing = false) {
  renderPage( (editing ? appTop('내 계정', '참여자에게 표시될 이름을 관리해요.') + appTabs('account') : '') + `<div class="${editing ? 'form-panel' : 'auth-panel'}">${editing ? '' : '<h1 id="app-heading">어떤 이름으로 만날까요?</h1><p>약속에 표시할 이름을 등록하면 회원가입이 완료돼요.</p>'}<form id="profile-form"><div class="field"><label for="profile-name">이름</label><input id="profile-name" name="name" autocomplete="nickname" maxlength="30" required value="${escape(me.user?.name || '')}"></div><p id="form-status" class="inline-status" role="status"></p><div class="form-actions"><button class="button" type="submit">${editing ? '이름 저장' : '가입하고 시작하기'}</button>${editing ? '<button class="quiet-button" type="button" id="logout">로그아웃</button>' : ''}</div></form></div>`);
  document.querySelector('#profile-form').onsubmit = async event => {
    event.preventDefault(); const button = event.submitter; button.disabled = true; button.textContent = '저장 중…';
    try { const result = await api('/profile', { method: 'POST', body: JSON.stringify({ name: new FormData(event.target).get('name') }) }); me.user = result.user; if (editing) { status('이름을 저장했어요.'); button.textContent = '이름 저장'; } else location.reload(); }
    catch (error) { status(error.message, true); button.textContent = editing ? '이름 저장' : '가입하고 시작하기'; }
    finally { button.disabled = false; }
  };
  const logout = document.querySelector('#logout');
  if (logout) logout.onclick = async () => { logout.disabled = true; try { await api('/auth/logout', { method: 'POST', body: '{}' }); location.href = pageUrl('/'); } catch (error) { status(error.message, true); logout.disabled = false; } };
}
async function renderMeetings() {
  const data = await api('/meetings');
  renderPage( appTop('내 약속', `${me.user.name}님, 다음에 만날 시간을 정해 볼까요?`, '<a class="button" href="/app?new=1">새 약속 만들기</a>') + appTabs('meetings') + (data.meetings.length ? `<ul class="meeting-list">${data.meetings.map(meeting => `<li><a href="/m/${meeting.id}"><div><h2>${escape(meeting.title)}</h2><p>${dateLabel(meeting.start_date)} ~ ${dateLabel(meeting.end_date)}</p></div><span>${meeting.response_count}명 참여</span></a>${meeting.can_delete ? `<button class="quiet-button delete-meeting" type="button" data-delete-meeting="${meeting.id}" aria-label="${escape(meeting.title)} 삭제">삭제</button>` : ''}</li>`).join('')}</ul>` : '<div class="empty"><h2>아직 만든 약속이 없어요</h2><p>날짜를 정하고 링크를 보내면, 함께 가능한 시간을 모을 수 있어요.</p><a class="button" href="/app?new=1">첫 약속 만들기</a></div>'));
  for (const button of document.querySelectorAll('[data-delete-meeting]')) button.onclick = () => {
    const meeting = data.meetings.find(item => item.id === button.dataset.deleteMeeting);
    openMeetingDeletion(meeting, api, () => { void renderMeetings().catch(errorView); });
  };
}
function renderCreate() {
  renderPage( '<a class="back-link" href="/app">내 약속으로 돌아가기</a>' + appTop('어떤 약속을 만들까요?', '만날 날짜와 시간 범위를 정하면 참여 링크가 생겨요.') + `<form id="create-form" class="form-panel"><div class="field"><label for="meeting-title">약속 이름</label><input id="meeting-title" name="title" placeholder="예: 다음 주 스터디" required maxlength="80" autofocus></div><div class="form-grid"><div class="field"><label for="start-date">시작 날짜</label><input id="start-date" type="date" name="start_date" min="${today}" value="${today}" required></div><div class="field"><label for="end-date">마지막 날짜</label><input id="end-date" type="date" name="end_date" min="${today}" max="${offsetDate(today, 13)}" value="${offsetDate(today, 6)}" required></div></div><p class="helper">최대 14일의 가능한 시간을 비교할 수 있어요.</p><div class="form-grid"><div class="field"><label for="start-hour">시작 시간</label><select name="start_hour" id="start-hour">${hoursOptions(9, 23)}</select></div><div class="field"><label for="end-hour">종료 시간</label><select name="end_hour" id="end-hour">${hoursOptions(21).replace('<option value="0" >00:00</option>', '')}</select></div></div><div class="field"><label for="meeting-delete-password">삭제 비밀번호</label><input id="meeting-delete-password" name="delete_password" type="password" required minlength="8" maxlength="128" autocomplete="new-password"><p class="helper">약속을 삭제할 때 사용할 비밀번호를 8~128자로 입력해 주세요.</p></div><p id="form-status" class="inline-status" role="status"></p><div class="form-actions"><button type="submit" class="button">참여 링크 만들기</button><a class="quiet-button" href="/app">취소</a></div></form>`);
  document.querySelector('#start-date').onchange = event => {
    const end = document.querySelector('#end-date'); end.min = event.target.value; end.max = offsetDate(event.target.value, 13);
    if (end.value < end.min || end.value > end.max) end.value = offsetDate(event.target.value, 6);
  };
  document.querySelector('#create-form').onsubmit = async event => {
    event.preventDefault(); const button = event.submitter; button.disabled = true; button.textContent = '링크 만드는 중…';
    const values = Object.fromEntries(new FormData(event.target));
    for (const field of ['start_hour', 'end_hour']) values[field] = Number(values[field]);
    try { const result = await api('/meetings', { method: 'POST', body: JSON.stringify(values) }); location.href = pageUrl(result.path + '?created=1'); }
    catch (error) { status(error.message, true); button.disabled = false; button.textContent = '참여 링크 만들기'; }
  };
}
function fixedView() {
  renderPage( appTop('내 고정 일정', '매주 반복되는 바쁜 시간을 저장하면, 모든 약속에서 자동으로 제외돼요.') + appTabs('fixed') + `<div id="everytime-import"></div><div id="fixed-painter"></div><h2 class="manual-fixed-heading">시간을 직접 입력하거나 저장된 일정을 관리해요</h2><div class="fixed-layout"><form id="fixed-form" class="fixed-form"><h2 class="sr-only">고정 일정 추가</h2><div class="field"><label for="fixed-name">일정 이름</label><input id="fixed-name" name="name" required maxlength="40" placeholder="예: 전공 수업, 팀 회의"></div><div class="field"><label for="fixed-day">반복 요일</label><select name="weekday" id="fixed-day">${weekOrder.map(index => `<option value="${index}">매주 ${days[index]}요일</option>`).join('')}</select></div><div class="form-grid"><div class="field"><label for="fixed-start">시작 시간</label><select name="start" id="fixed-start">${halfHourOptions(540, fixedDayStart, fixedDayEnd - 30)}</select></div><div class="field"><label for="fixed-end">종료 시간</label><select name="end" id="fixed-end">${halfHourOptions(600, fixedDayStart + 30, fixedDayEnd)}</select></div></div><p id="form-status" class="inline-status" role="status"></p><div class="form-actions"><button class="button" type="submit">고정 일정 추가</button></div><p class="privacy-note">일정 이름과 내용은 나에게만 보여요.</p></form><div><p class="fixed-summary" id="fixed-summary"></p><ul class="fixed-list" id="fixed-list"></ul><div class="empty" id="fixed-empty" hidden><h2>아직 등록한 고정 일정이 없어요</h2><p>반복되는 수업이나 회의 시간을 추가해 주세요.</p></div></div></div>`);
  fixedPainter = mountFixedGrid(document.querySelector('#fixed-painter'), { current: () => me.fixed, save: saveFixed, onSaved: drawFixed, onDirty: value => { dirty = value; } });
  mountEverytimeImport(document.querySelector('#everytime-import'), {
    request: url => api('/imports/everytime', { method: 'POST', body: JSON.stringify({ url }) }),
    current: () => me.fixed, save: saveFixed, onSaved: drawFixed,
  });
  drawFixed();
  document.querySelector('#fixed-form').onsubmit = async event => {
    event.preventDefault(); const values = Object.fromEntries(new FormData(event.target));
    const item = { id: crypto.randomUUID(), name: values.name, weekday: Number(values.weekday), start: Number(values.start), end: Number(values.end) };
    if (item.end <= item.start) { status('종료 시간은 시작 시간보다 늦어야 해요.', true); return; }
    const button = event.submitter; button.disabled = true;
    try { await saveFixed([...me.fixed, item]); event.target.reset(); drawFixed(); status('저장했어요. 이 시간은 약속에서 자동으로 제외돼요.'); }
    catch (error) { status(error.message, true); }
    finally { button.disabled = false; }
  };
}
async function saveFixed(items) { const data = await api('/fixed', { method: 'PUT', body: JSON.stringify({ items, version: me.fixed_version }) }); me.fixed = data.fixed; me.fixed_version = data.fixed_version; }
function drawFixed() {
  fixedPainter?.refresh();
  const items = [...me.fixed].sort((first, second) => weekOrder.indexOf(first.weekday) - weekOrder.indexOf(second.weekday) || first.start - second.start);
  document.querySelector('#fixed-summary').textContent = `매주 반복되는 일정이 ${items.length}개 있어요.`;
  document.querySelector('#fixed-empty').hidden = Boolean(items.length);
  document.querySelector('#fixed-list').innerHTML = items.map(item => `<li><div><strong>${escape(item.name)}</strong><span>매주 ${days[item.weekday]}요일 / ${timeLabel(item.start)} ~ ${timeLabel(item.end)}</span></div><button class="quiet-button" type="button" data-delete="${escape(item.id)}" aria-label="${escape(item.name)} 삭제">삭제</button></li>`).join('');
  document.querySelectorAll('[data-delete]').forEach(button => button.onclick = async () => {
    const removed = me.fixed.find(item => item.id === button.dataset.delete);
    if (!confirm(`‘${removed.name}’ 고정 일정을 삭제할까요?`)) return;
    button.disabled = true;
    try { await saveFixed(me.fixed.filter(item => item.id !== removed.id)); drawFixed(); status('삭제했어요. 필요한 약속에서 해당 시간을 다시 선택해 주세요.'); (document.querySelector('[data-delete]') || document.querySelector('#fixed-name')).focus(); }
    catch (error) { status(error.message, true); button.disabled = false; }
  });
}
function meetingDates(meeting) { return Array.from({ length: (Date.parse(meeting.end_date) - Date.parse(meeting.start_date)) / 86400000 + 1 }, (_, index) => offsetDate(meeting.start_date, index)); }
function meetingSlots(meeting) { return meetingDates(meeting).flatMap(date => Array.from({ length: (meeting.end_hour - meeting.start_hour) * 2 }, (_, index) => `${date}|${meeting.start_hour * 60 + index * 30}`)); }
function blockedBy(slot) { const [date, minute] = slot.split('|'); const weekday = (new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7; return me.fixed.find(item => item.weekday === weekday && Number(minute) < item.end && Number(minute) + 30 > item.start); }
async function renderMeeting() {
  appContent.classList.add('meeting-page');
  savedMeeting = await api('/meetings/' + meetingId);
  const meeting = savedMeeting.meeting;
  selected = new Set((savedMeeting.mine?.slots || []).filter(slot => !blockedBy(slot)));
  const shareUrl = new URL(pageUrl('/m/' + meetingId), location.origin).href;
  renderPage( '<a class="back-link" href="/app">내 약속으로 돌아가기</a>' + appTop(meeting.title, `${dateLabel(meeting.start_date)} ~ ${dateLabel(meeting.end_date)}`) + `<div class="share-panel"><div class="share-controls"><span class="share-label">공유 링크</span>${savedMeeting.can_delete ? '<button class="quiet-button delete-meeting" id="delete-meeting" type="button">약속 삭제</button>' : ''}<button class="copy-link-button" id="copy-link" type="button" aria-label="공유 링크 복사" title="공유 링크 복사"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg></button></div><label class="sr-only" for="share-link">참여 링크</label><input id="share-link" class="share-url" readonly hidden value="${escape(shareUrl)}"><p class="helper" id="copy-status" role="status" hidden></p></div><div class="vote-layout"><section aria-labelledby="vote-heading"><div class="vote-toolbar"><h2 id="vote-heading">가능한 시간을 선택해 주세요</h2><button class="quiet-button" type="button" id="select-all">고정 일정 제외 모두 선택</button><button class="quiet-button" type="button" id="clear-all">선택 해제</button></div><div class="paint-options"><button class="button secondary" id="paint-toggle" type="button" aria-pressed="false">드래그로 칠하기</button></div><div class="schedule-scroll" tabindex="0" role="region" aria-label="시간표 스크롤"><div class="schedule-grid" id="schedule-grid"></div></div><div class="response-actions"><button class="quiet-button" type="button" id="save-schedule">일정 저장</button><button class="quiet-button" type="button" id="load-schedule">불러오기</button><button class="quiet-button" id="undo-response" type="button" aria-keyshortcuts="Control+Z Meta+Z" disabled>되돌리기</button><button class="quiet-button" id="retry-response" type="button" hidden>다시 저장</button><button class="quiet-button" id="reload-response" type="button" hidden>저장된 응답 불러오기</button></div><p id="library-status" class="inline-status" role="status" hidden></p><p id="form-status" class="inline-status" role="status"></p></section><aside class="results-panel" id="results" aria-labelledby="overview-heading"></aside></div><section id="participant-availability" aria-labelledby="participant-heading"></section>`);
  const deletionTarget = { ...meeting, has_delete_password: savedMeeting.has_delete_password };
  const deleteButton = document.querySelector('#delete-meeting');
  if (deleteButton) deleteButton.onclick = () => openMeetingDeletion(deletionTarget, async (path, options) => {
    if (options.method === 'DELETE') await responseEditor.flush();
    return api(path, options);
  }, () => { dirty = false; location.href = pageUrl('/app'); });
  document.querySelector('#copy-link').onclick = async () => {
    try { await navigator.clipboard.writeText(shareUrl); const feedback = document.querySelector('#copy-status'); feedback.hidden = false; feedback.textContent = '링크를 복사했어요.'; }
    catch { const input = document.querySelector('#share-link'); input.hidden = false; input.focus(); input.select(); document.querySelector('#copy-status').hidden = false; document.querySelector('#copy-status').textContent = '주소를 선택했어요. 복사 단축키로 복사해 주세요.'; }
  };
  document.querySelector('#select-all').onclick = () => { if (loadingResponse) return; selected = new Set(meetingSlots(meeting).filter(slot => !blockedBy(slot))); changed(); drawGrid(); };
  document.querySelector('#clear-all').onclick = () => { if (loadingResponse) return; selected.clear(); changed(); drawGrid(); };
  const libraryStatus = message => { const node = document.querySelector('#library-status'); node.hidden = false; node.textContent = message; };
  document.querySelector('#save-schedule').onclick = () => {
    if (loadingResponse) return; schedulePainter?.finish(false);
    saveScheduleDialog(meeting, responseEditor.state.slots, api, () => libraryStatus('일정을 저장했어요.'));
  };
  document.querySelector('#load-schedule').onclick = () => {
    if (loadingResponse) return; schedulePainter?.finish(false);
    loadScheduleDialog(meeting, () => responseEditor.state.slots, blockedBy, api, slots => {
      responseEditor.change(slots); drawGrid(); libraryStatus('저장한 일정을 불러왔어요.');
    });
  };
  document.querySelector('#undo-response').onclick = undoResponse;
  document.querySelector('#retry-response').onclick = () => { void responseEditor.retry(); };
  document.querySelector('#reload-response').onclick = reloadResponse;
  document.querySelector('#paint-toggle').onclick = event => { touchPainting = !touchPainting; event.currentTarget.setAttribute('aria-pressed', String(touchPainting)); event.currentTarget.textContent = touchPainting ? '스크롤로 이동하기' : '드래그로 칠하기'; document.querySelector('.schedule-scroll').classList.toggle('painting', touchPainting); };
  const allowed = new Set(meetingSlots(meeting));
  responseEditor = createResponseEditor({
    slots: selected, version: savedMeeting.mine?.version || 0, exists: Boolean(savedMeeting.mine),
    normalize: slots => slots.filter(slot => allowed.has(slot) && !blockedBy(slot)),
    save: (slots, version) => persistResponse(api, '/meetings/' + meetingId, slots, version),
    onDraft: slots => { if (!schedulePainter?.isPainting()) { selected = new Set(slots); refreshSlotButtons(); } },
    onState: renderResponseState,
    onSaved: () => {
      void refreshMeetingResults().catch(() => status('응답은 저장했지만 결과를 새로 불러오지 못했어요. 결과 새로고침을 눌러 주세요.', true, '#results-status'));
    },
  });
  drawGrid(); drawResults();
}
function changed() { responseEditor.change([...selected]); }
function drawGrid(focusSlot) {
  const meeting = savedMeeting.meeting;
  const dates = meetingDates(meeting);
  const minutes = Array.from({ length: (meeting.end_hour - meeting.start_hour) * 2 }, (_, index) => meeting.start_hour * 60 + index * 30);
  const grid = document.querySelector('#schedule-grid');
  const scroll = document.querySelector('.schedule-scroll');
  const position = { left: scroll.scrollLeft, top: scroll.scrollTop };
  const tabStop = focusSlot || dates[0] + '|' + minutes[0];
  grid.style.setProperty('--schedule-columns', String(dates.length));
  grid.innerHTML = timeAxisMarkup(minutes) + dates.map(date => `<div class="slot-col"><button type="button" class="col-head select-date" data-select-date="${date}">${dateLabel(date)}</button>${minutes.map(minute => {
    const slot = date + '|' + minute; const blocked = blockedBy(slot); const pressed = selected.has(slot); const count = savedMeeting.counts[slot] || 0;
    return `<button type="button" class="slot${blocked ? ' blocked' : ''}" data-slot="${slot}" aria-pressed="${pressed}" ${blocked ? 'aria-disabled="true"' : ''} tabindex="${slot === tabStop ? '0' : '-1'}" aria-label="${dateLabel(date)} ${timeLabel(minute)}부터 ${timeLabel(minute + 30)}까지, ${blocked ? escape(blocked.name) + ' 고정 일정' : pressed ? '선택됨' : '선택 안 됨'}, ${count}명 가능">${!blocked && pressed ? '✓' : ''}</button>`;
  }).join('')}</div>`).join('') + timeAxisMarkup(minutes, true);
  schedulePainter = bindScheduleGrid(grid, scroll, { columns: dates, read: () => selected, write: value => { selected = value; }, blocked: blockedBy, locked: () => loadingResponse, touch: () => touchPainting, preview: refreshSlotButtons, commit: changed, settled: () => { selected = new Set(responseEditor.state.slots); refreshSlotButtons(); } });
  scroll.scrollLeft = position.left; scroll.scrollTop = position.top;
  for (const button of grid.querySelectorAll('[data-select-date]')) button.onclick = () => {
    if (loadingResponse) return;
    schedulePainter?.finish(false);
    selected = toggleColumnSelection(selected, meetingSlots(meeting).filter(slot => slot.startsWith(button.dataset.selectDate + '|')), blockedBy);
    refreshSlotButtons(); changed();
  };
  refreshDateButtons();
  lockSelection();
}
let touchPainting = false;
let schedulePainter;
function refreshSlotButtons() {
  document.querySelectorAll('#schedule-grid [data-slot]').forEach(button => {
    const slot = button.dataset.slot, [date, minute] = slot.split('|'), blocked = blockedBy(slot), pressed = !blocked && selected.has(slot);
    button.setAttribute('aria-pressed', String(pressed)); button.classList.toggle('blocked', Boolean(blocked));
    if (blocked) button.setAttribute('aria-disabled', 'true'); else button.removeAttribute('aria-disabled');
    button.textContent = !blocked && pressed ? '✓' : ''; button.disabled = loadingResponse;
    button.setAttribute('aria-label', `${dateLabel(date)} ${timeLabel(Number(minute))}부터 ${timeLabel(Number(minute) + 30)}까지, ${blocked ? blocked.name + ' 고정 일정' : pressed ? '선택됨' : '선택 안 됨'}, ${savedMeeting.counts[slot] || 0}명 가능`);
  });
  refreshDateButtons();
}
function refreshDateButtons() {
  for (const button of document.querySelectorAll('[data-select-date]')) {
    const allowed = meetingSlots(savedMeeting.meeting).filter(slot => slot.startsWith(button.dataset.selectDate + '|') && !blockedBy(slot));
    const count = allowed.filter(slot => selected.has(slot)).length;
    const all = allowed.length > 0 && count === allowed.length;
    button.setAttribute('aria-pressed', all ? 'true' : count ? 'mixed' : 'false');
    button.setAttribute('aria-label', `${dateLabel(button.dataset.selectDate)} 가능한 시간 ${all ? '선택 해제' : '모두 선택'}`);
    button.title = allowed.length ? '고정 일정을 제외한 해당 날짜의 시간을 선택하거나 해제해요.' : '고정 일정으로 선택 가능한 시간이 없어요.';
    button.disabled = loadingResponse || !allowed.length;
  }
}
function lockSelection() { document.querySelectorAll('#schedule-grid [data-slot], [data-select-date], #paint-toggle, #select-all, #clear-all, #save-schedule, #load-schedule, #refresh-results').forEach(button => { button.disabled = loadingResponse; }); refreshDateButtons(); }
function drawResults() {
  const active = document.activeElement;
  const restoreFocus = active?.closest('#results, #participant-availability') ? active.id ? '#' + active.id : active.dataset.filter ? '[data-filter="' + active.dataset.filter + '"]' : active.dataset.slot ? '#overview-grid [data-slot="' + active.dataset.slot + '"]' : null : null;
  const data = savedMeeting;
  document.querySelector('#results').innerHTML = `<section id="availability-overview" aria-labelledby="overview-heading"></section><p id="export-status" class="inline-status" role="status" hidden></p><div class="participants"><h3>참여한 사람</h3><p>${data.participants.length ? data.participants.map(person => escape(person.name)).join(', ') : '아직 참여한 사람이 없어요.'}</p><button class="quiet-button" id="refresh-results" type="button">결과 새로고침</button><p class="helper" id="results-status" role="status"></p></div>`;
  document.querySelector('#refresh-results').onclick = async event => { const button = event.currentTarget; button.disabled = true; try { await refreshMeetingResults(); } catch (error) { status(error.message, true, '#results-status'); button.disabled = false; } };
  mountAvailabilityOverview(document.querySelector('#availability-overview'), data, overviewState);
  for (const button of document.querySelectorAll('[data-export-result]')) {
    button.disabled = exportingResult;
    button.onclick = () => { void exportResult(button.dataset.exportResult); };
  }
  mountParticipantTable(document.querySelector('#participant-availability'), data);
  if (restoreFocus) document.querySelector(restoreFocus)?.focus({ preventScroll: true });
  lockSelection();
}
async function exportResult(format) {
  if (exportingResult) return;
  exportingResult = true;
  const filter = overviewState.filter;
  document.querySelectorAll('[data-export-result]').forEach(button => { button.disabled = true; });
  const feedback = (message, error = false) => { const node = document.querySelector('#export-status'); if (node) { node.hidden = false; node.textContent = message; node.classList.toggle('error', error); } };
  feedback('파일을 만들고 있어요…');
  try {
    schedulePainter?.finish(false); await responseEditor.flush();
    if (responseEditor.state.dirty) throw new Error('먼저 응답의 저장 상태를 확인한 뒤 다시 내려받아 주세요.');
    const data = await api('/meetings/' + meetingId);
    await exportMeetingResult(data, filter, format); feedback('파일을 내려받았어요.');
  } catch (error) { feedback(error.message, true); }
  finally { exportingResult = false; document.querySelectorAll('[data-export-result]').forEach(button => { button.disabled = false; }); }
}
function renderResponseState(state) {
  dirty = state.dirty;
  const messages = { error: '자동 저장하지 못했어요. 연결을 확인한 뒤 다시 저장해 주세요.', conflict: '다른 창에서 응답이 바뀌었어요. 현재 선택은 유지했어요. 저장된 응답을 불러온 뒤 다시 선택해 주세요.' };
  const message = messages[state.phase] || '';
  status(message, Boolean(message));
  document.querySelector('#form-status').hidden = !message;
  document.querySelector('#form-status').dataset.saveState = state.phase;
  document.querySelector('#undo-response').disabled = loadingResponse || !state.canUndo;
  document.querySelector('#retry-response').hidden = state.phase !== 'error';
  document.querySelector('#reload-response').hidden = state.phase !== 'conflict';
}
function undoResponse() {
  if (!responseEditor || loadingResponse) return;
  schedulePainter?.finish(false); responseEditor.undo();
}
async function refreshMeetingResults() {
  const request = ++resultsRequest;
  const [meeting, profile] = await Promise.all([api('/meetings/' + meetingId), api('/me')]);
  if (request !== resultsRequest) return;
  savedMeeting = meeting; me = profile; responseEditor.revalidate(); drawResults(); refreshSlotButtons();
}
async function reloadResponse() {
  if (loadingResponse) return;
  schedulePainter?.finish(false); loadingResponse = true; resultsRequest++; lockSelection();
  document.querySelector('#reload-response').disabled = true;
  try {
    const [meeting, profile] = await Promise.all([api('/meetings/' + meetingId), api('/me')]);
    savedMeeting = meeting; me = profile;
    responseEditor.reset(meeting.mine?.slots || [], meeting.mine?.version || 0, Boolean(meeting.mine));
    drawResults(); drawGrid();
  } catch (error) { status(error.message, true); }
  finally { loadingResponse = false; document.querySelector('#reload-response').disabled = false; lockSelection(); renderResponseState(responseEditor.state); }
}
window.addEventListener('keydown', event => {
  if (!responseEditor || loadingResponse || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'z' || event.target.closest?.('input, textarea, select, [contenteditable]')) return;
  event.preventDefault(); undoResponse();
});
window.addEventListener('online', () => { if (responseEditor?.state.phase === 'error') void responseEditor.retry(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) void responseEditor?.flush(); });
window.addEventListener('beforeunload', event => { if (dirty) { void responseEditor?.flush(); event.preventDefault(); event.returnValue = ''; } });
async function boot() {
  try {
    me = await api('/me');
    if (me.user) { document.querySelector('#account-link').textContent = '내 약속'; document.querySelector('#signup-link').textContent = me.user.name + '님'; document.querySelector('#signup-link').href = pageUrl('/app?tab=account'); }
    if (!isApp) return;
    if (!me.authenticated) { authView(); return; }
    if (!me.user) { profileView(); return; }
    if (meetingId) await renderMeeting(); else if (params.get('tab') === 'fixed') fixedView(); else if (params.get('tab') === 'account') profileView(true); else if (params.has('new')) renderCreate(); else await renderMeetings();
  } catch (error) { if (isApp) errorView(error); }
}
boot();
