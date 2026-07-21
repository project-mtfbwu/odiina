begin;

do $$
begin
  if current_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'odiina_migration_requires_postgres_runner';
  end if;
end
$$;

alter table app.profiles
  add column display_name text,
  add column handle text,
  add column handle_normalized text,
  add column bio text not null default '';

update app.profiles
set display_name = 'Odiina member',
    handle = 'member_' || left(pg_catalog.md5(user_id::text), 23),
    handle_normalized = 'member_' || left(pg_catalog.md5(user_id::text), 23);

alter table app.profiles
  alter column display_name set not null,
  alter column handle set not null,
  alter column handle_normalized set not null,
  add constraint profiles_display_name_valid check (
    display_name = btrim(display_name)
    and char_length(display_name) between 1 and 80
  ),
  add constraint profiles_handle_valid check (
    handle ~ '^[a-z][a-z0-9_]{2,29}$'
    and handle = handle_normalized
    and handle_normalized = lower(handle_normalized)
  ),
  add constraint profiles_bio_valid check (char_length(bio) <= 500),
  add constraint profiles_handle_normalized_unique unique (handle_normalized);

grant odiina_provisioner to postgres;
grant create on schema app to odiina_provisioner;
set role odiina_provisioner;
create or replace function app.provision_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  default_handle text := 'member_' || left(pg_catalog.md5(new.id::text), 23);
begin
  insert into app.profiles (
    user_id, display_name, handle, handle_normalized, bio
  ) values (
    new.id, 'Odiina member', default_handle, default_handle, ''
  );
  insert into app.user_preferences (user_id) values (new.id);
  return new;
end
$$;
reset role;
revoke create on schema app from odiina_provisioner;
revoke odiina_provisioner from postgres;

alter table app.attachments
  add column purpose text not null default 'entry'
    check (purpose in ('entry', 'profile_avatar', 'profile_banner')),
  add constraint attachments_owner_id_unique unique (user_id, id);

create table app.profile_media (
  user_id uuid not null references app.profiles(user_id) on delete cascade,
  media_role text not null check (media_role in ('avatar', 'banner')),
  attachment_id uuid not null,
  attached_at timestamptz not null default statement_timestamp(),
  primary key (user_id, media_role),
  constraint profile_media_owned_attachment_fk
    foreign key (user_id, attachment_id)
    references app.attachments(user_id, id)
    on delete cascade,
  constraint profile_media_attachment_unique unique (attachment_id)
);

create index entries_profile_stats_idx
  on app.entries (user_id, lifecycle_state, current_revision_id)
  where lifecycle_state = 'active';

alter table app.profile_media enable row level security;
alter table app.profile_media force row level security;

create policy profiles_owner_api on app.profiles
for all to odiina_owner_api
using (user_id = (select app.request_user_id()))
with check (user_id = (select app.request_user_id()));

create policy profile_media_owner_read on app.profile_media
for select to authenticated
using (user_id = (select app.request_user_id()));

create policy profile_media_owner_api on app.profile_media
for all to odiina_owner_api
using (user_id = (select app.request_user_id()))
with check (user_id = (select app.request_user_id()));

grant select on app.profile_media to authenticated;
grant select, insert, update, delete on app.profile_media to odiina_owner_api;
grant select, update on app.profiles to odiina_owner_api;

create policy owner_profile_display_read on storage.objects
for select to authenticated
using (
  bucket_id = 'odiina-display'
  and exists (
    select 1
    from app.attachment_objects as ao
    join app.attachments as a
      on a.user_id = ao.user_id
      and a.entry_id = ao.entry_id
      and a.id = ao.attachment_id
    join app.profile_media as pm
      on pm.user_id = a.user_id
      and pm.attachment_id = a.id
      and a.purpose = 'profile_' || pm.media_role
    where ao.bucket_id = storage.objects.bucket_id
      and ao.object_key = storage.objects.name
      and ao.variant = 'display'
      and ao.state = 'verified'
      and ao.user_id = app.request_user_id()
      and a.state = 'accepted'
  )
);

create function app.require_entry_media_purpose()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from app.attachments as a
    where a.user_id = new.user_id
      and a.id = new.attachment_id
      and a.purpose = 'entry'
  ) then
    raise exception using errcode = 'P0001', message = 'odiina_entry_media_required';
  end if;
  return new;
end
$$;
revoke all on function app.require_entry_media_purpose() from public, anon;

create trigger entry_revision_attachments_require_entry_purpose
before insert on app.entry_revision_attachments
for each row execute function app.require_entry_media_purpose();

