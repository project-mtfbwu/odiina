begin;

do $$
begin
  if current_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'odiina_migration_requires_postgres_runner';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'odiina_worker_api') then
    create role odiina_worker_api
      nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
end
$$;

create extension if not exists pgmq;

do $$
begin
  if not exists (
    select 1 from pgmq.list_queues()
    where queue_name = 'odiina_media_processing'
  ) then
    perform pgmq.create('odiina_media_processing');
  end if;
  if not exists (
    select 1 from pgmq.list_queues()
    where queue_name = 'odiina_media_processing_dlq'
  ) then
    perform pgmq.create('odiina_media_processing_dlq');
  end if;
end
$$;

revoke all on schema pgmq from public, anon, authenticated;
grant usage on schema pgmq to odiina_owner_api, odiina_worker_api;
grant select, insert on pgmq.q_odiina_media_processing to odiina_owner_api;
grant usage on sequence pgmq.q_odiina_media_processing_msg_id_seq
  to odiina_owner_api;
grant select, insert, update, delete on
  pgmq.q_odiina_media_processing,
  pgmq.q_odiina_media_processing_dlq,
  pgmq.a_odiina_media_processing,
  pgmq.a_odiina_media_processing_dlq
  to odiina_worker_api;
grant usage on sequence
  pgmq.q_odiina_media_processing_msg_id_seq,
  pgmq.q_odiina_media_processing_dlq_msg_id_seq
  to odiina_worker_api;
revoke execute on all functions in schema pgmq from public, anon, authenticated;
-- pgmq's public entry points are SECURITY INVOKER functions that call
-- extension helpers. Internal NOLOGIN function-owner roles therefore need the
-- helper graph, while browser roles retain neither schema usage nor EXECUTE.
grant execute on all functions in schema pgmq
  to odiina_owner_api, odiina_worker_api;

-- pgmq function signatures have changed between extension releases. Grant the
-- installed overloads by catalog identity so this migration remains strict
-- without assuming a particular bundled Supabase extension version.
do $$
declare
  function_identity regprocedure;
  function_name text;
  matched_count integer;
begin
  foreach function_name in array array['send', 'read', 'set_vt', 'archive']
  loop
    matched_count := 0;

    for function_identity in
      select p.oid::regprocedure
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'pgmq'
        and p.proname = function_name
    loop
      if function_name = 'send' then
        execute format(
          'grant execute on function %s to odiina_owner_api, odiina_worker_api',
          function_identity
        );
      else
        execute format(
          'grant execute on function %s to odiina_worker_api',
          function_identity
        );
      end if;

      matched_count := matched_count + 1;
    end loop;

    if matched_count = 0 then
      raise exception 'Required pgmq function % is unavailable', function_name;
    end if;
  end loop;
end
$$;

alter table app.entries drop constraint entries_lifecycle_state_check;
alter table app.entries add constraint entries_lifecycle_state_check
  check (lifecycle_state in ('draft', 'active', 'trashed'));
alter table app.entries alter column finalized_at drop not null;
alter table app.entries drop constraint entries_trash_state_consistent;
alter table app.entries add constraint entries_trash_state_consistent check (
  (
    lifecycle_state = 'draft'
    and finalized_at is null
    and trashed_at is null
    and purge_after is null
  )
  or
  (
    lifecycle_state = 'active'
    and finalized_at is not null
    and trashed_at is null
    and purge_after is null
  )
  or
  (
    lifecycle_state = 'trashed'
    and finalized_at is not null
    and trashed_at is not null
    and purge_after is not null
    and purge_after >= trashed_at
  )
);

create or replace function app.require_committed_current_revision()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.lifecycle_state = 'draft' and new.current_revision_id is null then
    return null;
  end if;
  if new.lifecycle_state <> 'draft' and not exists (
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

create table app.attachments (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references app.profiles(user_id) on delete cascade,
  entry_id uuid not null,
  media_kind text not null check (media_kind in ('image', 'video', 'audio')),
  state text not null check (
    state in (
      'pending_upload', 'uploading', 'quarantined', 'queued', 'processing',
      'accepted', 'rejected', 'failed', 'deleting', 'deleted'
    )
  ),
  original_filename text null check (
    original_filename is null or char_length(original_filename) between 1 and 180
  ),
  declared_mime text null check (
    declared_mime is null or char_length(declared_mime) between 1 and 100
  ),
  expected_byte_count bigint not null check (
    expected_byte_count between 1 and 15728640
  ),
  error_code text null check (
    error_code is null or error_code ~ '^[a-z0-9_]{1,64}$'
  ),
  accepted_at timestamptz null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint attachments_owner_entry_fk
    foreign key (user_id, entry_id)
    references app.entries(user_id, id)
    on delete restrict,
  constraint attachments_owner_entry_id_unique unique (user_id, entry_id, id)
);

create table app.attachment_objects (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null,
  entry_id uuid not null,
  attachment_id uuid not null,
  variant text not null check (variant in ('quarantine', 'original', 'display', 'ai')),
  bucket_id text not null check (
    bucket_id in (
      'odiina-quarantine', 'odiina-originals', 'odiina-display', 'odiina-ai'
    )
  ),
  object_key text not null check (
    object_key ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}$'
  ),
  state text not null check (
    state in ('expected', 'uploaded', 'verified', 'deleting', 'deleted')
  ),
  byte_count bigint null check (byte_count is null or byte_count >= 0),
  sha256 bytea null check (sha256 is null or octet_length(sha256) = 32),
  detected_mime text null,
  created_at timestamptz not null default statement_timestamp(),
  verified_at timestamptz null,
  deleted_at timestamptz null,
  constraint attachment_objects_attachment_fk
    foreign key (user_id, entry_id, attachment_id)
    references app.attachments(user_id, entry_id, id)
    on delete restrict,
  constraint attachment_objects_owner_entry_id_unique
    unique (user_id, entry_id, attachment_id, id),
  constraint attachment_objects_bucket_key_unique unique (bucket_id, object_key),
  constraint attachment_objects_attachment_variant_unique unique (attachment_id, variant),
  constraint attachment_objects_variant_bucket_check check (
    (variant = 'quarantine' and bucket_id = 'odiina-quarantine')
    or (variant = 'original' and bucket_id = 'odiina-originals')
    or (variant = 'display' and bucket_id = 'odiina-display')
    or (variant = 'ai' and bucket_id = 'odiina-ai')
  )
);

create table app.entry_revision_attachments (
  user_id uuid not null,
  entry_id uuid not null,
  revision_id uuid not null,
  attachment_id uuid not null,
  position smallint not null check (position between 1 and 5),
  created_at timestamptz not null default statement_timestamp(),
  primary key (user_id, entry_id, revision_id, attachment_id),
  constraint entry_revision_attachments_revision_fk
    foreign key (user_id, entry_id, revision_id)
    references app.entry_revisions(user_id, entry_id, id)
    on delete restrict,
  constraint entry_revision_attachments_attachment_fk
    foreign key (user_id, entry_id, attachment_id)
    references app.attachments(user_id, entry_id, id)
    on delete restrict,
  constraint entry_revision_attachments_position_unique
    unique (user_id, entry_id, revision_id, position)
);

create table app.image_metadata (
  user_id uuid not null,
  entry_id uuid not null,
  attachment_id uuid not null,
  input_format text not null check (input_format in ('jpeg', 'png', 'webp')),
  input_width integer not null check (input_width between 1 and 12000),
  input_height integer not null check (input_height between 1 and 12000),
  decoded_pixels bigint not null check (decoded_pixels between 1 and 40000000),
  orientation_normalized boolean not null,
  animated boolean not null default false check (not animated),
  display_width integer not null check (display_width between 1 and 2400),
  display_height integer not null check (display_height between 1 and 2400),
  ai_width integer not null check (ai_width between 1 and 1600),
  ai_height integer not null check (ai_height between 1 and 1600),
  created_at timestamptz not null default statement_timestamp(),
  primary key (user_id, entry_id, attachment_id),
  constraint image_metadata_attachment_fk
    foreign key (user_id, entry_id, attachment_id)
    references app.attachments(user_id, entry_id, id)
    on delete restrict
);

