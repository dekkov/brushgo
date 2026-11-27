-- Apply after 20261127_check_in_timing.sql.
begin;

alter table public.brushings add unique (id, revision);

create table brushy_private.selfie_hearts (
  brushing_id uuid not null,
  revision uuid not null,
  reactor_id uuid not null references auth.users(id) on delete cascade,
  friendship_id uuid not null references brushy_private.friendships(id) on delete cascade,
  primary key (brushing_id, revision, reactor_id),
  foreign key (brushing_id, revision) references public.brushings(id, revision) on delete cascade
);
create index on brushy_private.selfie_hearts (friendship_id);
create index on brushy_private.selfie_hearts (reactor_id);
revoke all on brushy_private.selfie_hearts from public, anon, authenticated;

create function brushy_private.clear_replaced_hearts()
returns trigger language plpgsql set search_path = pg_catalog, brushy_private, pg_temp as $$
begin
  delete from brushy_private.selfie_hearts where brushing_id = old.id and revision = old.revision;
  return new;
end $$;
create trigger clear_replaced_hearts before update of revision on public.brushings
  for each row when (old.revision is distinct from new.revision)
  execute function brushy_private.clear_replaced_hearts();

create function brushy_private.heart_summary(viewer uuid, brushing uuid, photo_revision uuid)
returns jsonb language sql stable set search_path = pg_catalog, brushy_private, pg_temp as $$
  select jsonb_build_object(
    'names', coalesce(jsonb_agg(p.display_name order by p.display_name, h.reactor_id), '[]'),
    'hearted', coalesce(bool_or(h.reactor_id = viewer), false)
  )
  from brushy_private.selfie_hearts h
  join brushy_private.profiles p on p.id = h.reactor_id
  where h.brushing_id = brushing and h.revision = photo_revision
    and brushy_private.can_read(h.reactor_id, brushing)
$$;

alter function public.brushy_social(text,jsonb) set schema brushy_private;
alter function brushy_private.brushy_social(text,jsonb) rename to social_before_hearts;
revoke all on function brushy_private.social_before_hearts(text,jsonb) from public, anon, authenticated;

create function public.brushy_social(p_action text, p_data jsonb default '{}')
returns jsonb language plpgsql security definer
set search_path = pg_catalog, brushy_private, pg_temp as $$
declare
  me uuid := auth.uid();
  owner_id uuid;
  photo_id uuid;
  photo_revision uuid;
  friendship uuid;
  page jsonb;
  items jsonb;
begin
  if p_action = 'feed' then
    page := brushy_private.social_before_hearts(p_action,p_data);
    select coalesce(jsonb_agg(item || jsonb_build_object(
      'hearts', brushy_private.heart_summary(me,b.id,b.revision)
    ) order by position), '[]') into items
    from jsonb_array_elements(page->'items') with ordinality as i(item,position)
    join public.brushings b on b.id = (item->>'id')::uuid and b.revision = (item->>'revision')::uuid
    where brushy_private.can_read(me,b.id);
    return jsonb_set(page,'{items}',items);
  elsif p_action is distinct from 'set_heart' then
    return brushy_private.social_before_hearts(p_action,p_data);
  end if;

  if me is null or not exists (select 1 from auth.users where id = me) then
    raise exception 'Authentication required';
  end if;
  perform brushy_private.validate_payload(p_data, array['id','revision','hearted'], array['id','revision','hearted']);
  if jsonb_typeof(p_data->'id') <> 'string' or jsonb_typeof(p_data->'revision') <> 'string'
    or jsonb_typeof(p_data->'hearted') <> 'boolean' then
    raise exception 'Invalid heart payload';
  end if;
  photo_id := (p_data->>'id')::uuid;
  photo_revision := (p_data->>'revision')::uuid;
  select b.user_id into owner_id from public.brushings b
    where b.id = photo_id and b.revision = photo_revision and brushy_private.can_read(me,b.id);
  if owner_id is null or owner_id = me then raise exception 'Selfie unavailable for reactions'; end if;
  perform brushy_private.lock_users(me,owner_id);
  perform 1 from public.brushings b
    where b.id = photo_id and b.revision = photo_revision and b.user_id = owner_id
      and brushy_private.can_read(me,b.id) for update;
  if not found then raise exception 'Selfie unavailable for reactions'; end if;
  select f.id into friendship from brushy_private.friendships f
    where f.user_low = least(me,owner_id) and f.user_high = greatest(me,owner_id);
  if (p_data->>'hearted')::boolean then
    insert into brushy_private.selfie_hearts values (photo_id,photo_revision,me,friendship)
      on conflict (brushing_id, revision, reactor_id) do nothing;
  else
    delete from brushy_private.selfie_hearts h
      where h.brushing_id = photo_id and h.revision = photo_revision and h.reactor_id = me;
  end if;
  return brushy_private.heart_summary(me,photo_id,photo_revision);
end $$;

revoke all on function brushy_private.clear_replaced_hearts() from public, anon, authenticated;
revoke all on function brushy_private.heart_summary(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.brushy_social(text,jsonb) from public, anon, authenticated;
grant execute on function public.brushy_social(text,jsonb) to authenticated;

commit;
