begin;

do $$
begin
  if current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'odiina_migration_requires_postgres_runner';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'odiina_ai_worker_api') then
    create role odiina_ai_worker_api nologin noinherit nosuperuser nocreatedb
      nocreaterole noreplication nobypassrls;
  end if;
end
$$;

grant usage on schema app, extensions to odiina_ai_worker_api;
grant odiina_owner_api, odiina_ai_worker_api to postgres;
grant create on schema app to odiina_owner_api, odiina_ai_worker_api;

create table app.ai_settings (
  user_id uuid primary key references app.profiles(user_id) on delete cascade,
  master_enabled boolean not null default false,
  transcription_enabled boolean not null default false,
  insights_enabled boolean not null default false,
  transcript_search_enabled boolean not null default false,
  auto_transcribe_enabled boolean not null default false check (not auto_transcribe_enabled),
  consent_version integer not null default 0 check (consent_version >= 0),
  consent_policy_version text not null default 'odiina-ai-consent-v1'
    check (char_length(consent_policy_version) between 1 and 80),
  provider_policy_version text null check (
    provider_policy_version is null or char_length(provider_policy_version) between 1 and 80
  ),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  check (master_enabled or (not transcription_enabled and not insights_enabled
    and not transcript_search_enabled and not auto_transcribe_enabled)),
  check (transcription_enabled or not transcript_search_enabled)
);

create table app.ai_consent_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references app.profiles(user_id) on delete cascade,
  consent_version integer not null check (consent_version > 0),
  feature text not null check (feature in (
    'master','transcription','insights','transcript_search','auto_transcribe'
  )),
  enabled boolean not null,
  consent_policy_version text not null check (char_length(consent_policy_version) between 1 and 80),
  provider_policy_version text null check (
    provider_policy_version is null or char_length(provider_policy_version) between 1 and 80
  ),
  source_surface text not null check (source_surface in ('settings_ai','derived_data_delete')),
  created_at timestamptz not null default statement_timestamp(),
  unique (user_id, consent_version, feature)
);

create table app.ai_worker_principals (
  auth_user_id uuid primary key,
  generation integer not null check (generation > 0),
  active boolean not null default true,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);

create table app.ai_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references app.profiles(user_id) on delete cascade,
  job_kind text not null check (job_kind in ('transcription','insight')),
  status text not null default 'queued' check (status in (
    'queued','sending','transcribing','processing_response','generating',
    'ready','failed','canceled','dead_letter'
  )),
  client_request_id uuid not null,
  consent_version integer not null check (consent_version >= 1),
  provider_id text not null check (provider_id = 'fake-local'),
  model_id text not null check (model_id in (
    'deterministic-transcript-v1','deterministic-insight-v1'
  )),
  entry_id uuid null,
  revision_id uuid null,
  attachment_id uuid null,
  source_object_id uuid null,
  source_sha256 bytea null check (source_sha256 is null or octet_length(source_sha256) = 32),
  source_kind text null check (source_kind is null or source_kind in ('audio','video_audio')),
  source_duration_ms integer null check (source_duration_ms is null or source_duration_ms between 250 and 600000),
  language_hint text null check (language_hint is null or char_length(language_hint) between 2 and 35),
  insight_scope text null check (insight_scope is null or insight_scope in (
    'entry','day','range','week','month'
  )),
  range_start date null,
  range_end date null,
  source_snapshot jsonb null check (
    source_snapshot is null or pg_catalog.jsonb_typeof(source_snapshot) = 'array'
  ),
  source_snapshot_sha256 bytea null check (
    source_snapshot_sha256 is null or octet_length(source_snapshot_sha256) = 32
  ),
  attempts smallint not null default 0 check (attempts between 0 and 3),
  lease_token uuid null,
  leased_by uuid null,
  lease_expires_at timestamptz null,
  heartbeat_at timestamptz null,
  cancel_requested boolean not null default false,
  safe_error_code text null check (safe_error_code is null or safe_error_code ~ '^[a-z0-9_]{1,64}$'),
  queued_at timestamptz not null default statement_timestamp(),
  started_at timestamptz null,
  completed_at timestamptz null,
  updated_at timestamptz not null default statement_timestamp(),
  unique (user_id, id),
  unique (user_id, job_kind, client_request_id),
  constraint ai_jobs_entry_fk foreign key (user_id, entry_id)
    references app.entries(user_id, id) on delete restrict,
  constraint ai_jobs_revision_fk foreign key (user_id, entry_id, revision_id)
    references app.entry_revisions(user_id, entry_id, id) on delete restrict,
  constraint ai_jobs_attachment_fk foreign key (user_id, entry_id, attachment_id)
    references app.attachments(user_id, entry_id, id) on delete restrict,
  constraint ai_jobs_object_fk foreign key (user_id, entry_id, attachment_id, source_object_id)
    references app.attachment_objects(user_id, entry_id, attachment_id, id) on delete restrict,
  check (
    (job_kind = 'transcription' and entry_id is not null and revision_id is not null
      and attachment_id is not null and source_object_id is not null
      and source_sha256 is not null and source_kind is not null
      and source_duration_ms is not null and insight_scope is null
      and source_snapshot is null)
    or
    (job_kind = 'insight' and insight_scope is not null and source_snapshot is not null
      and source_snapshot_sha256 is not null and attachment_id is null
      and source_object_id is null and source_sha256 is null and source_kind is null)
  )
);

create table app.transcripts (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null,
  job_id uuid not null unique,
  entry_id uuid not null,
  revision_id uuid not null,
  attachment_id uuid not null,
  source_object_id uuid not null,
  source_sha256 bytea not null check (octet_length(source_sha256) = 32),
  source_kind text not null check (source_kind in ('audio','video_audio')),
  machine_text text null check (machine_text is null or char_length(machine_text) <= 100000),
  language text null check (language is null or char_length(language) between 2 and 35),
  language_hint text null check (language_hint is null or char_length(language_hint) between 2 and 35),
  language_confidence numeric(4,3) null check (language_confidence between 0 and 1),
  timing_kind text null check (timing_kind is null or timing_kind in ('segment','utterance')),
  provider_id text not null,
  model_id text not null,
  status text not null check (status in ('ready','stale','deleted')),
  current boolean not null default true,
  search_enabled boolean not null default false,
  created_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz not null default statement_timestamp(),
  stale_at timestamptz null,
  deleted_at timestamptz null,
  updated_at timestamptz not null default statement_timestamp(),
  unique (user_id, id),
  unique (user_id, entry_id, attachment_id, id),
  constraint transcripts_job_fk foreign key (user_id, job_id)
    references app.ai_jobs(user_id, id) on delete restrict,
  constraint transcripts_revision_fk foreign key (user_id, entry_id, revision_id)
    references app.entry_revisions(user_id, entry_id, id) on delete restrict,
  constraint transcripts_attachment_fk foreign key (user_id, entry_id, attachment_id)
    references app.attachments(user_id, entry_id, id) on delete restrict,
  constraint transcripts_object_fk foreign key (user_id, entry_id, attachment_id, source_object_id)
    references app.attachment_objects(user_id, entry_id, attachment_id, id) on delete restrict,
  check ((status = 'deleted' and machine_text is null and deleted_at is not null
      and not current and not search_enabled)
    or (status <> 'deleted' and machine_text is not null and deleted_at is null)),
  check (status = 'ready' or not search_enabled)
);
create unique index transcripts_current_source_idx
  on app.transcripts (user_id, entry_id, revision_id, attachment_id)
  where current;

create table app.transcript_segments (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null,
  transcript_id uuid not null,
  position smallint not null check (position between 0 and 499),
  start_ms integer not null check (start_ms >= 0),
  end_ms integer not null check (end_ms >= start_ms),
  machine_text text not null check (char_length(machine_text) between 1 and 2000),
  created_at timestamptz not null default statement_timestamp(),
  unique (user_id, transcript_id, id),
  unique (user_id, transcript_id, position),
  constraint transcript_segments_transcript_fk foreign key (user_id, transcript_id)
    references app.transcripts(user_id, id) on delete cascade
);

create table app.transcript_corrections (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null,
  transcript_id uuid not null,
  segment_id uuid not null,
  corrected_text text not null check (char_length(corrected_text) between 1 and 2000),
  created_at timestamptz not null default statement_timestamp(),
  constraint transcript_corrections_segment_fk
    foreign key (user_id, transcript_id, segment_id)
    references app.transcript_segments(user_id, transcript_id, id) on delete cascade
);

