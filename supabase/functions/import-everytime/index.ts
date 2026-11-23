import { fetchEverytime, EverytimeError } from '../../../worker/everytime.js';

const headers = {
  'Access-Control-Allow-Origin': 'https://0verhydrated.github.io',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers });
Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return json({ error: '지원하지 않는 요청이에요.' }, 405);
  try {
    const authorization = request.headers.get('Authorization') || '';
    if (!authorization.startsWith('Bearer ')) return json({ error: '로그인 후 이용해 주세요.' }, 401);
    const identity = await fetch(Deno.env.get('SUPABASE_URL') + '/auth/v1/user', {
      headers: { Authorization: authorization, apikey: Deno.env.get('SUPABASE_ANON_KEY')! },
      signal: AbortSignal.timeout(5000),
    });
    if (!identity.ok) return json({ error: '다시 로그인한 뒤 이용해 주세요.' }, 401);
    if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: '요청 형식을 확인해 주세요.' }, 415);
    // Small bounded request body, including requests without Content-Length.
    const reader = request.body?.getReader();
    if (!reader) return json({ error: '공유 링크를 입력해 주세요.' }, 400);
    let raw = '';
    const decoder = new TextDecoder();
    try {
      for (;;) { const { value, done } = await reader.read(); if (done) break; raw += decoder.decode(value, { stream: true }); if (raw.length > 2000) return json({ error: '요청이 너무 커요.' }, 413); }
      raw += decoder.decode();
    } finally { await reader.cancel(); }
    let payload;
    try { payload = JSON.parse(raw); } catch { return json({ error: '공유 링크를 확인해 주세요.' }, 400); }
    return json(await fetchEverytime(payload?.url));
  } catch (error) {
    return json({ error: error instanceof EverytimeError ? error.message : '시간표를 가져오지 못했어요. 다시 시도해 주세요.' }, error instanceof EverytimeError ? 400 : 502);
  }
});