create table app.media_worker_principals (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  generation integer not null check (generation > 0),
  active boolean not null default true,
  created_at timestamptz not null default statement_timestamp(),
  revoked_at timestamptz null,
  last_seen_at timestamptz null
);

create table app.media_processing_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null,
  entry_id uuid not null,
  attachment_id uuid not null,
  status text not null check (
    status in (
      'queued', 'leased', 'committed', 'retry', 'completed', 'rejected',
      'failed', 'cancelled', 'dead'
    )
  ),
  stage text not null default 'checking' check (
    stage in ('checking', 'scanning', 'preparing', 'promoting', 'cleanup', 'ready', 'failed')
  ),
  idempotency_key uuid not null default extensions.gen_random_uuid(),
  queue_message_id bigint null,
  attempts integer not null default 0 check (attempts between 0 and 5),
  next_attempt_at timestamptz not null default statement_timestamp(),
  leased_by uuid null references app.media_worker_principals(auth_user_id),
  worker_generation integer null,
  lease_token uuid null,
  lease_expires_at timestamptz null,
  last_error_code text null check (
    last_error_code is null or last_error_code ~ '^[a-z0-9_]{1,64}$'
  ),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz null,
  constraint media_jobs_attachment_fk
    foreign key (user_id, entry_id, attachment_id)
    references app.attachments(user_id, entry_id, id)
    on delete restrict,
  constraint media_jobs_attachment_unique unique (attachment_id),
  constraint media_jobs_idempotency_unique unique (idempotency_key)
);

create index attachments_owner_entry_created_idx
  on app.attachments (user_id, entry_id, created_at, id);
create index attachment_objects_attachment_variant_idx
  on app.attachment_objects (attachment_id, variant, state);
create index revision_attachments_revision_position_idx
  on app.entry_revision_attachments (user_id, entry_id, revision_id, position);
create index media_jobs_ready_idx
  on app.media_processing_jobs (status, next_attempt_at, created_at);
create index media_jobs_lease_idx
  on app.media_processing_jobs (leased_by, lease_expires_at)
  where status in ('leased', 'committed');

create trigger attachments_set_updated_at
before update on app.attachments
for each row execute function app.set_updated_at();

create trigger media_jobs_set_updated_at
before update on app.media_processing_jobs
for each row execute function app.set_updated_at();

create trigger entry_revision_attachments_are_immutable
before update or delete on app.entry_revision_attachments
for each row execute function app.reject_revision_mutation();

alter table app.attachments enable row level security;
alter table app.attachments force row level security;
alter table app.attachment_objects enable row level security;
alter table app.attachment_objects force row level security;
alter table app.entry_revision_attachments enable row level security;
alter table app.entry_revision_attachments force row level security;
alter table app.image_metadata enable row level security;
alter table app.image_metadata force row level security;
alter table app.media_worker_principals enable row level security;
alter table app.media_worker_principals force row level security;
alter table app.media_processing_jobs enable row level security;
alter table app.media_processing_jobs force row level security;

create function app.worker_actor_id()
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  with claims as (
    select nullif(
      pg_catalog.current_setting('request.jwt.claims', true),
      ''
    )::jsonb as value
  )
  select case
    when value -> 'app_metadata' ->> 'odiina_worker' = 'true'
      then nullif(value ->> 'sub', '')::uuid
    else null
  end
  from claims
$$;
revoke all on function app.worker_actor_id() from public, anon;
grant execute on function app.worker_actor_id() to authenticated, odiina_worker_api;

create function app.worker_claim_generation()
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when nullif(
      pg_catalog.current_setting('request.jwt.claims', true),
      ''
    )::jsonb -> 'app_metadata' ->> 'odiina_worker' = 'true'
    then (
      nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb
      -> 'app_metadata' ->> 'worker_generation'
    )::integer
    else null
  end
$$;
revoke all on function app.worker_claim_generation() from public, anon;
grant execute on function app.worker_claim_generation() to authenticated, odiina_worker_api;

create policy attachments_owner_read on app.attachments
for select to authenticated
using (user_id = (select app.request_user_id()));
create policy objects_owner_read on app.attachment_objects
for select to authenticated
using (user_id = (select app.request_user_id()));
create policy revision_attachments_owner_read on app.entry_revision_attachments
for select to authenticated
using (user_id = (select app.request_user_id()));
create policy image_metadata_owner_read on app.image_metadata
for select to authenticated
using (user_id = (select app.request_user_id()));
create policy media_jobs_owner_read on app.media_processing_jobs
for select to authenticated
using (user_id = (select app.request_user_id()));

create policy attachments_owner_api on app.attachments
for all to odiina_owner_api
using (user_id = (select app.request_user_id()))
with check (user_id = (select app.request_user_id()));
create policy objects_owner_api on app.attachment_objects
for all to odiina_owner_api
using (user_id = (select app.request_user_id()))
with check (user_id = (select app.request_user_id()));
create policy revision_attachments_owner_api on app.entry_revision_attachments
for all to odiina_owner_api
using (user_id = (select app.request_user_id()))
with check (user_id = (select app.request_user_id()));
create policy image_metadata_owner_api on app.image_metadata
for all to odiina_owner_api
using (user_id = (select app.request_user_id()))
with check (user_id = (select app.request_user_id()));
create policy media_jobs_owner_api on app.media_processing_jobs
for all to odiina_owner_api
using (user_id = (select app.request_user_id()))
with check (user_id = (select app.request_user_id()));

create policy attachments_worker_api on app.attachments
for all to odiina_worker_api
using (app.worker_actor_id() is not null)
with check (app.worker_actor_id() is not null);
create policy objects_worker_api on app.attachment_objects
for all to odiina_worker_api
using (app.worker_actor_id() is not null)
with check (app.worker_actor_id() is not null);
create policy image_metadata_worker_api on app.image_metadata
for all to odiina_worker_api
using (app.worker_actor_id() is not null)
with check (app.worker_actor_id() is not null);
create policy jobs_worker_api on app.media_processing_jobs
for all to odiina_worker_api
using (app.worker_actor_id() is not null)
with check (app.worker_actor_id() is not null);
create policy principals_worker_api on app.media_worker_principals
for all to odiina_worker_api
using (true)
with check (true);
create policy profiles_worker_bootstrap_cleanup on app.profiles
for delete to odiina_provisioner
using (true);
create policy profiles_worker_bootstrap_read on app.profiles
for select to odiina_provisioner
using (true);
create policy preferences_worker_bootstrap_cleanup on app.user_preferences
for delete to odiina_provisioner using (true);
create policy entries_worker_bootstrap_cleanup on app.entries
for delete to odiina_provisioner using (true);
create policy receipts_worker_bootstrap_cleanup on app.entry_command_receipts
for delete to odiina_provisioner using (true);
create policy revisions_worker_bootstrap_cleanup on app.entry_revisions
for delete to odiina_provisioner using (true);
create policy attachments_worker_bootstrap_cleanup on app.attachments
for delete to odiina_provisioner using (true);
create policy objects_worker_bootstrap_cleanup on app.attachment_objects
for delete to odiina_provisioner using (true);
create policy revision_media_worker_bootstrap_cleanup
on app.entry_revision_attachments
for delete to odiina_provisioner using (true);
create policy image_metadata_worker_bootstrap_cleanup on app.image_metadata
for delete to odiina_provisioner using (true);
create policy jobs_worker_bootstrap_cleanup on app.media_processing_jobs
for delete to odiina_provisioner using (true);
create policy principals_worker_bootstrap on app.media_worker_principals
for all to odiina_provisioner
using (true)
with check (true);

