export function meetingDates(meeting) {
  const result = [];
  for (let stamp = Date.parse(meeting.start_date + 'T00:00:00Z'); stamp <= Date.parse(meeting.end_date + 'T00:00:00Z'); stamp += 86400000) result.push(new Date(stamp).toISOString().slice(0, 10));
  return result;
}
export function meetingSlots(meeting) {
  return meetingDates(meeting).flatMap(date => Array.from({ length: (meeting.end_hour - meeting.start_hour) * 2 }, (_, index) => `${date}|${meeting.start_hour * 60 + index * 30}`));
}
export function isBlocked(slot, fixed) {
  const [date, minute] = slot.split('|');
  const weekday = (new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7;
  const start = Number(minute);
  return fixed.some(item => item.weekday === weekday && start < item.end && start + 30 > item.start);
}
export function effectiveSlots(slots, fixed) { return slots.filter(slot => !isBlocked(slot, fixed)); }
export function summarize(meeting, responses) {
  const slots = meetingSlots(meeting);
  const counts = Object.fromEntries(slots.map(slot => [slot, 0]));
  const availableBy = Object.fromEntries(slots.map(slot => [slot, []]));
  for (const [index, response] of responses.entries()) {
    for (const slot of new Set(effectiveSlots(JSON.parse(response.slots_json), JSON.parse(response.fixed_json)))) {
      if (Object.hasOwn(counts, slot)) { counts[slot]++; availableBy[slot].push(index); }
    }
  }
  const candidates = [];
  if (responses.length) {
    for (const date of meetingDates(meeting)) {
      let range = null;
      let previousMembers = '';
      for (let minute = meeting.start_hour * 60; minute < meeting.end_hour * 60; minute += 30) {
        const count = counts[`${date}|${minute}`];
        const members = availableBy[`${date}|${minute}`].join(',');
        if (range && members === previousMembers) range.end = minute + 30;
        else {
          range = count > 0 ? { date, start: minute, end: minute + 30, count } : null;
          if (range) candidates.push(range);
        }
        previousMembers = members;
      }
    }
  }
  candidates.sort((first, second) => second.count - first.count || first.date.localeCompare(second.date) || first.start - second.start);
  return { counts, candidates: candidates.slice(0, 8), participants: responses.map(response => ({ name: response.name })), total: responses.length };
}
