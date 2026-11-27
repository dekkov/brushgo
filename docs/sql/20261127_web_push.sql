-- Apply after the selfie hearts migration. Scheduling is a separate owner step.
begin;

create table brushy_private.push_preferences (
  user_id uuid references auth.users(id) on delete cascade,
  kind text check (kind in ('reminder', 'request', 'heart')),
  enabled_since timestamptz not null default clock_timestamp(),
  primary key (user_id, kind)
);
create table brushy_private.push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  added_at timestamptz not null default clock_timestamp()
);
create index on brushy_private.push_devices (user_id);
create table brushy_private.recorded_slots (
  user_id uuid references auth.users(id) on delete cascade,
  day date,
  slot text check (slot in ('am', 'pm')),
  primary key (user_id, day, slot)
);

create table brushy_private.push_events (
  id uuid primary key default gen_random_uuid(),
  recipient uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('reminder', 'request', 'heart')),
  dedupe text not null,
  actor uuid references auth.users(id) on delete cascade,
  target uuid,
  revision uuid,
  day date,
  slot text,
  event_at timestamptz not null,
  expires_at timestamptz not null,
  unique (recipient, kind, dedupe)
);
create index on brushy_private.push_events (expires_at);
create index on brushy_private.push_events (actor);
create table brushy_private.push_attempts (
  event_id uuid references brushy_private.push_events(id) on delete cascade,
  device_id uuid references brushy_private.push_devices(id) on delete cascade,
  primary key (event_id, device_id)
);
create index on brushy_private.push_attempts (device_id);

create function brushy_private.record_slot()
returns trigger language plpgsql set search_path = pg_catalog, brushy_private, pg_temp as $$
begin
  insert into brushy_private.recorded_slots values (new.user_id,new.local_date,new.slot)
    on conflict do nothing;
  return new;
end $$;
create trigger record_slot after insert or update of revision on public.brushings
  for each row execute function brushy_private.record_slot();
insert into brushy_private.recorded_slots
  select user_id, local_date, slot from public.brushings on conflict do nothing;

create function brushy_private.push_zone(account uuid, at_time timestamptz)
returns text language sql stable set search_path = pg_catalog, brushy_private, pg_temp as $$
  select coalesce((select case when time_zone_changes_at <= at_time then next_time_zone
    else time_zone end from brushy_private.profiles where id = account), 'UTC')
$$;

-- Seed currently existing hearts as already seen. A removed pre-rollout heart cannot be reconstructed.
alter table brushy_private.selfie_hearts add column hearted_at timestamptz not null default clock_timestamp();
insert into brushy_private.push_events (recipient,kind,dedupe,actor,target,revision,event_at,expires_at)
  select b.user_id,'heart',h.reactor_id || '/' || h.revision,h.reactor_id,b.id,h.revision,h.hearted_at,h.hearted_at
  from brushy_private.selfie_hearts h join public.brushings b on b.id = h.brushing_id;

create function brushy_private.queue_social_push()
returns trigger language plpgsql set search_path = pg_catalog, brushy_private, pg_temp as $$
declare
  occurred timestamptz := clock_timestamp();
  owner_id uuid;
  brushing_day date;
begin
  if tg_table_name = 'requests' then
    if new.status <> 'pending' or not exists (select 1 from brushy_private.push_preferences
      where user_id = new.recipient_id and kind = 'request' and enabled_since <= occurred) then return new; end if;
    select local_date into brushing_day from brushy_private.check_in_slot(
      occurred,brushy_private.push_zone(new.recipient_id,occurred));
    insert into brushy_private.push_events (recipient,kind,dedupe,actor,target,event_at,expires_at)
      values (new.recipient_id,'request',new.sender_id || '/' || brushing_day,new.sender_id,new.id,
        occurred,occurred + interval '24 hours') on conflict do nothing;
  else
    occurred := new.hearted_at;
    select user_id into owner_id from public.brushings where id = new.brushing_id;
    insert into brushy_private.push_events (recipient,kind,dedupe,actor,target,revision,event_at,expires_at)
      values (owner_id,'heart',new.reactor_id || '/' || new.revision,new.reactor_id,new.brushing_id,new.revision,
        occurred,case when exists (select 1 from brushy_private.push_preferences
          where user_id = owner_id and kind = 'heart' and enabled_since <= occurred)
          then occurred + interval '24 hours' else occurred end) on conflict do nothing;
  end if;
  return new;
end $$;
create trigger queue_request_push after insert on brushy_private.requests
  for each row execute function brushy_private.queue_social_push();
create trigger queue_heart_push after insert on brushy_private.selfie_hearts
  for each row execute function brushy_private.queue_social_push();

