begin;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

alter table public.meetings add column if not exists deleted_at timestamptz;
create table if not exists public.meeting_deletion_secrets (
  meeting_id text primary key references public.meetings(id) on delete cascade,
  password_hash text not null,
  failures integer not null default 0,
  reset_at timestamptz not null default now()
);
alter table public.meeting_deletion_secrets enable row level security;
revoke all on public.meeting_deletion_secrets from public, anon, authenticated;

-- Keep the existing scheduling implementation private behind the deletion checks.
do $$ begin
  if to_regprocedure('public.when2meet_api_base(text,text,jsonb)') is null then
    alter function public.when2meet_api(text,text,jsonb) rename to when2meet_api_base;
  end if;
end $$;
revoke all on function public.when2meet_api_base(text,text,jsonb) from public, anon, authenticated;

create or replace function public.when2meet_api(p_path text, p_method text, p_payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  target public.meetings;
  secret public.meeting_deletion_secrets;
  route text[];
  pass text;
  result jsonb;
begin
  if actor is null then raise exception '로그인 후 이용해 주세요.' using errcode = '22023'; end if;
  if length(p_payload::text) > 50000 then raise exception '요청 크기를 초과했어요.' using errcode = '22023'; end if;
  if p_path = '/meetings' and p_method = 'POST' then
    pass := p_payload->>'delete_password';
    if jsonb_typeof(p_payload->'delete_password') is distinct from 'string' or pass is null or length(pass) not between 8 and 128 then
      raise exception '삭제 비밀번호는 8~128자로 입력해 주세요.' using errcode = '22023';
    end if;
    result := public.when2meet_api_base(p_path, p_method, p_payload);
    insert into public.meeting_deletion_secrets (meeting_id, password_hash)
      values (result->>'id', extensions.crypt(encode(extensions.digest(pass, 'sha256'), 'hex'), extensions.gen_salt('bf', 10)));
    return result;
  end if;
  if p_path = '/meetings' and p_method = 'GET' then
    select coalesce(jsonb_agg(row_data order by created_at desc, id desc), '[]'::jsonb) into result from (
      select m.id, m.created_at, to_jsonb(m) - 'deleted_at' || jsonb_build_object(
        'can_delete', m.owner_id = actor,
        'has_delete_password', exists(select 1 from public.meeting_deletion_secrets s where s.meeting_id = m.id),
        'response_count', (select count(*) from public.responses r where r.meeting_id = m.id)) row_data
      from public.meetings m where m.deleted_at is null and (m.owner_id = actor or exists (select 1 from public.responses r where r.meeting_id = m.id and r.user_id = actor))
      order by m.created_at desc, m.id desc limit 100
    ) listed;
    return jsonb_build_object('meetings', result);
  end if;
  route := regexp_match(p_path, '^/meetings/([a-f0-9]{32})(/response|/delete-password)?$');
  if route is not null then
    -- Serialize deletion with edits, and serialize password attempts per meeting.
    select * into target from public.meetings m where m.id = route[1] for update;
    if not found or (target.deleted_at is not null and p_method <> 'DELETE') then
      raise exception '약속 링크를 찾을 수 없어요. 주소를 다시 확인해 주세요.' using errcode = '22023';
    end if;
    if (route[2] is null and p_method = 'DELETE') or (route[2] = '/delete-password' and p_method = 'POST') then
      if target.owner_id <> actor then raise exception '약속을 만든 사람만 삭제할 수 있어요.' using errcode = '22023'; end if;
      pass := p_payload->>'password';
      if jsonb_typeof(p_payload->'password') is distinct from 'string' or pass is null or length(pass) not between 8 and 128 then
        raise exception '삭제 비밀번호는 8~128자로 입력해 주세요.' using errcode = '22023';
      end if;
      select * into secret from public.meeting_deletion_secrets where meeting_id = target.id;
      if route[2] = '/delete-password' then
        if found then raise exception '이미 삭제 비밀번호가 설정돼 있어요.' using errcode = '22023'; end if;
        insert into public.meeting_deletion_secrets (meeting_id, password_hash)
          values (target.id, extensions.crypt(encode(extensions.digest(pass, 'sha256'), 'hex'), extensions.gen_salt('bf', 10)));
        return jsonb_build_object('ok', true);
      end if;
      if not found then raise exception '먼저 삭제 비밀번호를 설정해 주세요.' using errcode = '22023'; end if;
      if secret.failures >= 5 and secret.reset_at > now() then
        return jsonb_build_object('error', '비밀번호 확인 횟수를 초과했어요. 15분 뒤 다시 시도해 주세요.');
      end if;
      if extensions.crypt(encode(extensions.digest(pass, 'sha256'), 'hex'), secret.password_hash) <> secret.password_hash then
        update public.meeting_deletion_secrets set failures = case when reset_at <= now() then 1 else failures + 1 end,
          reset_at = case when reset_at <= now() then now() + interval '15 minutes' else reset_at end where meeting_id = target.id;
        -- Return errors so PostgreSQL commits the failed-attempt counter.
        return jsonb_build_object('error', '삭제 비밀번호를 확인해 주세요.');
      end if;
      update public.meetings set deleted_at = coalesce(deleted_at, now()) where id = target.id;
      return jsonb_build_object('deleted', true);
    end if;
    if route[2] = '/delete-password' then raise exception '요청한 기능을 찾을 수 없어요.' using errcode = '22023'; end if;
    result := public.when2meet_api_base(p_path, p_method, p_payload);
    if route[2] is null and p_method = 'GET' then
      result := jsonb_set(result, '{meeting}', (result->'meeting') - 'deleted_at') || jsonb_build_object(
        'can_delete', target.owner_id = actor,
        'has_delete_password', exists(select 1 from public.meeting_deletion_secrets s where s.meeting_id = target.id));
    end if;
    return result;
  end if;
  return public.when2meet_api_base(p_path, p_method, p_payload);
end;
$$;
revoke all on function public.when2meet_api(text,text,jsonb) from public, anon;
grant execute on function public.when2meet_api(text,text,jsonb) to authenticated;
commit;