create table app.insights (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references app.profiles(user_id) on delete cascade,
  job_id uuid not null unique,
  scope text not null check (scope in ('entry','day','range','week','month')),
  range_start date not null,
  range_end date not null,
  title text null check (title is null or char_length(title) between 1 and 120),
  summary text null check (summary is null or char_length(summary) between 1 and 4000),
  key_moments jsonb not null default '[]'::jsonb check (jsonb_typeof(key_moments) = 'array'),
  topics jsonb not null default '[]'::jsonb check (jsonb_typeof(topics) = 'array'),
  open_loops jsonb not null default '[]'::jsonb check (jsonb_typeof(open_loops) = 'array'),
  limitations text null check (limitations is null or char_length(limitations) between 1 and 1000),
  provider_id text not null,
  model_id text not null,
  source_snapshot_sha256 bytea not null check (octet_length(source_snapshot_sha256) = 32),
  status text not null check (status in ('ready','stale','deleted')),
  created_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz not null default statement_timestamp(),
  stale_at timestamptz null,
  deleted_at timestamptz null,
  updated_at timestamptz not null default statement_timestamp(),
  unique (user_id, id),
  constraint insights_job_fk foreign key (user_id, job_id)
    references app.ai_jobs(user_id, id) on delete restrict,
  check ((status = 'deleted' and title is null and summary is null and limitations is null
      and deleted_at is not null)
    or (status <> 'deleted' and title is not null and summary is not null
      and limitations is not null and deleted_at is null))
);

create table app.insight_sources (
  id uuid primary key,
  user_id uuid not null,
  insight_id uuid not null,
  entry_id uuid not null,
  revision_id uuid not null,
  transcript_id uuid null,
  source_position smallint not null check (source_position between 0 and 99),
  occurred_local_date date not null,
  evidence_excerpt text not null check (char_length(evidence_excerpt) between 1 and 1000),
  start_ms integer null check (start_ms is null or start_ms >= 0),
  end_ms integer null check (end_ms is null or end_ms >= start_ms),
  source_unavailable boolean not null default false,
  created_at timestamptz not null default statement_timestamp(),
  unique (user_id, insight_id, source_position),
  constraint insight_sources_insight_fk foreign key (user_id, insight_id)
    references app.insights(user_id, id) on delete cascade,
  constraint insight_sources_revision_fk foreign key (user_id, entry_id, revision_id)
    references app.entry_revisions(user_id, entry_id, id) on delete restrict,
  constraint insight_sources_transcript_fk foreign key (user_id, transcript_id)
    references app.transcripts(user_id, id) on delete restrict
);

create table app.ai_usage_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references app.profiles(user_id) on delete cascade,
  job_id uuid not null,
  usage_kind text not null check (usage_kind in ('transcription','insight')),
  duration_ms integer not null default 0 check (duration_ms between 0 and 600000),
  input_characters integer not null default 0 check (input_characters between 0 and 100000),
  output_characters integer not null default 0 check (output_characters between 0 and 20000),
  cost_microunits bigint not null default 0 check (cost_microunits >= 0),
  created_at timestamptz not null default statement_timestamp(),
  unique (user_id, job_id),
  constraint ai_usage_job_fk foreign key (user_id, job_id)
    references app.ai_jobs(user_id, id) on delete restrict
);

create index ai_jobs_claim_idx on app.ai_jobs (status, queued_at, id)
  where status in ('queued','sending','transcribing','processing_response','generating');
create index ai_jobs_owner_idx on app.ai_jobs (user_id, updated_at desc);
create index transcripts_entry_idx on app.transcripts (user_id, entry_id, completed_at desc);
create index transcript_segments_order_idx on app.transcript_segments (user_id, transcript_id, position);
create index transcript_corrections_latest_idx on app.transcript_corrections
  (user_id, transcript_id, segment_id, created_at desc, id desc);
create index insights_owner_idx on app.insights (user_id, created_at desc) where status <> 'deleted';
create index insight_sources_entry_idx on app.insight_sources (user_id, entry_id, revision_id);
create index ai_usage_owner_day_idx on app.ai_usage_events (user_id, created_at);

alter table app.entry_search_documents
  add column transcript_text text not null default '',
  add column has_transcript boolean not null default false;

create trigger ai_settings_set_updated_at before update on app.ai_settings
  for each row execute function app.set_updated_at();
create trigger ai_worker_principals_set_updated_at before update on app.ai_worker_principals
  for each row execute function app.set_updated_at();
create trigger ai_jobs_set_updated_at before update on app.ai_jobs
  for each row execute function app.set_updated_at();
create trigger transcripts_set_updated_at before update on app.transcripts
  for each row execute function app.set_updated_at();
create trigger insights_set_updated_at before update on app.insights
  for each row execute function app.set_updated_at();

create function app.reject_ai_audit_mutation()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception using errcode = 'P0001', message = 'odiina_ai_audit_immutable';
end
$$;
create trigger ai_consent_events_immutable before update or delete on app.ai_consent_events
  for each row execute function app.reject_ai_audit_mutation();
create trigger transcript_corrections_immutable before update on app.transcript_corrections
  for each row execute function app.reject_ai_audit_mutation();
create trigger ai_usage_events_immutable before update or delete on app.ai_usage_events
  for each row execute function app.reject_ai_audit_mutation();

create function app.ai_worker_actor_id()
returns uuid language sql stable security invoker set search_path = '' as $$
  with claims as (
    select nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb value
  )
  select case when value -> 'app_metadata' ->> 'odiina_ai_worker' = 'true'
    then nullif(value ->> 'sub', '')::uuid else null end from claims
$$;

create function app.ai_worker_generation()
returns integer language sql stable security invoker set search_path = '' as $$
  select case when nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb
      -> 'app_metadata' ->> 'odiina_ai_worker' = 'true'
    then (nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb
      -> 'app_metadata' ->> 'ai_worker_generation')::integer else null end
$$;

create function app.require_active_ai_worker()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app.ai_worker_actor_id();
begin
  if actor is null or not exists (
    select 1 from app.ai_worker_principals p where p.auth_user_id = actor
      and p.active and p.generation = app.ai_worker_generation()
  ) then
    raise exception using errcode = 'P0001', message = 'odiina_ai_worker_required';
  end if;
  return actor;
end
$$;
alter function app.require_active_ai_worker() owner to odiina_ai_worker_api;

-- All new tables are private, owner scoped and forced through RLS.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'ai_settings','ai_consent_events','ai_worker_principals','ai_jobs',
    'transcripts','transcript_segments','transcript_corrections','insights',
    'insight_sources','ai_usage_events'
  ] loop
    execute format('alter table app.%I enable row level security', table_name);
    execute format('alter table app.%I force row level security', table_name);
  end loop;
end
$$;

create policy ai_settings_owner_read on app.ai_settings for select to authenticated
  using (user_id = (select app.request_user_id()));
create policy ai_settings_owner_api on app.ai_settings for all to odiina_owner_api
  using (user_id = (select app.request_user_id()))
  with check (user_id = (select app.request_user_id()));
create policy ai_consent_owner_read on app.ai_consent_events for select to authenticated
  using (user_id = (select app.request_user_id()));
create policy ai_consent_owner_api on app.ai_consent_events for all to odiina_owner_api
  using (user_id = (select app.request_user_id()))
  with check (user_id = (select app.request_user_id()));
create policy ai_jobs_owner_read on app.ai_jobs for select to authenticated
  using (user_id = (select app.request_user_id()));
create policy ai_jobs_owner_api on app.ai_jobs for all to odiina_owner_api
  using (user_id = (select app.request_user_id()))
  with check (user_id = (select app.request_user_id()));
create policy transcripts_owner_read on app.transcripts for select to authenticated
  using (user_id = (select app.request_user_id()));
create policy transcripts_owner_api on app.transcripts for all to odiina_owner_api
  using (user_id = (select app.request_user_id()))
  with check (user_id = (select app.request_user_id()));
create policy transcript_segments_owner_read on app.transcript_segments for select to authenticated
  using (user_id = (select app.request_user_id()));
create policy transcript_segments_owner_api on app.transcript_segments for all to odiina_owner_api
  using (user_id = (select app.request_user_id()))
  with check (user_id = (select app.request_user_id()));
create policy transcript_corrections_owner_read on app.transcript_corrections for select to authenticated
  using (user_id = (select app.request_user_id()));
create policy transcript_corrections_owner_api on app.transcript_corrections for all to odiina_owner_api
  using (user_id = (select app.request_user_id()))
  with check (user_id = (select app.request_user_id()));
create policy insights_owner_read on app.insights for select to authenticated
  using (user_id = (select app.request_user_id()));
create policy insights_owner_api on app.insights for all to odiina_owner_api
  using (user_id = (select app.request_user_id()))
  with check (user_id = (select app.request_user_id()));
create policy insight_sources_owner_read on app.insight_sources for select to authenticated
  using (user_id = (select app.request_user_id()));
create policy insight_sources_owner_api on app.insight_sources for all to odiina_owner_api
  using (user_id = (select app.request_user_id()))
  with check (user_id = (select app.request_user_id()));
create policy ai_usage_owner_read on app.ai_usage_events for select to authenticated
  using (user_id = (select app.request_user_id()));
