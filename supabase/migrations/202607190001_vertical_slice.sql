begin;

create schema if not exists app;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'odiina_owner_api') then
    create role odiina_owner_api nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'odiina_provisioner') then
    create role odiina_provisioner nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
end
$$;

do $$
begin
  if current_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'odiina_migration_requires_postgres_runner';
  end if;
end
$$;

revoke all on schema app from public, anon;
grant usage on schema app to authenticated, service_role, odiina_owner_api, odiina_provisioner;
grant usage on schema extensions to odiina_owner_api;

create table app.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  account_state text not null default 'active'
    check (account_state in ('active', 'suspended', 'closed')),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);

create table app.user_preferences (
  user_id uuid primary key references app.profiles(user_id) on delete cascade,
  locale text not null default 'en' check (char_length(locale) between 2 and 35),
  iana_timezone text null check (
    iana_timezone is null or char_length(iana_timezone) between 1 and 255
  ),
  week_starts_on smallint not null default 1 check (week_starts_on between 0 and 6),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);

create table app.entries (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references app.profiles(user_id) on delete cascade,
  current_revision_id uuid null,
  lifecycle_state text not null default 'active'
    check (lifecycle_state in ('active', 'trashed')),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  finalized_at timestamptz not null default statement_timestamp(),
  trashed_at timestamptz null,
  purge_after timestamptz null,
  constraint entries_owner_id_unique unique (user_id, id),
  constraint entries_trash_state_consistent check (
    (
      lifecycle_state = 'active'
      and trashed_at is null
      and purge_after is null
    )
    or
    (
      lifecycle_state = 'trashed'
      and trashed_at is not null
      and purge_after is not null
      and purge_after >= trashed_at
    )
  )
);

create table app.entry_revisions (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null,
  entry_id uuid not null,
  revision_number integer not null check (revision_number > 0),
  body_text text not null check (char_length(body_text) <= 100000),
  occurred_at timestamptz not null,
  occurred_timezone text not null check (char_length(occurred_timezone) between 1 and 255),
  occurred_local_date date not null,
  occurred_utc_offset_minutes smallint not null
    check (occurred_utc_offset_minutes between -840 and 840),
  change_reason text not null
    check (change_reason in ('created', 'edited', 'occurrence_corrected')),
  created_at timestamptz not null default statement_timestamp(),
  constraint entry_revisions_owner_entry_fk
    foreign key (user_id, entry_id)
    references app.entries(user_id, id)
    on delete restrict,
  constraint entry_revisions_owner_entry_id_unique unique (user_id, entry_id, id),
  constraint entry_revisions_number_unique unique (user_id, entry_id, revision_number)
);

alter table app.entries
  add constraint entries_current_revision_fk
  foreign key (user_id, id, current_revision_id)
  references app.entry_revisions(user_id, entry_id, id)
  on delete restrict
  deferrable initially deferred;

create table app.entry_command_receipts (
  user_id uuid not null references app.profiles(user_id) on delete cascade,
  command_kind text not null check (command_kind = 'create_entry'),
  client_request_id uuid not null,
  request_hash bytea not null,
  entry_id uuid not null,
  revision_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  primary key (user_id, command_kind, client_request_id),
  constraint entry_command_receipts_entry_fk
    foreign key (user_id, entry_id)
    references app.entries(user_id, id)
    on delete restrict,
  constraint entry_command_receipts_revision_fk
    foreign key (user_id, entry_id, revision_id)
    references app.entry_revisions(user_id, entry_id, id)
    on delete restrict
);

create index entries_feed_active_idx
  on app.entries (user_id, lifecycle_state, id desc)
  where lifecycle_state = 'active';
create index entries_trash_idx
  on app.entries (user_id, purge_after desc, id desc)
  where lifecycle_state = 'trashed';
create index entry_revisions_history_idx
  on app.entry_revisions (user_id, entry_id, revision_number desc);
create index entry_revisions_feed_occurrence_idx
  on app.entry_revisions (user_id, occurred_at desc, entry_id desc);

create function app.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := statement_timestamp();
  return new;
end
$$;
revoke all on function app.set_updated_at() from public, anon;

create trigger profiles_set_updated_at
before update on app.profiles
for each row execute function app.set_updated_at();

create trigger preferences_set_updated_at
before update on app.user_preferences
for each row execute function app.set_updated_at();