grant select on app.attachments, app.attachment_objects,
  app.entry_revision_attachments, app.image_metadata, app.media_processing_jobs
  to authenticated;
grant select, insert, update on app.attachments, app.attachment_objects,
  app.entry_revision_attachments, app.image_metadata, app.media_processing_jobs
  to odiina_owner_api;
grant select, insert, update on app.attachments, app.attachment_objects,
  app.image_metadata, app.media_processing_jobs, app.media_worker_principals
  to odiina_worker_api;
grant select on app.entries, app.entry_revisions to odiina_worker_api;
grant select, delete on app.profiles to odiina_provisioner;
grant delete on app.user_preferences, app.entries,
  app.entry_command_receipts, app.entry_revisions, app.attachments,
  app.attachment_objects, app.entry_revision_attachments,
  app.image_metadata, app.media_processing_jobs
  to odiina_provisioner;
grant select, insert, update on app.media_worker_principals to odiina_provisioner;

grant usage on schema app, extensions, storage to odiina_worker_api;
grant usage on schema storage to odiina_owner_api;
grant select on storage.objects to odiina_owner_api, odiina_worker_api;

grant odiina_provisioner to postgres;
create or replace function app.provision_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((new.raw_app_meta_data ->> 'odiina_worker')::boolean, false) then
    return new;
  end if;
  insert into app.profiles (user_id) values (new.id);
  insert into app.user_preferences (user_id) values (new.id);
  return new;
end
$$;
revoke odiina_provisioner from postgres;