create function app.authorize_profile_image_upload(
  p_media_role text,
  p_original_filename text,
  p_declared_mime text,
  p_expected_byte_count bigint
)
returns table (
  attachment_id uuid,
  object_id uuid,
  bucket_id text,
  object_key text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := app.request_user_id();
  draft_id uuid := extensions.gen_random_uuid();
  created_attachment uuid := extensions.gen_random_uuid();
  created_object uuid := extensions.gen_random_uuid();
  created_key text := extensions.gen_random_uuid()::text || '/' || extensions.gen_random_uuid()::text;
  safe_filename text := nullif(left(btrim(p_original_filename), 180), '');
  attachment_purpose text;
begin
  if actor is null then
    raise exception using errcode = '42501', message = 'odiina_auth_required';
  end if;
  if p_media_role not in ('avatar', 'banner')
    or p_expected_byte_count is null
    or p_expected_byte_count not between 1 and 15728640
    or p_declared_mime not in ('image/jpeg', 'image/png', 'image/webp') then
    raise exception using errcode = 'P0001', message = 'odiina_image_upload_invalid';
  end if;
  attachment_purpose := 'profile_' || p_media_role;
  insert into app.entries (
    id, user_id, lifecycle_state, current_revision_id, finalized_at
  ) values (draft_id, actor, 'draft', null, null);
  insert into app.attachments (
    id, user_id, entry_id, media_kind, purpose, state, original_filename,
    declared_mime, expected_byte_count
  ) values (
    created_attachment, actor, draft_id, 'image', attachment_purpose,
    'pending_upload', safe_filename, p_declared_mime, p_expected_byte_count
  );
  insert into app.attachment_objects (
    id, user_id, entry_id, attachment_id, variant, bucket_id, object_key, state
  ) values (
    created_object, actor, draft_id, created_attachment, 'quarantine',
    'odiina-quarantine', created_key, 'expected'
  );
  return query
  select created_attachment, created_object, 'odiina-quarantine'::text, created_key;
end
$$;

create function app.save_profile(
  p_display_name text,
  p_handle text,
  p_bio text,
  p_avatar_attachment_id uuid,
  p_banner_attachment_id uuid
)
returns table (
  display_name text,
  handle text,
  bio text,
  avatar_attachment_id uuid,
  banner_attachment_id uuid,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := app.request_user_id();
  normalized_name text := btrim(p_display_name);
  normalized_handle text := lower(btrim(p_handle));
  normalized_bio text := coalesce(p_bio, '');
  changed_at timestamptz;
begin
  if actor is null then
    raise exception using errcode = '42501', message = 'odiina_auth_required';
  end if;
  if normalized_name is null
    or char_length(normalized_name) not between 1 and 80
    or normalized_handle !~ '^[a-z][a-z0-9_]{2,29}$'
    or char_length(normalized_bio) > 500 then
    raise exception using errcode = 'P0001', message = 'odiina_profile_invalid';
  end if;
  if normalized_handle = any(array[
    'odiina', 'admin', 'api', 'auth', 'login', 'logout', 'onboarding',
    'feed', 'calendar', 'profile', 'settings', 'trash', 'entries',
    'reviews', 'insights'
  ]) then
    raise exception using errcode = 'P0001', message = 'odiina_handle_unavailable';
  end if;
  if p_avatar_attachment_id is not null and not exists (
    select 1 from app.attachments as a
    where a.id = p_avatar_attachment_id
      and a.user_id = actor
      and a.media_kind = 'image'
      and a.purpose = 'profile_avatar'
      and a.state = 'accepted'
  ) then
    raise exception using errcode = 'P0001', message = 'odiina_profile_media_unready';
  end if;
  if p_banner_attachment_id is not null and not exists (
    select 1 from app.attachments as a
    where a.id = p_banner_attachment_id
      and a.user_id = actor
      and a.media_kind = 'image'
      and a.purpose = 'profile_banner'
      and a.state = 'accepted'
  ) then
    raise exception using errcode = 'P0001', message = 'odiina_profile_media_unready';
  end if;

  begin
    update app.profiles as p
    set display_name = normalized_name,
        handle = normalized_handle,
        handle_normalized = normalized_handle,
        bio = normalized_bio
    where p.user_id = actor
    returning p.updated_at into changed_at;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'odiina_handle_unavailable';
  end;

  delete from app.profile_media as pm
  where pm.user_id = actor
    and (
      (pm.media_role = 'avatar' and p_avatar_attachment_id is null)
      or (pm.media_role = 'banner' and p_banner_attachment_id is null)
    );
  if p_avatar_attachment_id is not null then
    insert into app.profile_media (user_id, media_role, attachment_id)
    values (actor, 'avatar', p_avatar_attachment_id)
    on conflict (user_id, media_role) do update
    set attachment_id = excluded.attachment_id,
        attached_at = statement_timestamp();
  end if;
  if p_banner_attachment_id is not null then
    insert into app.profile_media (user_id, media_role, attachment_id)
    values (actor, 'banner', p_banner_attachment_id)
    on conflict (user_id, media_role) do update
    set attachment_id = excluded.attachment_id,
        attached_at = statement_timestamp();
  end if;

  return query
  select p.display_name, p.handle, p.bio,
    (select pm.attachment_id from app.profile_media as pm
      where pm.user_id = actor and pm.media_role = 'avatar'),
    (select pm.attachment_id from app.profile_media as pm
      where pm.user_id = actor and pm.media_role = 'banner'),
    p.updated_at
  from app.profiles as p
  where p.user_id = actor;
end
$$;

create function app.profile_statistics()
returns table (
  active_entries bigint,
  active_logging_days bigint,
  current_month_entries bigint,
  image_entries bigint,
  edited_entries bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with owner_context as (
    select p.user_id,
      coalesce(up.iana_timezone, 'UTC') as timezone,
      (statement_timestamp() at time zone coalesce(up.iana_timezone, 'UTC'))::date as local_today
    from app.profiles as p
    left join app.user_preferences as up on up.user_id = p.user_id
    where p.user_id = app.request_user_id()
  ), active as (
    select e.id, e.user_id, e.current_revision_id, r.occurred_local_date,
      r.revision_number
    from owner_context as owner
    join app.entries as e
      on e.user_id = owner.user_id and e.lifecycle_state = 'active'
    join app.entry_revisions as r
      on r.user_id = e.user_id and r.entry_id = e.id
      and r.id = e.current_revision_id
  )
  select
    count(active.id)::bigint,
    count(distinct active.occurred_local_date)::bigint,
    count(*) filter (
      where active.occurred_local_date >= date_trunc('month', owner.local_today)::date
        and active.occurred_local_date < (date_trunc('month', owner.local_today) + interval '1 month')::date
    )::bigint,
    count(*) filter (where exists (
      select 1
      from app.entry_revision_attachments as era
      join app.attachments as a
        on a.user_id = era.user_id
        and a.entry_id = era.entry_id
        and a.id = era.attachment_id
      where era.user_id = active.user_id
        and era.entry_id = active.id
        and era.revision_id = active.current_revision_id
        and a.media_kind = 'image'
        and a.purpose = 'entry'
        and a.state = 'accepted'
    ))::bigint,
    count(*) filter (where active.revision_number > 1)::bigint
  from owner_context as owner
  left join active on active.user_id = owner.user_id
  group by owner.user_id, owner.local_today
$$;

create function app.processing_media_purpose(p_attachment_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  worker record;
  result text;
begin
  select * into worker from app.require_active_worker();
  select a.purpose into result
  from app.attachments as a
  where a.id = p_attachment_id;
  if result is null then
    raise exception using errcode = 'P0001', message = 'odiina_attachment_unavailable';
  end if;
  return result;
end
$$;

revoke all on function app.authorize_profile_image_upload(text, text, text, bigint)
  from public, anon;
revoke all on function app.save_profile(text, text, text, uuid, uuid)
  from public, anon;
revoke all on function app.profile_statistics() from public, anon;
revoke all on function app.processing_media_purpose(uuid) from public, anon;
grant execute on function app.authorize_profile_image_upload(text, text, text, bigint)
  to authenticated;
grant execute on function app.save_profile(text, text, text, uuid, uuid)
  to authenticated;
grant execute on function app.profile_statistics() to authenticated;
grant execute on function app.processing_media_purpose(uuid) to authenticated;

grant odiina_owner_api to postgres;
grant create on schema app to odiina_owner_api;
alter function app.authorize_profile_image_upload(text, text, text, bigint)
  owner to odiina_owner_api;
alter function app.save_profile(text, text, text, uuid, uuid)
  owner to odiina_owner_api;
revoke create on schema app from odiina_owner_api;
revoke odiina_owner_api from postgres;

grant odiina_worker_api to postgres;
grant create on schema app to odiina_worker_api;
alter function app.processing_media_purpose(uuid) owner to odiina_worker_api;
revoke create on schema app from odiina_worker_api;
revoke odiina_worker_api from postgres;

comment on column app.attachments.purpose is
  'Authoritative media use. Profile purposes share the certified pipeline but cannot enter Entry revisions.';
comment on table app.profile_media is
  'Current private Profile image pointers. Only accepted owned purpose-matching attachments may be attached by app.save_profile.';
comment on function app.profile_statistics() is
  'Owner-scoped active Entry facts. Trash is excluded; activity periods use current-revision occurrence dates.';

commit;