create policy ai_usage_owner_api on app.ai_usage_events for all to odiina_owner_api
  using (user_id = (select app.request_user_id()))
  with check (user_id = (select app.request_user_id()));
create policy ai_worker_principals_worker on app.ai_worker_principals for all to odiina_ai_worker_api
  using (true) with check (true);
create policy ai_worker_principals_provisioner on app.ai_worker_principals for all to odiina_provisioner
  using (true) with check (true);

-- A worker can see content only while inside its narrowly granted RPCs.
create policy ai_settings_worker on app.ai_settings for select to odiina_ai_worker_api
  using (app.ai_worker_actor_id() is not null or user_id=app.request_user_id());
create policy ai_jobs_worker on app.ai_jobs for all to odiina_ai_worker_api
  using (app.ai_worker_actor_id() is not null) with check (app.ai_worker_actor_id() is not null);
create policy transcripts_worker on app.transcripts for all to odiina_ai_worker_api
  using (app.ai_worker_actor_id() is not null or user_id=app.request_user_id())
  with check (app.ai_worker_actor_id() is not null or user_id=app.request_user_id());
create policy transcript_segments_worker on app.transcript_segments for all to odiina_ai_worker_api
  using (app.ai_worker_actor_id() is not null or user_id=app.request_user_id())
  with check (app.ai_worker_actor_id() is not null or user_id=app.request_user_id());
create policy transcript_corrections_worker on app.transcript_corrections for select to odiina_ai_worker_api
  using (app.ai_worker_actor_id() is not null or user_id=app.request_user_id());
create policy insights_worker on app.insights for all to odiina_ai_worker_api
  using (app.ai_worker_actor_id() is not null) with check (app.ai_worker_actor_id() is not null);
create policy insight_sources_worker on app.insight_sources for all to odiina_ai_worker_api
  using (app.ai_worker_actor_id() is not null) with check (app.ai_worker_actor_id() is not null);
create policy ai_usage_worker on app.ai_usage_events for insert to odiina_ai_worker_api
  with check (app.ai_worker_actor_id() is not null);
create policy entries_ai_worker_read on app.entries for select to odiina_ai_worker_api
  using (app.ai_worker_actor_id() is not null or user_id=app.request_user_id());
create policy revisions_ai_worker_read on app.entry_revisions for select to odiina_ai_worker_api
  using (app.ai_worker_actor_id() is not null or user_id=app.request_user_id());
create policy attachments_ai_worker_read on app.attachments for select to odiina_ai_worker_api
  using (app.ai_worker_actor_id() is not null or user_id=app.request_user_id());
create policy revision_attachments_ai_worker_read on app.entry_revision_attachments
  for select to odiina_ai_worker_api
  using (app.ai_worker_actor_id() is not null or user_id=app.request_user_id());
create policy objects_ai_worker_read on app.attachment_objects for select to odiina_ai_worker_api
  using (app.ai_worker_actor_id() is not null or user_id=app.request_user_id());
create policy audio_metadata_ai_worker_read on app.audio_metadata for select to odiina_ai_worker_api
  using (app.ai_worker_actor_id() is not null or user_id=app.request_user_id());
create policy video_metadata_ai_worker_read on app.video_metadata for select to odiina_ai_worker_api
  using (app.ai_worker_actor_id() is not null or user_id=app.request_user_id());
create policy search_documents_ai_worker_update on app.entry_search_documents for all to odiina_ai_worker_api
  using (app.ai_worker_actor_id() is not null or user_id=app.request_user_id())
  with check (app.ai_worker_actor_id() is not null or user_id=app.request_user_id());

grant select on app.ai_settings, app.ai_consent_events, app.ai_jobs, app.transcripts,
  app.transcript_segments, app.transcript_corrections, app.insights,
  app.insight_sources, app.ai_usage_events to authenticated;
grant select, insert, update, delete on app.ai_settings, app.ai_consent_events,
  app.ai_jobs, app.transcripts, app.transcript_segments,
  app.transcript_corrections, app.insights, app.insight_sources,
  app.ai_usage_events to odiina_owner_api;
grant select, insert, update, delete on app.ai_jobs, app.transcripts,
  app.transcript_segments, app.insights, app.insight_sources to odiina_ai_worker_api;
grant select on app.ai_settings, app.transcript_corrections, app.entries,
  app.entry_revisions, app.attachments, app.attachment_objects,
  app.entry_revision_attachments,
  app.audio_metadata, app.video_metadata to odiina_ai_worker_api;
grant insert on app.ai_usage_events to odiina_ai_worker_api;
grant select, update on app.entry_search_documents to odiina_ai_worker_api;
grant select, insert, update on app.ai_worker_principals to odiina_ai_worker_api, odiina_provisioner;

insert into app.ai_settings (user_id)
select p.user_id from app.profiles p on conflict do nothing;

grant select, insert on app.ai_settings to odiina_provisioner;
create policy ai_settings_provisioner on app.ai_settings for all to odiina_provisioner
  using (true) with check (true);

grant odiina_provisioner to postgres;
grant create on schema app to odiina_provisioner;
set role odiina_provisioner;
create or replace function app.provision_account()
returns trigger language plpgsql security definer set search_path = '' as $$
declare default_handle text := 'member_' || left(pg_catalog.md5(new.id::text), 23);
begin
  if coalesce((new.raw_app_meta_data ->> 'odiina_worker')::boolean, false)
    or coalesce((new.raw_app_meta_data ->> 'odiina_ai_worker')::boolean, false) then
    return new;
  end if;
  insert into app.profiles (user_id, display_name, handle, handle_normalized, bio)
  values (new.id, 'Odiina member', default_handle, default_handle, '');
  insert into app.user_preferences (user_id) values (new.id);
  insert into app.ai_settings (user_id) values (new.id);
  return new;
end
$$;
reset role;
revoke create on schema app from odiina_provisioner;
revoke odiina_provisioner from postgres;

-- User consent updates are race safe, append-only and cancel queued work.
create function app.update_ai_settings(
  p_master_enabled boolean,
  p_transcription_enabled boolean,
  p_insights_enabled boolean,
  p_transcript_search_enabled boolean,
  p_auto_transcribe_enabled boolean,
  p_consent_policy_version text,
  p_provider_policy_version text,
  p_source_surface text
)
returns setof app.ai_settings
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := app.request_user_id();
  previous app.ai_settings%rowtype;
  next_version integer;
  feature_name text;
  previous_enabled boolean;
  requested_enabled boolean;
  changed_entry_id uuid;
begin
  if actor is null then raise exception using errcode='P0001',message='odiina_auth_required'; end if;
  if p_master_enabled is null or p_transcription_enabled is null
    or p_insights_enabled is null or p_transcript_search_enabled is null
    or p_auto_transcribe_enabled is null or p_auto_transcribe_enabled
    or p_source_surface <> 'settings_ai'
    or p_consent_policy_version <> 'odiina-ai-consent-v1'
    or (not p_master_enabled and (p_transcription_enabled or p_insights_enabled
      or p_transcript_search_enabled))
    or (p_transcript_search_enabled and not p_transcription_enabled) then
    raise exception using errcode='P0001',message='odiina_ai_settings_invalid';
  end if;
  select * into previous from app.ai_settings where user_id=actor for update;
  next_version := previous.consent_version + 1;
  update app.ai_settings set master_enabled=p_master_enabled,
    transcription_enabled=p_transcription_enabled,
    insights_enabled=p_insights_enabled,
    transcript_search_enabled=p_transcript_search_enabled,
    auto_transcribe_enabled=false, consent_version=next_version,
    consent_policy_version=p_consent_policy_version,
    provider_policy_version=p_provider_policy_version
  where user_id=actor;
  for feature_name, previous_enabled, requested_enabled in
    select * from (values
      ('master',previous.master_enabled,p_master_enabled),
      ('transcription',previous.transcription_enabled,p_transcription_enabled),
      ('insights',previous.insights_enabled,p_insights_enabled),
      ('transcript_search',previous.transcript_search_enabled,p_transcript_search_enabled),
      ('auto_transcribe',previous.auto_transcribe_enabled,false)
    ) changed(changed_feature,prior_enabled,next_enabled)
    where prior_enabled is distinct from next_enabled
  loop
    insert into app.ai_consent_events(user_id,consent_version,feature,enabled,
      consent_policy_version,provider_policy_version,source_surface)
    values(actor,next_version,feature_name,requested_enabled,p_consent_policy_version,
      p_provider_policy_version,p_source_surface);
  end loop;
  if not p_master_enabled then
    update app.ai_jobs set status='canceled',cancel_requested=true,
      safe_error_code='consent_revoked',completed_at=statement_timestamp()
    where user_id=actor and status='queued';
    update app.ai_jobs set cancel_requested=true,safe_error_code='consent_revoked'
    where user_id=actor and status in ('sending','transcribing','processing_response','generating');
  end if;
  update app.transcripts set search_enabled=p_transcript_search_enabled
  where user_id=actor and current and status='ready'
    and search_enabled is distinct from p_transcript_search_enabled;
  for changed_entry_id in select id from app.entries where user_id=actor loop
    perform app.refresh_ai_search_document(actor,changed_entry_id);
  end loop;
  return query select * from app.ai_settings where user_id=actor;
