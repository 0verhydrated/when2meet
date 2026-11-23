const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const timeLabel = minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const dateLabel = date => new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', weekday: 'short', timeZone: 'Asia/Seoul' }).format(new Date(date + 'T00:00:00+09:00'));
function meetingDates(meeting) {
  return Array.from({ length: (Date.parse(meeting.end_date) - Date.parse(meeting.start_date)) / 86400000 + 1 }, (_, index) => new Date(Date.parse(meeting.start_date + 'T00:00:00Z') + index * 86400000).toISOString().slice(0, 10));
}
export function participantColumns(participants) {
  const totals = new Map(), seen = new Map();
  for (const person of participants) totals.set(person.name, (totals.get(person.name) || 0) + 1);
  return participants.map(person => {
    const index = (seen.get(person.name) || 0) + 1; seen.set(person.name, index);
    return { key: JSON.stringify([person.name, index]), label: totals.get(person.name) > 1 ? `${person.name} (${index})` : person.name, slots: new Set(person.slots || []) };
  });
}
export function participantTableMarkup(meeting, person) {
  const dates = meetingDates(meeting);
  const minutes = Array.from({ length: (meeting.end_hour - meeting.start_hour) * 2 }, (_, index) => meeting.start_hour * 60 + index * 30);
  return `<table class="participant-table"><caption>${escape(person.label)} / ${escape(dateLabel(meeting.start_date))} ~ ${escape(dateLabel(meeting.end_date))} / 30분 단위 / 한국 표준시</caption><thead><tr><th scope="col">시간</th>${dates.map(date => `<th scope="col">${escape(dateLabel(date))}</th>`).join('')}</tr></thead><tbody>${minutes.map(minute => `<tr><th scope="row">${timeLabel(minute)} ~ ${timeLabel(minute + 30)}</th>${dates.map(date => { const available = person.slots.has(date + '|' + minute); return `<td class="${available ? 'person-available' : 'person-unselected'}"><span aria-hidden="true">${available ? '✓' : '—'}</span><span class="sr-only">${available ? '가능' : '선택하지 않음'}</span></td>`; }).join('')}</tr>`).join('')}</tbody><tfoot><tr><th scope="row">가능한 시간</th>${dates.map(date => `<td>${minutes.filter(minute => person.slots.has(date + '|' + minute)).length / 2}시간</td>`).join('')}</tr></tfoot></table>`;
}
export function mountParticipantTable(container, data) {
  const heading = '<h2 id="participant-heading">참여자별 가능한 시간을 확인해 보세요</h2>';
  if (!data.participants.length) { container.innerHTML = heading + '<p class="helper">아직 응답한 사람이 없어요. 응답이 저장되면 참여자별 시간표가 표시돼요.</p>'; return; }
  if (data.participants.some(person => !Array.isArray(person.slots))) { container.innerHTML = heading + '<p class="helper">참여자별 시간을 불러오려면 결과를 새로고침해 주세요.</p>'; return; }
  const meeting = data.meeting;
  const dates = meetingDates(meeting);
  const people = participantColumns(data.participants);
  const previous = container.querySelector('select')?.value;
  const chosen = people.some(person => person.key === previous) ? previous : people[0].key;
  const oldScroll = container.querySelector('.participant-table-scroll');
  const position = { left: oldScroll?.scrollLeft || 0, top: oldScroll?.scrollTop || 0 };
  container.innerHTML = heading + `<p class="helper">참여자를 선택하면 약속 전체 기간의 가능한 시간을 한 번에 볼 수 있어요. 고정 일정은 제외하며, ✓는 가능, —는 선택하지 않은 시간이에요.</p><div class="participant-controls field"><label for="participant-person">확인할 참여자</label><select id="participant-person" aria-controls="participant-person-table">${people.map(person => `<option value="${escape(person.key)}" ${person.key === chosen ? 'selected' : ''}>${escape(person.label)}</option>`).join('')}</select></div><p class="participant-person-summary" id="participant-person-summary" role="status"></p><p class="helper participant-empty" hidden>이 참여자는 가능한 시간을 선택하지 않았어요.</p><div class="participant-table-scroll" id="participant-person-table" tabindex="0" role="region" aria-label="선택한 참여자의 전체 기간 시간표"></div>`;
  const scroll = container.querySelector('.participant-table-scroll');
  const drawPerson = () => {
    const person = people.find(item => item.key === container.querySelector('select').value);
    const minutes = Array.from({ length: (meeting.end_hour - meeting.start_hour) * 2 }, (_, index) => meeting.start_hour * 60 + index * 30);
    const total = dates.reduce((sum, date) => sum + minutes.filter(minute => person.slots.has(date + '|' + minute)).length, 0);
    container.querySelector('#participant-person-summary').textContent = `${person.label}님의 전체 기간 가능한 시간은 ${total / 2}시간이에요.`;
    container.querySelector('.participant-empty').hidden = total > 0;
    scroll.innerHTML = participantTableMarkup(meeting, person);
  };
  container.querySelector('select').onchange = drawPerson;
  drawPerson(); scroll.scrollLeft = position.left; scroll.scrollTop = position.top;
}
