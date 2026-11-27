begin;
create table if not exists public.saved_schedules (
  id text primary key check (id ~ '^[a-f0-9]{32}$'),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 60),
  start_date date not null,
  end_date date not null,
  start_hour integer not null,
  end_hour integer not null,
  slots jsonb not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists saved_schedules_user on public.saved_schedules(user_id,deleted_at);
alter table public.saved_schedules enable row level security;
revoke all on public.saved_schedules from public, anon, authenticated;

create or replace function public.when2meet_api(p_path text, p_method text, p_payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  target public.meetings;
  secret public.meeting_deletion_secrets;
  route text[];
  pass text;
  result jsonb;
  original public.meetings;
  saved_id text;
  item jsonb;
  clean_slots jsonb;
begin
  if actor is null then raise exception '로그인 후 이용해 주세요.' using errcode = '22023'; end if;
  if length(p_payload::text) > 50000 then raise exception '요청 크기를 초과했어요.' using errcode = '22023'; end if;
  if p_path = '/saved-schedules' and p_method = 'GET' then
    select coalesce(jsonb_agg(to_jsonb(s) - 'user_id' - 'deleted_at' order by s.created_at desc, s.id desc), '[]'::jsonb)
      into result from public.saved_schedules s where s.user_id = actor and s.deleted_at is null;
    return jsonb_build_object('schedules', result);
  end if;
  if p_path = '/saved-schedules' and p_method = 'POST' then
    if jsonb_typeof(p_payload->'name') is distinct from 'string' or length(btrim(p_payload->>'name')) not between 1 and 60 then
      raise exception '저장할 일정 이름을 60자 이내로 입력해 주세요.' using errcode = '22023';
    end if;
    select * into original from public.meetings m where m.id = p_payload->>'meeting_id' and m.deleted_at is null for share;
    if not found then raise exception '약속 링크를 찾을 수 없어요.' using errcode = '22023'; end if;
    if jsonb_typeof(p_payload->'slots') is distinct from 'array' then raise exception '저장할 시간을 확인해 주세요.' using errcode = '22023'; end if;
    if jsonb_array_length(p_payload->'slots') > (original.end_date-original.start_date+1)*(original.end_hour-original.start_hour)*2 then
      raise exception '저장할 시간이 약속 범위를 벗어났어요.' using errcode = '22023';
    end if;
    for item in select value from jsonb_array_elements(p_payload->'slots') loop
      if jsonb_typeof(item) <> 'string' or not (item #>> '{}') ~ '^\d{4}-\d{2}-\d{2}\|[0-9]{1,4}$' then
        raise exception '저장할 시간을 확인해 주세요.' using errcode = '22023';
      end if;
      if split_part(item #>> '{}','|',1)::date not between original.start_date and original.end_date
        or split_part(item #>> '{}','|',2)::integer < original.start_hour*60
        or split_part(item #>> '{}','|',2)::integer >= original.end_hour*60
        or split_part(item #>> '{}','|',2)::integer % 30 <> 0 then
        raise exception '저장할 시간이 약속 범위를 벗어났어요.' using errcode = '22023';
      end if;
    end loop;
    perform 1 from public.profiles where id=actor for update;
    if (select count(*) from public.saved_schedules where user_id=actor and deleted_at is null) >= 30 then
      raise exception '일정은 최대 30개까지 저장할 수 있어요. 사용하지 않는 일정을 지워 주세요.' using errcode = '22023';
    end if;
    select public.when2meet_effective_slots(p_payload->'slots', fixed_json) into clean_slots from public.profiles where id=actor;
    saved_id := replace(gen_random_uuid()::text,'-','');
    insert into public.saved_schedules(id,user_id,name,start_date,end_date,start_hour,end_hour,slots)
      values(saved_id,actor,btrim(p_payload->>'name'),original.start_date,original.end_date,original.start_hour,original.end_hour,clean_slots);
    return jsonb_build_object('id',saved_id);
  end if;
  route := regexp_match(p_path, '^/saved-schedules/([a-f0-9]{32})$');
  if route is not null and p_method='DELETE' then
    update public.saved_schedules set deleted_at=now() where id=route[1] and user_id=actor and deleted_at is null returning id into saved_id;
    if not found then raise exception '저장한 일정을 찾을 수 없어요.' using errcode = '22023'; end if;
    return jsonb_build_object('deleted',true);
  end if;
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