create function brushy_private.valid_push_endpoint(endpoint text)
returns boolean language sql immutable set search_path = pg_catalog, pg_temp as $$
  select length(endpoint) <= 2048 and endpoint ~
    '^https://(fcm[.]googleapis[.]com|web[.]push[.]apple[.]com|[a-z0-9-]+[.]push[.]apple[.]com|updates[.]push[.]services[.]mozilla[.]com)/[^[:space:]#]+$'
$$;

create function public.brushy_push(p_action text, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, brushy_private, pg_temp as $$
declare
  me uuid := auth.uid();
  sid uuid := (auth.jwt()->>'session_id')::uuid;
  endpoint_value text := p_data->>'endpoint';
  category text := p_data->>'kind';
begin
  if me is null or sid is null or not exists (select 1 from auth.sessions where id = sid and user_id = me) then
    raise exception 'Sign in again to manage notifications';
  end if;
  if p_action in ('status','detach','attach') then
    if p_action = 'attach' then
      perform brushy_private.validate_payload(p_data,array['endpoint','p256dh','auth'],array['endpoint','p256dh','auth']);
      if jsonb_typeof(p_data->'p256dh') <> 'string' or jsonb_typeof(p_data->'auth') <> 'string'
        or p_data->>'p256dh' !~ '^B[A-Za-z0-9_-]{86}$' or p_data->>'auth' !~ '^[A-Za-z0-9_-]{22}$' then
        raise exception 'Invalid push subscription';
      end if;
    else
      perform brushy_private.validate_payload(p_data,array['endpoint'],'{}');
    end if;
    if p_data ? 'endpoint' and (jsonb_typeof(p_data->'endpoint') <> 'string'
      or not brushy_private.valid_push_endpoint(endpoint_value)) then raise exception 'Unsupported push endpoint'; end if;
    if p_action = 'attach' then
      insert into brushy_private.push_devices (user_id,session_id,endpoint,p256dh,auth_key)
        values (me,sid,endpoint_value,p_data->>'p256dh',p_data->>'auth')
        on conflict (endpoint) do update set p256dh = excluded.p256dh, auth_key = excluded.auth_key
        where push_devices.user_id = me and push_devices.session_id = sid;
      if not found then raise exception 'Reset this device subscription before enabling notifications'; end if;
    elsif p_action = 'detach' then
      delete from brushy_private.push_devices where user_id = me and session_id = sid and endpoint = endpoint_value;
    end if;
  elsif p_action = 'set_preference' then
    perform brushy_private.validate_payload(p_data,array['kind','enabled'],array['kind','enabled']);
    if category not in ('reminder','request','heart') or jsonb_typeof(p_data->'enabled') <> 'boolean' then
      raise exception 'Invalid notification preference';
    end if;
    if (p_data->>'enabled')::boolean then
      insert into brushy_private.push_preferences (user_id,kind) values (me,category) on conflict do nothing;
    else
      delete from brushy_private.push_preferences where user_id = me and kind = category;
    end if;
  else
    raise exception 'Unknown notification action';
  end if;
  return jsonb_build_object(
    'attached', exists (select 1 from brushy_private.push_devices
      where user_id = me and session_id = sid and endpoint = endpoint_value),
    'enabled', coalesce((select jsonb_agg(kind order by kind) from brushy_private.push_preferences
      where user_id = me),'[]')
  );
end $$;

create function brushy_private.queue_reminders(at_time timestamptz)
returns void language sql set search_path = pg_catalog, brushy_private, pg_temp as $$
  insert into brushy_private.push_events (recipient,kind,dedupe,day,slot,event_at,expires_at)
  select p.user_id,'reminder',s.local_date || '/' || s.slot,s.local_date,s.slot,w.due,
    least(w.due + interval '30 minutes',w.slot_end)
  from brushy_private.push_preferences p
  cross join lateral (select brushy_private.push_zone(p.user_id,at_time) as zone) z
  cross join lateral brushy_private.check_in_slot(at_time,z.zone) s
  cross join lateral (select
    (s.local_date + case s.slot when 'am' then time '10:00' else time '21:00' end) at time zone z.zone as due,
    (s.local_date + case s.slot when 'am' then interval '14 hours' else interval '29 hours' end)
      at time zone z.zone as slot_end) w
  where p.kind = 'reminder' and p.enabled_since <= w.due
    and at_time >= w.due and at_time <= w.due + interval '15 minutes'
    and exists (select 1 from brushy_private.push_devices d join auth.sessions a on a.id = d.session_id
      and a.user_id = d.user_id where d.user_id = p.user_id and d.added_at <= w.due)
    and not exists (select 1 from brushy_private.recorded_slots r where r.user_id = p.user_id
      and r.day = s.local_date and r.slot = s.slot)
  on conflict do nothing
$$;

create function brushy_private.eligible_push(e brushy_private.push_events, d brushy_private.push_devices, at_time timestamptz)
returns boolean language sql stable set search_path = pg_catalog, brushy_private, pg_temp as $$
  select e.recipient = d.user_id and e.event_at >= d.added_at and e.expires_at > at_time
    and exists (select 1 from auth.sessions s where s.id = d.session_id and s.user_id = d.user_id
      and (s.not_after is null or s.not_after > at_time))
    and exists (select 1 from brushy_private.push_preferences p where p.user_id = e.recipient
      and p.kind = e.kind and p.enabled_since <= e.event_at)
    and case e.kind
      when 'reminder' then at_time <= e.event_at + interval '15 minutes'
        and exists (select 1 from brushy_private.check_in_slot(at_time,brushy_private.push_zone(e.recipient,at_time)) s
          where s.local_date = e.day and s.slot = e.slot)
        and not exists (select 1 from brushy_private.recorded_slots r where r.user_id = e.recipient
          and r.day = e.day and r.slot = e.slot)
      when 'request' then exists (select 1 from brushy_private.requests r where r.id = e.target
        and r.sender_id = e.actor and r.recipient_id = e.recipient and r.status = 'pending'
        and not brushy_private.is_blocked(e.actor,e.recipient)
        and not exists (select 1 from brushy_private.friendships where user_low = least(e.actor,e.recipient)
          and user_high = greatest(e.actor,e.recipient))
        and (select count(*) from brushy_private.friendships where e.recipient in (user_low,user_high)) < 5
        and (select count(*) from brushy_private.friendships where e.actor in (user_low,user_high)) < 5)
      when 'heart' then exists (select 1 from brushy_private.selfie_hearts h
        join public.brushings b on b.id = h.brushing_id and b.revision = h.revision
        where h.brushing_id = e.target and h.revision = e.revision and h.reactor_id = e.actor
          and h.hearted_at = e.event_at
          and b.user_id = e.recipient and brushy_private.can_read(e.actor,b.id))
      else false end
$$;

create function public.brushy_push_work()
returns table (event_id uuid, device_id uuid) language plpgsql security definer
set search_path = pg_catalog, brushy_private, pg_temp as $$
declare t timestamptz := clock_timestamp();
begin
  perform brushy_private.queue_reminders(t);
  delete from brushy_private.push_devices d where not exists (
    select 1 from auth.sessions s where s.id = d.session_id and s.user_id = d.user_id
      and (s.not_after is null or s.not_after > t));
  delete from brushy_private.push_events e where e.expires_at < t - interval '2 days'
    and (e.kind <> 'heart' or not exists (select 1 from public.brushings b
      where b.id = e.target and b.revision = e.revision));
  return query select e.id,d.id from brushy_private.push_events e
    join brushy_private.push_devices d on d.user_id = e.recipient
    where e.expires_at > t and brushy_private.eligible_push(e,d,t)
      and not exists (select 1 from brushy_private.push_attempts a where a.event_id = e.id and a.device_id = d.id)
    order by e.expires_at,e.id,d.id limit 100;
end $$;

create function public.brushy_push_take(p_event uuid,p_device uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, brushy_private, pg_temp as $$
declare
  e brushy_private.push_events;
  d brushy_private.push_devices;
begin
  select * into e from brushy_private.push_events where id = p_event for key share;
  if not found then return null; end if;
  select * into d from brushy_private.push_devices where id = p_device for share;
  if not found or brushy_private.eligible_push(e,d,clock_timestamp()) is not true then return null; end if;
  insert into brushy_private.push_attempts values (p_event,p_device) on conflict do nothing;
  if not found then return null; end if;
  return jsonb_build_object('endpoint',d.endpoint,'p256dh',d.p256dh,'auth',d.auth_key,'kind',e.kind,
    'target',e.target,'revision',e.revision,'expires_at',e.expires_at);
end $$;

create function public.brushy_push_drop(p_device uuid)
returns void language sql security definer set search_path = pg_catalog, brushy_private, pg_temp as $$
  delete from brushy_private.push_devices where id = p_device
$$;

revoke all on all tables in schema brushy_private from public, anon, authenticated;
revoke all on all functions in schema brushy_private from public, anon, authenticated;
revoke all on function public.brushy_push(text,jsonb), public.brushy_push_work(),
  public.brushy_push_take(uuid,uuid), public.brushy_push_drop(uuid) from public, anon, authenticated;
grant execute on function public.brushy_push(text,jsonb) to authenticated;
grant execute on function public.brushy_push_work(), public.brushy_push_take(uuid,uuid),
  public.brushy_push_drop(uuid) to service_role;

commit;
