import { XMLParser, XMLValidator } from 'fast-xml-parser';

export class EverytimeError extends Error {}
export function everytimeIdentifier(value) {
  try {
    if (typeof value !== 'string' || value.length > 200) throw new Error();
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.hostname !== 'everytime.kr' || url.port || url.username || url.password || url.search || url.hash || !/^\/@[a-zA-Z0-9]{10,40}$/.test(url.pathname)) throw new Error();
    return url.pathname.slice(2);
  } catch { throw new EverytimeError('에브리타임의 URL 공유 링크를 입력해 주세요. 예: https://everytime.kr/@…'); }
}

export function parseEverytime(xml) {
  if (typeof xml !== 'string' || xml.length > 1000000 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new EverytimeError('시간표 응답 형식을 확인할 수 없어요.');
  if (XMLValidator.validate(xml) !== true) throw new EverytimeError('시간표 응답 형식을 확인할 수 없어요.');
  const doc = new XMLParser({ ignoreAttributes: false, isArray: name => name === 'subject' || name === 'data' }).parse(xml);
  const table = doc.response?.table;
  if (!table || typeof table !== 'object' || Array.isArray(table) || doc.response.error) throw new EverytimeError('공개 시간표를 찾을 수 없어요. 에브리타임에서 공개 범위와 공유 링크를 확인해 주세요.');
  const items = [], seen = new Set();
  let skipped = 0;
  for (const subject of table.subject || []) {
    const name = subject.name?.['@_value']?.trim();
    const times = subject.time?.data || [];
    if (!times.length) { skipped++; continue; }
    if (!name || name.length > 40) throw new EverytimeError('이름이 없거나 40자를 넘는 수업이 있어요. 에브리타임에서 이름을 수정한 뒤 다시 가져와 주세요.');
    for (const time of times) {
      const values = ['day', 'starttime', 'endtime'].map(key => time['@_' + key]);
      if (!values.every(value => /^\d{1,3}$/.test(value || ''))) throw new EverytimeError('일부 수업의 시간을 읽지 못했어요. 시간표를 확인해 주세요.');
      const [weekday, from, to] = values.map(Number);
      if (weekday > 6 || from >= to || to > 288) throw new EverytimeError('일부 수업의 요일이나 시간이 올바르지 않아요.');
      // Everytime uses five-minute units; block every overlapping half hour.
      const start = Math.floor(from / 6) * 30, end = Math.ceil(to / 6) * 30;
      const key = JSON.stringify([name, weekday, start, end]);
      if (!seen.has(key)) { seen.add(key); items.push({ name, weekday, start, end }); }
    }
  }
  if (!items.length) throw new EverytimeError('가져올 수 있는 수업 시간이 없어요. 시간이 없는 수업은 고정 일정으로 등록할 수 없어요.');
  if (items.length > 50) throw new EverytimeError('가져올 일정이 50개를 초과해요. 시간표를 나누어 등록해 주세요.');
  items.sort((a, b) => a.weekday - b.weekday || a.start - b.start || a.end - b.end);
  return { items, skipped, year: table['@_year'] || '', semester: table['@_semester'] || '' };
}

export async function fetchEverytime(value, fetcher = fetch) {
  const identifier = everytimeIdentifier(value);
  try {
    const response = await fetcher('https://api.everytime.kr/find/timetable/table/friend', {
      method: 'POST', body: new URLSearchParams({ identifier, friendInfo: 'false' }),
      headers: { Origin: 'https://everytime.kr', Referer: 'https://everytime.kr/', Accept: 'application/xml' },
      redirect: 'error', signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new EverytimeError('에브리타임에서 시간표를 가져오지 못했어요. 잠시 후 다시 시도해 주세요.');
    if (Number(response.headers.get('content-length')) > 1000000) throw new EverytimeError('시간표 응답이 너무 커요.');
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let size = 0, xml = '';
    try {
      for (;;) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        size += chunk.byteLength;
        if (size > 1000000) throw new EverytimeError('시간표 응답이 너무 커요.');
        xml += decoder.decode(chunk, { stream: true });
      }
      xml += decoder.decode();
    } finally { await reader.cancel(); }
    return parseEverytime(xml);
  } catch (error) {
    if (error instanceof EverytimeError) throw error;
    throw new EverytimeError('에브리타임 연결에 실패했어요. 잠시 후 다시 시도해 주세요.');
  }
}
