export function timeAxisMarkup(minutes, right = false) {
  const label = minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
  return `<div class="hours-col${right ? ' end-hours-col' : ''}" ${right ? 'aria-hidden="true"' : ''}><div class="col-head">시간</div>${minutes.map(minute => `<span class="hour-label">${label(minute)}</span>`).join('')}<span class="axis-end-label">${label(minutes.at(-1) + 30)}</span></div>`;
}
export function rectangleSlots(columns, origin, end) {
  const [firstColumn, firstMinute] = origin.split('|'), [lastColumn, lastMinute] = end.split('|');
  const a = columns.map(String).indexOf(firstColumn), b = columns.map(String).indexOf(lastColumn), slots = [];
  for (const column of columns.slice(Math.min(a, b), Math.max(a, b) + 1)) {
    for (let minute = Math.min(Number(firstMinute), Number(lastMinute)); minute <= Math.max(Number(firstMinute), Number(lastMinute)); minute += 30) slots.push(column + '|' + minute);
  }
  return slots;
}
export function toggleColumnSelection(current, slots, blocked = () => false) {
  const allowed = slots.filter(slot => !blocked(slot));
  const remove = allowed.length > 0 && allowed.every(slot => current.has(slot));
  const next = new Set(current);
  for (const slot of allowed) { if (remove) next.delete(slot); else next.add(slot); }
  return next;
}
function focusGridSlot(grid, button) {
  grid.querySelector('[tabindex="0"]')?.setAttribute('tabindex', '-1');
  button.tabIndex = 0; button.focus({ preventScroll: true });
}
export function bindGridKeyboard(grid, columns) {
  const buttons = [...grid.querySelectorAll('[data-slot]')];
  for (const button of buttons) button.onkeydown = event => {
    const [column, minute] = button.dataset.slot.split('|');
    let x = columns.map(String).indexOf(column), y = Number(minute);
    if (event.key === 'ArrowLeft') x--; else if (event.key === 'ArrowRight') x++; else if (event.key === 'ArrowUp') y -= 30; else if (event.key === 'ArrowDown') y += 30;
    else if (event.key === 'Home') y = Number(buttons[0].dataset.slot.split('|')[1]);
    else if (event.key === 'End') y = Number(buttons.at(-1).dataset.slot.split('|')[1]); else return;
    event.preventDefault(); x = Math.max(0, Math.min(columns.length - 1, x));
    const target = buttons.find(item => item.dataset.slot === columns[x] + '|' + y);
    if (target) { focusGridSlot(grid, target); target.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  };
}

// Meeting availability and weekly commitments share pointer, touch and keyboard behavior.
export function bindScheduleGrid(grid, scroll, { columns, read, write, blocked = () => false, locked = () => false, touch, preview, commit, settled = () => {} }) {
  let gesture = null, frame = 0, suppress = false;
  const buttons = [...grid.querySelectorAll('[data-slot]')];
  const focus = button => focusGridSlot(grid, button);
  const paint = () => {
    const next = new Set(gesture.initial);
    for (const slot of rectangleSlots(columns, gesture.origin, gesture.end)) if (!blocked(slot)) { if (gesture.value) next.add(slot); else next.delete(slot); }
    write(next); preview();
  };
  const atPointer = () => {
    const box = scroll.getBoundingClientRect();
    const rightAxis = grid.querySelector('.end-hours-col')?.offsetWidth || 0;
    const x = Math.max(box.left + 56, Math.min(Math.min(box.right, innerWidth) - rightAxis - 4, gesture.x));
    const y = Math.max(Math.max(box.top + grid.querySelector('.col-head').offsetHeight + 4, 0), Math.min(Math.min(box.bottom, innerHeight) - 4, gesture.y));
    const button = document.elementFromPoint(x, y)?.closest('[data-slot]');
    if (button && grid.contains(button) && button.dataset.slot !== gesture.end) { gesture.end = button.dataset.slot; paint(); }
  };
  const autoScroll = () => {
    if (!gesture) return;
    const box = scroll.getBoundingClientRect();
    const x = gesture.x > Math.min(box.right, innerWidth) - 28 ? 12 : gesture.x < box.left + 76 ? -12 : 0;
    const y = gesture.y > Math.min(box.bottom, innerHeight) - 28 ? 12 : gesture.y < Math.max(box.top + grid.querySelector('.col-head').offsetHeight + 20, 0) ? -12 : 0;
    if (x || y) { scroll.scrollBy(x, y); atPointer(); }
    frame = requestAnimationFrame(autoScroll);
  };
  const finish = cancelled => {
    if (!gesture) return;
    const previous = gesture; gesture = null; cancelAnimationFrame(frame);
    if (grid.hasPointerCapture(previous.pointerId)) grid.releasePointerCapture(previous.pointerId);
    if (cancelled) { write(previous.initial); preview(); }
    else if (read().size !== previous.initial.size || [...read()].some(slot => !previous.initial.has(slot))) commit();
    settled();
    setTimeout(() => { suppress = false; }, 0);
  };
  for (const button of buttons) {
    button.onclick = event => {
      if (locked() || blocked(button.dataset.slot) || (suppress && event.detail !== 0)) return;
      const next = new Set(read()); if (next.has(button.dataset.slot)) next.delete(button.dataset.slot); else next.add(button.dataset.slot);
      write(next); focus(button); preview(); commit();
    };

  }
  bindGridKeyboard(grid, columns);
  grid.onpointerdown = event => {
    const button = event.target.closest('[data-slot]');
    if (!button || locked() || event.button !== 0 || blocked(button.dataset.slot) || (event.pointerType === 'touch' && !touch())) return;
    event.preventDefault(); suppress = true;
    gesture = { pointerId: event.pointerId, origin: button.dataset.slot, end: button.dataset.slot, value: !read().has(button.dataset.slot), initial: new Set(read()), x: event.clientX, y: event.clientY };
    grid.setPointerCapture(event.pointerId); focus(button); paint(); frame = requestAnimationFrame(autoScroll);
  };
  grid.onpointermove = event => { if (gesture?.pointerId === event.pointerId) { gesture.x = event.clientX; gesture.y = event.clientY; atPointer(); } };
  grid.onpointerup = event => { if (gesture?.pointerId === event.pointerId) finish(false); };
  grid.onpointercancel = () => finish(true);
  grid.onlostpointercapture = () => { if (gesture) finish(true); };
  return { finish, isPainting: () => Boolean(gesture) };
}
