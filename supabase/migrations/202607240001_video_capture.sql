begin;

alter table app.attachments
  drop constraint attachments_expected_byte_count_check;
alter table app.attachments
  add constraint attachments_expected_byte_count_check
  check (expected_byte_count between 1 and 262144000);

alter table app.attachment_objects
  drop constraint attachment_objects_variant_check,
  drop constraint attachment_objects_bucket_id_check,
  drop constraint attachment_objects_variant_bucket_check;
alter table app.attachment_objects
  add constraint attachment_objects_variant_check
    check (variant in ('quarantine', 'original', 'display', 'ai', 'playback', 'poster')),
  add constraint attachment_objects_bucket_id_check
    check (bucket_id in (
      'odiina-quarantine', 'odiina-originals', 'odiina-display',
      'odiina-ai', 'odiina-playback', 'odiina-posters'
    )),
  add constraint attachment_objects_variant_bucket_check check (
    (variant = 'quarantine' and bucket_id = 'odiina-quarantine')
    or (variant = 'original' and bucket_id = 'odiina-originals')
    or (variant = 'display' and bucket_id = 'odiina-display')
    or (variant = 'ai' and bucket_id = 'odiina-ai')
    or (variant = 'playback' and bucket_id = 'odiina-playback')
    or (variant = 'poster' and bucket_id = 'odiina-posters')
  );

alter table app.media_processing_jobs
  drop constraint media_processing_jobs_stage_check;
alter table app.media_processing_jobs
  add constraint media_processing_jobs_stage_check check (
    stage in (
      'checking', 'scanning', 'preparing', 'validating', 'transcoding',
      'waveform', 'poster', 'promoting', 'cleanup', 'ready', 'failed'
    )
  );

create table app.video_metadata (
  user_id uuid not null,
  entry_id uuid not null,
  attachment_id uuid not null,
  input_container text not null check (input_container in ('webm', 'mp4', 'mov')),
  input_video_codec text not null check (input_video_codec in ('vp8', 'vp9', 'h264', 'hevc')),
  input_audio_codec text check (input_audio_codec in ('opus', 'aac')),
  input_duration_ms integer not null check (input_duration_ms between 250 and 300000),
  input_width integer not null check (input_width between 2 and 3840),
  input_height integer not null check (input_height between 2 and 3840),
  input_frame_rate numeric(8,3) not null check (input_frame_rate > 0 and input_frame_rate <= 60),
  input_rotation smallint not null check (input_rotation in (0, 90, 180, 270)),
  has_audio boolean not null,
  playback_container text not null check (playback_container = 'mp4'),
  playback_video_codec text not null check (playback_video_codec = 'h264'),
  playback_audio_codec text check (playback_audio_codec = 'aac_lc'),
  playback_duration_ms integer not null check (playback_duration_ms between 250 and 300000),
  playback_width integer not null check (playback_width between 2 and 1920),
  playback_height integer not null check (playback_height between 2 and 1920),
  playback_frame_rate numeric(8,3) not null check (playback_frame_rate > 0 and playback_frame_rate <= 30),
  poster_width integer not null check (poster_width between 2 and 1280),
  poster_height integer not null check (poster_height between 2 and 1280),
  created_at timestamptz not null default statement_timestamp(),
  primary key (user_id, entry_id, attachment_id),
  constraint video_metadata_attachment_fk
    foreign key (user_id, entry_id, attachment_id)
    references app.attachments(user_id, entry_id, id)
    on delete restrict,
  check ((has_audio and input_audio_codec is not null and playback_audio_codec = 'aac_lc')
    or (not has_audio and input_audio_codec is null and playback_audio_codec is null)),
  check (input_width::bigint * input_height::bigint <= 8294400),
  check (playback_width::bigint * playback_height::bigint <= 2073600)
);

alter table app.video_metadata enable row level security;
alter table app.video_metadata force row level security;
create policy video_metadata_owner_read on app.video_metadata
for select to authenticated using (user_id = (select app.request_user_id()));
create policy video_metadata_owner_api on app.video_metadata
for all to odiina_owner_api
using (user_id = (select app.request_user_id()))
with check (user_id = (select app.request_user_id()));
create policy video_metadata_worker_api on app.video_metadata
for all to odiina_worker_api
using (app.worker_actor_id() is not null)
with check (app.worker_actor_id() is not null);
create policy video_metadata_worker_bootstrap_cleanup on app.video_metadata
for delete to odiina_provisioner using (true);
grant select on app.video_metadata to authenticated;
grant select, insert, update on app.video_metadata to odiina_owner_api, odiina_worker_api;
grant delete on app.video_metadata to odiina_provisioner;

create or replace function app.require_entry_media_purpose()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  selected_kind text;
  selected_purpose text;
  selected_state text;
  selected_entry_id uuid;
  existing_count integer;
  conflicting_count integer;