end
$$;
alter function app.update_ai_settings(boolean,boolean,boolean,boolean,boolean,text,text,text)
  owner to odiina_owner_api;

create function app.request_transcription(
  p_entry_id uuid, p_revision_id uuid, p_attachment_id uuid,
  p_client_request_id uuid, p_language_hint text
)
returns table (job_id uuid, job_status text)
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := app.request_user_id(); settings app.ai_settings%rowtype;
  existing app.ai_jobs%rowtype; selected record; created_id uuid := extensions.gen_random_uuid();
  used_ms bigint; active_jobs integer;
begin
  if actor is null then raise exception using errcode='P0001',message='odiina_auth_required'; end if;
  if p_client_request_id is null or (p_language_hint is not null
    and char_length(p_language_hint) not between 2 and 35) then
    raise exception using errcode='P0001',message='odiina_transcription_request_invalid';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor::text||':'||p_client_request_id::text,0));
  select * into existing from app.ai_jobs where user_id=actor
    and job_kind='transcription' and client_request_id=p_client_request_id;
  if found then return query select existing.id,existing.status; return; end if;
  select * into settings from app.ai_settings where user_id=actor for share;
  if not settings.master_enabled or not settings.transcription_enabled then
    raise exception using errcode='P0001',message='odiina_transcription_consent_required';
  end if;
  select e.id entry_id,e.current_revision_id,a.media_kind,o.id object_id,o.sha256,
    case when a.media_kind='audio' then am.playback_duration_ms
      else vm.playback_duration_ms end duration_ms,
    case when a.media_kind='audio' then 'audio' else 'video_audio' end source_kind
  into selected
  from app.entries e
  join app.entry_revision_attachments ra on ra.user_id=e.user_id and ra.entry_id=e.id
    and ra.revision_id=e.current_revision_id and ra.attachment_id=p_attachment_id
  join app.attachments a on a.user_id=e.user_id and a.entry_id=e.id and a.id=ra.attachment_id
  join app.attachment_objects o on o.user_id=a.user_id and o.entry_id=a.entry_id
    and o.attachment_id=a.id and o.variant='playback' and o.state='verified'
  left join app.audio_metadata am on am.user_id=a.user_id and am.entry_id=a.entry_id
    and am.attachment_id=a.id
  left join app.video_metadata vm on vm.user_id=a.user_id and vm.entry_id=a.entry_id
    and vm.attachment_id=a.id
  where e.user_id=actor and e.id=p_entry_id and e.current_revision_id=p_revision_id
    and e.lifecycle_state='active' and a.state='accepted'
    and (a.media_kind='audio' or (a.media_kind='video' and vm.has_audio));
  if not found or selected.sha256 is null then
    if exists(select 1 from app.attachments a join app.video_metadata vm
      on vm.user_id=a.user_id and vm.entry_id=a.entry_id and vm.attachment_id=a.id
      where a.user_id=actor and a.id=p_attachment_id and a.media_kind='video' and not vm.has_audio) then
      raise exception using errcode='P0001',message='odiina_video_has_no_audio';
    end if;
    raise exception using errcode='P0001',message='odiina_transcription_source_unavailable';
  end if;
  select coalesce(sum(duration_ms),0) into used_ms from app.ai_usage_events
    where user_id=actor and usage_kind='transcription'
      and created_at >= date_trunc('month',statement_timestamp());
  if used_ms + selected.duration_ms > 72000000 then
    raise exception using errcode='P0001',message='odiina_monthly_transcription_quota';
  end if;
  select count(*) into active_jobs from app.ai_jobs where user_id=actor
    and status in ('queued','sending','transcribing','processing_response','generating');
  if active_jobs >= 2 then raise exception using errcode='P0001',message='odiina_concurrent_job_limit'; end if;
  insert into app.ai_jobs(id,user_id,job_kind,client_request_id,consent_version,
    provider_id,model_id,entry_id,revision_id,attachment_id,source_object_id,
    source_sha256,source_kind,source_duration_ms,language_hint)
  values(created_id,actor,'transcription',p_client_request_id,settings.consent_version,
    'fake-local','deterministic-transcript-v1',p_entry_id,p_revision_id,p_attachment_id,
    selected.object_id,selected.sha256,selected.source_kind,selected.duration_ms,p_language_hint);
  return query select created_id,'queued'::text;
end
$$;
alter function app.request_transcription(uuid,uuid,uuid,uuid,text) owner to odiina_owner_api;

create function app.build_insight_source_snapshot(
  p_scope text, p_entry_id uuid, p_from date, p_to date,
  p_tag_names text[], p_media text[], p_include_authored_text boolean,
  p_include_transcripts boolean, p_include_place_labels boolean
)
returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare actor uuid := app.request_user_id(); result jsonb;
begin
  if actor is null or p_scope not in ('entry','day','range','week','month')
    or p_from is null or p_to is null or p_from > p_to or p_to-p_from > 31
    or (p_scope='entry' and p_entry_id is null)
    or coalesce(cardinality(p_tag_names),0)>10 or coalesce(cardinality(p_media),0)>5
    or exists(select 1 from unnest(coalesce(p_media,array[]::text[])) m
      where m not in ('text','image','audio','video','place')) then
    raise exception using errcode='P0001',message='odiina_insight_scope_invalid';
  end if;
  with selected as (
    select d.user_id,d.entry_id,d.revision_id,d.occurred_local_date,
      case when p_include_authored_text then nullif(d.body_text,'') end authored_text,
      case when p_include_place_labels then nullif(d.place_name,'') end place_label,
      case when p_include_transcripts then nullif(d.transcript_text,'') end transcript_text,
      extensions.gen_random_uuid() source_id
    from app.entry_search_documents d
    where d.user_id=actor and d.lifecycle_state='active'
      and d.occurred_local_date between p_from and p_to
      and (p_scope<>'entry' or d.entry_id=p_entry_id)
      and not exists (
        select 1 from unnest(coalesce(p_tag_names,array[]::text[])) wanted
        where not exists(select 1 from unnest(d.tag_normalized_names) actual
          where actual=pg_catalog.lower(pg_catalog.normalize(pg_catalog.btrim(wanted),'NFKC')))
      )
      and (cardinality(coalesce(p_media,array[]::text[]))=0
        or ('text'=any(p_media) and d.has_text)
        or ('image'=any(p_media) and d.has_image)
        or ('audio'=any(p_media) and d.has_audio)
        or ('video'=any(p_media) and d.has_video)
        or ('place'=any(p_media) and d.has_place))
    order by d.occurred_at,d.entry_id limit 101
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'sourceId',source_id,'entryId',entry_id,'revisionId',revision_id,
    'occurredLocalDate',occurred_local_date,'authoredText',authored_text,
    'transcriptText',transcript_text,'placeLabel',place_label
  ) order by occurred_local_date,entry_id),'[]'::jsonb) into result from selected;
  if jsonb_array_length(result)=0 then
    raise exception using errcode='P0001',message='odiina_insight_sources_empty';
  end if;
  if jsonb_array_length(result)>100 or char_length(result::text)>100000 then
    raise exception using errcode='P0001',message='odiina_insight_input_limit';
  end if;
  return result;
end
$$;

create function app.preview_insight(
  p_scope text, p_entry_id uuid, p_from date, p_to date,
  p_tag_names text[], p_media text[], p_include_authored_text boolean,
  p_include_transcripts boolean, p_include_place_labels boolean
)
returns table(entry_count integer,input_characters integer,transcript_count integer)
language plpgsql stable security definer set search_path = '' as $$
declare snapshot jsonb;
begin
  snapshot := app.build_insight_source_snapshot(p_scope,p_entry_id,p_from,p_to,
    p_tag_names,p_media,p_include_authored_text,p_include_transcripts,p_include_place_labels);
  return query select jsonb_array_length(snapshot),char_length(snapshot::text),
    (select count(*)::integer from jsonb_array_elements(snapshot) source
      where source->>'transcriptText' is not null);
end
$$;
alter function app.preview_insight(text,uuid,date,date,text[],text[],boolean,boolean,boolean)
  owner to odiina_owner_api;

