import { createClient } from '@supabase/supabase-js';

const client = createClient(__SUPABASE_URL__, __SUPABASE_KEY__, { auth: { detectSessionInUrl: false, flowType: 'pkce' } });
export async function requestApi(path, options = {}) {
  const payload = options.body ? JSON.parse(options.body) : {};
  if (path === '/auth/register') {
    const { data, error } = await client.auth.signUp({ email: payload.email.trim(), password: payload.password, options: { data: { name: payload.name.trim() } } });
    if (error) throw new Error(error.message);
    if (!data.session) throw new Error('가입은 접수됐지만 이메일 확인 설정이 켜져 있습니다. 관리자에게 문의해 주세요.');
    return { ok: true };
  }
  if (path === '/auth/login') {
    const { error } = await client.auth.signInWithPassword({ email: payload.email.trim(), password: payload.password });
    if (error) throw new Error('이메일 또는 비밀번호를 확인해 주세요.');
    return { ok: true };
  }
  if (path === '/auth/logout') {
    const { error } = await client.auth.signOut({ scope: 'local' });
    if (error) throw new Error('로그아웃하지 못했습니다. 다시 시도해 주세요.');
    return { ok: true };
  }
  const { data: identity, error: identityError } = await client.auth.getUser();
  if (identityError || !identity.user) {
    if (path === '/me') return { authenticated: false, auth_mode: 'password', user: null, fixed: [], fixed_version: 0 };
    throw new Error('로그인 후 이용해 주세요.');
  }
  const { data, error } = await client.rpc('when2meet_api', { p_path: path, p_method: options.method || 'GET', p_payload: payload });
  if (error) throw new Error(error.code === 'P0001' || error.code === '22023' ? error.message : '요청을 처리하지 못했어요. 다시 시도해 주세요.');
  if (path === '/me') return { ...data, user: { ...data.user, email: identity.user.email } };
  return data;
}
