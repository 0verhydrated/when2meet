import { buildOverviewModel, overviewCell, overviewFilterLabel } from './availability-overview.js';

const palette = ['#f2f5f1', '#e7f1df', '#cde3ba', '#a3cb8d', '#6f9e60', '#325f3f'];
const time = minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const day = date => new Date(date + 'T00:00:00Z');
const color = (count, total) => palette[count && total ? Math.min(5, Math.ceil(count / total * 5)) : 0];
const filename = title => (title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 80) || 'When2Meet') + '_결과';

function modelFor(data) {
  if (!data.participants.every(person => Array.isArray(person.slots))) throw new Error('결과를 새로고침한 뒤 다시 내려받아 주세요.');
  return buildOverviewModel(data.meeting, data.participants);
}
export function buildWorkbookSheets(data, filter = 'all') {
  const model = modelFor(data), count = model.dates.length + 1;
  const cell = (value, extra = {}) => ({ value, fontFamily: '맑은 고딕', fontSize: 11, height: 22, alignVertical: 'center', ...extra });
  const heading = value => cell(value, { fontWeight: 'bold', backgroundColor: '#325f3f', textColor: '#ffffff', align: 'center', height: 28 });
  const merged = (value, extra = {}) => [cell(value, { columnSpan: count, ...extra }), ...Array(count - 1).fill(null)];
  const overview = [
    merged(data.meeting.title, { fontSize: 18, fontWeight: 'bold', wrap: true, height: Math.max(36, Math.ceil([...data.meeting.title].length * 18 / (count * 100)) * 24 + 8) }),
    merged(`${overviewFilterLabel(model, filter)} / 응답 ${model.total}명 / ${model.people.some(person => person.key === filter) ? '1은 가능, 0은 선택하지 않은 시간이에요.' : '숫자는 가능한 인원이에요.'}`, { height: 26 }),
    [heading('시간'), ...model.dates.map(date => heading(day(date)))],
    ...model.minutes.map(minute => [
      cell(`${time(minute)} ~ ${time(minute + 30)}`, { align: 'center' }),
      ...model.dates.map(date => {
        const { count: amount, total, match } = overviewCell(model, date + '|' + minute, filter);
        return cell(amount, { type: Number, format: '0', align: 'center', backgroundColor: match ? color(amount, total) : '#f2f5f1', textColor: match && amount && Math.ceil(amount / total * 5) === 5 ? '#ffffff' : match ? '#20312b' : '#899389', borderColor: '#dce2dc', borderStyle: 'thin' });
      }),
    ]),
  ];
  for (const dateCell of overview[2].slice(1)) dateCell.format = 'yyyy-mm-dd (ddd)';
  const people = [[heading('참여자'), heading('날짜'), heading('시작'), heading('종료'), heading('상태')]];
  for (const person of model.people) {
    const ranges = [];
    for (const slot of model.slots) if (person.slots.has(slot)) {
      const [date, minuteText] = slot.split('|'), minute = Number(minuteText), previous = ranges.at(-1);
      if (previous?.date === date && previous.end === minute) previous.end += 30;
      else ranges.push({ date, start: minute, end: minute + 30 });
    }
    if (!ranges.length) people.push([cell(person.label, { wrap: true, height: 32 }), null, null, null, cell('선택한 시간이 없어요.')]);
    for (const range of ranges) people.push([cell(person.label, { wrap: true, height: 32 }), cell(day(range.date), { type: Date, format: 'yyyy-mm-dd (ddd)' }), cell(range.start / 1440, { type: Number, format: '[h]:mm' }), cell(range.end / 1440, { type: Number, format: '[h]:mm' }), cell('가능')]);
  }
  return [
    { sheet: '전체 현황', data: overview, columns: [{ width: 21 }, ...model.dates.map(() => ({ width: 21 }))], stickyRowsCount: 3, stickyColumnsCount: 1, showGridLines: false, orientation: 'landscape' },
    { sheet: '참여자 응답', data: people, columns: [{ width: 30 }, { width: 24 }, { width: 13 }, { width: 13 }, { width: 28 }], stickyRowsCount: 1, showGridLines: false },
  ];
}

export async function resultImageBlob(data, filter = 'all') {
  const model = modelFor(data), row = 28, axis = 72, column = 116, top = 148, width = axis * 2 + model.dates.length * column + 32, height = top + model.minutes.length * row + 56;
  await document.fonts.ready;
  const canvas = document.createElement('canvas'); canvas.width = width * 2; canvas.height = height * 2;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('이미지를 만들 수 없어요. 다른 브라우저에서 다시 시도해 주세요.');
  ctx.scale(2, 2); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height);
  const text = (value, x, y, size = 13, weight = 400, ink = '#20312b', align = 'left') => { ctx.font = `${weight} ${size}px system-ui, sans-serif`; ctx.fillStyle = ink; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillText(value, x, y); };
  let title = data.meeting.title;
  ctx.font = '700 22px system-ui, sans-serif';
  while (ctx.measureText(title).width > width - 48) title = [...title].slice(0, -2).join('') + '…';
  text(title, 24, 30, 22, 700);
  text(`${overviewFilterLabel(model, filter)} · 응답 ${model.total}명`, 24, 64, 14);
  text('When2Meet', width - 24, 92, 12, 700, '#325f3f', 'right');
  const x0 = axis + 16;
  for (let index = 0; index < model.dates.length; index++) {
    const x = x0 + index * column + column / 2;
    text(model.dates[index], x, top - 26, 13, 700, '#20312b', 'center');
  }
  for (let i = 0; i <= model.minutes.length; i++) {
    const minute = i < model.minutes.length ? model.minutes[i] : model.minutes.at(-1) + 30, y = top + i * row;
    text(time(minute), x0 - 12, y, 12, 400, '#566459', 'right'); text(time(minute), width - axis, y, 12, 400, '#566459');
  }
  for (let y = 0; y < model.minutes.length; y++) for (let x = 0; x < model.dates.length; x++) {
    const { count: amount, total, match, text: label } = overviewCell(model, model.dates[x] + '|' + model.minutes[y], filter), left = x0 + x * column, upper = top + y * row;
    ctx.fillStyle = match ? color(amount, total) : '#f2f5f1'; ctx.fillRect(left, upper, column, row);
    ctx.strokeStyle = '#d5dfd3'; ctx.lineWidth = 0.5; ctx.strokeRect(left, upper, column, row);
    text(label, left + column / 2, upper + row / 2, 13, 500, match && amount && Math.ceil(amount / total * 5) === 5 ? '#ffffff' : '#20312b', 'center');
  }
  text(model.people.some(person => person.key === filter) ? '✓는 가능, —는 선택하지 않은 시간이에요.' : model.total ? '각 칸은 가능 인원 / 응답 인원이에요.' : '아직 저장된 응답이 없어요.', 24, height - 20, 12, 400, '#566459');
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('이미지를 만들지 못했어요.')), 'image/png'));
}

function download(blob, name) {
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export async function exportMeetingResult(data, filter, format) {
  if (format === 'png') return download(await resultImageBlob(data, filter), filename(data.meeting.title) + '.png');
  const url = new URL('./xlsx-writer.js', import.meta.url); url.search = new URL(import.meta.url).search;
  const { default: writeExcelFile } = await import(url.href);
  const blob = await writeExcelFile(buildWorkbookSheets(data, filter)).toBlob();
  download(blob, filename(data.meeting.title) + '.xlsx');
}
