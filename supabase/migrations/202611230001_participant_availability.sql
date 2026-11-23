-- Expose only submitted meeting availability after applying private fixed exclusions.
begin;

create or replace function public.when2meet_api(p_path text, p_method text, p_payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  profile public.profiles;
  meeting public.meetings;
  item jsonb;
  normalized jsonb := '[]'::jsonb;
  selected jsonb;
  saved_version integer;
  requested_version integer;
  match text[];
  target_id text;
  response_suffix boolean;
  title text;
  first_date date;
  last_date date;
  first_hour integer;
  last_hour integer;
  counts jsonb;
  candidates jsonb;
  participants jsonb;
  mine jsonb;
  total integer;
  result jsonb;
begin
  if actor is null then raise exception '로그인 후 이용해 주세요.' using errcode = '22023'; end if;
  if length(p_payload::text) > 50000 then raise exception '요청 크기를 초과했어요.' using errcode = '22023'; end if;
  select * into strict profile from public.profiles where id = actor;

  if p_path = '/me' and p_method = 'GET' then
    return jsonb_build_object('authenticated', true, 'auth_mode', 'password', 'user', jsonb_build_object('id', actor, 'name', profile.name), 'fixed', profile.fixed_json, 'fixed_version', profile.fixed_version);
  end if;
  if p_path = '/profile' and p_method = 'POST' then
    title := btrim(p_payload->>'name');
    if jsonb_typeof(p_payload->'name') is distinct from 'string' or title is null or length(title) not between 1 and 30 then raise exception '이름을 30자 이내로 입력해 주세요.' using errcode = '22023'; end if;
    update public.profiles set name = title where id = actor;
    return jsonb_build_object('user', jsonb_build_object('id', actor, 'name', title));
  end if;
  if p_path = '/fixed' and p_method = 'PUT' then
    if jsonb_typeof(p_payload->'items') is distinct from 'array' or not coalesce(p_payload->>'version' ~ '^[0-9]{1,9}$', false) then raise exception '고정 일정과 저장 버전을 확인해 주세요.' using errcode = '22023'; end if;
    if jsonb_array_length(p_payload->'items') > 50 then raise exception '고정 일정은 최대 50개까지 등록할 수 있어요.' using errcode = '22023'; end if;
    for item in select value from jsonb_array_elements(p_payload->'items') loop
      if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'name') is distinct from 'string' or coalesce(length(btrim(item->>'name')), 0) not between 1 and 40
        or not coalesce(item->>'weekday' ~ '^[0-6]$', false) or not coalesce(item->>'start' ~ '^[0-9]{1,4}$', false) or not coalesce(item->>'end' ~ '^[0-9]{1,4}$', false) then raise exception '고정 일정의 이름, 요일과 시간을 확인해 주세요.' using errcode = '22023'; end if;
      if (item->>'start')::integer >= (item->>'end')::integer or (item->>'end')::integer > 1440 or (item->>'start')::integer % 30 <> 0 or (item->>'end')::integer % 30 <> 0 then raise exception '고정 일정의 시간을 확인해 주세요.' using errcode = '22023'; end if;
      normalized := normalized || jsonb_build_array(jsonb_build_object('id', coalesce(nullif(left(item->>'id', 80), ''), gen_random_uuid()::text), 'name', btrim(item->>'name'), 'weekday', (item->>'weekday')::integer, 'start', (item->>'start')::integer, 'end', (item->>'end')::integer));
    end loop;
    update public.profiles set fixed_json = normalized, fixed_version = fixed_version + 1 where id = actor and fixed_version = (p_payload->>'version')::integer returning fixed_version into saved_version;
    if saved_version is null then raise exception '다른 창에서 일정이 변경됐어요. 새로고침 후 다시 저장해 주세요.'; end if;
    return jsonb_build_object('fixed', normalized, 'fixed_version', saved_version);
  end if;
  if p_path = '/meetings' and p_method = 'GET' then
    select coalesce(jsonb_agg(row_data order by created_at desc, id desc), '[]'::jsonb) into result from (
      select m.id, m.created_at, to_jsonb(m) || jsonb_build_object('response_count', (select count(*) from public.responses r where r.meeting_id = m.id)) row_data
      from public.meetings m where m.owner_id = actor or exists (select 1 from public.responses r where r.meeting_id = m.id and r.user_id = actor) order by m.created_at desc, m.id desc limit 100
    ) listed;
    return jsonb_build_object('meetings', result);
  end if;
  if p_path = '/meetings' and p_method = 'POST' then
    title := btrim(p_payload->>'title');
    if jsonb_typeof(p_payload->'title') is distinct from 'string' or title is null or length(title) not between 1 and 80 or not coalesce(p_payload->>'start_date' ~ '^\d{4}-\d{2}-\d{2}$', false) or not coalesce(p_payload->>'end_date' ~ '^\d{4}-\d{2}-\d{2}$', false)
      or not coalesce(p_payload->>'start_hour' ~ '^[0-9]{1,2}$', false) or not coalesce(p_payload->>'end_hour' ~ '^[0-9]{1,2}$', false) then raise exception '약속 이름과 날짜, 시간을 확인해 주세요.' using errcode = '22023'; end if;
    first_date := (p_payload->>'start_date')::date; last_date := (p_payload->>'end_date')::date; first_hour := (p_payload->>'start_hour')::integer; last_hour := (p_payload->>'end_hour')::integer;
    if first_date < (now() at time zone 'Asia/Seoul')::date or last_date - first_date not between 0 and 13 or first_hour < 0 or last_hour > 24 or first_hour >= last_hour then raise exception '오늘부터 최대 14일의 날짜와 시간 범위를 선택해 주세요.' using errcode = '22023'; end if;
    target_id := replace(gen_random_uuid()::text, '-', '');
    insert into public.meetings values (target_id, actor, title, first_date, last_date, first_hour, last_hour, now());
    return jsonb_build_object('id', target_id, 'path', '/m/' || target_id);
  end if;
  match := regexp_match(p_path, '^/meetings/([a-f0-9]{32})(/response)?$');
  if match is null then raise exception '요청한 기능을 찾을 수 없어요.' using errcode = '22023'; end if;
  target_id := match[1]; response_suffix := match[2] is not null;
  select m.* into meeting from public.meetings m where m.id = target_id;
  if not found then raise exception '약속 링크를 찾을 수 없어요. 주소를 다시 확인해 주세요.' using errcode = '22023'; end if;
  if response_suffix and p_method = 'PUT' then
    if jsonb_typeof(p_payload->'slots') is distinct from 'array' or not coalesce(p_payload->>'version' ~ '^[0-9]{1,9}$', false) then raise exception '선택한 시간과 저장 버전을 확인해 주세요.' using errcode = '22023'; end if;
    if jsonb_array_length(p_payload->'slots') > (meeting.end_date - meeting.start_date + 1) * (meeting.end_hour - meeting.start_hour) * 2 then raise exception '선택한 시간이 약속 범위를 벗어났어요.' using errcode = '22023'; end if;
    for item in select value from jsonb_array_elements(p_payload->'slots') loop
      if jsonb_typeof(item) <> 'string' or not (item #>> '{}') ~ '^\d{4}-\d{2}-\d{2}\|[0-9]{1,4}$' then raise exception '선택한 시간을 확인해 주세요.' using errcode = '22023'; end if;
      if split_part(item #>> '{}', '|', 1)::date not between meeting.start_date and meeting.end_date or split_part(item #>> '{}', '|', 2)::integer < meeting.start_hour * 60 or split_part(item #>> '{}', '|', 2)::integer >= meeting.end_hour * 60 or split_part(item #>> '{}', '|', 2)::integer % 30 <> 0 then raise exception '선택한 시간이 약속 범위를 벗어났어요.' using errcode = '22023'; end if;
    end loop;
    select * into profile from public.profiles where id = actor for share;
    selected := public.when2meet_effective_slots(p_payload->'slots', profile.fixed_json);
    requested_version := (p_payload->>'version')::integer;
    insert into public.responses as existing (meeting_id, user_id, slots_json) values (meeting.id, actor, selected)
      on conflict (meeting_id, user_id) do update set slots_json = excluded.slots_json, version = existing.version + 1, updated_at = now() where existing.version = requested_version returning version into saved_version;
    if saved_version is null then raise exception '다른 창에서 참여 정보가 바뀌었어요. 새로고침 후 다시 제출해 주세요.'; end if;
    return jsonb_build_object('slots', selected, 'version', saved_version);
  end if;
  if response_suffix or p_method <> 'GET' then raise exception '요청한 기능을 찾을 수 없어요.' using errcode = '22023'; end if;
  select count(*) into total from public.responses r where r.meeting_id = meeting.id;
  select coalesce(jsonb_agg(jsonb_build_object('name', p.name, 'slots', public.when2meet_effective_slots(r.slots_json, p.fixed_json)) order by r.updated_at, r.user_id), '[]'::jsonb) into participants from public.responses r join public.profiles p on p.id = r.user_id where r.meeting_id = meeting.id;
  select jsonb_build_object('slots', r.slots_json, 'version', r.version) into mine from public.responses r where r.meeting_id = meeting.id and r.user_id = actor;
  with availability as (
    select r.user_id, public.when2meet_effective_slots(r.slots_json, p.fixed_json) slots from public.responses r join public.profiles p on p.id = r.user_id where r.meeting_id = meeting.id
  ), timeline as (
    select date_value::date slot_date, minute, date_value::date::text || '|' || minute::text slot from generate_series(meeting.start_date::timestamp, meeting.end_date::timestamp, interval '1 day') date_value cross join generate_series(meeting.start_hour * 60, meeting.end_hour * 60 - 30, 30) minute
  ), cells as (
    select t.*, array(select a.user_id from availability a where a.slots ? t.slot order by a.user_id) members from timeline t
  ), boundaries as (
    select *, case when lag(members) over (partition by slot_date order by minute) is not distinct from members then 0 else 1 end boundary from cells
  ), grouped as (
    select *, sum(boundary) over (partition by slot_date order by minute) segment from boundaries
  ), ranges as (
    select slot_date, min(minute) start_minute, max(minute) + 30 end_minute, cardinality(members) amount from grouped where cardinality(members) > 0 group by slot_date, segment, members
  ) select (select coalesce(jsonb_object_agg(slot, cardinality(members)), '{}'::jsonb) from cells), (select coalesce(jsonb_agg(jsonb_build_object('date', slot_date, 'start', start_minute, 'end', end_minute, 'count', amount) order by amount desc, slot_date, start_minute), '[]'::jsonb) from (select * from ranges order by amount desc, slot_date, start_minute limit 8) ranked) into counts, candidates;
  return jsonb_build_object('meeting', to_jsonb(meeting), 'counts', counts, 'candidates', candidates, 'participants', participants, 'total', total, 'mine', mine);
end;
$$;
revoke all on function public.when2meet_api(text, text, jsonb) from public, anon;
grant execute on function public.when2meet_api(text, text, jsonb) to authenticated;

commit;
