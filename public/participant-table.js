const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const timeLabel = minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const dateLabel = date => new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', weekday: 'short', timeZone: 'Asia/Seoul' }).format(new Date(date + 'T00:00:00+09:00'));
export function participantColumns(participants) {
  const totals = new Map(), seen = new Map();
  for (const person of participants) totals.set(person.name, (totals.get(person.name) || 0) + 1);
  return participants.map(person => {
    const index = (seen.get(person.name) || 0) + 1; seen.set(person.name, index);
    return { label: totals.get(person.name) > 1 ? `${person.name} (${index})` : person.name, slots: new Set(person.slots || []) };
  });
}
export function participantTableMarkup(meeting, participants, date) {
  const columns = participantColumns(participants);
  const minutes = Array.from({ length: (meeting.end_hour - meeting.start_hour) * 2 }, (_, index) => meeting.start_hour * 60 + index * 30);
  return `<table class="participant-table"><caption>${escape(dateLabel(date))} / 30분 단위 / 한국 표준시</caption><thead><tr><th scope="col">시간</th>${columns.map(person => `<th scope="col">${escape(person.label)}</th>`).join('')}</tr></thead><tbody>${minutes.map(minute => `<tr><th scope="row">${timeLabel(minute)} ~ ${timeLabel(minute + 30)}</th>${columns.map(person => { const available = person.slots.has(date + '|' + minute); return `<td class="${available ? 'person-available' : 'person-unselected'}"><span aria-hidden="true">${available ? '✓' : '—'}</span><span class="sr-only">${available ? '가능' : '선택하지 않음'}</span></td>`; }).join('')}</tr>`).join('')}</tbody><tfoot><tr><th scope="row">가능한 시간</th>${columns.map(person => `<td>${minutes.filter(minute => person.slots.has(date + '|' + minute)).length / 2}시간</td>`).join('')}</tr></tfoot></table>`;
}
export function mountParticipantTable(container, data) {
  const heading = '<h2 id="participant-heading">참여자별 가능한 시간을 확인해 보세요</h2>';
  if (!data.participants.length) { container.innerHTML = heading + '<p class="helper">아직 응답한 사람이 없어요. 응답이 저장되면 참여자별 시간표가 표시돼요.</p>'; return; }
  if (data.participants.some(person => !Array.isArray(person.slots))) { container.innerHTML = heading + '<p class="helper">참여자별 시간을 불러오려면 결과를 새로고침해 주세요.</p>'; return; }
  const meeting = data.meeting;
  const dates = Array.from({ length: (Date.parse(meeting.end_date) - Date.parse(meeting.start_date)) / 86400000 + 1 }, (_, index) => new Date(Date.parse(meeting.start_date + 'T00:00:00Z') + index * 86400000).toISOString().slice(0, 10));
  const previous = container.querySelector('select')?.value;
  const selectedDate = dates.includes(previous) ? previous : dates[0];
  container.innerHTML = heading + `<p class="helper">저장한 가능 시간에서 각자의 고정 일정을 제외해 표시해요. ✓는 가능, —는 선택하지 않은 시간이에요.</p><div class="participant-controls field"><label for="participant-date">확인할 날짜</label><select id="participant-date">${dates.map(date => `<option value="${date}" ${date === selectedDate ? 'selected' : ''}>${escape(dateLabel(date))}</option>`).join('')}</select></div><div class="participant-table-scroll" tabindex="0" role="region" aria-label="참여자별 가능한 시간표">${participantTableMarkup(meeting, data.participants, selectedDate)}</div>`;
  container.querySelector('select').onchange = () => { mountParticipantTable(container, data); container.querySelector('select').focus(); };
}
