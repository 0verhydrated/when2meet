import './demo.js';
import { renderAuth } from './auth-ui.js';
import { requestApi } from './backend.js';
import { pageUrl, pageMarkup } from './navigation.js';
import { mountEverytimeImport } from './everytime-import.js';
import { mountFixedGrid, weekOrder, fixedDayStart, fixedDayEnd } from './fixed-grid.js';
import { bindScheduleGrid } from './schedule-grid.js';
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
let responseVersion = 0;
let savingResponse = false;
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
  renderPage( appTop('내 약속', `${me.user.name}님, 다음에 만날 시간을 정해 볼까요?`, '<a class="button" href="/app?new=1">새 약속 만들기</a>') + appTabs('meetings') + (data.meetings.length ? `<ul class="meeting-list">${data.meetings.map(meeting => `<li><a href="/m/${meeting.id}"><div><h2>${escape(meeting.title)}</h2><p>${dateLabel(meeting.start_date)} ~ ${dateLabel(meeting.end_date)}</p></div><span>${meeting.response_count}명 참여</span></a></li>`).join('')}</ul>` : '<div class="empty"><h2>아직 만든 약속이 없어요</h2><p>날짜를 정하고 링크를 보내면, 함께 가능한 시간을 모을 수 있어요.</p><a class="button" href="/app?new=1">첫 약속 만들기</a></div>'));
}
function renderCreate() {
  renderPage( '<a class="back-link" href="/app">내 약속으로 돌아가기</a>' + appTop('어떤 약속을 만들까요?', '만날 날짜와 시간 범위를 정하면 참여 링크가 생겨요.') + `<form id="create-form" class="form-panel"><div class="field"><label for="meeting-title">약속 이름</label><input id="meeting-title" name="title" placeholder="예: 다음 주 스터디" required maxlength="80" autofocus></div><div class="form-grid"><div class="field"><label for="start-date">시작 날짜</label><input id="start-date" type="date" name="start_date" min="${today}" value="${today}" required></div><div class="field"><label for="end-date">마지막 날짜</label><input id="end-date" type="date" name="end_date" min="${today}" max="${offsetDate(today, 13)}" value="${offsetDate(today, 6)}" required></div></div><p class="helper">최대 14일의 가능한 시간을 비교할 수 있어요.</p><div class="form-grid"><div class="field"><label for="start-hour">시작 시간</label><select name="start_hour" id="start-hour">${hoursOptions(9, 23)}</select></div><div class="field"><label for="end-hour">종료 시간</label><select name="end_hour" id="end-hour">${hoursOptions(21).replace('<option value="0" >00:00</option>', '')}</select></div></div><p class="helper">모든 시간은 한국 표준시(UTC+9) 기준이에요.</p><p id="form-status" class="inline-status" role="status"></p><div class="form-actions"><button type="submit" class="button">참여 링크 만들기</button><a class="quiet-button" href="/app">취소</a></div></form>`);
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
  savedMeeting = await api('/meetings/' + meetingId);
  const meeting = savedMeeting.meeting;
  responseVersion = savedMeeting.mine?.version || 0;
  selected = new Set((savedMeeting.mine?.slots || []).filter(slot => !blockedBy(slot)));
  const shareUrl = new URL(pageUrl('/m/' + meetingId), location.origin).href;
  renderPage( '<a class="back-link" href="/app">내 약속으로 돌아가기</a>' + appTop(meeting.title, `${dateLabel(meeting.start_date)} ~ ${dateLabel(meeting.end_date)} / 한국 표준시`) + `<div class="share-panel"><h2>${params.has('created') ? '참여 링크가 만들어졌어요.' : '이 링크로 함께 시간을 모아요.'}</h2><div class="share-controls"><label class="sr-only" for="share-link">참여 링크</label><input id="share-link" readonly value="${escape(shareUrl)}"><button class="button" id="copy-link" type="button">링크 복사</button><button class="quiet-button" id="native-share" type="button" ${typeof navigator.share !== 'function' ? 'hidden' : ''}>공유하기</button></div><p class="helper" id="copy-status" role="status">링크를 받은 사람은 로그인 후 가능한 시간을 제출할 수 있어요.</p></div><div class="response-note" id="response-note" ${savedMeeting.mine ? '' : 'hidden'}>저장된 응답을 불러왔어요. 시간을 수정한 뒤 다시 저장할 수 있어요.</div><div class="vote-layout"><section aria-labelledby="vote-heading"><div class="vote-toolbar"><h2 id="vote-heading">가능한 시간을 선택해 주세요</h2><button class="quiet-button" type="button" id="select-all">고정 일정 제외 모두 선택</button><button class="quiet-button" type="button" id="clear-all">선택 해제</button></div><p class="vote-help" id="grid-help">시간을 누르거나 드래그해 선택하세요. 키보드는 방향키로 이동하고 Space로 선택해요. 빗금 친 고정 일정은 제외돼요.</p><div class="paint-options"><button class="button secondary" id="paint-toggle" type="button" aria-pressed="false">드래그로 칠하기</button><span class="helper">전체 기간을 한눈에 보고 영역을 칠해 보세요.</span></div><div class="schedule-scroll" tabindex="0" role="region" aria-label="시간표 스크롤"><div class="schedule-grid" id="schedule-grid" aria-describedby="grid-help"></div></div><div class="vote-save"><span id="selection-count"></span><button class="button" id="save-response" type="button">가능한 시간 저장</button></div><p id="form-status" class="inline-status" role="status"></p><p class="privacy-note">고정 일정은 <a href="/app?tab=fixed">내 고정 일정</a>에서 관리할 수 있어요.</p></section><aside class="results-panel" id="results" aria-labelledby="results-heading"></aside></div>`);
  document.querySelector('#copy-link').onclick = async () => {
    try { await navigator.clipboard.writeText(shareUrl); document.querySelector('#copy-status').textContent = '링크를 복사했어요. 함께할 사람에게 보내주세요.'; }
    catch { const input = document.querySelector('#share-link'); input.focus(); input.select(); document.querySelector('#copy-status').textContent = '주소를 선택했어요. 복사 단축키로 복사해 주세요.'; }
  };
  document.querySelector('#native-share').onclick = async () => { try { await navigator.share({ title: meeting.title, url: shareUrl }); } catch (error) { if (error.name !== 'AbortError') document.querySelector('#copy-status').textContent = '공유를 열지 못했어요. 링크 복사를 이용해 주세요.'; } };
  const help = document.querySelector('#grid-help'); help.innerHTML = '<span class="mouse-help">여러 날짜와 시간을 가로세로 드래그해 칠하거나 지우세요. 방향키로 이동하고 Space로 선택할 수도 있어요.</span><span class="touch-help">좌우로 밀어 전체 날짜를 확인하세요. 드래그로 칠하기를 켜면 손가락으로 영역을 선택할 수 있어요.</span> 빗금 친 고정 일정은 제외돼요.';
  document.querySelector('#select-all').onclick = () => { if (savingResponse) return; selected = new Set(meetingSlots(meeting).filter(slot => !blockedBy(slot))); changed(); drawGrid(); };
  document.querySelector('#clear-all').onclick = () => { if (savingResponse) return; selected.clear(); changed(); drawGrid(); };
  document.querySelector('#save-response').onclick = saveResponse;
  document.querySelector('#paint-toggle').onclick = event => { touchPainting = !touchPainting; event.currentTarget.setAttribute('aria-pressed', String(touchPainting)); event.currentTarget.textContent = touchPainting ? '스크롤로 이동하기' : '드래그로 칠하기'; document.querySelector('.schedule-scroll').classList.toggle('painting', touchPainting); };
  drawGrid(); drawResults();
}
function changed() { dirty = true; status('아직 저장하지 않은 변경 사항이 있어요.'); updateCount(); }
function updateCount() { document.querySelector('#selection-count').textContent = selected.size ? `${selected.size}칸 선택 / 총 ${selected.size / 2}시간` : '선택한 시간이 없어요. 불참도 저장할 수 있어요.'; }
function drawGrid(focusSlot) {
  const meeting = savedMeeting.meeting;
  const dates = meetingDates(meeting);
  const minutes = Array.from({ length: (meeting.end_hour - meeting.start_hour) * 2 }, (_, index) => meeting.start_hour * 60 + index * 30);
  const grid = document.querySelector('#schedule-grid');
  const scroll = document.querySelector('.schedule-scroll');
  const position = { left: scroll.scrollLeft, top: scroll.scrollTop };
  const tabStop = focusSlot || dates[0] + '|' + minutes[0];
  grid.innerHTML = '<div class="hours-col"><div class="col-head">시간</div>' + minutes.map(minute => `<span class="hour-label">${timeLabel(minute)}</span>`).join('') + '</div>' + dates.map(date => `<div class="slot-col"><div class="col-head">${dateLabel(date)}</div>${minutes.map(minute => {
    const slot = date + '|' + minute; const blocked = blockedBy(slot); const pressed = selected.has(slot); const count = savedMeeting.counts[slot] || 0;
    return `<button type="button" class="slot${blocked ? ' blocked' : ''}" data-slot="${slot}" aria-pressed="${pressed}" ${blocked ? 'aria-disabled="true"' : ''} tabindex="${slot === tabStop ? '0' : '-1'}" aria-label="${dateLabel(date)} ${timeLabel(minute)}부터 ${timeLabel(minute + 30)}까지, ${blocked ? escape(blocked.name) + ' 고정 일정' : pressed ? '선택됨' : '선택 안 됨'}, ${count}명 가능">${blocked ? '고정' : pressed ? '✓' : ''}</button>`;
  }).join('')}</div>`).join('');
  schedulePainter = bindScheduleGrid(grid, scroll, { columns: dates, read: () => selected, write: value => { selected = value; }, blocked: blockedBy, locked: () => savingResponse, touch: () => touchPainting, preview: () => { refreshSlotButtons(); updateCount(); }, commit: changed });
  scroll.scrollLeft = position.left; scroll.scrollTop = position.top;
  updateCount();
  lockSelection();
}
let touchPainting = false;
let schedulePainter;
function refreshSlotButtons() { document.querySelectorAll('[data-slot]').forEach(button => { const pressed = selected.has(button.dataset.slot); button.setAttribute('aria-pressed', String(pressed)); if (!button.hasAttribute('aria-disabled')) button.textContent = pressed ? '✓' : ''; button.setAttribute('aria-label', button.getAttribute('aria-label').replace(/선택됨|선택 안 됨/, pressed ? '선택됨' : '선택 안 됨')); }); }
function lockSelection() { document.querySelectorAll('[data-slot], #paint-toggle, #select-all, #clear-all, #refresh-results').forEach(button => { button.disabled = savingResponse; }); }
function drawResults() {
  const data = savedMeeting;
  document.querySelector('#results').innerHTML = `<h2 id="results-heading">겹치는 시간을 확인해 보세요</h2><p>${data.total}명이 응답했어요.</p>${data.candidates.length ? `<ul class="candidate-list">${data.candidates.map(candidate => `<li><strong>${dateLabel(candidate.date)}</strong><span>${timeLabel(candidate.start)} ~ ${timeLabel(candidate.end)}</span><br><span class="${candidate.count === data.total ? 'all-available' : ''}">${candidate.count === data.total ? '모두 가능해요' : '일부만 가능해요'} (${candidate.count}/${data.total}명)</span></li>`).join('')}</ul>` : `<div class="empty"><p>${data.total ? '아직 함께 가능한 시간이 없어요. 시간 범위를 확인하거나 응답을 수정해 보세요.' : '첫 응답을 기다리고 있어요. 가능한 시간을 저장하면 결과가 나타나요.'}</p></div>`}<div class="participants"><h3>참여한 사람</h3><p>${data.participants.length ? data.participants.map(person => escape(person.name)).join(', ') : '아직 참여한 사람이 없어요.'}</p><button class="quiet-button" id="refresh-results" type="button">결과 새로고침</button><p class="helper" id="results-status" role="status"></p></div>`;
  document.querySelector('#refresh-results').onclick = async event => { const button = event.currentTarget; button.disabled = true; try { const result = await api('/meetings/' + meetingId); savedMeeting = { ...result, mine: savedMeeting.mine }; drawResults(); drawGrid(); document.querySelector('#refresh-results').focus(); } catch (error) { document.querySelector('#results-status').textContent = error.message; button.disabled = false; } };
  lockSelection();
}
async function saveResponse() {
  if (savingResponse) return;
  schedulePainter?.finish(false); savingResponse = true; lockSelection();
  const button = document.querySelector('#save-response'); button.disabled = true; button.textContent = '저장 중…';
  try {
    const result = await api('/meetings/' + meetingId + '/response', { method: 'PUT', body: JSON.stringify({ slots: [...selected], version: responseVersion }) });
    responseVersion = result.version; selected = new Set(result.slots); dirty = false;
    status('참여가 저장됐어요. 다른 사람의 응답과 함께 확인할 수 있어요.');
    const note = document.querySelector('#response-note'); note.hidden = false; note.textContent = '참여가 저장됐어요. 이 링크에서 언제든 수정할 수 있어요.';
    [savedMeeting, me] = await Promise.all([api('/meetings/' + meetingId), api('/me')]); drawResults(); drawGrid();
  } catch (error) { status(error.message, true); }
  finally { savingResponse = false; lockSelection(); button.disabled = false; button.textContent = '가능한 시간 저장'; }
}
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
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
