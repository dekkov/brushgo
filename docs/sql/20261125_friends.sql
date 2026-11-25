-- Review and run as the Supabase SQL editor owner, before deploying the app.
-- No extensions, service role keys, or broad friend SELECT policies are needed.
begin;

create schema if not exists brushy_private;
revoke all on schema brushy_private from public, anon, authenticated;

create table brushy_private.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (display_name is null or (display_name = btrim(display_name) and char_length(display_name) between 1 and 40)),
  time_zone text not null default 'UTC',
  last_audience text not null default 'only_me' check (last_audience in ('only_me', 'all_friends', 'selected_friends')),
  selected_friendship_ids uuid[] not null default '{}'
);
create table brushy_private.invites (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  token_hash text not null unique,
  token text not null
);
create table brushy_private.invite_views (
  viewer_id uuid not null references auth.users(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  primary key (viewer_id, owner_id)
);
create table brushy_private.friendships (
  id uuid primary key default gen_random_uuid(),
  user_low uuid not null references auth.users(id) on delete cascade,
  user_high uuid not null references auth.users(id) on delete cascade,
  check (user_low < user_high),
  unique (user_low, user_high)
);
create table brushy_private.requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'ended')),
  attempted_at timestamptz not null default clock_timestamp(),
  check (sender_id <> recipient_id)
);
create unique index brushy_one_pending_pair on brushy_private.requests
  (least(sender_id, recipient_id), greatest(sender_id, recipient_id)) where status = 'pending';
create index brushy_request_attempts on brushy_private.requests (sender_id, attempted_at);
create table brushy_private.blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

alter table public.brushings
  add column audience text not null default 'only_me' check (audience in ('only_me', 'all_friends', 'selected_friends')),
  add column revision uuid not null default gen_random_uuid(),
  add column captured_at timestamptz;
update public.brushings set captured_at = coalesce(created_at, clock_timestamp());
alter table public.brushings alter column captured_at set not null,
  alter column captured_at set default clock_timestamp();
create index brushy_feed_order on public.brushings (captured_at desc, id desc);
create table brushy_private.photo_grants (
  brushing_id uuid not null references public.brushings(id) on delete cascade,
  friendship_id uuid not null references brushy_private.friendships(id) on delete cascade,
  primary key (brushing_id, friendship_id)
);
create index brushy_photo_grants_friendship on brushy_private.photo_grants (friendship_id);
-- Retain used paths even after replacement/deletion: a previous upload is not a new capture.
create table brushy_private.used_photo_paths (
  photo_path text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade
);
insert into brushy_private.used_photo_paths (photo_path, owner_id)
  select distinct on (photo_path) photo_path, user_id from public.brushings
  where photo_path is not null order by photo_path, id;

-- Existing owner-only RLS policies are deliberately unchanged. Column grants must
-- also be revoked: revoking the table grant alone does not remove column grants.
revoke all on public.brushings from public, anon, authenticated;
do $$
declare c text;
begin
  for c in select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'brushings'
  loop
    execute format('revoke select (%I), insert (%I), update (%I), references (%I) on public.brushings from public, anon, authenticated', c, c, c, c);
  end loop;
end $$;
grant select, delete on public.brushings to authenticated;

create function brushy_private.validate_payload(d jsonb, allowed text[], required text[])
returns void language plpgsql set search_path = pg_catalog, brushy_private, pg_temp as $$
begin
  if jsonb_typeof(d) is distinct from 'object' then raise exception 'Payload must be an object'; end if;
  if exists (select 1 from jsonb_object_keys(d) k where not (k = any(allowed))) then
    raise exception 'Unexpected payload field';
  end if;
  if exists (select 1 from unnest(required) k where not (d ? k) or d->k = 'null'::jsonb) then
    raise exception 'Missing required payload field';
  end if;
end $$;

-- Every graph write locks the same stable user rows, in UUID order. Inserting
-- missing rows in that order also avoids a first-use profile insertion deadlock.
create function brushy_private.lock_users(a uuid, b uuid)
returns void language plpgsql set search_path = pg_catalog, brushy_private, pg_temp as $$
declare u uuid;
begin
  for u in select distinct x from unnest(array[a,b]) x where x is not null order by x loop
    insert into brushy_private.profiles(id) values (u) on conflict do nothing;
    perform 1 from brushy_private.profiles where id = u for update;
  end loop;