create function app.request_insight(
  p_scope text, p_entry_id uuid, p_from date, p_to date,
  p_tag_names text[], p_media text[], p_include_authored_text boolean,
  p_include_transcripts boolean, p_include_place_labels boolean,
  p_client_request_id uuid
)
returns table(job_id uuid,job_status text)
language plpgsql security definer set search_path = '' as $$
declare actor uuid:=app.request_user_id(); settings app.ai_settings%rowtype;
  snapshot jsonb; existing app.ai_jobs%rowtype; created_id uuid:=extensions.gen_random_uuid();
  daily_count integer; monthly_count integer; active_jobs integer;
begin
  if actor is null then raise exception using errcode='P0001',message='odiina_auth_required'; end if;
  if p_client_request_id is null then raise exception using errcode='P0001',message='odiina_insight_request_invalid'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor::text||':'||p_client_request_id::text,0));
  select * into existing from app.ai_jobs where user_id=actor
    and job_kind='insight' and client_request_id=p_client_request_id;
  if found then return query select existing.id,existing.status; return; end if;
  select * into settings from app.ai_settings where user_id=actor for share;
  if not settings.master_enabled or not settings.insights_enabled then
    raise exception using errcode='P0001',message='odiina_insights_consent_required';
  end if;
  snapshot:=app.build_insight_source_snapshot(p_scope,p_entry_id,p_from,p_to,
    p_tag_names,p_media,p_include_authored_text,p_include_transcripts,p_include_place_labels);
  select count(*) filter(where created_at>=date_trunc('day',statement_timestamp())),count(*)
  into daily_count,monthly_count from app.ai_usage_events where user_id=actor
    and usage_kind='insight' and created_at>=date_trunc('month',statement_timestamp());
  if daily_count>=10 or monthly_count>=100 then
    raise exception using errcode='P0001',message='odiina_insight_quota';
  end if;
  select count(*) into active_jobs from app.ai_jobs where user_id=actor
    and status in ('queued','sending','transcribing','processing_response','generating');
  if active_jobs>=2 then raise exception using errcode='P0001',message='odiina_concurrent_job_limit'; end if;
  insert into app.ai_jobs(id,user_id,job_kind,client_request_id,consent_version,
    provider_id,model_id,entry_id,revision_id,insight_scope,range_start,range_end,
    source_snapshot,source_snapshot_sha256)
  values(created_id,actor,'insight',p_client_request_id,settings.consent_version,
    'fake-local','deterministic-insight-v1',case when p_scope='entry' then p_entry_id end,
    case when p_scope='entry' then (snapshot->0->>'revisionId')::uuid end,
    p_scope,p_from,p_to,snapshot,extensions.digest(convert_to(snapshot::text,'UTF8'),'sha256'));
  return query select created_id,'queued'::text;
end
$$;
alter function app.request_insight(text,uuid,date,date,text[],text[],boolean,boolean,boolean,uuid)
  owner to odiina_owner_api;

