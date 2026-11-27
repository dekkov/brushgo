-- Apply after the Friends migration. Existing check-in dates are not rewritten.
begin;

alter table brushy_private.profiles
  add column time_zone_initialized boolean not null default false,
  add column time_zone_effective_at timestamptz,
  add column next_time_zone text,
  add column time_zone_changes_at timestamptz;

update brushy_private.profiles p set time_zone_initialized = true
where p.display_name is not null or exists (
  select 1 from public.brushings b where b.user_id = p.id
);

create function brushy_private.check_in_slot(at_time timestamptz, zone text)
returns table (local_date date, slot text)
language sql stable set search_path = pg_catalog, pg_temp as $$
  select (local_time - interval '5 hours')::date,
    case when local_time::time >= time '05:00' and local_time::time < time '14:00'
      then 'am' else 'pm' end
  from (select at_time at time zone zone as local_time) t
$$;

create or replace function brushy_private.streak(u uuid)
returns integer language sql stable set search_path = pg_catalog, brushy_private, pg_temp as $$
  with recursive complete as (
    select local_date from public.brushings where user_id = u
    group by local_date having count(distinct slot) = 2
  ), today as (
    select local_date d from brushy_private.check_in_slot(current_timestamp, coalesce(
      (select case when time_zone_changes_at <= current_timestamp then next_time_zone
        else time_zone end from brushy_private.profiles where id = u), 'UTC'))
  ), chain(d) as (
    select case when exists(select 1 from complete, today where local_date = today.d)
      then today.d else today.d - 1 end from today
    union all
    select chain.d - 1 from chain where exists(select 1 from complete where local_date = chain.d)
  )
  select count(*)::integer from chain where exists(select 1 from complete where local_date = chain.d)
$$;

-- Keep the existing Friends implementation private so every save uses this gate.
alter function public.brushy_social(text,jsonb) set schema brushy_private;
alter function brushy_private.brushy_social(text,jsonb) rename to social_before_timing;
revoke all on function brushy_private.social_before_timing(text,jsonb) from public, anon, authenticated;

create function public.brushy_social(p_action text, p_data jsonb default '{}')
returns jsonb language plpgsql security definer
set search_path = pg_catalog, brushy_private, pg_temp as $$
declare
  me uuid := auth.uid();
  received_at timestamptz := statement_timestamp();
  timing_at timestamptz;
  proposed_zone text;
  profile brushy_private.profiles%rowtype;
  expected_date date;
  expected_slot text;
begin
  if p_action not in ('timing','schedule_time_zone','profile','save') or p_action is null then
    return brushy_private.social_before_timing(p_action,p_data);
  end if;
  if me is null or not exists (select 1 from auth.users where id = me) then
    raise exception 'Authentication required';
  end if;
  if p_action in ('timing','schedule_time_zone') then
    perform brushy_private.validate_payload(p_data, array['time_zone'], array['time_zone']);
  end if;
  proposed_zone := p_data->>'time_zone';
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = proposed_zone) then
    raise exception 'Invalid time zone';
  end if;
  perform brushy_private.lock_users(me,null);
  timing_at := clock_timestamp();
  select * into profile from brushy_private.profiles where id = me;
  if not profile.time_zone_initialized or profile.time_zone_changes_at <= timing_at then
    update brushy_private.profiles
      set time_zone = coalesce(profile.next_time_zone, proposed_zone),
        time_zone_effective_at = profile.time_zone_changes_at,
        time_zone_initialized = true, next_time_zone = null, time_zone_changes_at = null
      where id = me returning * into profile;
  end if;

  if p_action = 'schedule_time_zone' then
    update brushy_private.profiles
      set next_time_zone = nullif(proposed_zone, profile.time_zone),
        time_zone_changes_at = case when proposed_zone <> profile.time_zone then
          ((date_trunc('day', (timing_at at time zone profile.time_zone) - interval '5 hours')
            + interval '1 day 5 hours') at time zone profile.time_zone) end
      where id = me returning * into profile;
  end if;
  if p_action in ('timing','schedule_time_zone') then
    return jsonb_build_object('server_now',clock_timestamp(),'time_zone',profile.time_zone,
      'next_time_zone',profile.next_time_zone,'changes_at',profile.time_zone_changes_at);
  end if;
  if p_action = 'save' then
    select local_date, slot into expected_date, expected_slot
      from brushy_private.check_in_slot(received_at, profile.time_zone);
    if received_at < profile.time_zone_effective_at
      or p_data->>'local_date' is distinct from expected_date::text
      or p_data->>'slot' is distinct from expected_slot then
      raise exception 'The check-in window changed. Confirm the current slot before saving.';
    end if;
  end if;
  return brushy_private.social_before_timing(
    p_action, jsonb_set(p_data, '{time_zone}', to_jsonb(profile.time_zone)));
end $$;

revoke all on function brushy_private.check_in_slot(timestamptz,text) from public, anon, authenticated;
revoke all on function public.brushy_social(text,jsonb) from public, anon, authenticated;
grant execute on function public.brushy_social(text,jsonb) to authenticated;

commit;
