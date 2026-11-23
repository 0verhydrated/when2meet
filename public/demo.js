const days = ['월', '화', '수', '목', '금', '토', '일'];
const demoGrid = document.querySelector('#demo-grid');
function renderDemo(mode = 'after') {
  if (!demoGrid) return;
  const blocked = { '0-0': '수업', '1-0': '수업', '2-2': '팀 회의', '3-2': '팀 회의', '4-1': '운동', '5-1': '운동', '1-4': '수업', '2-4': '수업' };
  demoGrid.innerHTML = '<div></div>' + days.slice(0, 5).map(day => `<div class="demo-day">${day}</div>`).join('') + Array.from({ length: 6 }, (_, row) => `<div class="demo-time demo-row-${row}">${row + 13}:00</div>` + Array.from({ length: 5 }, (_, col) => { const label = blocked[`${row}-${col}`]; return `<div class="demo-cell demo-row-${row} ${label && mode === 'after' ? 'blocked' : ''}">${label && mode === 'after' && !blocked[`${row - 1}-${col}`] ? label : ''}</div>`; }).join('')).join('');
}
renderDemo();
document.querySelectorAll('[data-demo]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-demo]').forEach(tab => tab.setAttribute('aria-pressed', String(tab === button)));
  renderDemo(button.dataset.demo);
  document.querySelector('#demo-message').textContent = button.dataset.demo === 'after' ? '겹치는 시간은 빼고, 만날 수 있는 시간만 남겨요.' : '등록 전에는 고정 일정과 가능한 시간이 겹칠 수 있어요.';
}));