create trigger entries_set_updated_at
before update on app.entries
for each row execute function app.set_updated_at();

create function app.reject_revision_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using errcode = 'P0001', message = 'odiina_revision_immutable';
end
$$;
revoke all on function app.reject_revision_mutation() from public, anon;

create trigger entry_revisions_are_immutable
before update or delete on app.entry_revisions
for each row execute function app.reject_revision_mutation();

create function app.require_committed_current_revision()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from app.entries as e
    where e.user_id = new.user_id
      and e.id = new.id
      and e.current_revision_id is not null
  ) then
    raise exception using errcode = 'P0001', message = 'odiina_current_revision_required';
  end if;
  return null;
end
$$;
revoke all on function app.require_committed_current_revision() from public, anon;

create constraint trigger entries_require_current_revision
after insert or update of current_revision_id on app.entries
deferrable initially deferred
for each row execute function app.require_committed_current_revision();

-- Supabase auth.uid() reads this same request-scoped claim. Keeping the
-- equivalent security-invoker helper in app avoids granting custom function
-- owners access to the protected auth schema.
create function app.request_user_id()
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claim.sub', true), ''),
    nullif(
      pg_catalog.current_setting('request.jwt.claims', true),
      ''
    )::jsonb ->> 'sub'
  )::uuid
$$;
revoke all on function app.request_user_id() from public, anon;
grant execute on function app.request_user_id()
  to authenticated, odiina_owner_api;

alter table app.profiles enable row level security;
alter table app.profiles force row level security;
alter table app.user_preferences enable row level security;
alter table app.user_preferences force row level security;
alter table app.entries enable row level security;
alter table app.entries force row level security;
alter table app.entry_revisions enable row level security;
alter table app.entry_revisions force row level security;
alter table app.entry_command_receipts enable row level security;
alter table app.entry_command_receipts force row level security;

create policy profiles_owner_read on app.profiles
for select to authenticated
using (user_id = (select app.request_user_id()));
create policy preferences_owner_read on app.user_preferences
for select to authenticated
using (user_id = (select app.request_user_id()));
create policy entries_owner_read on app.entries
for select to authenticated
using (user_id = (select app.request_user_id()));
create policy revisions_owner_read on app.entry_revisions
for select to authenticated
using (user_id = (select app.request_user_id()));

create policy preferences_function_owner on app.user_preferences
for all to odiina_owner_api
using (user_id = (select app.request_user_id()))
with check (user_id = (select app.request_user_id()));
create policy entries_function_owner on app.entries
for all to odiina_owner_api
using (user_id = (select app.request_user_id()))
with check (user_id = (select app.request_user_id()));
create policy revisions_function_owner on app.entry_revisions
for all to odiina_owner_api
using (user_id = (select app.request_user_id()))
with check (user_id = (select app.request_user_id()));
create policy receipts_function_owner on app.entry_command_receipts
for all to odiina_owner_api
using (user_id = (select app.request_user_id()))
with check (user_id = (select app.request_user_id()));

create policy profiles_provision_insert on app.profiles
for insert to odiina_provisioner
with check (true);
create policy preferences_provision_insert on app.user_preferences
for insert to odiina_provisioner
with check (true);

grant select on app.profiles, app.user_preferences, app.entries, app.entry_revisions
  to authenticated;
grant select on app.profiles, app.user_preferences, app.entries, app.entry_revisions,
  app.entry_command_receipts to service_role;
grant select, update on app.user_preferences to odiina_owner_api;
grant select, insert, update on app.entries to odiina_owner_api;
grant select, insert on app.entry_revisions, app.entry_command_receipts
  to odiina_owner_api;
grant insert on app.profiles, app.user_preferences to odiina_provisioner;

create function app.provision_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into app.profiles (user_id) values (new.id);
  insert into app.user_preferences (user_id) values (new.id);
  return new;
end
$$;
revoke all on function app.provision_account() from public, anon, authenticated;

create trigger provision_odiina_account
after insert on auth.users
for each row execute function app.provision_account();

grant odiina_provisioner to postgres;
grant create on schema app to odiina_provisioner;
alter function app.provision_account() owner to odiina_provisioner;
revoke create on schema app from odiina_provisioner;
revoke odiina_provisioner from postgres;