end $$;

create function brushy_private.is_blocked(a uuid, b uuid)
returns boolean language sql stable set search_path = pg_catalog, brushy_private, pg_temp as $$
  select exists (select 1 from brushy_private.blocks
    where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a))
$$;

create function brushy_private.streak(u uuid)
returns integer language sql stable set search_path = pg_catalog, brushy_private, pg_temp as $$
  with recursive complete as (
    select local_date from public.brushings where user_id = u
    group by local_date having count(distinct slot) = 2
  ), today as (
    select (current_timestamp at time zone coalesce(
      (select time_zone from brushy_private.profiles where id = u), 'UTC'))::date d
  ), chain(d) as (
    select case when exists(select 1 from complete, today where local_date = today.d)
      then today.d else today.d - 1 end from today
    union all
    select chain.d - 1 from chain where exists(select 1 from complete where local_date = chain.d)
  )
  select count(*)::integer from chain where exists(select 1 from complete where local_date = chain.d)
$$;

create function brushy_private.can_read(viewer uuid, brushing uuid)
returns boolean language sql stable set search_path = pg_catalog, brushy_private, pg_temp as $$
  select exists (
    select 1 from public.brushings b where b.id = brushing and (
      b.user_id = viewer or (
        not brushy_private.is_blocked(viewer, b.user_id) and exists (
          select 1 from brushy_private.friendships f
          where f.user_low = least(viewer, b.user_id) and f.user_high = greatest(viewer, b.user_id)
          and (b.audience = 'all_friends' or (b.audience = 'selected_friends' and exists (
            select 1 from brushy_private.photo_grants g where g.brushing_id = b.id and g.friendship_id = f.id
          )))
        )
      )
    )
  )
$$;

create function brushy_private.end_pair(a uuid, b uuid)
returns void language plpgsql set search_path = pg_catalog, brushy_private, pg_temp as $$
declare old_id uuid;
begin
  delete from brushy_private.friendships
    where user_low = least(a,b) and user_high = greatest(a,b) returning id into old_id;
  if old_id is not null then
    update brushy_private.profiles set selected_friendship_ids = array_remove(selected_friendship_ids, old_id)
      where id in (a,b);
  end if;
  update brushy_private.requests set status = 'ended'
    where status = 'pending' and least(sender_id,recipient_id) = least(a,b)
    and greatest(sender_id,recipient_id) = greatest(a,b);
end $$;

create function public.brushy_social(p_action text, p_data jsonb default '{}')
returns jsonb language plpgsql security definer
set search_path = pg_catalog, brushy_private, pg_temp
as $$
declare
  me uuid := auth.uid();
  other uuid;
  fid uuid;
  rid uuid;
  token_value text;
  relation text;
  name_value text;
  zone_value text;
  aud text;
  selected uuid[] := '{}';
  day_value date;
  result jsonb;
  items jsonb;
  next_value jsonb := null;
  req brushy_private.requests%rowtype;
  new_revision uuid;
  cursor_time timestamptz;
  cursor_id uuid;