begin
  select a.media_kind, a.purpose, a.state, a.entry_id
  into selected_kind, selected_purpose, selected_state, selected_entry_id
  from app.attachments as a
  where a.user_id = new.user_id and a.id = new.attachment_id;
  if selected_purpose is distinct from 'entry' then
    raise exception using errcode = 'P0001', message = 'odiina_entry_media_required';
  end if;
  if selected_entry_id is distinct from new.entry_id then return new; end if;
  if selected_state is distinct from 'accepted'
    or selected_kind not in ('image', 'audio', 'video') then
    raise exception using errcode = 'P0001', message = 'odiina_entry_media_required';
  end if;
  select count(*) into existing_count
  from app.entry_revision_attachments as era
  join app.attachments as a on a.user_id = era.user_id
    and a.entry_id = era.entry_id and a.id = era.attachment_id
  where era.user_id = new.user_id and era.entry_id = new.entry_id
    and era.revision_id = new.revision_id and a.media_kind = selected_kind;
  if (selected_kind = 'image' and existing_count >= 5)
    or (selected_kind in ('audio', 'video') and existing_count >= 1) then
    raise exception using errcode = 'P0001', message = 'odiina_entry_media_limit';
  end if;
  if selected_kind in ('audio', 'video') then
    select count(*) into conflicting_count
    from app.entry_revision_attachments as era
    join app.attachments as a on a.user_id = era.user_id
      and a.entry_id = era.entry_id and a.id = era.attachment_id
    where era.user_id = new.user_id and era.entry_id = new.entry_id
      and era.revision_id = new.revision_id
      and a.media_kind in ('audio', 'video') and a.media_kind <> selected_kind;
    if conflicting_count > 0 then
      raise exception using errcode = 'P0001', message = 'odiina_voice_video_conflict';
    end if;
  end if;
  return new;
end
$$;

grant odiina_owner_api to postgres;
grant create on schema app to odiina_owner_api;