create function app.assert_occurrence(
  p_occurred_at timestamptz,
  p_timezone text,
  p_local_date date,
  p_utc_offset_minutes smallint
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  computed_offset integer;
begin
  if p_occurred_at is null
    or p_timezone is null
    or p_local_date is null
    or p_utc_offset_minutes is null
    or not exists (
    select 1 from pg_catalog.pg_timezone_names where name = p_timezone
  ) then
    raise exception using errcode = 'P0001', message = 'odiina_occurrence_invalid';
  end if;

  if (p_occurred_at at time zone p_timezone)::date <> p_local_date then
    raise exception using errcode = 'P0001', message = 'odiina_occurrence_invalid';
  end if;

  computed_offset := round(
    extract(
      epoch from (
        (p_occurred_at at time zone p_timezone)
        - (p_occurred_at at time zone 'UTC')
      )
    ) / 60
  );
  if computed_offset <> p_utc_offset_minutes then
    raise exception using errcode = 'P0001', message = 'odiina_occurrence_invalid';
  end if;
end
$$;

create function app.create_entry(
  p_client_request_id uuid,
  p_body_text text,
  p_occurred_at timestamptz,
  p_occurred_timezone text,
  p_occurred_local_date date,
  p_occurred_utc_offset_minutes smallint
)
returns table (entry_id uuid, revision_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := app.request_user_id();
  normalized_body text := btrim(p_body_text);
  canonical_hash bytea;
  receipt app.entry_command_receipts%rowtype;
  created_entry_id uuid := extensions.gen_random_uuid();
  created_revision_id uuid := extensions.gen_random_uuid();
begin
  if actor is null then
    raise exception using errcode = 'P0001', message = 'odiina_auth_required';
  end if;
  if p_client_request_id is null
    or normalized_body is null
    or char_length(normalized_body) not between 1 and 100000 then
    raise exception using errcode = 'P0001', message = 'odiina_entry_invalid';
  end if;

  perform app.assert_occurrence(
    p_occurred_at,
    p_occurred_timezone,
    p_occurred_local_date,
    p_occurred_utc_offset_minutes
  );

  canonical_hash := extensions.digest(
    convert_to(
      jsonb_build_object(
        'body_text', normalized_body,
        'occurred_at', p_occurred_at,
        'occurred_timezone', p_occurred_timezone,
        'occurred_local_date', p_occurred_local_date,
        'occurred_utc_offset_minutes', p_occurred_utc_offset_minutes
      )::text,
      'UTF8'
    ),
    'sha256'
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor::text || ':' || p_client_request_id::text, 0)
  );

  select r.* into receipt
  from app.entry_command_receipts as r
  where r.user_id = actor
    and r.command_kind = 'create_entry'
    and r.client_request_id = p_client_request_id;

  if found then
    if receipt.request_hash <> canonical_hash then
      raise exception using errcode = 'P0001', message = 'odiina_idempotency_conflict';
    end if;
    return query select receipt.entry_id, receipt.revision_id;
    return;
  end if;

  insert into app.entries (id, user_id)
  values (created_entry_id, actor);

  insert into app.entry_revisions (
    id,
    user_id,
    entry_id,
    revision_number,
    body_text,
    occurred_at,
    occurred_timezone,
    occurred_local_date,
    occurred_utc_offset_minutes,
    change_reason
  )
  values (
    created_revision_id,
    actor,
    created_entry_id,
    1,
    normalized_body,
    p_occurred_at,
    p_occurred_timezone,
    p_occurred_local_date,
    p_occurred_utc_offset_minutes,
    'created'
  );

  update app.entries
  set current_revision_id = created_revision_id
  where id = created_entry_id and user_id = actor;

  insert into app.entry_command_receipts (
    user_id,
    command_kind,
    client_request_id,
    request_hash,
    entry_id,
    revision_id
  )
  values (
    actor,
    'create_entry',
    p_client_request_id,
    canonical_hash,
    created_entry_id,
    created_revision_id
  );

  return query select created_entry_id, created_revision_id;
end
$$;
revoke all on function app.create_entry(uuid, text, timestamptz, text, date, smallint)
  from public, anon;
grant execute on function app.create_entry(uuid, text, timestamptz, text, date, smallint)
  to authenticated;
grant odiina_owner_api to postgres;
grant create on schema app to odiina_owner_api;
alter function app.create_entry(uuid, text, timestamptz, text, date, smallint)
  owner to odiina_owner_api;
revoke create on schema app from odiina_owner_api;
revoke odiina_owner_api from postgres;

create function app.revise_entry(
  p_entry_id uuid,
  p_expected_current_revision_id uuid,
  p_body_text text,
  p_occurred_at timestamptz,
  p_occurred_timezone text,
  p_occurred_local_date date,
  p_occurred_utc_offset_minutes smallint,
  p_change_reason text
)
returns table (entry_id uuid, revision_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := app.request_user_id();
  normalized_body text := btrim(p_body_text);
  locked_entry app.entries%rowtype;
  next_revision integer;
  created_revision_id uuid := extensions.gen_random_uuid();
begin
  if actor is null then
    raise exception using errcode = 'P0001', message = 'odiina_auth_required';
  end if;
  if p_entry_id is null
    or p_expected_current_revision_id is null
    or normalized_body is null
    or char_length(normalized_body) not between 1 and 100000
    or p_change_reason is null
    or p_change_reason not in ('edited', 'occurrence_corrected') then
    raise exception using errcode = 'P0001', message = 'odiina_entry_invalid';
  end if;
  perform app.assert_occurrence(
    p_occurred_at,
    p_occurred_timezone,
    p_occurred_local_date,
    p_occurred_utc_offset_minutes
  );

  select e.* into locked_entry
  from app.entries as e
  where e.id = p_entry_id and e.user_id = actor
  for update;

  if not found or locked_entry.lifecycle_state <> 'active' then
    raise exception using errcode = 'P0001', message = 'odiina_entry_unavailable';
  end if;
  if locked_entry.current_revision_id <> p_expected_current_revision_id then
    raise exception using errcode = 'P0001', message = 'odiina_revision_conflict';
  end if;

  select coalesce(max(r.revision_number), 0) + 1 into next_revision
  from app.entry_revisions as r
  where r.user_id = actor and r.entry_id = p_entry_id;

  insert into app.entry_revisions (
    id,
    user_id,
    entry_id,
    revision_number,
    body_text,
    occurred_at,
    occurred_timezone,
    occurred_local_date,
    occurred_utc_offset_minutes,
    change_reason
  )
  values (
    created_revision_id,
    actor,
    p_entry_id,
    next_revision,
    normalized_body,
    p_occurred_at,
    p_occurred_timezone,
    p_occurred_local_date,
    p_occurred_utc_offset_minutes,
    p_change_reason
  );

  update app.entries
  set current_revision_id = created_revision_id
  where id = p_entry_id and user_id = actor;

  return query select p_entry_id, created_revision_id;
end
$$;
revoke all on function app.revise_entry(uuid, uuid, text, timestamptz, text, date, smallint, text)
  from public, anon;
grant execute on function app.revise_entry(uuid, uuid, text, timestamptz, text, date, smallint, text)
  to authenticated;
grant odiina_owner_api to postgres;
grant create on schema app to odiina_owner_api;
alter function app.revise_entry(uuid, uuid, text, timestamptz, text, date, smallint, text)
  owner to odiina_owner_api;
revoke create on schema app from odiina_owner_api;
revoke odiina_owner_api from postgres;

create function app.trash_entry(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := app.request_user_id();
begin
  if actor is null then
    raise exception using errcode = 'P0001', message = 'odiina_auth_required';
  end if;
  update app.entries
  set lifecycle_state = 'trashed',
      trashed_at = statement_timestamp(),
      purge_after = statement_timestamp() + interval '30 days'
  where id = p_entry_id
    and user_id = actor
    and lifecycle_state = 'active';
  if not found then
    raise exception using errcode = 'P0001', message = 'odiina_entry_unavailable';
  end if;
end
$$;
revoke all on function app.trash_entry(uuid) from public, anon;
grant execute on function app.trash_entry(uuid) to authenticated;
grant odiina_owner_api to postgres;
grant create on schema app to odiina_owner_api;
alter function app.trash_entry(uuid) owner to odiina_owner_api;
revoke create on schema app from odiina_owner_api;
revoke odiina_owner_api from postgres;

create function app.restore_entry(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := app.request_user_id();
begin
  if actor is null then
    raise exception using errcode = 'P0001', message = 'odiina_auth_required';
  end if;
  update app.entries
  set lifecycle_state = 'active',
      trashed_at = null,
      purge_after = null
  where id = p_entry_id
    and user_id = actor
    and lifecycle_state = 'trashed'
    and purge_after > statement_timestamp();
  if not found then
    raise exception using errcode = 'P0001', message = 'odiina_entry_unavailable';
  end if;
end
$$;
revoke all on function app.restore_entry(uuid) from public, anon;
grant execute on function app.restore_entry(uuid) to authenticated;
grant odiina_owner_api to postgres;
grant create on schema app to odiina_owner_api;
alter function app.restore_entry(uuid) owner to odiina_owner_api;
revoke create on schema app from odiina_owner_api;
revoke odiina_owner_api from postgres;

create function app.save_preferences(
  p_iana_timezone text,
  p_week_starts_on smallint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := app.request_user_id();
begin
  if actor is null then
    raise exception using errcode = 'P0001', message = 'odiina_auth_required';
  end if;
  if p_iana_timezone is null
    or p_week_starts_on is null
    or p_week_starts_on not between 0 and 6
    or not exists (
    select 1 from pg_catalog.pg_timezone_names where name = p_iana_timezone
  ) then
    raise exception using errcode = 'P0001', message = 'odiina_preferences_invalid';
  end if;
  update app.user_preferences
  set iana_timezone = p_iana_timezone,
      week_starts_on = p_week_starts_on
  where user_id = actor;
  if not found then
    raise exception using errcode = 'P0001', message = 'odiina_preferences_unavailable';
  end if;
end
$$;
revoke all on function app.save_preferences(text, smallint) from public, anon;
grant execute on function app.save_preferences(text, smallint) to authenticated;
grant odiina_owner_api to postgres;
grant create on schema app to odiina_owner_api;
alter function app.save_preferences(text, smallint) owner to odiina_owner_api;
revoke create on schema app from odiina_owner_api;
revoke odiina_owner_api from postgres;

create function app.feed_page(
  p_cursor_occurred_at timestamptz default null,
  p_cursor_entry_id uuid default null,
  p_limit integer default 24,
  p_include_trash boolean default false
)
returns table (
  entry_id uuid,
  current_revision_id uuid,
  body_text text,
  revision_number integer,
  occurred_at timestamptz,
  occurred_timezone text,
  occurred_local_date date,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security invoker
set search_path = ''
as $$
  select
    e.id,
    e.current_revision_id,
    r.body_text,
    r.revision_number,
    r.occurred_at,
    r.occurred_timezone,
    r.occurred_local_date,
    e.created_at,
    e.updated_at
  from app.entries as e
  join app.entry_revisions as r
    on r.user_id = e.user_id
    and r.entry_id = e.id
    and r.id = e.current_revision_id
  where e.user_id = app.request_user_id()
    and e.lifecycle_state = case when p_include_trash then 'trashed' else 'active' end
    and (
      p_cursor_occurred_at is null
      or (r.occurred_at, e.id) < (p_cursor_occurred_at, p_cursor_entry_id)
    )
  order by r.occurred_at desc, e.id desc
  limit least(greatest(coalesce(p_limit, 24), 1), 50)
$$;

revoke all on function app.assert_occurrence(timestamptz, text, date, smallint)
  from public, anon;
revoke all on function app.feed_page(timestamptz, uuid, integer, boolean)
  from public, anon;
grant execute on function app.assert_occurrence(timestamptz, text, date, smallint)
  to odiina_owner_api;
grant execute on function app.feed_page(timestamptz, uuid, integer, boolean)
  to authenticated;

comment on constraint entry_revisions_owner_entry_fk on app.entry_revisions is
  'Prevents a revision from belonging to another user entry.';
comment on constraint entries_current_revision_fk on app.entries is
  'Current revision must belong to this exact user and Entry.';
comment on column app.entry_revisions.body_text is
  'May be empty in future attachment-backed entries; current text-only RPCs require 1..100000 trimmed characters. Future attachments use a general media abstraction, not an image-only invariant.';
comment on table app.entry_revisions is
  'Vertical slice 1 stores text revisions only. Reserved future media kinds image, video, and audio are not accepted by this migration or any current route.';
comment on function app.request_user_id() is
  'Security-invoker equivalent of Supabase auth.uid(), including PostgREST JWT-claims fallback, scoped to app so custom function owners need no auth-schema privileges.';

commit;