create function app.register_ai_worker(p_auth_user_id uuid,p_generation integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb->>'role'<>'service_role' then
    raise exception using errcode='42501',message='odiina_service_role_required';
  end if;
  if p_auth_user_id is null or p_generation is null or p_generation<1 then
    raise exception using errcode='P0001',message='odiina_ai_worker_identity_invalid';
  end if;
  delete from app.profiles where user_id=p_auth_user_id;
  insert into app.ai_worker_principals(auth_user_id,generation,active)
  values(p_auth_user_id,p_generation,true)
  on conflict(auth_user_id) do update set generation=excluded.generation,active=true;
end
$$;

create function app.claim_ai_job(p_visibility_seconds integer default 180)
returns table(
  job_id uuid,job_kind text,lease_token uuid,provider_id text,model_id text,
  entry_id uuid,revision_id uuid,attachment_id uuid,source_kind text,
  source_duration_ms integer,source_sha256_hex text,language_hint text,
  bucket_id text,object_key text,source_snapshot jsonb,client_request_id uuid
)
language plpgsql security definer set search_path = '' as $$
declare worker uuid:=app.require_active_ai_worker(); selected app.ai_jobs%rowtype;
  token uuid:=extensions.gen_random_uuid();
begin
  if p_visibility_seconds not between 30 and 600 then
    raise exception using errcode='P0001',message='odiina_ai_lease_invalid';
  end if;
  update app.ai_jobs j set status='canceled',cancel_requested=true,
    safe_error_code='consent_revoked',completed_at=statement_timestamp()
  where j.status='queued' and not exists(select 1 from app.ai_settings s
    where s.user_id=j.user_id and s.master_enabled
      and ((j.job_kind='transcription' and s.transcription_enabled)
        or (j.job_kind='insight' and s.insights_enabled)));
  select j.* into selected from app.ai_jobs j
  where (j.status='queued' or (j.status in ('sending','transcribing','processing_response','generating')
      and j.lease_expires_at<statement_timestamp()))
    and not j.cancel_requested and j.attempts<3
  order by j.queued_at,j.id for update skip locked limit 1;
  if not found then return; end if;
  update app.ai_jobs set status=case when selected.job_kind='transcription'
      then 'sending' else 'generating' end,
    attempts=attempts+1,leased_by=worker,lease_token=token,
    lease_expires_at=statement_timestamp()+make_interval(secs=>p_visibility_seconds),
    heartbeat_at=statement_timestamp(),started_at=coalesce(started_at,statement_timestamp()),
    safe_error_code=null where id=selected.id;
  return query select selected.id,selected.job_kind,token,selected.provider_id,
    selected.model_id,selected.entry_id,selected.revision_id,selected.attachment_id,
    selected.source_kind,selected.source_duration_ms,encode(selected.source_sha256,'hex'),
    selected.language_hint,o.bucket_id,o.object_key,selected.source_snapshot,
    selected.client_request_id
  from (select 1) sentinel
  left join app.attachment_objects o on o.id=selected.source_object_id;
end
$$;
alter function app.claim_ai_job(integer) owner to odiina_ai_worker_api;

create function app.heartbeat_ai_job(
  p_job_id uuid,p_lease_token uuid,p_stage text,p_visibility_seconds integer default 180
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_active_ai_worker();
  if p_stage not in ('sending','transcribing','processing_response','generating')
    or p_visibility_seconds not between 30 and 600 then
    raise exception using errcode='P0001',message='odiina_ai_heartbeat_invalid';
  end if;
  update app.ai_jobs j set status=p_stage,heartbeat_at=statement_timestamp(),
    lease_expires_at=statement_timestamp()+make_interval(secs=>p_visibility_seconds)
  where j.id=p_job_id and j.lease_token=p_lease_token
    and j.leased_by=app.ai_worker_actor_id()
    and j.status in ('sending','transcribing','processing_response','generating')
    and not j.cancel_requested
    and exists(select 1 from app.ai_settings s where s.user_id=j.user_id
      and s.master_enabled and ((j.job_kind='transcription' and s.transcription_enabled)
        or (j.job_kind='insight' and s.insights_enabled)))
    and (j.job_kind<>'transcription' or exists(
      select 1 from app.entries e
      join app.entry_revision_attachments ra on ra.user_id=e.user_id
        and ra.entry_id=e.id and ra.revision_id=e.current_revision_id
        and ra.attachment_id=j.attachment_id
      join app.attachments a on a.user_id=e.user_id and a.id=ra.attachment_id
        and a.state='accepted'
      join app.attachment_objects o on o.user_id=a.user_id and o.attachment_id=a.id
        and o.id=j.source_object_id and o.state='verified' and o.sha256=j.source_sha256
      where e.user_id=j.user_id and e.id=j.entry_id
        and e.current_revision_id=j.revision_id and e.lifecycle_state='active'))
    and (j.job_kind<>'insight' or not exists(
      select 1 from jsonb_array_elements(j.source_snapshot) source
      left join app.entries e on e.user_id=j.user_id
        and e.id=(source->>'entryId')::uuid
      where e.id is null or e.lifecycle_state<>'active'
        or e.current_revision_id<>(source->>'revisionId')::uuid));
  if not found then raise exception using errcode='P0001',message='odiina_ai_lease_lost'; end if;
end
$$;
alter function app.heartbeat_ai_job(uuid,uuid,text,integer) owner to odiina_ai_worker_api;

create function app.finish_transcription_job(
  p_job_id uuid,p_lease_token uuid,p_output jsonb
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare job app.ai_jobs%rowtype; settings app.ai_settings%rowtype;
  transcript_id uuid:=extensions.gen_random_uuid(); segment jsonb; position integer:=0;
  duration integer; full_text text; previous_start integer:=-1;
begin
  perform app.require_active_ai_worker();
  select * into job from app.ai_jobs where id=p_job_id and lease_token=p_lease_token
    and leased_by=app.ai_worker_actor_id() and job_kind='transcription' for update;
  if not found then raise exception using errcode='P0001',message='odiina_ai_lease_lost'; end if;
  select * into settings from app.ai_settings where user_id=job.user_id;
  if job.cancel_requested or not settings.master_enabled or not settings.transcription_enabled then
    update app.ai_jobs set status='canceled',safe_error_code='consent_revoked',
      completed_at=statement_timestamp() where id=job.id;
    raise exception using errcode='P0001',message='odiina_ai_consent_revoked';
  end if;
  if not exists(select 1 from app.entries e join app.entry_revision_attachments ra
      on ra.user_id=e.user_id and ra.entry_id=e.id and ra.revision_id=e.current_revision_id
      and ra.attachment_id=job.attachment_id
    join app.attachments a on a.user_id=e.user_id and a.id=ra.attachment_id and a.state='accepted'
    join app.attachment_objects o on o.user_id=a.user_id and o.attachment_id=a.id
      and o.id=job.source_object_id and o.state='verified' and o.sha256=job.source_sha256
    where e.user_id=job.user_id and e.id=job.entry_id and e.current_revision_id=job.revision_id
      and e.lifecycle_state='active') then
    update app.ai_jobs set status='failed',safe_error_code='source_changed',
      completed_at=statement_timestamp() where id=job.id;
    raise exception using errcode='P0001',message='odiina_ai_source_changed';
  end if;
  if jsonb_typeof(p_output)<>'object' or jsonb_typeof(p_output->'segments')<>'array'
    or jsonb_array_length(p_output->'segments') not between 1 and 500
    or (p_output->>'timingKind') not in ('segment','utterance')
    or char_length(coalesce(p_output->>'language','')) not between 2 and 35 then
    raise exception using errcode='P0001',message='odiina_transcript_output_invalid';
  end if;
  duration:=job.source_duration_ms;
  for segment in select value from jsonb_array_elements(p_output->'segments') loop
    if (segment->>'startMs')::integer<0
      or (segment->>'endMs')::integer<(segment->>'startMs')::integer
      or (segment->>'endMs')::integer>duration+1000
      or char_length(btrim(coalesce(segment->>'text',''))) not between 1 and 2000
      or (segment->>'startMs')::integer<previous_start then
      raise exception using errcode='P0001',message='odiina_transcript_segment_invalid';
    end if;
    previous_start:=(segment->>'startMs')::integer;
    position:=position+1;
  end loop;
  select string_agg(btrim(value->>'text'),' ' order by ordinality) into full_text
    from jsonb_array_elements(p_output->'segments') with ordinality;
  update app.transcripts set current=false,status='stale',search_enabled=false,
    stale_at=statement_timestamp() where user_id=job.user_id and entry_id=job.entry_id
      and attachment_id=job.attachment_id and current;
  insert into app.transcripts(id,user_id,job_id,entry_id,revision_id,attachment_id,
    source_object_id,source_sha256,source_kind,machine_text,language,language_hint,
    language_confidence,timing_kind,provider_id,model_id,status,search_enabled)
  values(transcript_id,job.user_id,job.id,job.entry_id,job.revision_id,job.attachment_id,
    job.source_object_id,job.source_sha256,job.source_kind,full_text,p_output->>'language',
    job.language_hint,case when p_output->>'languageConfidence' is null then null
      else (p_output->>'languageConfidence')::numeric end,p_output->>'timingKind',
    job.provider_id,job.model_id,'ready',settings.transcript_search_enabled);
  position:=0;
  for segment in select value from jsonb_array_elements(p_output->'segments') loop
    insert into app.transcript_segments(user_id,transcript_id,position,start_ms,end_ms,machine_text)
    values(job.user_id,transcript_id,position,(segment->>'startMs')::integer,
      (segment->>'endMs')::integer,btrim(segment->>'text'));
    position:=position+1;
  end loop;
  insert into app.ai_usage_events(user_id,job_id,usage_kind,duration_ms,output_characters)
    values(job.user_id,job.id,'transcription',job.source_duration_ms,char_length(full_text));
  update app.ai_jobs set status='ready',completed_at=statement_timestamp(),
    lease_expires_at=null,heartbeat_at=statement_timestamp() where id=job.id;
  perform app.refresh_ai_search_document(job.user_id,job.entry_id);
  return transcript_id;
end
$$;

create function app.refresh_ai_search_document(p_user_id uuid,p_entry_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare transcript_value text:=''; enabled boolean:=false;
begin
  if app.ai_worker_actor_id() is null and app.request_user_id()<>p_user_id then
    raise exception using errcode='P0001',message='odiina_owner_required';
  end if;
  select s.transcript_search_enabled into enabled from app.ai_settings s
    where s.user_id=p_user_id;
  if enabled then
    select coalesce(string_agg(coalesce(c.corrected_text,seg.machine_text),' '
      order by seg.position),'') into transcript_value
    from app.transcripts t
    join app.entries e on e.user_id=t.user_id and e.id=t.entry_id
      and e.current_revision_id=t.revision_id and e.lifecycle_state='active'
    join app.entry_revision_attachments ra on ra.user_id=t.user_id
      and ra.entry_id=t.entry_id and ra.revision_id=t.revision_id
      and ra.attachment_id=t.attachment_id
    join app.attachments a on a.user_id=t.user_id and a.id=t.attachment_id
      and a.state='accepted'
    join app.attachment_objects o on o.user_id=t.user_id and o.id=t.source_object_id
      and o.state='verified' and o.sha256=t.source_sha256
    join app.transcript_segments seg on seg.user_id=t.user_id and seg.transcript_id=t.id
    left join lateral (
      select tc.corrected_text from app.transcript_corrections tc
      where tc.user_id=seg.user_id and tc.transcript_id=seg.transcript_id
        and tc.segment_id=seg.id order by tc.created_at desc,tc.id desc limit 1
    ) c on true
    where t.user_id=p_user_id and t.entry_id=p_entry_id and t.current
      and t.status='ready' and t.search_enabled;
  end if;
  update app.entry_search_documents d set transcript_text=transcript_value,
    has_transcript=btrim(transcript_value)<>'',
    normalized_document=pg_catalog.lower(pg_catalog.normalize(concat_ws(' ',
      d.body_text,d.place_name,d.place_details,d.tag_text,transcript_value),'NFKC')),
    search_vector=setweight(to_tsvector('simple',d.tag_text),'A')
      ||setweight(to_tsvector('simple',d.body_text),'B')
      ||setweight(to_tsvector('simple',d.place_name),'C')
      ||setweight(to_tsvector('simple',d.place_details),'D')
      ||setweight(to_tsvector('simple',transcript_value),'D'),
    updated_at=statement_timestamp()
  where d.user_id=p_user_id and d.entry_id=p_entry_id;
end
$$;
alter function app.refresh_ai_search_document(uuid,uuid) owner to odiina_ai_worker_api;
grant execute on function app.refresh_ai_search_document(uuid,uuid)
  to odiina_owner_api,odiina_ai_worker_api;

create function app.finish_insight_job(
  p_job_id uuid,p_lease_token uuid,p_output jsonb
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare job app.ai_jobs%rowtype; settings app.ai_settings%rowtype;
  insight_id uuid:=extensions.gen_random_uuid(); citation jsonb; source jsonb;
  position integer:=0; output_chars integer;
begin
  perform app.require_active_ai_worker();
  select * into job from app.ai_jobs where id=p_job_id and lease_token=p_lease_token
    and leased_by=app.ai_worker_actor_id() and job_kind='insight' for update;
  if not found then raise exception using errcode='P0001',message='odiina_ai_lease_lost'; end if;
  select * into settings from app.ai_settings where user_id=job.user_id;
  if job.cancel_requested or not settings.master_enabled or not settings.insights_enabled then
    update app.ai_jobs set status='canceled',safe_error_code='consent_revoked',
      completed_at=statement_timestamp() where id=job.id;
    raise exception using errcode='P0001',message='odiina_ai_consent_revoked';
  end if;
  if jsonb_typeof(p_output)<>'object' or char_length(btrim(coalesce(p_output->>'title',''))) not between 1 and 120
    or char_length(btrim(coalesce(p_output->>'summary',''))) not between 1 and 4000
    or char_length(btrim(coalesce(p_output->>'limitations',''))) not between 1 and 1000
    or jsonb_typeof(p_output->'citations')<>'array'
    or jsonb_array_length(p_output->'citations') not between 1 and 100
    or jsonb_typeof(p_output->'keyMoments')<>'array'
    or jsonb_typeof(p_output->'topics')<>'array'
    or jsonb_typeof(p_output->'openLoops')<>'array' then
    raise exception using errcode='P0001',message='odiina_insight_output_invalid';
  end if;
  for citation in select value from jsonb_array_elements(p_output->'citations') loop
    if not exists(select 1 from jsonb_array_elements(job.source_snapshot) allowed
      where allowed->>'sourceId'=citation->>'sourceId')
      or char_length(btrim(coalesce(citation->>'claim',''))) not between 1 and 500 then
      raise exception using errcode='P0001',message='odiina_insight_citation_invalid';
    end if;
  end loop;
  insert into app.insights(id,user_id,job_id,scope,range_start,range_end,title,summary,
    key_moments,topics,open_loops,limitations,provider_id,model_id,
    source_snapshot_sha256,status)
  values(insight_id,job.user_id,job.id,job.insight_scope,job.range_start,job.range_end,
    btrim(p_output->>'title'),btrim(p_output->>'summary'),p_output->'keyMoments',
    p_output->'topics',p_output->'openLoops',btrim(p_output->>'limitations'),
    job.provider_id,job.model_id,job.source_snapshot_sha256,'ready');
  for citation in select value from jsonb_array_elements(p_output->'citations') loop
    select value into source from jsonb_array_elements(job.source_snapshot)
      where value->>'sourceId'=citation->>'sourceId' limit 1;
    insert into app.insight_sources(id,user_id,insight_id,entry_id,revision_id,
      transcript_id,source_position,occurred_local_date,evidence_excerpt)
    values((source->>'sourceId')::uuid,job.user_id,insight_id,
      (source->>'entryId')::uuid,(source->>'revisionId')::uuid,null,position,
      (source->>'occurredLocalDate')::date,btrim(citation->>'claim'));
    position:=position+1;
  end loop;
  output_chars:=char_length(p_output::text);
  insert into app.ai_usage_events(user_id,job_id,usage_kind,input_characters,
    output_characters,cost_microunits)
  values(job.user_id,job.id,'insight',char_length(job.source_snapshot::text),output_chars,0);
  update app.ai_jobs set status='ready',completed_at=statement_timestamp(),
    lease_expires_at=null,heartbeat_at=statement_timestamp() where id=job.id;
  return insight_id;
end
$$;
alter function app.finish_insight_job(uuid,uuid,jsonb) owner to odiina_ai_worker_api;
alter function app.finish_transcription_job(uuid,uuid,jsonb) owner to odiina_ai_worker_api;

create function app.fail_ai_job(
  p_job_id uuid,p_lease_token uuid,p_error_code text,p_retryable boolean
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_active_ai_worker();
  if p_error_code is null or p_error_code!~'^[a-z0-9_]{1,64}$' then
    raise exception using errcode='P0001',message='odiina_ai_error_invalid';
  end if;
  update app.ai_jobs set status=case when p_retryable and attempts<3 then 'queued'
      when p_retryable then 'dead_letter' else 'failed' end,
    safe_error_code=p_error_code,lease_token=null,leased_by=null,lease_expires_at=null,
    completed_at=case when p_retryable and attempts<3 then null else statement_timestamp() end
  where id=p_job_id and lease_token=p_lease_token and leased_by=app.ai_worker_actor_id()
    and status in ('sending','transcribing','processing_response','generating');
  if not found then raise exception using errcode='P0001',message='odiina_ai_lease_lost'; end if;
end
$$;
alter function app.fail_ai_job(uuid,uuid,text,boolean) owner to odiina_ai_worker_api;

create function app.cancel_ai_job(p_job_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid:=app.request_user_id();
begin
  update app.ai_jobs set status=case when status='queued' then 'canceled' else status end,
    cancel_requested=true,safe_error_code='user_canceled',
    completed_at=case when status='queued' then statement_timestamp() else completed_at end
  where id=p_job_id and user_id=actor
    and status in ('queued','sending','transcribing','processing_response','generating');
  if not found then raise exception using errcode='P0001',message='odiina_ai_job_unavailable'; end if;
end
$$;
alter function app.cancel_ai_job(uuid) owner to odiina_owner_api;

create function app.retry_ai_job(p_job_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid:=app.request_user_id(); selected app.ai_jobs%rowtype;
  settings app.ai_settings%rowtype;
begin
  select * into selected from app.ai_jobs where id=p_job_id and user_id=actor for update;
  select * into settings from app.ai_settings where user_id=actor;
  if not found or selected.status not in ('failed','dead_letter','canceled')
    or selected.attempts>=3 or not settings.master_enabled
    or (selected.job_kind='transcription' and not settings.transcription_enabled)
    or (selected.job_kind='insight' and not settings.insights_enabled) then
    raise exception using errcode='P0001',message='odiina_ai_retry_unavailable';
  end if;
  update app.ai_jobs set status='queued',cancel_requested=false,safe_error_code=null,
    completed_at=null,lease_token=null,leased_by=null,lease_expires_at=null where id=p_job_id;
end
$$;
alter function app.retry_ai_job(uuid) owner to odiina_owner_api;

create function app.correct_transcript_segment(
  p_transcript_id uuid,p_segment_id uuid,p_corrected_text text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor uuid:=app.request_user_id(); correction_id uuid:=extensions.gen_random_uuid();
  target_entry_id uuid;
begin
  if char_length(btrim(coalesce(p_corrected_text,''))) not between 1 and 2000 then
    raise exception using errcode='P0001',message='odiina_transcript_correction_invalid';
  end if;
  select t.entry_id into target_entry_id from app.transcripts t
  join app.transcript_segments s on s.user_id=t.user_id and s.transcript_id=t.id
    and s.id=p_segment_id
  where t.user_id=actor and t.id=p_transcript_id and t.status='ready' and t.current;
  if not found then raise exception using errcode='P0001',message='odiina_transcript_unavailable'; end if;
  insert into app.transcript_corrections(id,user_id,transcript_id,segment_id,corrected_text)
  values(correction_id,actor,p_transcript_id,p_segment_id,btrim(p_corrected_text));
  update app.insights i set status='stale',stale_at=statement_timestamp()
  where i.user_id=actor and i.status='ready' and exists(select 1 from app.insight_sources s
    where s.insight_id=i.id and s.entry_id=target_entry_id);
  perform app.refresh_ai_search_document(actor,target_entry_id);
  return correction_id;
end
$$;
alter function app.correct_transcript_segment(uuid,uuid,text) owner to odiina_owner_api;

create function app.delete_ai_derived_data(p_kind text,p_artifact_id uuid)
returns table(deleted_transcripts integer,deleted_insights integer)
language plpgsql security definer set search_path = '' as $$
declare actor uuid:=app.request_user_id(); transcript_count integer:=0;
  insight_count integer:=0; linked_entry uuid; affected integer;
begin
  if p_kind not in ('transcript','insight','all_transcripts','all_insights','all')
    or (p_kind in ('transcript','insight') and p_artifact_id is null) then
    raise exception using errcode='P0001',message='odiina_derived_delete_invalid';
  end if;
  for linked_entry in select distinct t.entry_id from app.transcripts t
    where t.user_id=actor and t.status<>'deleted'
      and (p_kind in ('all_transcripts','all') or (p_kind='transcript' and t.id=p_artifact_id))
  loop
    delete from app.transcript_corrections c where c.user_id=actor and exists(
      select 1 from app.transcript_segments s join app.transcripts t
        on t.user_id=s.user_id and t.id=s.transcript_id
      where s.id=c.segment_id and t.entry_id=linked_entry
        and (p_kind in ('all_transcripts','all') or t.id=p_artifact_id));
    delete from app.transcript_segments s where s.user_id=actor and exists(
      select 1 from app.transcripts t where t.id=s.transcript_id and t.user_id=actor
        and t.entry_id=linked_entry
        and (p_kind in ('all_transcripts','all') or t.id=p_artifact_id));
    update app.transcripts t set status='deleted',machine_text=null,current=false,
      search_enabled=false,deleted_at=statement_timestamp()
    where t.user_id=actor and t.entry_id=linked_entry and t.status<>'deleted'
      and (p_kind in ('all_transcripts','all') or t.id=p_artifact_id);
    get diagnostics affected=row_count;
    transcript_count:=transcript_count+affected;
    perform app.refresh_ai_search_document(actor,linked_entry);
  end loop;
  if p_kind in ('insight','all_insights','all') then
    delete from app.insight_sources s where s.user_id=actor and exists(
      select 1 from app.insights i where i.id=s.insight_id and i.user_id=actor
        and (p_kind in ('all_insights','all') or i.id=p_artifact_id));
    update app.insights i set status='deleted',title=null,summary=null,
      limitations=null,key_moments='[]',topics='[]',open_loops='[]',
      deleted_at=statement_timestamp()
    where i.user_id=actor and i.status<>'deleted'
      and (p_kind in ('all_insights','all') or i.id=p_artifact_id);
    get diagnostics insight_count=row_count;
  end if;
  update app.ai_jobs set source_snapshot='[]'::jsonb where user_id=actor
    and job_kind='insight' and p_kind='all' and status in ('ready','failed','canceled','dead_letter');
  return query select transcript_count,insight_count;
end
$$;
alter function app.delete_ai_derived_data(text,uuid) owner to odiina_owner_api;

create function app.ai_usage_summary()
returns table(transcription_minutes_month numeric,insight_requests_today bigint,
  insight_requests_month bigint,active_jobs bigint)
language sql stable security definer set search_path = '' as $$
  select round(coalesce(sum(duration_ms) filter(where usage_kind='transcription'
      and created_at>=date_trunc('month',statement_timestamp())),0)/60000.0,1),
    count(*) filter(where usage_kind='insight' and created_at>=date_trunc('day',statement_timestamp())),
    count(*) filter(where usage_kind='insight' and created_at>=date_trunc('month',statement_timestamp())),
    (select count(*) from app.ai_jobs j where j.user_id=app.request_user_id()
      and j.status in ('queued','sending','transcribing','processing_response','generating'))
  from app.ai_usage_events where user_id=app.request_user_id()
$$;
alter function app.ai_usage_summary() owner to odiina_owner_api;

create function app.transcript_match_entries(p_entry_ids uuid[],p_query text)
returns table(entry_id uuid)
language sql stable security definer set search_path = '' as $$
  select d.entry_id from app.entry_search_documents d
  where d.user_id=app.request_user_id() and d.entry_id=any(coalesce(p_entry_ids,array[]::uuid[]))
    and d.has_transcript and char_length(btrim(coalesce(p_query,'')))>=2
    and pg_catalog.lower(d.transcript_text) like '%'
      ||pg_catalog.lower(pg_catalog.normalize(pg_catalog.btrim(p_query),'NFKC'))||'%'
$$;
alter function app.transcript_match_entries(uuid[],text) owner to odiina_owner_api;

create function app.mark_ai_sources_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.current_revision_id is distinct from old.current_revision_id then
    update app.transcripts set status='stale',current=false,search_enabled=false,
      stale_at=statement_timestamp() where user_id=new.user_id and entry_id=new.id
      and current and revision_id<>new.current_revision_id;
    update app.insights i set status='stale',stale_at=statement_timestamp()
    where i.user_id=new.user_id and i.status='ready' and exists(
      select 1 from app.insight_sources s where s.insight_id=i.id and s.entry_id=new.id
        and s.revision_id<>new.current_revision_id);
  end if;
  if new.lifecycle_state is distinct from old.lifecycle_state then
    update app.insight_sources set source_unavailable=(new.lifecycle_state='trashed')
    where user_id=new.user_id and entry_id=new.id;
  end if;
  perform app.refresh_ai_search_document(new.user_id,new.id);
  return new;
end
$$;
alter function app.mark_ai_sources_changed() owner to odiina_owner_api;
create trigger a_entries_mark_ai_sources_changed
after update of current_revision_id,lifecycle_state on app.entries
for each row execute function app.mark_ai_sources_changed();

create function app.mark_ai_place_redacted()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.redacted_at is distinct from old.redacted_at and new.redacted_at is not null then
    update app.insights i set status='stale',stale_at=statement_timestamp()
    where i.user_id=new.user_id and i.status='ready' and exists(
      select 1 from app.insight_sources s where s.insight_id=i.id and s.entry_id=new.entry_id);
  end if;
  return new;
end
$$;
alter function app.mark_ai_place_redacted() owner to odiina_owner_api;
create trigger entry_places_mark_ai_redaction
after update of redacted_at on app.entry_revision_places
for each row execute function app.mark_ai_place_redacted();

-- Worker storage access is limited to the exact currently leased playback object.
create policy ai_worker_playback_read on storage.objects for select to authenticated
using (
  app.ai_worker_actor_id() is not null and exists(
    select 1 from app.ai_jobs j join app.attachment_objects o
      on o.user_id=j.user_id and o.id=j.source_object_id
    where j.leased_by=app.ai_worker_actor_id() and j.lease_token is not null
      and j.lease_expires_at>statement_timestamp()
      and j.status in ('sending','transcribing','processing_response')
      and o.bucket_id=storage.objects.bucket_id and o.object_key=storage.objects.name
      and o.variant='playback' and o.state='verified'
  )
);

-- Grants: authenticated callers reach only owner-derived RPCs; worker RPCs
-- independently require a live restricted principal. PUBLIC and anon get none.
revoke all on function app.reject_ai_audit_mutation() from public,anon,authenticated;
revoke all on function app.ai_worker_actor_id() from public,anon;
revoke all on function app.ai_worker_generation() from public,anon;
revoke all on function app.require_active_ai_worker() from public,anon,authenticated;
revoke all on function app.build_insight_source_snapshot(text,uuid,date,date,text[],text[],boolean,boolean,boolean)
  from public,anon,authenticated;
revoke all on function app.update_ai_settings(boolean,boolean,boolean,boolean,boolean,text,text,text)
  from public,anon;
revoke all on function app.request_transcription(uuid,uuid,uuid,uuid,text) from public,anon;
revoke all on function app.preview_insight(text,uuid,date,date,text[],text[],boolean,boolean,boolean)
  from public,anon;
revoke all on function app.request_insight(text,uuid,date,date,text[],text[],boolean,boolean,boolean,uuid)
  from public,anon;
revoke all on function app.register_ai_worker(uuid,integer) from public,anon,authenticated;
revoke all on function app.claim_ai_job(integer) from public,anon;
revoke all on function app.heartbeat_ai_job(uuid,uuid,text,integer) from public,anon;
revoke all on function app.finish_transcription_job(uuid,uuid,jsonb) from public,anon;
revoke all on function app.finish_insight_job(uuid,uuid,jsonb) from public,anon;
revoke all on function app.fail_ai_job(uuid,uuid,text,boolean) from public,anon;
revoke all on function app.cancel_ai_job(uuid) from public,anon;
revoke all on function app.retry_ai_job(uuid) from public,anon;
revoke all on function app.correct_transcript_segment(uuid,uuid,text) from public,anon;
revoke all on function app.delete_ai_derived_data(text,uuid) from public,anon;
revoke all on function app.ai_usage_summary() from public,anon;
revoke all on function app.transcript_match_entries(uuid[],text) from public,anon;
revoke all on function app.refresh_ai_search_document(uuid,uuid) from public,anon,authenticated;
revoke all on function app.mark_ai_sources_changed() from public,anon,authenticated;
revoke all on function app.mark_ai_place_redacted() from public,anon,authenticated;

grant execute on function app.update_ai_settings(boolean,boolean,boolean,boolean,boolean,text,text,text)
  to authenticated;
grant execute on function app.request_transcription(uuid,uuid,uuid,uuid,text) to authenticated;
grant execute on function app.preview_insight(text,uuid,date,date,text[],text[],boolean,boolean,boolean)
  to authenticated;
grant execute on function app.request_insight(text,uuid,date,date,text[],text[],boolean,boolean,boolean,uuid)
  to authenticated;
grant execute on function app.cancel_ai_job(uuid),app.retry_ai_job(uuid),
  app.correct_transcript_segment(uuid,uuid,text),app.delete_ai_derived_data(text,uuid),
  app.ai_usage_summary(),app.transcript_match_entries(uuid[],text) to authenticated;
grant execute on function app.register_ai_worker(uuid,integer) to service_role;
grant execute on function app.ai_worker_actor_id(),app.ai_worker_generation(),
  app.claim_ai_job(integer),app.heartbeat_ai_job(uuid,uuid,text,integer),
  app.finish_transcription_job(uuid,uuid,jsonb),app.finish_insight_job(uuid,uuid,jsonb),
  app.fail_ai_job(uuid,uuid,text,boolean) to authenticated;
grant execute on function app.require_active_ai_worker() to odiina_ai_worker_api;

-- Allow constrained function owners to call the private helpers they compose.
grant execute on function app.build_insight_source_snapshot(text,uuid,date,date,text[],text[],boolean,boolean,boolean)
  to odiina_owner_api;
grant execute on function app.ai_worker_actor_id(),app.ai_worker_generation()
  to authenticated,odiina_ai_worker_api;
grant execute on function app.request_user_id() to odiina_ai_worker_api;

grant odiina_provisioner to postgres;
grant create on schema app to odiina_provisioner;
alter function app.register_ai_worker(uuid,integer) owner to odiina_provisioner;
revoke create on schema app from odiina_provisioner;
revoke odiina_provisioner from postgres;

revoke create on schema app from odiina_owner_api,odiina_ai_worker_api;
revoke odiina_owner_api,odiina_ai_worker_api from postgres;

comment on table app.ai_settings is 'Current explicit consent switches; every switch defaults off.';
comment on table app.ai_consent_events is 'Append-only non-content consent evidence.';
comment on table app.ai_jobs is 'Durable provider jobs. Audio/text bodies are never stored here outside bounded insight source snapshots.';
comment on table app.transcripts is 'Derived machine transcript bound to an exact accepted media object and hash.';
comment on table app.transcript_corrections is 'Append-only user corrections; machine evidence remains separate.';
comment on table app.insights is 'Private AI-generated evidence summaries with normalized citations.';

commit;