create function app.authorize_video_upload(
  p_entry_id uuid,
  p_original_filename text,
  p_declared_mime text,
  p_expected_byte_count bigint
)
returns table (
  entry_id uuid, attachment_id uuid, object_id uuid,
  bucket_id text, object_key text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := app.request_user_id();
  target_entry app.entries%rowtype;
  target_id uuid := p_entry_id;
  created_attachment uuid := extensions.gen_random_uuid();
  created_object uuid := extensions.gen_random_uuid();
  created_key text := extensions.gen_random_uuid()::text || '/' || extensions.gen_random_uuid()::text;
  safe_filename text := nullif(left(btrim(p_original_filename), 180), '');
  unattached_count integer := 0;
  filename_lower text;
begin
  if actor is null then
    raise exception using errcode = '42501', message = 'odiina_auth_required';
  end if;
  filename_lower := pg_catalog.lower(coalesce(safe_filename, ''));
  if p_expected_byte_count is null or p_expected_byte_count not between 1 and 262144000
    or not (
      (p_declared_mime = 'video/webm' and filename_lower ~ '\.webm$')
      or (p_declared_mime in ('video/mp4', 'application/mp4') and filename_lower ~ '\.(mp4|m4v)$')
      or (p_declared_mime = 'video/quicktime' and filename_lower ~ '\.mov$')
    ) then
    raise exception using errcode = 'P0001', message = 'odiina_video_upload_invalid';
  end if;
  if target_id is null then
    target_id := extensions.gen_random_uuid();
    insert into app.entries (id, user_id, lifecycle_state, current_revision_id, finalized_at)
    values (target_id, actor, 'draft', null, null);
  else
    select e.* into target_entry from app.entries as e
    where e.id = target_id and e.user_id = actor for update;
    if not found or target_entry.lifecycle_state not in ('draft', 'active') then
      raise exception using errcode = 'P0001', message = 'odiina_media_entry_unavailable';
    end if;
  end if;
  select count(*) into unattached_count from app.attachments as a
  where a.user_id = actor and a.entry_id = target_id
    and a.media_kind = 'video' and a.purpose = 'entry'
    and a.state not in ('rejected', 'failed', 'deleting', 'deleted')
    and not exists (
      select 1 from app.entry_revision_attachments as membership
      where membership.user_id = a.user_id and membership.entry_id = a.entry_id
        and membership.attachment_id = a.id
    );
  if unattached_count >= 1 then
    raise exception using errcode = 'P0001', message = 'odiina_video_limit';
  end if;
  insert into app.attachments (
    id, user_id, entry_id, media_kind, purpose, state, original_filename,
    declared_mime, expected_byte_count
  ) values (
    created_attachment, actor, target_id, 'video', 'entry', 'pending_upload',
    safe_filename, p_declared_mime, p_expected_byte_count
  );
  insert into app.attachment_objects (
    id, user_id, entry_id, attachment_id, variant, bucket_id, object_key, state
  ) values (
    created_object, actor, target_id, created_attachment, 'quarantine',
    'odiina-quarantine', created_key, 'expected'
  );
  return query select target_id, created_attachment, created_object,
    'odiina-quarantine'::text, created_key;
end
$$;

create function app.mark_video_uploading(p_attachment_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.request_user_id();
begin
  update app.attachments set state = 'uploading'
  where id = p_attachment_id and user_id = actor
    and media_kind = 'video' and purpose = 'entry' and state = 'pending_upload';
  if not found then
    raise exception using errcode = 'P0001', message = 'odiina_upload_unavailable';
  end if;
end
$$;

create function app.finalize_video_upload(p_attachment_id uuid)
returns table (job_id uuid, attachment_state text)
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := app.request_user_id();
  target app.attachments%rowtype;
  expected app.attachment_objects%rowtype;
  actual_size bigint;
  created_job uuid := extensions.gen_random_uuid();
  created_idempotency uuid := extensions.gen_random_uuid();
  message_id bigint;
begin
  select * into target from app.attachments
  where id = p_attachment_id and user_id = actor
    and media_kind = 'video' and purpose = 'entry' for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'odiina_upload_unavailable';
  end if;
  if target.state in ('queued', 'processing', 'accepted') then
    return query select j.id, target.state from app.media_processing_jobs as j
    where j.attachment_id = target.id;
    return;
  end if;
  if target.state not in ('pending_upload', 'uploading', 'quarantined') then
    raise exception using errcode = 'P0001', message = 'odiina_upload_state_invalid';
  end if;
  select * into expected from app.attachment_objects
  where attachment_id = target.id and variant = 'quarantine' for update;
  select nullif(o.metadata ->> 'size', '')::bigint into actual_size
  from storage.objects as o
  where o.bucket_id = expected.bucket_id and o.name = expected.object_key
    and o.owner_id = actor::text;
  if actual_size is null then
    raise exception using errcode = 'P0001', message = 'odiina_quarantine_missing';
  end if;
  if actual_size <> target.expected_byte_count or actual_size > 262144000 then
    raise exception using errcode = 'P0001', message = 'odiina_upload_size_mismatch';
  end if;
  update app.attachment_objects set state = 'uploaded', byte_count = actual_size
  where id = expected.id;
  update app.attachments set state = 'queued' where id = target.id;
  insert into app.media_processing_jobs (
    id, user_id, entry_id, attachment_id, status, idempotency_key
  ) values (created_job, actor, target.entry_id, target.id, 'queued', created_idempotency);
  select send into message_id from pgmq.send(
    'odiina_media_processing',
    jsonb_build_object('version', 1, 'job_id', created_job,
      'attachment_id', target.id, 'idempotency_id', created_idempotency), 0
  );
  update app.media_processing_jobs set queue_message_id = message_id where id = created_job;
  return query select created_job, 'queued'::text;
end
$$;

create or replace function app.activate_media_entry(
  p_client_request_id uuid, p_entry_id uuid, p_body_text text,
  p_attachment_ids uuid[], p_occurred_at timestamptz,
  p_occurred_timezone text, p_occurred_local_date date,
  p_occurred_utc_offset_minutes smallint
)
returns table (entry_id uuid, revision_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := app.request_user_id();
  normalized_body text := btrim(coalesce(p_body_text, ''));
  created_revision uuid := extensions.gen_random_uuid();
  requested_count integer := coalesce(array_length(p_attachment_ids, 1), 0);
  image_count integer; audio_count integer; video_count integer;
  canonical_hash bytea; receipt app.entry_command_receipts%rowtype;
begin
  if actor is null then raise exception using errcode = '42501', message = 'odiina_auth_required'; end if;
  if p_client_request_id is null then raise exception using errcode = 'P0001', message = 'odiina_entry_invalid'; end if;
  perform app.assert_occurrence(p_occurred_at, p_occurred_timezone,
    p_occurred_local_date, p_occurred_utc_offset_minutes);
  if char_length(normalized_body) > 100000 or requested_count > 6
    or (char_length(normalized_body) = 0 and requested_count = 0)
    or requested_count <> (select count(distinct value)
      from unnest(coalesce(p_attachment_ids, array[]::uuid[])) as value) then
    raise exception using errcode = 'P0001', message = 'odiina_entry_invalid';
  end if;
  canonical_hash := extensions.digest(convert_to(jsonb_build_object(
    'entry_id', p_entry_id, 'body_text', normalized_body,
    'attachment_ids', p_attachment_ids, 'occurred_at', p_occurred_at,
    'occurred_timezone', p_occurred_timezone,
    'occurred_local_date', p_occurred_local_date,
    'occurred_utc_offset_minutes', p_occurred_utc_offset_minutes
  )::text, 'UTF8'), 'sha256');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    actor::text || ':activate_media_entry:' || p_client_request_id::text, 0));
  select r.* into receipt from app.entry_command_receipts as r
  where r.user_id = actor and r.command_kind = 'activate_media_entry'
    and r.client_request_id = p_client_request_id;
  if found then
    if receipt.request_hash <> canonical_hash then
      raise exception using errcode = 'P0001', message = 'odiina_idempotency_conflict';
    end if;
    return query select receipt.entry_id, receipt.revision_id; return;
  end if;
  perform 1 from app.entries where id = p_entry_id and user_id = actor
    and lifecycle_state = 'draft' for update;
  if not found then raise exception using errcode = 'P0001', message = 'odiina_media_draft_unavailable'; end if;
  if requested_count <> (select count(*) from app.attachments as a
    where a.id = any(coalesce(p_attachment_ids, array[]::uuid[]))
      and a.user_id = actor and a.entry_id = p_entry_id
      and a.media_kind in ('image', 'audio', 'video')
      and a.purpose = 'entry' and a.state = 'accepted') then
    raise exception using errcode = 'P0001', message = 'odiina_attachment_unavailable';
  end if;
  select count(*) filter (where a.media_kind = 'image'),
    count(*) filter (where a.media_kind = 'audio'),
    count(*) filter (where a.media_kind = 'video')
  into image_count, audio_count, video_count from app.attachments as a
  where a.id = any(coalesce(p_attachment_ids, array[]::uuid[]));
  if image_count > 5 or audio_count > 1 or video_count > 1
    or (audio_count > 0 and video_count > 0) then
    raise exception using errcode = 'P0001', message = 'odiina_entry_media_limit';
  end if;
  insert into app.entry_revisions (
    id, user_id, entry_id, revision_number, body_text, occurred_at,
    occurred_timezone, occurred_local_date, occurred_utc_offset_minutes, change_reason
  ) values (created_revision, actor, p_entry_id, 1, normalized_body,
    p_occurred_at, p_occurred_timezone, p_occurred_local_date,
    p_occurred_utc_offset_minutes, 'created');
  insert into app.entry_revision_attachments
    (user_id, entry_id, revision_id, attachment_id, position)
  select actor, p_entry_id, created_revision, value, ordinality::smallint
  from unnest(coalesce(p_attachment_ids, array[]::uuid[]))
    with ordinality as selected(value, ordinality);
  update app.entries set current_revision_id = created_revision,
    lifecycle_state = 'active', finalized_at = statement_timestamp()
  where id = p_entry_id and user_id = actor;
  insert into app.entry_command_receipts
    (user_id, command_kind, client_request_id, request_hash, entry_id, revision_id)
  values (actor, 'activate_media_entry', p_client_request_id,
    canonical_hash, p_entry_id, created_revision);
  return query select p_entry_id, created_revision;
end
$$;

create or replace function app.revise_entry_media(
  p_entry_id uuid, p_expected_current_revision_id uuid, p_body_text text,
  p_attachment_ids uuid[], p_occurred_at timestamptz,
  p_occurred_timezone text, p_occurred_local_date date,
  p_occurred_utc_offset_minutes smallint, p_change_reason text
)
returns table (entry_id uuid, revision_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := app.request_user_id();
  normalized_body text := btrim(coalesce(p_body_text, ''));
  locked_entry app.entries%rowtype;
  next_revision integer; created_revision_id uuid := extensions.gen_random_uuid();
  requested_count integer := coalesce(array_length(p_attachment_ids, 1), 0);
  image_count integer; audio_count integer; video_count integer;
begin
  if actor is null then raise exception using errcode = 'P0001', message = 'odiina_auth_required'; end if;
  if p_entry_id is null or p_expected_current_revision_id is null
    or char_length(normalized_body) > 100000 or requested_count > 6
    or (char_length(normalized_body) = 0 and requested_count = 0)
    or requested_count <> (select count(distinct value)
      from unnest(coalesce(p_attachment_ids, array[]::uuid[])) as value)
    or p_change_reason not in ('edited', 'occurrence_corrected') then
    raise exception using errcode = 'P0001', message = 'odiina_entry_invalid';
  end if;
  perform app.assert_occurrence(p_occurred_at, p_occurred_timezone,
    p_occurred_local_date, p_occurred_utc_offset_minutes);
  select e.* into locked_entry from app.entries as e
  where e.id = p_entry_id and e.user_id = actor for update;
  if not found or locked_entry.lifecycle_state <> 'active' then
    raise exception using errcode = 'P0001', message = 'odiina_entry_unavailable';
  end if;
  if locked_entry.current_revision_id <> p_expected_current_revision_id then
    raise exception using errcode = 'P0001', message = 'odiina_revision_conflict';
  end if;
  if requested_count <> (select count(*) from app.attachments as a
    where a.id = any(coalesce(p_attachment_ids, array[]::uuid[]))
      and a.user_id = actor and a.entry_id = p_entry_id
      and a.media_kind in ('image', 'audio', 'video')
      and a.purpose = 'entry' and a.state = 'accepted') then
    raise exception using errcode = 'P0001', message = 'odiina_attachment_unavailable';
  end if;
  select count(*) filter (where a.media_kind = 'image'),
    count(*) filter (where a.media_kind = 'audio'),
    count(*) filter (where a.media_kind = 'video')
  into image_count, audio_count, video_count from app.attachments as a
  where a.id = any(coalesce(p_attachment_ids, array[]::uuid[]));
  if image_count > 5 or audio_count > 1 or video_count > 1
    or (audio_count > 0 and video_count > 0) then
    raise exception using errcode = 'P0001', message = 'odiina_entry_media_limit';
  end if;
  select coalesce(max(r.revision_number), 0) + 1 into next_revision
  from app.entry_revisions as r where r.user_id = actor and r.entry_id = p_entry_id;
  insert into app.entry_revisions (
    id, user_id, entry_id, revision_number, body_text, occurred_at,
    occurred_timezone, occurred_local_date, occurred_utc_offset_minutes, change_reason
  ) values (created_revision_id, actor, p_entry_id, next_revision,
    normalized_body, p_occurred_at, p_occurred_timezone,
    p_occurred_local_date, p_occurred_utc_offset_minutes, p_change_reason);
  insert into app.entry_revision_attachments
    (user_id, entry_id, revision_id, attachment_id, position)
  select actor, p_entry_id, created_revision_id, selected.value,
    selected.ordinality::smallint
  from unnest(coalesce(p_attachment_ids, array[]::uuid[]))
    with ordinality as selected(value, ordinality);
  update app.entries set current_revision_id = created_revision_id
  where id = p_entry_id and user_id = actor;
  return query select p_entry_id, created_revision_id;
end
$$;

revoke all on function app.authorize_video_upload(uuid, text, text, bigint) from public, anon;
revoke all on function app.mark_video_uploading(uuid) from public, anon;
revoke all on function app.finalize_video_upload(uuid) from public, anon;
grant execute on function app.authorize_video_upload(uuid, text, text, bigint) to authenticated;
grant execute on function app.mark_video_uploading(uuid) to authenticated;
grant execute on function app.finalize_video_upload(uuid) to authenticated;
alter function app.authorize_video_upload(uuid, text, text, bigint) owner to odiina_owner_api;
alter function app.mark_video_uploading(uuid) owner to odiina_owner_api;
alter function app.finalize_video_upload(uuid) owner to odiina_owner_api;
alter function app.activate_media_entry(uuid, uuid, text, uuid[], timestamptz, text, date, smallint)
  owner to odiina_owner_api;
alter function app.revise_entry_media(uuid, uuid, text, uuid[], timestamptz, text, date, smallint, text)
  owner to odiina_owner_api;
revoke create on schema app from odiina_owner_api;
revoke odiina_owner_api from postgres;

revoke all on function app.revision_media(uuid[]) from public, anon, authenticated;
drop function app.revision_media(uuid[]);
create function app.revision_media(p_revision_ids uuid[])
returns table (
  revision_id uuid, attachment_id uuid, media_position smallint,
  media_kind text, width integer, height integer, duration_ms integer,
  waveform_peaks smallint[], has_audio boolean,
  poster_width integer, poster_height integer
)
language sql stable security invoker set search_path = '' as $$
  select ra.revision_id, ra.attachment_id, ra.position, a.media_kind,
    coalesce(image.display_width, video.playback_width),
    coalesce(image.display_height, video.playback_height),
    coalesce(audio.playback_duration_ms, video.playback_duration_ms),
    audio.waveform_peaks, video.has_audio,
    video.poster_width, video.poster_height
  from app.entry_revision_attachments as ra
  join app.attachments as a on a.user_id = ra.user_id
    and a.entry_id = ra.entry_id and a.id = ra.attachment_id
  left join app.image_metadata as image on image.user_id = ra.user_id
    and image.entry_id = ra.entry_id and image.attachment_id = ra.attachment_id
  left join app.audio_metadata as audio on audio.user_id = ra.user_id
    and audio.entry_id = ra.entry_id and audio.attachment_id = ra.attachment_id
  left join app.video_metadata as video on video.user_id = ra.user_id
    and video.entry_id = ra.entry_id and video.attachment_id = ra.attachment_id
  where ra.user_id = app.request_user_id()
    and ra.revision_id = any(coalesce(p_revision_ids, array[]::uuid[]))
    and a.purpose = 'entry' and a.state = 'accepted'
    and ((a.media_kind = 'image' and image.attachment_id is not null)
      or (a.media_kind = 'audio' and audio.attachment_id is not null)
      or (a.media_kind = 'video' and video.attachment_id is not null))
  order by ra.revision_id, ra.position
$$;
revoke all on function app.revision_media(uuid[]) from public, anon;
grant execute on function app.revision_media(uuid[]) to authenticated;

revoke all on function app.profile_statistics() from public, anon, authenticated;
drop function app.profile_statistics();
create function app.profile_statistics()
returns table (
  active_entries bigint, active_logging_days bigint,
  current_month_entries bigint, image_entries bigint,
  voice_entries bigint, video_entries bigint, edited_entries bigint
)
language sql stable security invoker set search_path = '' as $$
  with owner_context as (
    select p.user_id,
      (statement_timestamp() at time zone coalesce(up.iana_timezone, 'UTC'))::date as local_today
    from app.profiles as p left join app.user_preferences as up on up.user_id = p.user_id
    where p.user_id = app.request_user_id()
  ), active as (
    select e.id, e.user_id, e.current_revision_id, r.occurred_local_date,
      r.revision_number
    from owner_context as owner
    join app.entries as e on e.user_id = owner.user_id and e.lifecycle_state = 'active'
    join app.entry_revisions as r on r.user_id = e.user_id and r.entry_id = e.id
      and r.id = e.current_revision_id
  )
  select count(active.id)::bigint,
    count(distinct active.occurred_local_date)::bigint,
    count(*) filter (where active.occurred_local_date >= date_trunc('month', owner.local_today)::date
      and active.occurred_local_date < (date_trunc('month', owner.local_today) + interval '1 month')::date)::bigint,
    count(*) filter (where exists (
      select 1 from app.entry_revision_attachments as era
      join app.attachments as a on a.user_id = era.user_id and a.entry_id = era.entry_id and a.id = era.attachment_id
      where era.user_id = active.user_id and era.entry_id = active.id
        and era.revision_id = active.current_revision_id and a.media_kind = 'image'
        and a.purpose = 'entry' and a.state = 'accepted'))::bigint,
    count(*) filter (where exists (
      select 1 from app.entry_revision_attachments as era
      join app.attachments as a on a.user_id = era.user_id and a.entry_id = era.entry_id and a.id = era.attachment_id
      where era.user_id = active.user_id and era.entry_id = active.id
        and era.revision_id = active.current_revision_id and a.media_kind = 'audio'
        and a.purpose = 'entry' and a.state = 'accepted'))::bigint,
    count(*) filter (where exists (
      select 1 from app.entry_revision_attachments as era
      join app.attachments as a on a.user_id = era.user_id and a.entry_id = era.entry_id and a.id = era.attachment_id
      where era.user_id = active.user_id and era.entry_id = active.id
        and era.revision_id = active.current_revision_id and a.media_kind = 'video'
        and a.purpose = 'entry' and a.state = 'accepted'))::bigint,
    count(*) filter (where active.revision_number > 1)::bigint
  from owner_context as owner left join active on active.user_id = owner.user_id
  group by owner.user_id, owner.local_today
$$;
revoke all on function app.profile_statistics() from public, anon;
grant execute on function app.profile_statistics() to authenticated;

drop function app.claim_media_job(integer);
create function app.claim_media_job(p_visibility_seconds integer default 120)
returns table (
  job_id uuid, attachment_id uuid, media_kind text, declared_mime text,
  original_filename text, lease_token uuid, committed boolean,
  quarantine_bucket text, quarantine_key text,
  original_object_id uuid, original_key text,
  display_object_id uuid, display_key text,
  ai_object_id uuid, ai_key text,
  playback_object_id uuid, playback_key text,
  poster_object_id uuid, poster_key text
)
language plpgsql security definer set search_path = '' as $$
declare
  worker record; message record; target app.media_processing_jobs%rowtype;
  target_attachment app.attachments%rowtype; new_lease uuid := extensions.gen_random_uuid();
begin
  if p_visibility_seconds not between 30 and 600 then
    raise exception using errcode = 'P0001', message = 'odiina_lease_invalid';
  end if;
  select * into worker from app.require_active_worker();
  update app.media_processing_jobs set status = 'retry', lease_token = null,
    lease_expires_at = null, leased_by = null, worker_generation = null,
    next_attempt_at = statement_timestamp()
  where status = 'leased' and lease_expires_at <= statement_timestamp();
  select * into message from pgmq.read('odiina_media_processing', p_visibility_seconds, 1) limit 1;
  if not found then return; end if;
  if (message.message ->> 'version')::integer <> 1
    or message.message ->> 'job_id' is null
    or message.message ->> 'attachment_id' is null
    or message.message ->> 'idempotency_id' is null then
    perform pgmq.archive('odiina_media_processing', message.msg_id); return;
  end if;
  select * into target from app.media_processing_jobs as queued_job
  where queued_job.id = (message.message ->> 'job_id')::uuid
    and queued_job.attachment_id = (message.message ->> 'attachment_id')::uuid
    and queued_job.idempotency_key = (message.message ->> 'idempotency_id')::uuid
  for update;
  if not found or target.status in ('completed', 'rejected', 'failed', 'cancelled', 'dead') then
    perform pgmq.archive('odiina_media_processing', message.msg_id); return;
  end if;
  if target.next_attempt_at > statement_timestamp() then
    perform pgmq.set_vt('odiina_media_processing', message.msg_id,
      greatest(1, extract(epoch from target.next_attempt_at - statement_timestamp())::integer));
    return;
  end if;
  if message.read_ct > 5 then
    update app.media_processing_jobs set status = 'dead', stage = 'failed',
      last_error_code = 'attempt_limit', completed_at = statement_timestamp() where id = target.id;
    update app.attachments set state = 'failed', error_code = 'attempt_limit'
      where id = target.attachment_id;
    perform pgmq.send('odiina_media_processing_dlq', message.message, 0);
    perform pgmq.archive('odiina_media_processing', message.msg_id); return;
  end if;
  select * into target_attachment from app.attachments where id = target.attachment_id;
  if target_attachment.media_kind = 'image' then
    insert into app.attachment_objects
      (user_id, entry_id, attachment_id, variant, bucket_id, object_key, state)
    values
      (target.user_id, target.entry_id, target.attachment_id, 'original', 'odiina-originals', extensions.gen_random_uuid()::text || '/' || extensions.gen_random_uuid()::text, 'expected'),
      (target.user_id, target.entry_id, target.attachment_id, 'display', 'odiina-display', extensions.gen_random_uuid()::text || '/' || extensions.gen_random_uuid()::text, 'expected'),
      (target.user_id, target.entry_id, target.attachment_id, 'ai', 'odiina-ai', extensions.gen_random_uuid()::text || '/' || extensions.gen_random_uuid()::text, 'expected')
    on conflict on constraint attachment_objects_attachment_variant_unique do nothing;
  elsif target_attachment.media_kind = 'audio' then
    insert into app.attachment_objects
      (user_id, entry_id, attachment_id, variant, bucket_id, object_key, state)
    values
      (target.user_id, target.entry_id, target.attachment_id, 'original', 'odiina-originals', extensions.gen_random_uuid()::text || '/' || extensions.gen_random_uuid()::text, 'expected'),
      (target.user_id, target.entry_id, target.attachment_id, 'playback', 'odiina-playback', extensions.gen_random_uuid()::text || '/' || extensions.gen_random_uuid()::text, 'expected')
    on conflict on constraint attachment_objects_attachment_variant_unique do nothing;
  elsif target_attachment.media_kind = 'video' then
    insert into app.attachment_objects
      (user_id, entry_id, attachment_id, variant, bucket_id, object_key, state)
    values
      (target.user_id, target.entry_id, target.attachment_id, 'original', 'odiina-originals', extensions.gen_random_uuid()::text || '/' || extensions.gen_random_uuid()::text, 'expected'),
      (target.user_id, target.entry_id, target.attachment_id, 'playback', 'odiina-playback', extensions.gen_random_uuid()::text || '/' || extensions.gen_random_uuid()::text, 'expected'),
      (target.user_id, target.entry_id, target.attachment_id, 'poster', 'odiina-posters', extensions.gen_random_uuid()::text || '/' || extensions.gen_random_uuid()::text, 'expected')
    on conflict on constraint attachment_objects_attachment_variant_unique do nothing;
  else
    raise exception using errcode = 'P0001', message = 'odiina_media_kind_unimplemented';
  end if;
  update app.media_processing_jobs
  set status = case when status = 'committed' then 'committed' else 'leased' end,
    stage = case when status = 'committed' then 'cleanup' else 'checking' end,
    attempts = attempts + 1, queue_message_id = message.msg_id,
    leased_by = worker.worker_id, worker_generation = worker.generation,
    lease_token = new_lease,
    lease_expires_at = statement_timestamp() + make_interval(secs => p_visibility_seconds)
  where id = target.id;
  update app.attachments set state = case when target.status = 'committed'
    then 'accepted' else 'processing' end where id = target.attachment_id;
  return query select target.id, target.attachment_id, target_attachment.media_kind,
    target_attachment.declared_mime, target_attachment.original_filename,
    new_lease, target.status = 'committed', q.bucket_id, q.object_key,
    original.id, original.object_key, display.id, display.object_key,
    ai.id, ai.object_key, playback.id, playback.object_key,
    poster.id, poster.object_key
  from app.attachment_objects as q
  left join app.attachment_objects as original on original.attachment_id = q.attachment_id and original.variant = 'original'
  left join app.attachment_objects as display on display.attachment_id = q.attachment_id and display.variant = 'display'
  left join app.attachment_objects as ai on ai.attachment_id = q.attachment_id and ai.variant = 'ai'
  left join app.attachment_objects as playback on playback.attachment_id = q.attachment_id and playback.variant = 'playback'
  left join app.attachment_objects as poster on poster.attachment_id = q.attachment_id and poster.variant = 'poster'
  where q.attachment_id = target.attachment_id and q.variant = 'quarantine';
end
$$;

create function app.commit_processed_video(
  p_job_id uuid, p_lease_token uuid, p_input_container text,
  p_input_video_codec text, p_input_audio_codec text,
  p_input_duration_ms integer, p_input_width integer, p_input_height integer,
  p_input_frame_rate numeric, p_input_rotation smallint, p_has_audio boolean,
  p_quarantine_sha256 bytea, p_quarantine_bytes bigint,
  p_original_sha256 bytea, p_original_bytes bigint,
  p_playback_sha256 bytea, p_playback_bytes bigint,
  p_playback_duration_ms integer, p_playback_width integer,
  p_playback_height integer, p_playback_frame_rate numeric,
  p_poster_sha256 bytea, p_poster_bytes bigint,
  p_poster_width integer, p_poster_height integer
)
returns void language plpgsql security definer set search_path = '' as $$
declare worker record; target app.media_processing_jobs%rowtype;
begin
  select * into worker from app.require_active_worker();
  select * into target from app.media_processing_jobs
  where id = p_job_id and lease_token = p_lease_token
    and leased_by = worker.worker_id and worker_generation = worker.generation
    and status = 'leased' and lease_expires_at > statement_timestamp() for update;
  if not found then raise exception using errcode = 'P0001', message = 'odiina_worker_lease_stale'; end if;
  if not exists (select 1 from app.attachments as a
      where a.id = target.attachment_id and a.media_kind = 'video' and a.purpose = 'entry')
    or p_input_container not in ('webm', 'mp4', 'mov')
    or p_input_video_codec not in ('vp8', 'vp9', 'h264', 'hevc')
    or (p_input_container = 'webm' and (p_input_video_codec not in ('vp8', 'vp9')
      or (p_input_audio_codec is not null and p_input_audio_codec <> 'opus')))
    or (p_input_container = 'mp4' and (p_input_video_codec <> 'h264'
      or (p_input_audio_codec is not null and p_input_audio_codec <> 'aac')))
    or (p_input_container = 'mov' and (p_input_video_codec not in ('h264', 'hevc')
      or (p_input_audio_codec is not null and p_input_audio_codec <> 'aac')))
    or p_has_audio <> (p_input_audio_codec is not null)
    or p_input_duration_ms not between 250 and 300000
    or p_playback_duration_ms not between 250 and 300000
    or abs(p_input_duration_ms - p_playback_duration_ms) > 2000
    or p_input_width not between 2 and 3840 or p_input_height not between 2 and 3840
    or p_input_width::bigint * p_input_height::bigint > 8294400
    or p_input_frame_rate <= 0 or p_input_frame_rate > 60
    or p_input_rotation not in (0, 90, 180, 270)
    or p_playback_width not between 2 and 1920 or p_playback_height not between 2 and 1920
    or p_playback_width::bigint * p_playback_height::bigint > 2073600
    or p_playback_frame_rate <= 0 or p_playback_frame_rate > 30
    or p_poster_width not between 2 and 1280 or p_poster_height not between 2 and 1280
    or p_quarantine_sha256 <> p_original_sha256 or p_quarantine_bytes <> p_original_bytes
    or p_quarantine_bytes > 262144000
    or p_playback_bytes <= 0 or p_playback_bytes > 188743680
    or p_poster_bytes <= 0 or p_poster_bytes > 2097152
    or exists (select 1 from app.attachment_objects as ao
      where ao.attachment_id = target.attachment_id
        and ao.variant in ('original', 'playback', 'poster')
        and not exists (select 1 from storage.objects as so
          where so.bucket_id = ao.bucket_id and so.name = ao.object_key)) then
    raise exception using errcode = 'P0001', message = 'odiina_processed_video_invalid';
  end if;
  update app.attachment_objects set state = 'verified',
    byte_count = case variant when 'original' then p_original_bytes
      when 'playback' then p_playback_bytes else p_poster_bytes end,
    sha256 = case variant when 'original' then p_original_sha256
      when 'playback' then p_playback_sha256 else p_poster_sha256 end,
    detected_mime = case variant when 'original' then case p_input_container
      when 'webm' then 'video/webm' when 'mov' then 'video/quicktime' else 'video/mp4' end
      when 'playback' then 'video/mp4' else 'image/jpeg' end,
    verified_at = statement_timestamp()
  where attachment_id = target.attachment_id and variant in ('original', 'playback', 'poster');
  update app.attachment_objects set state = 'verified', byte_count = p_quarantine_bytes,
    sha256 = p_quarantine_sha256,
    detected_mime = case p_input_container when 'webm' then 'video/webm'
      when 'mov' then 'video/quicktime' else 'video/mp4' end,
    verified_at = statement_timestamp()
  where attachment_id = target.attachment_id and variant = 'quarantine';
  insert into app.video_metadata (
    user_id, entry_id, attachment_id, input_container, input_video_codec,
    input_audio_codec, input_duration_ms, input_width, input_height,
    input_frame_rate, input_rotation, has_audio, playback_container,
    playback_video_codec, playback_audio_codec, playback_duration_ms,
    playback_width, playback_height, playback_frame_rate, poster_width, poster_height
  ) values (
    target.user_id, target.entry_id, target.attachment_id, p_input_container,
    p_input_video_codec, p_input_audio_codec, p_input_duration_ms,
    p_input_width, p_input_height, p_input_frame_rate, p_input_rotation,
    p_has_audio, 'mp4', 'h264', case when p_has_audio then 'aac_lc' else null end,
    p_playback_duration_ms, p_playback_width, p_playback_height,
    p_playback_frame_rate, p_poster_width, p_poster_height
  );
  update app.attachments set state = 'accepted', error_code = null,
    accepted_at = statement_timestamp() where id = target.attachment_id;
  update app.media_processing_jobs set status = 'committed', stage = 'cleanup'
    where id = target.id;
end
$$;

grant odiina_worker_api to postgres;
create or replace function app.heartbeat_media_job(
  p_job_id uuid, p_lease_token uuid, p_stage text,
  p_visibility_seconds integer default 120
)
returns void language plpgsql security definer set search_path = '' as $$
declare worker record; message_id bigint;
begin
  select * into worker from app.require_active_worker();
  if p_stage not in ('checking', 'scanning', 'preparing', 'validating',
    'transcoding', 'waveform', 'poster', 'promoting', 'cleanup') then
    raise exception using errcode = 'P0001', message = 'odiina_worker_stage_invalid';
  end if;
  update app.media_processing_jobs set stage = p_stage,
    lease_expires_at = statement_timestamp() + make_interval(secs => p_visibility_seconds)
  where id = p_job_id and lease_token = p_lease_token
    and leased_by = worker.worker_id and worker_generation = worker.generation
    and status in ('leased', 'committed') and lease_expires_at > statement_timestamp()
  returning queue_message_id into message_id;
  if not found then raise exception using errcode = 'P0001', message = 'odiina_worker_lease_stale'; end if;
  perform pgmq.set_vt('odiina_media_processing', message_id, p_visibility_seconds);
end
$$;

revoke all on function app.claim_media_job(integer) from public;
revoke all on function app.commit_processed_video(
  uuid, uuid, text, text, text, integer, integer, integer, numeric, smallint,
  boolean, bytea, bigint, bytea, bigint, bytea, bigint, integer, integer,
  integer, numeric, bytea, bigint, integer, integer
) from public, anon;
grant execute on function app.claim_media_job(integer) to authenticated;
grant execute on function app.commit_processed_video(
  uuid, uuid, text, text, text, integer, integer, integer, numeric, smallint,
  boolean, bytea, bigint, bytea, bigint, bytea, bigint, integer, integer,
  integer, numeric, bytea, bigint, integer, integer
) to authenticated;
grant create on schema app to odiina_worker_api;
alter function app.claim_media_job(integer) owner to odiina_worker_api;
alter function app.commit_processed_video(
  uuid, uuid, text, text, text, integer, integer, integer, numeric, smallint,
  boolean, bytea, bigint, bytea, bigint, bytea, bigint, integer, integer,
  integer, numeric, bytea, bigint, integer, integer
) owner to odiina_worker_api;
alter function app.heartbeat_media_job(uuid, uuid, text, integer) owner to odiina_worker_api;
revoke create on schema app from odiina_worker_api;
revoke odiina_worker_api from postgres;

drop policy worker_object_insert on storage.objects;
create policy worker_object_insert on storage.objects for insert to authenticated
with check (bucket_id in ('odiina-originals', 'odiina-display', 'odiina-ai',
  'odiina-playback', 'odiina-posters') and app.worker_can_access_object(bucket_id, name));
drop policy owner_playback_read on storage.objects;
create policy owner_playback_read on storage.objects for select to authenticated
using (bucket_id = 'odiina-playback' and exists (
  select 1 from app.attachment_objects as ao
  join app.attachments as a on a.user_id = ao.user_id and a.entry_id = ao.entry_id
    and a.id = ao.attachment_id
  join app.entries as e on e.user_id = a.user_id and e.id = a.entry_id
  where ao.bucket_id = storage.objects.bucket_id and ao.object_key = storage.objects.name
    and ao.variant = 'playback' and ao.state = 'verified'
    and ao.user_id = app.request_user_id() and a.media_kind in ('audio', 'video')
    and a.purpose = 'entry' and a.state = 'accepted'
    and e.lifecycle_state in ('active', 'trashed')
));
create policy owner_video_poster_read on storage.objects for select to authenticated
using (bucket_id = 'odiina-posters' and exists (
  select 1 from app.attachment_objects as ao
  join app.attachments as a on a.user_id = ao.user_id and a.entry_id = ao.entry_id
    and a.id = ao.attachment_id
  join app.entries as e on e.user_id = a.user_id and e.id = a.entry_id
  where ao.bucket_id = storage.objects.bucket_id and ao.object_key = storage.objects.name
    and ao.variant = 'poster' and ao.state = 'verified'
    and ao.user_id = app.request_user_id() and a.media_kind = 'video'
    and a.purpose = 'entry' and a.state = 'accepted'
    and e.lifecycle_state in ('active', 'trashed')
));

comment on table app.video_metadata is
  'Strictly validated private video facts for one immutable H.264 playback derivative and required server-generated poster.';
comment on table app.attachments is
  'Media-general identity. Entry image, voice and video pipelines are purpose-isolated; a revision permits five images and one voice-or-video attachment.';
comment on table app.media_processing_jobs is
  'Durable lease-fenced image, audio or video processing paired with the logged pgmq queue.';

commit;