create function app.require_active_worker()
returns table (worker_id uuid, generation integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := app.worker_actor_id();
  claim_generation integer := app.worker_claim_generation();
begin
  if actor is null or claim_generation is null then
    raise exception using errcode = '42501', message = 'odiina_worker_claim_required';
  end if;
  return query
  select p.auth_user_id, p.generation
  from app.media_worker_principals as p
  where p.auth_user_id = actor
    and p.generation = claim_generation
    and p.active
    and p.revoked_at is null;
  if not found then
    raise exception using errcode = '42501', message = 'odiina_worker_revoked';
  end if;
end
$$;
revoke all on function app.require_active_worker() from public, anon, authenticated;
grant execute on function app.require_active_worker() to odiina_worker_api;

create function app.worker_can_access_object(
  p_bucket_id text,
  p_object_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from app.attachment_objects as o
    join app.media_processing_jobs as j
      on j.user_id = o.user_id
      and j.entry_id = o.entry_id
      and j.attachment_id = o.attachment_id
    join app.media_worker_principals as p
      on p.auth_user_id = j.leased_by
      and p.generation = j.worker_generation
      and p.active
      and p.revoked_at is null
    where o.bucket_id = p_bucket_id
      and o.object_key = p_object_key
      and j.leased_by = app.worker_actor_id()
      and j.worker_generation = app.worker_claim_generation()
      and j.status in ('leased', 'committed')
      and j.lease_expires_at > statement_timestamp()
  )
$$;
revoke all on function app.worker_can_access_object(text, text) from public, anon;
grant execute on function app.worker_can_access_object(text, text) to authenticated;

create function app.authorize_image_upload(
  p_entry_id uuid,
  p_original_filename text,
  p_declared_mime text,
  p_expected_byte_count bigint
)
returns table (
  entry_id uuid,
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
  draft_id uuid := p_entry_id;
  created_attachment uuid := extensions.gen_random_uuid();
  created_object uuid := extensions.gen_random_uuid();
  created_key text := extensions.gen_random_uuid()::text || '/' || extensions.gen_random_uuid()::text;
  safe_filename text := nullif(left(btrim(p_original_filename), 180), '');
begin
  if actor is null then
    raise exception using errcode = '42501', message = 'odiina_auth_required';
  end if;
  if p_expected_byte_count is null
    or p_expected_byte_count not between 1 and 15728640
    or p_declared_mime not in ('image/jpeg', 'image/png', 'image/webp') then
    raise exception using errcode = 'P0001', message = 'odiina_image_upload_invalid';
  end if;
  if draft_id is null then
    draft_id := extensions.gen_random_uuid();
    insert into app.entries (
      id, user_id, lifecycle_state, current_revision_id, finalized_at
    )
    values (draft_id, actor, 'draft', null, null);
  else
    perform 1
    from app.entries as e
    where e.id = draft_id and e.user_id = actor and e.lifecycle_state = 'draft'
    for update;
    if not found then
      raise exception using errcode = 'P0001', message = 'odiina_media_draft_unavailable';
    end if;
  end if;
  if (
    select count(*)
    from app.attachments as a
    where a.user_id = actor
      and a.entry_id = draft_id
      and a.state not in ('rejected', 'failed', 'deleting', 'deleted')
  ) >= 5 then
    raise exception using errcode = 'P0001', message = 'odiina_attachment_limit';
  end if;
  insert into app.attachments (
    id, user_id, entry_id, media_kind, state, original_filename,
    declared_mime, expected_byte_count
  ) values (
    created_attachment, actor, draft_id, 'image', 'pending_upload',
    safe_filename, p_declared_mime, p_expected_byte_count
  );
  insert into app.attachment_objects (
    id, user_id, entry_id, attachment_id, variant, bucket_id, object_key, state
  ) values (
    created_object, actor, draft_id, created_attachment, 'quarantine',
    'odiina-quarantine', created_key, 'expected'
  );
  return query
  select draft_id, created_attachment, created_object, 'odiina-quarantine'::text, created_key;
end
$$;

create function app.mark_image_uploading(p_attachment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := app.request_user_id();
begin
  update app.attachments
  set state = 'uploading'
  where id = p_attachment_id
    and user_id = actor
    and state = 'pending_upload';
  if not found then
    raise exception using errcode = 'P0001', message = 'odiina_upload_unavailable';
  end if;
end
$$;

create function app.finalize_image_upload(p_attachment_id uuid)
returns table (job_id uuid, attachment_state text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := app.request_user_id();
  target app.attachments%rowtype;
  expected app.attachment_objects%rowtype;
  actual_size bigint;
  created_job uuid := extensions.gen_random_uuid();
  created_idempotency uuid := extensions.gen_random_uuid();
  message_id bigint;
begin
  select * into target
  from app.attachments
  where id = p_attachment_id and user_id = actor
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'odiina_upload_unavailable';
  end if;
  if target.state in ('queued', 'processing', 'accepted') then
    return query
    select j.id, target.state
    from app.media_processing_jobs as j
    where j.attachment_id = target.id;
    return;
  end if;
  if target.state not in ('pending_upload', 'uploading', 'quarantined') then
    raise exception using errcode = 'P0001', message = 'odiina_upload_state_invalid';
  end if;
  select * into expected
  from app.attachment_objects
  where attachment_id = target.id and variant = 'quarantine'
  for update;
  select nullif(o.metadata ->> 'size', '')::bigint into actual_size
  from storage.objects as o
  where o.bucket_id = expected.bucket_id
    and o.name = expected.object_key
    and o.owner_id = actor::text;
  if actual_size is null then
    raise exception using errcode = 'P0001', message = 'odiina_quarantine_missing';
  end if;
  if actual_size <> target.expected_byte_count or actual_size > 15728640 then
    raise exception using errcode = 'P0001', message = 'odiina_upload_size_mismatch';
  end if;
  update app.attachment_objects
  set state = 'uploaded', byte_count = actual_size
  where id = expected.id;
  update app.attachments set state = 'queued' where id = target.id;
  insert into app.media_processing_jobs (
    id, user_id, entry_id, attachment_id, status, idempotency_key
  ) values (
    created_job, actor, target.entry_id, target.id, 'queued', created_idempotency
  );
  select send into message_id
  from pgmq.send(
    'odiina_media_processing',
    jsonb_build_object(
      'version', 1,
      'job_id', created_job,
      'attachment_id', target.id,
      'idempotency_id', created_idempotency
    ),
    0
  );
  update app.media_processing_jobs
  set queue_message_id = message_id
  where id = created_job;
  return query select created_job, 'queued'::text;
end
$$;

create function app.cancel_image_upload(p_attachment_id uuid)
returns table (bucket_id text, object_key text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := app.request_user_id();
begin
  update app.media_processing_jobs
  set status = 'cancelled',
      stage = 'failed',
      last_error_code = 'user_cancelled',
      lease_token = null,
      lease_expires_at = null
  where attachment_id = p_attachment_id
    and user_id = actor
    and status not in ('completed', 'rejected', 'dead');
  update app.attachments
  set state = 'failed', error_code = 'user_cancelled'
  where id = p_attachment_id
    and user_id = actor
    and state not in ('accepted', 'deleted');
  if not found then
    raise exception using errcode = 'P0001', message = 'odiina_upload_unavailable';
  end if;
  return query
  select o.bucket_id, o.object_key
  from app.attachment_objects as o
  where o.attachment_id = p_attachment_id
    and o.user_id = actor
    and o.variant = 'quarantine'
    and o.state <> 'deleted';
end
$$;

create function app.mark_cancelled_object_deleted(p_attachment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := app.request_user_id();
begin
  update app.attachment_objects
  set state = 'deleted', deleted_at = statement_timestamp()
  where attachment_id = p_attachment_id
    and user_id = actor
    and variant = 'quarantine'
    and not exists (
      select 1 from storage.objects as s
      where s.bucket_id = app.attachment_objects.bucket_id
        and s.name = app.attachment_objects.object_key
    );
end
$$;

create function app.activate_media_entry(
  p_entry_id uuid,
  p_body_text text,
  p_attachment_ids uuid[],
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
  normalized_body text := btrim(coalesce(p_body_text, ''));
  created_revision uuid := extensions.gen_random_uuid();
  requested_count integer := coalesce(array_length(p_attachment_ids, 1), 0);
begin
  if actor is null then
    raise exception using errcode = '42501', message = 'odiina_auth_required';
  end if;
  perform app.assert_occurrence(
    p_occurred_at, p_occurred_timezone, p_occurred_local_date,
    p_occurred_utc_offset_minutes
  );
  if char_length(normalized_body) > 100000
    or requested_count > 5
    or (char_length(normalized_body) = 0 and requested_count = 0)
    or requested_count <> (
      select count(distinct value) from unnest(coalesce(p_attachment_ids, array[]::uuid[])) as value
    ) then
    raise exception using errcode = 'P0001', message = 'odiina_entry_invalid';
  end if;
  perform 1 from app.entries
  where id = p_entry_id and user_id = actor and lifecycle_state = 'draft'
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'odiina_media_draft_unavailable';
  end if;
  if requested_count <> (
    select count(*)
    from app.attachments as a
    where a.id = any(coalesce(p_attachment_ids, array[]::uuid[]))
      and a.user_id = actor
      and a.entry_id = p_entry_id
      and a.media_kind = 'image'
      and a.state = 'accepted'
  ) then
    raise exception using errcode = 'P0001', message = 'odiina_attachment_unavailable';
  end if;
  insert into app.entry_revisions (
    id, user_id, entry_id, revision_number, body_text, occurred_at,
    occurred_timezone, occurred_local_date, occurred_utc_offset_minutes,
    change_reason
  ) values (
    created_revision, actor, p_entry_id, 1, normalized_body, p_occurred_at,
    p_occurred_timezone, p_occurred_local_date, p_occurred_utc_offset_minutes,
    'created'
  );
  insert into app.entry_revision_attachments (
    user_id, entry_id, revision_id, attachment_id, position
  )
  select actor, p_entry_id, created_revision, value, ordinality::smallint
  from unnest(coalesce(p_attachment_ids, array[]::uuid[]))
    with ordinality as selected(value, ordinality);
  update app.entries
  set current_revision_id = created_revision,
      lifecycle_state = 'active',
      finalized_at = statement_timestamp()
  where id = p_entry_id and user_id = actor;
  return query select p_entry_id, created_revision;
end
$$;

grant odiina_owner_api to postgres;
create or replace function app.revise_entry(
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
  normalized_body text := btrim(coalesce(p_body_text, ''));
  locked_entry app.entries%rowtype;
  next_revision integer;
  created_revision_id uuid := extensions.gen_random_uuid();
  retained_count integer;
begin
  if actor is null then
    raise exception using errcode = 'P0001', message = 'odiina_auth_required';
  end if;
  if p_entry_id is null
    or p_expected_current_revision_id is null
    or char_length(normalized_body) > 100000
    or p_change_reason is null
    or p_change_reason not in ('edited', 'occurrence_corrected') then
    raise exception using errcode = 'P0001', message = 'odiina_entry_invalid';
  end if;
  perform app.assert_occurrence(
    p_occurred_at, p_occurred_timezone, p_occurred_local_date,
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
  select count(*) into retained_count
  from app.entry_revision_attachments as existing_media
  where existing_media.user_id = actor
    and existing_media.entry_id = p_entry_id
    and existing_media.revision_id = p_expected_current_revision_id;
  if char_length(normalized_body) = 0 and retained_count = 0 then
    raise exception using errcode = 'P0001', message = 'odiina_entry_invalid';
  end if;
  select coalesce(max(r.revision_number), 0) + 1 into next_revision
  from app.entry_revisions as r
  where r.user_id = actor and r.entry_id = p_entry_id;
  insert into app.entry_revisions (
    id, user_id, entry_id, revision_number, body_text, occurred_at,
    occurred_timezone, occurred_local_date, occurred_utc_offset_minutes,
    change_reason
  ) values (
    created_revision_id, actor, p_entry_id, next_revision, normalized_body,
    p_occurred_at, p_occurred_timezone, p_occurred_local_date,
    p_occurred_utc_offset_minutes, p_change_reason
  );
  insert into app.entry_revision_attachments (
    user_id, entry_id, revision_id, attachment_id, position
  )
  select existing_media.user_id, existing_media.entry_id,
    created_revision_id, existing_media.attachment_id,
    existing_media.position
  from app.entry_revision_attachments as existing_media
  where existing_media.user_id = actor
    and existing_media.entry_id = p_entry_id
    and existing_media.revision_id = p_expected_current_revision_id;
  update app.entries
  set current_revision_id = created_revision_id
  where id = p_entry_id and user_id = actor;
  return query select p_entry_id, created_revision_id;
end
$$;

create function app.revise_entry_media(
  p_entry_id uuid,
  p_expected_current_revision_id uuid,
  p_body_text text,
  p_attachment_ids uuid[],
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
  normalized_body text := btrim(coalesce(p_body_text, ''));
  locked_entry app.entries%rowtype;
  next_revision integer;
  created_revision_id uuid := extensions.gen_random_uuid();
  requested_count integer := coalesce(array_length(p_attachment_ids, 1), 0);
begin
  if actor is null then
    raise exception using errcode = 'P0001', message = 'odiina_auth_required';
  end if;
  if p_entry_id is null
    or p_expected_current_revision_id is null
    or char_length(normalized_body) > 100000
    or requested_count > 5
    or (char_length(normalized_body) = 0 and requested_count = 0)
    or requested_count <> (
      select count(distinct value)
      from unnest(coalesce(p_attachment_ids, array[]::uuid[])) as value
    )
    or p_change_reason is null
    or p_change_reason not in ('edited', 'occurrence_corrected') then
    raise exception using errcode = 'P0001', message = 'odiina_entry_invalid';
  end if;
  perform app.assert_occurrence(
    p_occurred_at, p_occurred_timezone, p_occurred_local_date,
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
  if requested_count <> (
    select count(*)
    from app.attachments as a
    where a.id = any(coalesce(p_attachment_ids, array[]::uuid[]))
      and a.user_id = actor
      and a.entry_id = p_entry_id
      and a.media_kind = 'image'
      and a.state = 'accepted'
  ) then
    raise exception using errcode = 'P0001', message = 'odiina_attachment_unavailable';
  end if;
  select coalesce(max(r.revision_number), 0) + 1 into next_revision
  from app.entry_revisions as r
  where r.user_id = actor and r.entry_id = p_entry_id;
  insert into app.entry_revisions (
    id, user_id, entry_id, revision_number, body_text, occurred_at,
    occurred_timezone, occurred_local_date, occurred_utc_offset_minutes,
    change_reason
  ) values (
    created_revision_id, actor, p_entry_id, next_revision, normalized_body,
    p_occurred_at, p_occurred_timezone, p_occurred_local_date,
    p_occurred_utc_offset_minutes, p_change_reason
  );
  insert into app.entry_revision_attachments (
    user_id, entry_id, revision_id, attachment_id, position
  )
  select actor, p_entry_id, created_revision_id, selected.value,
    selected.ordinality::smallint
  from unnest(coalesce(p_attachment_ids, array[]::uuid[]))
    with ordinality as selected(value, ordinality);
  update app.entries
  set current_revision_id = created_revision_id
  where id = p_entry_id and user_id = actor;
  return query select p_entry_id, created_revision_id;
end
$$;

create function app.revision_media(p_revision_ids uuid[])
returns table (
  revision_id uuid,
  attachment_id uuid,
  media_position smallint,
  width integer,
  height integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select ra.revision_id, ra.attachment_id, ra.position,
    m.display_width, m.display_height
  from app.entry_revision_attachments as ra
  join app.attachments as a
    on a.user_id = ra.user_id
    and a.entry_id = ra.entry_id
    and a.id = ra.attachment_id
  join app.image_metadata as m
    on m.user_id = ra.user_id
    and m.entry_id = ra.entry_id
    and m.attachment_id = ra.attachment_id
  where ra.user_id = app.request_user_id()
    and ra.revision_id = any(coalesce(p_revision_ids, array[]::uuid[]))
    and a.state = 'accepted'
  order by ra.revision_id, ra.position
$$;

create function app.register_media_worker(
  p_auth_user_id uuid,
  p_generation integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(
    pg_catalog.current_setting('request.jwt.claims', true),
    ''
  )::jsonb ->> 'role' <> 'service_role' then
    raise exception using errcode = '42501', message = 'odiina_service_role_required';
  end if;
  -- The process-only service-role bootstrap creates/updates Auth first. This
  -- function deliberately does not grant its narrow owner access to auth.users;
  -- every runtime call independently matches JWT app_metadata to this live row.
  if p_auth_user_id is null or p_generation is null or p_generation < 1 then
    raise exception using errcode = 'P0001', message = 'odiina_worker_identity_invalid';
  end if;
  -- GoTrue may insert the Auth row before applying app_metadata. Remove any
  -- human-account projection created during that narrow timing window.
  delete from app.profiles where user_id = p_auth_user_id;
  insert into app.media_worker_principals (
    auth_user_id, generation, active, revoked_at
  ) values (p_auth_user_id, p_generation, true, null)
  on conflict (auth_user_id) do update
  set generation = excluded.generation, active = true, revoked_at = null;
end
$$;

create function app.revoke_media_worker(p_auth_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(
    pg_catalog.current_setting('request.jwt.claims', true),
    ''
  )::jsonb ->> 'role' <> 'service_role' then
    raise exception using errcode = '42501', message = 'odiina_service_role_required';
  end if;
  update app.media_worker_principals
  set active = false,
      generation = generation + 1,
      revoked_at = statement_timestamp()
  where auth_user_id = p_auth_user_id;
  update app.media_processing_jobs
  set status = 'retry',
      lease_token = null,
      lease_expires_at = null,
      leased_by = null,
      worker_generation = null,
      next_attempt_at = statement_timestamp()
  where leased_by = p_auth_user_id
    and status in ('leased', 'committed');
end
$$;

create function app.claim_media_job(p_visibility_seconds integer default 120)
returns table (
  job_id uuid,
  attachment_id uuid,
  lease_token uuid,
  committed boolean,
  quarantine_bucket text,
  quarantine_key text,
  original_object_id uuid,
  original_key text,
  display_object_id uuid,
  display_key text,
  ai_object_id uuid,
  ai_key text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  worker record;
  message record;
  target app.media_processing_jobs%rowtype;
  new_lease uuid := extensions.gen_random_uuid();
  original_id uuid;
  display_id uuid;
  ai_id uuid;
begin
  if p_visibility_seconds not between 30 and 600 then
    raise exception using errcode = 'P0001', message = 'odiina_lease_invalid';
  end if;
  select * into worker from app.require_active_worker();
  update app.media_processing_jobs
  set status = 'retry',
      lease_token = null,
      lease_expires_at = null,
      leased_by = null,
      worker_generation = null,
      next_attempt_at = statement_timestamp()
  where status = 'leased' and lease_expires_at <= statement_timestamp();
  select * into message
  from pgmq.read('odiina_media_processing', p_visibility_seconds, 1)
  limit 1;
  if not found then
    return;
  end if;
  if (message.message ->> 'version')::integer <> 1
    or message.message ->> 'job_id' is null
    or message.message ->> 'attachment_id' is null
    or message.message ->> 'idempotency_id' is null then
    perform pgmq.archive('odiina_media_processing', message.msg_id);
    return;
  end if;
  select * into target
  from app.media_processing_jobs as queued_job
  where queued_job.id = (message.message ->> 'job_id')::uuid
    and queued_job.attachment_id = (message.message ->> 'attachment_id')::uuid
    and queued_job.idempotency_key = (message.message ->> 'idempotency_id')::uuid
  for update;
  if not found or target.status in ('completed', 'rejected', 'failed', 'cancelled', 'dead') then
    perform pgmq.archive('odiina_media_processing', message.msg_id);
    return;
  end if;
  if target.next_attempt_at > statement_timestamp() then
    perform pgmq.set_vt(
      'odiina_media_processing',
      message.msg_id,
      greatest(1, extract(epoch from target.next_attempt_at - statement_timestamp())::integer)
    );
    return;
  end if;
  if message.read_ct > 5 then
    update app.media_processing_jobs
    set status = 'dead', stage = 'failed', last_error_code = 'attempt_limit',
        completed_at = statement_timestamp()
    where id = target.id;
    update app.attachments set state = 'failed', error_code = 'attempt_limit'
    where id = target.attachment_id;
    perform pgmq.send('odiina_media_processing_dlq', message.message, 0);
    perform pgmq.archive('odiina_media_processing', message.msg_id);
    return;
  end if;
  insert into app.attachment_objects (
    user_id, entry_id, attachment_id, variant, bucket_id, object_key, state
  ) values
    (
      target.user_id, target.entry_id, target.attachment_id, 'original',
      'odiina-originals',
      extensions.gen_random_uuid()::text || '/' || extensions.gen_random_uuid()::text,
      'expected'
    ),
    (
      target.user_id, target.entry_id, target.attachment_id, 'display',
      'odiina-display',
      extensions.gen_random_uuid()::text || '/' || extensions.gen_random_uuid()::text,
      'expected'
    ),
    (
      target.user_id, target.entry_id, target.attachment_id, 'ai',
      'odiina-ai',
      extensions.gen_random_uuid()::text || '/' || extensions.gen_random_uuid()::text,
      'expected'
    )
  on conflict on constraint attachment_objects_attachment_variant_unique
  do nothing;
  update app.media_processing_jobs
  set status = case when status = 'committed' then 'committed' else 'leased' end,
      stage = case when status = 'committed' then 'cleanup' else 'checking' end,
      attempts = attempts + 1,
      queue_message_id = message.msg_id,
      leased_by = worker.worker_id,
      worker_generation = worker.generation,
      lease_token = new_lease,
      lease_expires_at = statement_timestamp() + make_interval(secs => p_visibility_seconds)
  where id = target.id;
  update app.attachments
  set state = case when target.status = 'committed' then 'accepted' else 'processing' end
  where id = target.attachment_id;
  select object_row.id into original_id
  from app.attachment_objects as object_row
  where object_row.attachment_id = target.attachment_id
    and object_row.variant = 'original';
  select object_row.id into display_id
  from app.attachment_objects as object_row
  where object_row.attachment_id = target.attachment_id
    and object_row.variant = 'display';
  select object_row.id into ai_id
  from app.attachment_objects as object_row
  where object_row.attachment_id = target.attachment_id
    and object_row.variant = 'ai';
  return query
  select target.id, target.attachment_id, new_lease,
    target.status = 'committed',
    q.bucket_id, q.object_key,
    original_id, o.object_key,
    display_id, d.object_key,
    ai_id, ai.object_key
  from app.attachment_objects as q
  join app.attachment_objects as o
    on o.attachment_id = q.attachment_id and o.variant = 'original'
  join app.attachment_objects as d
    on d.attachment_id = q.attachment_id and d.variant = 'display'
  join app.attachment_objects as ai
    on ai.attachment_id = q.attachment_id and ai.variant = 'ai'
  where q.attachment_id = target.attachment_id and q.variant = 'quarantine';
end
$$;

create function app.claim_media_orphan(p_stale_seconds integer default 7200)
returns table (
  job_id uuid,
  attachment_id uuid,
  lease_token uuid,
  quarantine_bucket text,
  quarantine_key text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  worker record;
  recovery app.media_processing_jobs%rowtype;
  target app.attachments%rowtype;
  object_row app.attachment_objects%rowtype;
  created_job uuid := extensions.gen_random_uuid();
  created_lease uuid := extensions.gen_random_uuid();
begin
  if p_stale_seconds not between 300 and 86400 then
    raise exception using errcode = 'P0001', message = 'odiina_orphan_window_invalid';
  end if;
  select * into worker from app.require_active_worker();
  select j.* into recovery
  from app.media_processing_jobs as j
  where j.queue_message_id is null
    and j.status = 'leased'
    and j.stage = 'cleanup'
    and j.lease_expires_at <= statement_timestamp()
  order by j.lease_expires_at, j.id
  for update skip locked
  limit 1;
  if found then
    update app.media_processing_jobs
    set attempts = attempts + 1,
        leased_by = worker.worker_id,
        worker_generation = worker.generation,
        lease_token = created_lease,
        lease_expires_at = statement_timestamp() + interval '2 minutes'
    where id = recovery.id;
    select a.* into target
    from app.attachments as a where a.id = recovery.attachment_id;
    select ao.* into object_row
    from app.attachment_objects as ao
    where ao.attachment_id = target.id and ao.variant = 'quarantine';
    return query select recovery.id, target.id, created_lease,
      object_row.bucket_id, object_row.object_key;
    return;
  end if;
  select a.* into target
  from app.attachments as a
  where a.state in ('pending_upload', 'uploading', 'quarantined')
    and a.updated_at <= statement_timestamp() - make_interval(secs => p_stale_seconds)
    and not exists (
      select 1 from app.media_processing_jobs as existing_job
      where existing_job.attachment_id = a.id
    )
  order by a.updated_at, a.id
  for update skip locked
  limit 1;
  if not found then
    return;
  end if;
  select ao.* into object_row
  from app.attachment_objects as ao
  where ao.attachment_id = target.id and ao.variant = 'quarantine'
  for update;
  insert into app.media_processing_jobs (
    id, user_id, entry_id, attachment_id, status, stage, attempts,
    idempotency_key, leased_by, worker_generation, lease_token,
    lease_expires_at
  ) values (
    created_job, target.user_id, target.entry_id, target.id, 'leased',
    'cleanup', 1, extensions.gen_random_uuid(), worker.worker_id,
    worker.generation, created_lease, statement_timestamp() + interval '2 minutes'
  );
  update app.attachments
  set state = 'deleting', error_code = 'upload_expired'
  where id = target.id;
  return query select created_job, target.id, created_lease,
    object_row.bucket_id, object_row.object_key;
end
$$;

create function app.complete_media_orphan(
  p_job_id uuid,
  p_lease_token uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  worker record;
  target app.media_processing_jobs%rowtype;
begin
  select * into worker from app.require_active_worker();
  select j.* into target
  from app.media_processing_jobs as j
  where j.id = p_job_id
    and j.lease_token = p_lease_token
    and j.leased_by = worker.worker_id
    and j.worker_generation = worker.generation
    and j.status = 'leased'
    and j.stage = 'cleanup'
    and j.queue_message_id is null
    and j.lease_expires_at > statement_timestamp()
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'odiina_worker_lease_stale';
  end if;
  if exists (
    select 1
    from app.attachment_objects as ao
    join storage.objects as so
      on so.bucket_id = ao.bucket_id and so.name = ao.object_key
    where ao.attachment_id = target.attachment_id
      and ao.variant = 'quarantine'
  ) then
    raise exception using errcode = 'P0001', message = 'odiina_quarantine_not_removed';
  end if;
  update app.attachment_objects
  set state = 'deleted', deleted_at = statement_timestamp()
  where attachment_id = target.attachment_id and variant = 'quarantine';
  update app.attachments
  set state = 'deleted', error_code = 'upload_expired'
  where id = target.attachment_id;
  update app.media_processing_jobs
  set status = 'completed', stage = 'ready', completed_at = statement_timestamp(),
      lease_token = null, lease_expires_at = null
  where id = target.id;
end
$$;

create function app.heartbeat_media_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_stage text,
  p_visibility_seconds integer default 120
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  worker record;
  message_id bigint;
begin
  select * into worker from app.require_active_worker();
  if p_stage not in ('checking', 'scanning', 'preparing', 'promoting', 'cleanup') then
    raise exception using errcode = 'P0001', message = 'odiina_worker_stage_invalid';
  end if;
  update app.media_processing_jobs
  set stage = p_stage,
      lease_expires_at = statement_timestamp() + make_interval(secs => p_visibility_seconds)
  where id = p_job_id
    and lease_token = p_lease_token
    and leased_by = worker.worker_id
    and worker_generation = worker.generation
    and status in ('leased', 'committed')
    and lease_expires_at > statement_timestamp()
  returning queue_message_id into message_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'odiina_worker_lease_stale';
  end if;
  perform pgmq.set_vt('odiina_media_processing', message_id, p_visibility_seconds);
end
$$;

create function app.commit_processed_image(
  p_job_id uuid,
  p_lease_token uuid,
  p_input_format text,
  p_input_width integer,
  p_input_height integer,
  p_display_width integer,
  p_display_height integer,
  p_ai_width integer,
  p_ai_height integer,
  p_quarantine_sha256 bytea,
  p_quarantine_bytes bigint,
  p_original_sha256 bytea,
  p_original_bytes bigint,
  p_display_sha256 bytea,
  p_display_bytes bigint,
  p_ai_sha256 bytea,
  p_ai_bytes bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  worker record;
  target app.media_processing_jobs%rowtype;
begin
  select * into worker from app.require_active_worker();
  select * into target from app.media_processing_jobs
  where id = p_job_id
    and lease_token = p_lease_token
    and leased_by = worker.worker_id
    and worker_generation = worker.generation
    and status = 'leased'
    and lease_expires_at > statement_timestamp()
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'odiina_worker_lease_stale';
  end if;
  if p_input_format not in ('jpeg', 'png', 'webp')
    or p_input_width not between 1 and 12000
    or p_input_height not between 1 and 12000
    or p_input_width::bigint * p_input_height::bigint > 40000000
    or p_quarantine_sha256 <> p_original_sha256
    or p_quarantine_bytes <> p_original_bytes
    or p_quarantine_bytes > 15728640
    or exists (
      select 1
      from app.attachment_objects as ao
      where ao.attachment_id = target.attachment_id
        and ao.variant in ('original', 'display', 'ai')
        and not exists (
          select 1 from storage.objects as so
          where so.bucket_id = ao.bucket_id
            and so.name = ao.object_key
        )
    ) then
    raise exception using errcode = 'P0001', message = 'odiina_processed_image_invalid';
  end if;
  update app.attachment_objects
  set state = 'verified',
      byte_count = case variant
        when 'original' then p_original_bytes
        when 'display' then p_display_bytes
        when 'ai' then p_ai_bytes
      end,
      sha256 = case variant
        when 'original' then p_original_sha256
        when 'display' then p_display_sha256
        when 'ai' then p_ai_sha256
      end,
      detected_mime = case when variant = 'original'
        then 'image/' || p_input_format else 'image/jpeg' end,
      verified_at = statement_timestamp()
  where attachment_id = target.attachment_id
    and variant in ('original', 'display', 'ai');
  update app.attachment_objects
  set state = 'verified', byte_count = p_quarantine_bytes,
      sha256 = p_quarantine_sha256,
      detected_mime = 'image/' || p_input_format,
      verified_at = statement_timestamp()
  where attachment_id = target.attachment_id and variant = 'quarantine';
  insert into app.image_metadata (
    user_id, entry_id, attachment_id, input_format, input_width, input_height,
    decoded_pixels, orientation_normalized, animated, display_width,
    display_height, ai_width, ai_height
  ) values (
    target.user_id, target.entry_id, target.attachment_id, p_input_format,
    p_input_width, p_input_height, p_input_width::bigint * p_input_height,
    true, false, p_display_width, p_display_height, p_ai_width, p_ai_height
  );
  update app.attachments
  set state = 'accepted', error_code = null, accepted_at = statement_timestamp()
  where id = target.attachment_id;
  update app.media_processing_jobs
  set status = 'committed', stage = 'cleanup'
  where id = target.id;
end
$$;
revoke odiina_owner_api from postgres;

create function app.finish_media_job(
  p_job_id uuid,
  p_lease_token uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  worker record;
  target app.media_processing_jobs%rowtype;
begin
  select * into worker from app.require_active_worker();
  select * into target from app.media_processing_jobs
  where id = p_job_id
    and lease_token = p_lease_token
    and leased_by = worker.worker_id
    and worker_generation = worker.generation
    and status = 'committed'
    and lease_expires_at > statement_timestamp()
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'odiina_worker_lease_stale';
  end if;
  if exists (
    select 1
    from app.attachment_objects as ao
    join storage.objects as so
      on so.bucket_id = ao.bucket_id and so.name = ao.object_key
    where ao.attachment_id = target.attachment_id and ao.variant = 'quarantine'
  ) then
    raise exception using errcode = 'P0001', message = 'odiina_quarantine_not_removed';
  end if;
  update app.attachment_objects
  set state = 'deleted', deleted_at = statement_timestamp()
  where attachment_id = target.attachment_id and variant = 'quarantine';
  update app.media_processing_jobs
  set status = 'completed', stage = 'ready', completed_at = statement_timestamp(),
      lease_token = null, lease_expires_at = null
  where id = target.id;
  perform pgmq.archive('odiina_media_processing', target.queue_message_id);
end
$$;

create function app.fail_media_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_error_code text,
  p_retryable boolean,
  p_rejected boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  worker record;
  target app.media_processing_jobs%rowtype;
  delay_seconds integer;
  message_payload jsonb;
begin
  select * into worker from app.require_active_worker();
  if p_error_code is null or p_error_code !~ '^[a-z0-9_]{1,64}$' then
    raise exception using errcode = 'P0001', message = 'odiina_worker_error_invalid';
  end if;
  select * into target from app.media_processing_jobs
  where id = p_job_id
    and lease_token = p_lease_token
    and leased_by = worker.worker_id
    and worker_generation = worker.generation
    and status in ('leased', 'committed')
    and lease_expires_at > statement_timestamp()
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'odiina_worker_lease_stale';
  end if;
  if p_retryable and target.attempts < 5 then
    delay_seconds := least(300, 5 * (2 ^ greatest(target.attempts - 1, 0)));
    update app.media_processing_jobs
    set status = 'retry', stage = 'failed', last_error_code = p_error_code,
        next_attempt_at = statement_timestamp() + make_interval(secs => delay_seconds),
        lease_token = null, lease_expires_at = null,
        leased_by = null, worker_generation = null
    where id = target.id;
    update app.attachments set state = 'queued', error_code = p_error_code
    where id = target.attachment_id;
    perform pgmq.set_vt('odiina_media_processing', target.queue_message_id, delay_seconds);
    return;
  end if;
  update app.media_processing_jobs
  set status = case when p_rejected then 'rejected'
                    when p_retryable then 'dead' else 'failed' end,
      stage = 'failed', last_error_code = p_error_code,
      completed_at = statement_timestamp(), lease_token = null,
      lease_expires_at = null
  where id = target.id;
  update app.attachments
  set state = case when p_rejected then 'rejected' else 'failed' end,
      error_code = p_error_code
  where id = target.attachment_id;
  if p_retryable then
    message_payload := jsonb_build_object(
      'version', 1, 'job_id', target.id,
      'attachment_id', target.attachment_id,
      'idempotency_id', target.idempotency_key
    );
    perform pgmq.send('odiina_media_processing_dlq', message_payload, 0);
  end if;
  perform pgmq.archive('odiina_media_processing', target.queue_message_id);
end
$$;

revoke all on function app.authorize_image_upload(uuid, text, text, bigint) from public, anon;
revoke all on function app.mark_image_uploading(uuid) from public, anon;
revoke all on function app.finalize_image_upload(uuid) from public, anon;
revoke all on function app.cancel_image_upload(uuid) from public, anon;
revoke all on function app.mark_cancelled_object_deleted(uuid) from public, anon;
revoke all on function app.activate_media_entry(
  uuid, text, uuid[], timestamptz, text, date, smallint
) from public, anon;
revoke all on function app.revision_media(uuid[]) from public, anon;
revoke all on function app.revise_entry_media(
  uuid, uuid, text, uuid[], timestamptz, text, date, smallint, text
) from public, anon;
grant execute on function app.authorize_image_upload(uuid, text, text, bigint) to authenticated;
grant execute on function app.mark_image_uploading(uuid) to authenticated;
grant execute on function app.finalize_image_upload(uuid) to authenticated;
grant execute on function app.cancel_image_upload(uuid) to authenticated;
grant execute on function app.mark_cancelled_object_deleted(uuid) to authenticated;
grant execute on function app.activate_media_entry(
  uuid, text, uuid[], timestamptz, text, date, smallint
) to authenticated;
grant execute on function app.revision_media(uuid[]) to authenticated;
grant execute on function app.revise_entry_media(
  uuid, uuid, text, uuid[], timestamptz, text, date, smallint, text
) to authenticated;

grant odiina_owner_api to postgres;
grant create on schema app to odiina_owner_api;
alter function app.authorize_image_upload(uuid, text, text, bigint) owner to odiina_owner_api;
alter function app.mark_image_uploading(uuid) owner to odiina_owner_api;
alter function app.finalize_image_upload(uuid) owner to odiina_owner_api;
alter function app.cancel_image_upload(uuid) owner to odiina_owner_api;
alter function app.mark_cancelled_object_deleted(uuid) owner to odiina_owner_api;
alter function app.activate_media_entry(
  uuid, text, uuid[], timestamptz, text, date, smallint
) owner to odiina_owner_api;
alter function app.revise_entry_media(
  uuid, uuid, text, uuid[], timestamptz, text, date, smallint, text
) owner to odiina_owner_api;
revoke create on schema app from odiina_owner_api;
revoke odiina_owner_api from postgres;

revoke all on function app.register_media_worker(uuid, integer) from public, anon, authenticated;
revoke all on function app.revoke_media_worker(uuid) from public, anon, authenticated;
grant execute on function app.register_media_worker(uuid, integer) to service_role;
grant execute on function app.revoke_media_worker(uuid) to service_role;
revoke all on function app.claim_media_job(integer) from public, anon;
revoke all on function app.claim_media_orphan(integer) from public, anon;
revoke all on function app.complete_media_orphan(uuid, uuid) from public, anon;
revoke all on function app.heartbeat_media_job(uuid, uuid, text, integer) from public, anon;
revoke all on function app.commit_processed_image(
  uuid, uuid, text, integer, integer, integer, integer, integer, integer,
  bytea, bigint, bytea, bigint, bytea, bigint, bytea, bigint
) from public, anon;
revoke all on function app.finish_media_job(uuid, uuid) from public, anon;
revoke all on function app.fail_media_job(uuid, uuid, text, boolean, boolean) from public, anon;
grant execute on function app.claim_media_job(integer) to authenticated;
grant execute on function app.claim_media_orphan(integer) to authenticated;
grant execute on function app.complete_media_orphan(uuid, uuid) to authenticated;
grant execute on function app.heartbeat_media_job(uuid, uuid, text, integer) to authenticated;
grant execute on function app.commit_processed_image(
  uuid, uuid, text, integer, integer, integer, integer, integer, integer,
  bytea, bigint, bytea, bigint, bytea, bigint, bytea, bigint
) to authenticated;
grant execute on function app.finish_media_job(uuid, uuid) to authenticated;
grant execute on function app.fail_media_job(uuid, uuid, text, boolean, boolean) to authenticated;

grant odiina_worker_api to postgres;
grant create on schema app to odiina_worker_api;
alter function app.require_active_worker() owner to odiina_worker_api;
alter function app.worker_can_access_object(text, text) owner to odiina_worker_api;
alter function app.revoke_media_worker(uuid) owner to odiina_worker_api;
alter function app.claim_media_job(integer) owner to odiina_worker_api;
alter function app.claim_media_orphan(integer) owner to odiina_worker_api;
alter function app.complete_media_orphan(uuid, uuid) owner to odiina_worker_api;
alter function app.heartbeat_media_job(uuid, uuid, text, integer) owner to odiina_worker_api;
alter function app.commit_processed_image(
  uuid, uuid, text, integer, integer, integer, integer, integer, integer,
  bytea, bigint, bytea, bigint, bytea, bigint, bytea, bigint
) owner to odiina_worker_api;
alter function app.finish_media_job(uuid, uuid) owner to odiina_worker_api;
alter function app.fail_media_job(uuid, uuid, text, boolean, boolean) owner to odiina_worker_api;
revoke create on schema app from odiina_worker_api;
revoke odiina_worker_api from postgres;

grant odiina_provisioner to postgres;
grant create on schema app to odiina_provisioner;
alter function app.register_media_worker(uuid, integer) owner to odiina_provisioner;
revoke create on schema app from odiina_provisioner;
revoke odiina_provisioner from postgres;

create policy quarantine_upload_exact on storage.objects
for insert to authenticated
with check (
  bucket_id = 'odiina-quarantine'
  and exists (
    select 1
    from app.attachment_objects as ao
    join app.attachments as a
      on a.user_id = ao.user_id
      and a.entry_id = ao.entry_id
      and a.id = ao.attachment_id
    where ao.bucket_id = storage.objects.bucket_id
      and ao.object_key = storage.objects.name
      and ao.variant = 'quarantine'
      and ao.state = 'expected'
      and ao.user_id = app.request_user_id()
      and a.state in ('pending_upload', 'uploading')
  )
);

create policy quarantine_owner_metadata on storage.objects
for select to authenticated
using (
  bucket_id = 'odiina-quarantine'
  and exists (
    select 1 from app.attachment_objects as ao
    where ao.bucket_id = storage.objects.bucket_id
      and ao.object_key = storage.objects.name
      and ao.user_id = app.request_user_id()
  )
);

create policy quarantine_owner_api_metadata on storage.objects
for select to odiina_owner_api
using (
  bucket_id = 'odiina-quarantine'
  and exists (
    select 1 from app.attachment_objects as ao
    where ao.bucket_id = storage.objects.bucket_id
      and ao.object_key = storage.objects.name
      and ao.user_id = app.request_user_id()
  )
);

create policy quarantine_owner_cancel on storage.objects
for delete to authenticated
using (
  bucket_id = 'odiina-quarantine'
  and exists (
    select 1
    from app.attachment_objects as ao
    join app.attachments as a on a.id = ao.attachment_id
    where ao.bucket_id = storage.objects.bucket_id
      and ao.object_key = storage.objects.name
      and ao.user_id = app.request_user_id()
      and a.state = 'failed'
  )
);

create policy worker_object_read on storage.objects
for select to authenticated
using (app.worker_can_access_object(bucket_id, name));
create policy worker_api_object_read on storage.objects
for select to odiina_worker_api
using (app.worker_can_access_object(bucket_id, name));
create policy worker_object_insert on storage.objects
for insert to authenticated
with check (
  bucket_id in ('odiina-originals', 'odiina-display', 'odiina-ai')
  and app.worker_can_access_object(bucket_id, name)
);
create policy worker_quarantine_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'odiina-quarantine'
  and app.worker_can_access_object(bucket_id, name)
);

create policy owner_display_read on storage.objects
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
    join app.entries as e
      on e.user_id = a.user_id and e.id = a.entry_id
    where ao.bucket_id = storage.objects.bucket_id
      and ao.object_key = storage.objects.name
      and ao.variant = 'display'
      and ao.state = 'verified'
      and ao.user_id = app.request_user_id()
      and a.state = 'accepted'
      and e.lifecycle_state in ('active', 'trashed')
  )
);

comment on table app.attachments is
  'Media-general attachment identity. Image-only facts belong in app.image_metadata; video and audio remain reserved and unaccepted.';
comment on table app.attachment_objects is
  'Immutable expected Storage objects. Uploaded paths are opaque and never overwritten.';
comment on table app.media_processing_jobs is
  'Durable lease-fenced image processing state paired with the logged pgmq queue.';
comment on table app.entry_revision_attachments is
  'Immutable ordered attachment membership for one exact Entry revision.';

commit;
