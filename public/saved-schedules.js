import { createDialog } from './dialog.js';
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const time = minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

export function applySavedSchedule(current, saved, meeting, blocked = () => false) {
  const first = [saved.start_date, meeting.start_date].sort().at(-1), last = [saved.end_date, meeting.end_date].sort()[0];
  const start = Math.max(saved.start_hour, meeting.start_hour) * 60, end = Math.min(saved.end_hour, meeting.end_hour) * 60;
  const within = slot => { const [date, minute] = slot.split('|'); return date >= first && date <= last && Number(minute) >= start && Number(minute) < end; };
  const overlaps = first <= last && start < end;
  if (!overlaps) return { slots: [...current], overlaps: false };
  const next = new Set([...current].filter(slot => !within(slot)));
  for (const slot of saved.slots) if (within(slot) && !blocked(slot)) next.add(slot);
  return { slots: [...next], overlaps: true };
}

export function saveScheduleDialog(meeting, slots, api, onSaved) {
  const dialog = createDialog(`<form><h2 id="save-schedule-heading">일정 저장</h2><div class="field"><label for="saved-name">일정 이름</label><input id="saved-name" name="name" required maxlength="60" value="${escape([...meeting.title].slice(0, 60).join(''))}" autofocus></div><p class="helper">${meeting.start_date} ~ ${meeting.end_date} / ${time(meeting.start_hour * 60)} ~ ${time(meeting.end_hour * 60)}</p><p class="inline-status" role="status"></p><div class="form-actions"><button class="quiet-button" type="button" id="cancel-save-schedule">취소</button><button class="button" type="submit">저장</button></div></form>`);
  const form = dialog.querySelector('form'), message = dialog.querySelector('[role=status]'), submit = dialog.querySelector('[type=submit]'), cancel = dialog.querySelector('#cancel-save-schedule');
  let busy = false;
  cancel.onclick = () => dialog.close(); dialog.oncancel = event => { if (busy) event.preventDefault(); };
  form.onsubmit = async event => {
    event.preventDefault(); if (busy) return; busy = true; submit.disabled = cancel.disabled = true; message.textContent = '';
    try { await api('/saved-schedules', { method: 'POST', body: JSON.stringify({ meeting_id: meeting.id, name: form.elements.name.value.trim(), slots }) }); dialog.close(); onSaved(); }
    catch (error) { message.textContent = error.message; message.classList.add('error'); }
    finally { busy = false; submit.disabled = cancel.disabled = false; }
  };
  dialog.showModal();
}

export function loadScheduleDialog(meeting, current, blocked, api, onApply) {
  const dialog = createDialog(`<form><h2 id="load-schedule-heading">저장한 일정 불러오기</h2><div class="field"><label for="saved-schedule">저장한 일정</label><select id="saved-schedule" disabled><option>불러오는 중…</option></select></div><p id="saved-schedule-preview" class="helper"></p><p class="helper">같은 날짜와 겹치는 시간만 바꾸고 고정 일정은 제외해요.</p><p class="inline-status" role="status"></p><div class="form-actions"><button class="quiet-button" type="button" id="remove-schedule" disabled>저장한 일정 삭제</button><button class="quiet-button" type="button" id="cancel-load-schedule">취소</button><button class="button" type="submit" disabled>불러오기</button></div></form>`);
  const select = dialog.querySelector('select'), submit = dialog.querySelector('[type=submit]'), remove = dialog.querySelector('#remove-schedule'), cancel = dialog.querySelector('#cancel-load-schedule'), message = dialog.querySelector('[role=status]'), preview = dialog.querySelector('#saved-schedule-preview');
  let schedules = [], busy = false;
  const chosen = () => schedules.find(item => item.id === select.value);
  const update = () => {
    const item = chosen(), overlap = item && applySavedSchedule(current(), item, meeting, blocked).overlaps;
    submit.disabled = busy || !overlap; remove.disabled = busy || !item;
    preview.textContent = item ? `${item.start_date} ~ ${item.end_date} / ${time(item.start_hour * 60)} ~ ${time(item.end_hour * 60)}${overlap ? '' : ' — 이 약속과 겹치는 날짜·시간이 없어요.'}` : '아직 저장한 일정이 없어요.';
  };
  const refresh = async () => {
    const previous = select.value;
    const result = await api('/saved-schedules');
    if (!dialog.isConnected) return;
    schedules = result.schedules;
    select.innerHTML = schedules.length ? schedules.map(item => `<option value="${item.id}">${escape(item.name)} (${item.start_date} ~ ${item.end_date})</option>`).join('') : '<option value="">저장한 일정이 없어요</option>';
    if (schedules.some(item => item.id === previous)) select.value = previous;
    select.disabled = !schedules.length; update();
  };
  select.onchange = () => { message.textContent = ''; update(); };
  cancel.onclick = () => dialog.close(); dialog.oncancel = event => { if (busy) event.preventDefault(); };
  dialog.querySelector('form').onsubmit = event => {
    event.preventDefault(); const item = chosen(); if (busy || !item) return;
    const next = applySavedSchedule(current(), item, meeting, blocked);
    if (next.overlaps) { dialog.close(); onApply(next.slots); }
  };
  remove.onclick = async () => {
    const item = chosen(); if (!item || busy || !confirm(`‘${item.name}’ 저장 일정을 삭제할까요?`)) return;
    busy = true; select.disabled = cancel.disabled = true; update();
    try { await api('/saved-schedules/' + item.id, { method: 'DELETE', body: '{}' }); await refresh(); message.textContent = '저장한 일정을 삭제했어요.'; }
    catch (error) { message.textContent = error.message; }
    finally { busy = false; cancel.disabled = false; select.disabled = !schedules.length; update(); }
  };
  dialog.showModal(); void refresh().catch(error => { message.textContent = error.message; });
}