begin
  if me is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from auth.users where id = me) then raise exception 'Authentication required'; end if;
  if p_action is null or p_action not in
    ('state','profile','reset_invite','preview','request','respond','remove','block','unblock','feed','photo','save') then
    raise exception 'Unknown social action';
  end if;
  if p_action in ('state','reset_invite') then
    perform brushy_private.validate_payload(p_data, '{}', '{}');
  elsif p_action = 'profile' then
    perform brushy_private.validate_payload(p_data, array['display_name','time_zone'], array['display_name','time_zone']);
  elsif p_action in ('preview','request') then
    perform brushy_private.validate_payload(p_data, array['token'], array['token']);
  elsif p_action = 'respond' then
    perform brushy_private.validate_payload(p_data, array['request_id','accept'], array['request_id','accept']);
  elsif p_action = 'remove' then
    perform brushy_private.validate_payload(p_data, array['friendship_id'], array['friendship_id']);
  elsif p_action in ('block','unblock') then
    perform brushy_private.validate_payload(p_data, array['user_id'], array['user_id']);
  elsif p_action = 'feed' then
    perform brushy_private.validate_payload(p_data, array['owner_id','cursor'], '{}');
  elsif p_action = 'photo' then
    perform brushy_private.validate_payload(p_data, array['id','revision'], array['id','revision']);
  elsif p_action = 'save' then
    perform brushy_private.validate_payload(p_data,
      array['local_date','slot','photo_path','verified','confidence','audience','friendship_ids','time_zone'],
      array['local_date','slot','photo_path','verified','confidence','audience','friendship_ids','time_zone']);
  end if;
  -- JSON scalar types matter: never silently coerce strings, booleans, or objects.
  if exists (select 1 from jsonb_each(p_data) e
    where e.key not in ('accept','verified','confidence','friendship_ids','cursor')
    and jsonb_typeof(e.value) <> 'string') then raise exception 'Expected a string field'; end if;
  if p_action not in ('state','profile','save','photo','feed') and not exists (
    select 1 from brushy_private.profiles where id = me and display_name is not null
  ) then raise exception 'Set a display name before using Friends'; end if;

  if p_action = 'profile' then
    name_value := btrim(p_data->>'display_name');
    zone_value := p_data->>'time_zone';
    if char_length(name_value) not between 1 and 40 then raise exception 'Display name must be 1-40 characters'; end if;
    if not exists(select 1 from pg_catalog.pg_timezone_names where name = zone_value) then raise exception 'Invalid time zone'; end if;
    perform brushy_private.lock_users(me, null);
    update brushy_private.profiles set display_name = name_value, time_zone = zone_value where id = me;
    return '{"ok":true}';
  elsif p_action = 'state' then
    select jsonb_build_object(
      'profile', (select case when display_name is null then null else jsonb_build_object(
        'id', id, 'display_name', display_name, 'last_audience', last_audience,
        'selected_friendship_ids', coalesce((select jsonb_agg(s.friendship_id order by s.position)
          from unnest(selected_friendship_ids) with ordinality s(friendship_id,position)
          join brushy_private.friendships f on f.id = s.friendship_id
          where me in (f.user_low,f.user_high) and not brushy_private.is_blocked(f.user_low,f.user_high)), '[]'),
        'time_zone', time_zone) end
        from brushy_private.profiles where id = me),
      'friends', coalesce((select jsonb_agg(jsonb_build_object('friendship_id', f.id,
        'user_id', p.id, 'display_name', p.display_name, 'streak', brushy_private.streak(p.id)) order by f.id)
        from brushy_private.friendships f join brushy_private.profiles p
        on p.id = case when f.user_low = me then f.user_high else f.user_low end
        where me in (f.user_low,f.user_high) and not brushy_private.is_blocked(me,p.id)), '[]'),
      'incoming', coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'user_id',p.id,'display_name',p.display_name) order by r.attempted_at)
        from brushy_private.requests r join brushy_private.profiles p on p.id = r.sender_id
        where r.recipient_id = me and r.status = 'pending'), '[]'),
      'outgoing', coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'user_id',p.id,'display_name',p.display_name) order by r.attempted_at)
        from brushy_private.requests r join brushy_private.profiles p on p.id = r.recipient_id
        where r.sender_id = me and r.status = 'pending'), '[]'),
      'blocked', coalesce((select jsonb_agg(jsonb_build_object('user_id',p.id,'display_name',p.display_name) order by p.id)
        from brushy_private.blocks b join brushy_private.profiles p on p.id = b.blocked_id where b.blocker_id = me), '[]'),
      'invite', (select token from brushy_private.invites where owner_id = me)
    ) into result;
    return result;
  elsif p_action = 'reset_invite' then
    perform brushy_private.lock_users(me,null);
    token_value := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    insert into brushy_private.invites(owner_id,token_hash,token) values(me,md5(token_value),token_value)
      on conflict (owner_id) do update set token_hash = excluded.token_hash, token = excluded.token;
    return jsonb_build_object('token',token_value);
  elsif p_action in ('preview','request') then
    token_value := p_data->>'token';
    if token_value !~ '^[0-9a-f]{64}$' then raise exception 'Invite unavailable'; end if;
    select owner_id into other from brushy_private.invites where token_hash = md5(token_value) and token = token_value;
    if other is null then raise exception 'Invite unavailable'; end if;
    perform brushy_private.lock_users(me,other);
    -- Recheck after the owner lock: a simultaneous reset must invalidate the token.
    if not exists(select 1 from brushy_private.invites where owner_id = other and token = token_value)
      or brushy_private.is_blocked(me,other) then raise exception 'Invite unavailable'; end if;
    insert into brushy_private.invite_views(viewer_id,owner_id) values(me,other) on conflict do nothing;
    relation := case when other = me then 'self'
      when exists(select 1 from brushy_private.friendships where user_low = least(me,other) and user_high = greatest(me,other)) then 'friend'
      when exists(select 1 from brushy_private.requests where sender_id = other and recipient_id = me and status = 'pending') then 'incoming'
      when exists(select 1 from brushy_private.requests where sender_id = me and recipient_id = other and status = 'pending') then 'outgoing'
      else 'none' end;
    if p_action = 'preview' then
      return jsonb_build_object('user_id',other,'display_name',(select display_name from brushy_private.profiles where id = other),'relationship',relation);
    end if;
    if relation = 'self' then raise exception 'Cannot request yourself'; end if;
    if relation = 'friend' then raise exception 'Already friends'; end if;
    if relation in ('incoming','outgoing') then raise exception 'A request is already pending'; end if;
    if (select count(*) from brushy_private.requests where sender_id = me and attempted_at > clock_timestamp() - interval '1 minute') >= 5 then
      raise exception 'Too many requests; try again in a minute';
    end if;
    insert into brushy_private.requests(sender_id,recipient_id) values(me,other) returning id into rid;
    return jsonb_build_object('id',rid);
  elsif p_action = 'respond' then
    if jsonb_typeof(p_data->'accept') <> 'boolean' then raise exception 'Accept must be boolean'; end if;
    rid := (p_data->>'request_id')::uuid;
    select * into req from brushy_private.requests where id = rid and recipient_id = me;
    if not found then raise exception 'Request unavailable'; end if;
    other := req.sender_id;
    perform brushy_private.lock_users(me,other);
    select * into req from brushy_private.requests where id = rid and recipient_id = me and status = 'pending';
    if not found or brushy_private.is_blocked(me,other) then raise exception 'Request unavailable'; end if;
    if (p_data->>'accept')::boolean then
      if (select count(*) from brushy_private.friendships where me in (user_low,user_high)) >= 5
        or (select count(*) from brushy_private.friendships where other in (user_low,user_high)) >= 5 then
        raise exception 'Friend limit reached (maximum 5); request remains pending';
      end if;
      insert into brushy_private.friendships(user_low,user_high) values(least(me,other),greatest(me,other)) returning id into fid;
      update brushy_private.requests set status = 'accepted' where id = rid;
      return jsonb_build_object('friendship_id',fid);
    end if;
    update brushy_private.requests set status = 'declined' where id = rid;
    return '{"ok":true}';
  elsif p_action = 'remove' then
    fid := (p_data->>'friendship_id')::uuid;
    select case when user_low = me then user_high else user_low end into other
      from brushy_private.friendships where id = fid and me in (user_low,user_high);
    if other is null then raise exception 'Friendship unavailable'; end if;
    perform brushy_private.lock_users(me,other);
    if not exists(select 1 from brushy_private.friendships where id = fid) then raise exception 'Friendship unavailable'; end if;
    perform brushy_private.end_pair(me,other);
    return '{"ok":true}';
  elsif p_action in ('block','unblock') then
    other := (p_data->>'user_id')::uuid;
    if p_action = 'unblock' and not exists(select 1 from brushy_private.blocks where blocker_id = me and blocked_id = other) then
      raise exception 'User unavailable';
    end if;
    if other = me or not exists(select 1 from auth.users where id = other) then raise exception 'User unavailable'; end if;
    perform brushy_private.lock_users(me,other);
    if p_action = 'unblock' then
      delete from brushy_private.blocks where blocker_id = me and blocked_id = other;
      return '{"ok":true}';
    end if;
    if not exists(select 1 from brushy_private.friendships where user_low = least(me,other) and user_high = greatest(me,other))
      and not exists(select 1 from brushy_private.requests where status = 'pending' and least(sender_id,recipient_id) = least(me,other) and greatest(sender_id,recipient_id) = greatest(me,other))
      and not exists(select 1 from brushy_private.blocks where blocker_id = me and blocked_id = other)
      and not exists(select 1 from brushy_private.invite_views where viewer_id = me and owner_id = other)
    then raise exception 'User unavailable'; end if;
    insert into brushy_private.blocks(blocker_id,blocked_id) values(me,other) on conflict do nothing;
    perform brushy_private.end_pair(me,other);
    return '{"ok":true}';
  elsif p_action = 'save' then
    if jsonb_typeof(p_data->'verified') <> 'boolean' or jsonb_typeof(p_data->'confidence') <> 'number'
      or jsonb_typeof(p_data->'friendship_ids') <> 'array' then raise exception 'Invalid save field types'; end if;
    if (p_data->>'confidence')::numeric not between 0 and 1 then raise exception 'Confidence must be between 0 and 1'; end if;
    if p_data->>'local_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Invalid local date'; end if;
    day_value := (p_data->>'local_date')::date;
    if day_value::text <> p_data->>'local_date' then raise exception 'Invalid local date'; end if;
    if p_data->>'slot' not in ('am','pm') then raise exception 'Invalid slot'; end if;
    aud := p_data->>'audience';
    if aud not in ('only_me','all_friends','selected_friends') then raise exception 'Invalid audience'; end if;
    zone_value := p_data->>'time_zone';
    if not exists(select 1 from pg_catalog.pg_timezone_names where name = zone_value) then raise exception 'Invalid time zone'; end if;
    if p_data->>'photo_path' !~ ('^s3:' || me::text || '/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}\.jpg$') then
      raise exception 'Invalid owned S3 selfie path';
    end if;
    if exists(select 1 from jsonb_array_elements(p_data->'friendship_ids') x where jsonb_typeof(x) <> 'string') then raise exception 'Friendship IDs must be strings'; end if;
    select coalesce(array_agg(value::uuid),'{}') into selected from jsonb_array_elements_text(p_data->'friendship_ids');
    if cardinality(selected) <> (select count(distinct x) from unnest(selected) x) then raise exception 'Duplicate friendship IDs'; end if;
    -- Saving only locks the owner and never acquires another user lock. Graph
    -- removals/blocks must hold that same owner lock before deleting grants.
    perform brushy_private.lock_users(me,null);
    if aud <> 'only_me' and not exists(select 1 from brushy_private.profiles where id = me and display_name is not null) then
      raise exception 'Set a display name before sharing';
    end if;
    if aud = 'selected_friends' then
      if cardinality(selected) = 0 or cardinality(selected) > 5 then raise exception 'Choose at least one active friend'; end if;
      if exists(select 1 from unnest(selected) x where not exists(
        select 1 from brushy_private.friendships f where f.id = x and me in (f.user_low,f.user_high)
        and not brushy_private.is_blocked(f.user_low,f.user_high))) then raise exception 'Selected friendship unavailable'; end if;
    elsif cardinality(selected) <> 0 then raise exception 'Friendship IDs require selected_friends'; end if;
    if exists(select 1 from brushy_private.used_photo_paths where photo_path = p_data->>'photo_path') then
      raise exception 'Replacement requires a new uploaded photo path';
    end if;
    insert into brushy_private.used_photo_paths(photo_path,owner_id) values(p_data->>'photo_path',me);
    new_revision := gen_random_uuid();
    insert into public.brushings(user_id,local_date,slot,photo_path,verified,confidence,audience,revision,captured_at)
      values(me,day_value,p_data->>'slot',p_data->>'photo_path',(p_data->>'verified')::boolean,
        (p_data->>'confidence')::real,aud,new_revision,clock_timestamp())
      on conflict (user_id,local_date,slot) do update set photo_path = excluded.photo_path,
        verified = excluded.verified, confidence = excluded.confidence, audience = excluded.audience,
        revision = excluded.revision, captured_at = excluded.captured_at
      returning id into rid;
    delete from brushy_private.photo_grants where brushing_id = rid;
    insert into brushy_private.photo_grants(brushing_id,friendship_id) select rid, x from unnest(selected) x;
    update brushy_private.profiles set last_audience = aud, selected_friendship_ids = selected, time_zone = zone_value where id = me;
    return jsonb_build_object('id',rid,'revision',new_revision);
  elsif p_action = 'photo' then
    rid := (p_data->>'id')::uuid;
    select jsonb_build_object('photo_path',b.photo_path,'owner_id',b.user_id) into result from public.brushings b
      where b.id = rid and b.revision = (p_data->>'revision')::uuid and brushy_private.can_read(me,b.id);
    if result is null then raise exception 'Photo unavailable'; end if;
    return result;
  elsif p_action = 'feed' then
    if p_data ? 'owner_id' then
      other := (p_data->>'owner_id')::uuid;
      if other <> me and (brushy_private.is_blocked(me,other) or not exists(select 1 from brushy_private.friendships
        where user_low = least(me,other) and user_high = greatest(me,other))) then raise exception 'Profile unavailable'; end if;
    end if;
    if p_data ? 'cursor' then
      perform brushy_private.validate_payload(p_data->'cursor',array['captured_at','id'],array['captured_at','id']);
      if jsonb_typeof(p_data->'cursor'->'captured_at') <> 'string' or jsonb_typeof(p_data->'cursor'->'id') <> 'string' then
        raise exception 'Invalid cursor';
      end if;
      cursor_time := (p_data->'cursor'->>'captured_at')::timestamptz;
      if not isfinite(cursor_time) then raise exception 'Invalid cursor'; end if;
      cursor_id := (p_data->'cursor'->>'id')::uuid;
    end if;
    select coalesce(jsonb_agg(row_data order by captured_at desc,id desc),'[]') into items from (
      select b.captured_at,b.id,jsonb_build_object('id',b.id,'revision',b.revision,
        'owner_id',b.user_id,'display_name',p.display_name,'streak',brushy_private.streak(b.user_id),
        'local_date',b.local_date,'slot',b.slot,'verified',b.verified,'captured_at',b.captured_at,'audience',b.audience) row_data
      from public.brushings b left join brushy_private.profiles p on p.id = b.user_id
      where (other is null or b.user_id = other) and brushy_private.can_read(me,b.id)
        and (cursor_time is null or (b.captured_at,b.id) < (cursor_time,cursor_id))
      order by b.captured_at desc,b.id desc limit 21
    ) page;
    if jsonb_array_length(items) > 20 then
      items := items - 20;
      next_value := jsonb_build_object('captured_at',items->19->>'captured_at','id',items->19->>'id');
    end if;
    if other is not null then
      -- Authorize the owner aggregate in the same statement/snapshot that reads
      -- it: removal during pagination must not expose a now-unrelated streak.
      select jsonb_build_object('user_id',other,
        'display_name',(select display_name from brushy_private.profiles where id = other),
        'streak',brushy_private.streak(other)) into result
      where other = me or (not brushy_private.is_blocked(me,other) and exists(
        select 1 from brushy_private.friendships where user_low = least(me,other) and user_high = greatest(me,other)));
      if result is null then raise exception 'Profile unavailable'; end if;
    end if;
    return jsonb_build_object('owner',result,'items',items,'next',next_value);
  end if;
  raise exception 'Unknown social action';
end $$;

-- Helpers are invoker functions reachable only inside the SECURITY DEFINER RPC.
-- Explicit ACLs also protect deployments with permissive default privileges.
revoke all on all tables in schema brushy_private from public, anon, authenticated;
revoke all on all functions in schema brushy_private from public, anon, authenticated;
revoke all on function public.brushy_social(text,jsonb) from public, anon, authenticated;
grant execute on function public.brushy_social(text,jsonb) to authenticated;

commit;
