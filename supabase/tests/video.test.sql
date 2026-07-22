begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(33);

select extensions.ok(not pg_catalog.has_function_privilege(
  'anon', 'app.authorize_video_upload(uuid,text,text,bigint)', 'EXECUTE'),
  'anon cannot authorize video');
select extensions.ok(pg_catalog.has_function_privilege(
  'authenticated', 'app.authorize_video_upload(uuid,text,text,bigint)', 'EXECUTE'),
  'authenticated may invoke narrow video authorization');
select extensions.ok(not pg_catalog.has_function_privilege(
  'anon', 'app.finalize_video_upload(uuid)', 'EXECUTE'),
  'anon cannot finalize video');
select extensions.ok(not pg_catalog.has_function_privilege(
  'anon', 'app.commit_processed_video(uuid,uuid,text,text,text,integer,integer,integer,numeric,smallint,boolean,bytea,bigint,bytea,bigint,bytea,bigint,integer,integer,integer,numeric,bytea,bigint,integer,integer)', 'EXECUTE'),
  'anon cannot commit worker video output');
select extensions.ok(not (select rolbypassrls from pg_roles where rolname = 'odiina_owner_api'),
  'video owner function role cannot bypass RLS');
select extensions.ok(not (select rolbypassrls from pg_roles where rolname = 'odiina_worker_api'),
  'video worker function role cannot bypass RLS');
select extensions.ok((select relrowsecurity and relforcerowsecurity
  from pg_class where oid = 'app.video_metadata'::regclass),
  'video metadata has forced RLS');
select extensions.is((select count(*)::bigint from storage.buckets
  where id = 'odiina-posters' and not public), 1::bigint,
  'poster bucket is private');
select extensions.is((select count(*)::bigint from storage.buckets
  where id = 'odiina-playback' and not public), 1::bigint,
  'shared playback bucket remains private');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('99999999-9999-4999-8999-999999999991', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'video-a@example.test', '', now(), '', '', '', '',
    '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('99999999-9999-4999-8999-999999999992', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'video-b@example.test', '', now(), '', '', '', '',
    '{"provider":"email","providers":["email"]}', '{}', now(), now())
on conflict (id) do nothing;

select set_config('request.jwt.claims',
  '{"sub":"99999999-9999-4999-8999-999999999991","role":"authenticated"}', true);
set local role authenticated;
create temporary table video_target as select * from app.create_entry(
  '99999999-9999-4999-8999-999999999901', 'Video target',
  '2026-07-24T23:45:00+05:30', 'Asia/Kolkata', '2026-07-24', 330::smallint);
create temporary table first_video as select * from app.authorize_video_upload(
  (select entry_id from video_target), 'capture.mp4', 'video/mp4', 1048576);
select extensions.is((select media_kind from app.attachments
  where id = (select attachment_id from first_video)), 'video',
  'authorization creates a video attachment');
select extensions.throws_ok(format(
  'select * from app.authorize_video_upload(%L,%L,%L,%L)',
  (select entry_id from video_target), 'wrong.webm', 'video/mp4', 4096),
  'P0001', 'odiina_video_upload_invalid', 'MIME and extension mismatch is rejected');
select extensions.throws_ok(format(
  'select * from app.authorize_video_upload(%L,%L,%L,%L)',
  (select entry_id from video_target), 'clip.avi', 'video/x-msvideo', 4096),
  'P0001', 'odiina_video_upload_invalid', 'unsupported video MIME is rejected');
select extensions.throws_ok(format(
  'select * from app.authorize_video_upload(%L,%L,%L,%L)',
  (select entry_id from video_target), 'large.mp4', 'video/mp4', 262144001),
  'P0001', 'odiina_video_upload_invalid', 'oversized video authorization is rejected');
select extensions.throws_ok(format(
  'select * from app.authorize_video_upload(%L,%L,%L,%L)',
  (select entry_id from video_target), 'second.webm', 'video/webm', 4096),
  'P0001', 'odiina_video_limit', 'only one unattached live video attempt may be staged');

reset role;
select set_config('request.jwt.claims',
  '{"sub":"99999999-9999-4999-8999-999999999992","role":"authenticated"}', true);
set local role authenticated;
select extensions.is((select count(*)::bigint from app.attachments), 0::bigint,
  'another owner cannot read staged video');
select extensions.throws_ok(format(
  'select * from app.authorize_video_upload(%L,%L,%L,%L)',
  (select entry_id from video_target), 'forged.mp4', 'video/mp4', 4096),
  'P0001', 'odiina_media_entry_unavailable',
  'another owner cannot stage video against the Entry');

reset role;
select extensions.throws_ok(format(
  'insert into app.entry_revision_attachments
   (user_id,entry_id,revision_id,attachment_id,position)
   values (%L,%L,%L,%L,1)',
  '99999999-9999-4999-8999-999999999991', (select entry_id from video_target),
  (select revision_id from video_target), (select attachment_id from first_video)),
  'P0001', 'odiina_entry_media_required',
  'pending video cannot enter an immutable revision');
update app.attachments set state = 'accepted', accepted_at = now()
where id = (select attachment_id from first_video);
insert into app.video_metadata (
  user_id, entry_id, attachment_id, input_container, input_video_codec,
  input_audio_codec, input_duration_ms, input_width, input_height,
  input_frame_rate, input_rotation, has_audio, playback_container,
  playback_video_codec, playback_audio_codec, playback_duration_ms,
  playback_width, playback_height, playback_frame_rate, poster_width, poster_height
) values (
  '99999999-9999-4999-8999-999999999991', (select entry_id from video_target),
  (select attachment_id from first_video), 'mp4', 'h264', 'aac', 2500,
  1280, 720, 30, 0, true, 'mp4', 'h264', 'aac_lc', 2510,
  1280, 720, 30, 640, 360);

select set_config('request.jwt.claims',
  '{"sub":"99999999-9999-4999-8999-999999999991","role":"authenticated"}', true);
set local role authenticated;
create temporary table video_revision as select * from app.revise_entry_media(
  (select entry_id from video_target), (select revision_id from video_target),
  'Video target', array[(select attachment_id from first_video)],
  '2026-07-24T23:45:00+05:30', 'Asia/Kolkata', '2026-07-24', 330::smallint, 'edited');
select extensions.is((select count(*)::bigint from app.entry_revision_attachments
  where revision_id = (select revision_id from video_revision)), 1::bigint,
  'accepted owned video enters a new revision');
select extensions.is((select media_kind from app.revision_media(
  array[(select revision_id from video_revision)])), 'video',
  'revision projection identifies video');
select extensions.is((select duration_ms from app.revision_media(
  array[(select revision_id from video_revision)])), 2510,
  'revision projection exposes playback duration');
select extensions.is((select has_audio from app.revision_media(
  array[(select revision_id from video_revision)])), true,
  'revision projection exposes truthful audio presence');
select extensions.is((select video_entries from app.profile_statistics()), 1::bigint,
  'Profile counts one active current Video Entry');

reset role;
insert into app.attachments (
  id, user_id, entry_id, media_kind, purpose, state, declared_mime,
  expected_byte_count, accepted_at
) values (
  '99999999-9999-4999-8999-999999999993',
  '99999999-9999-4999-8999-999999999991', (select entry_id from video_target),
  'audio', 'entry', 'accepted', 'audio/webm', 4096, now());
insert into app.audio_metadata (
  user_id, entry_id, attachment_id, input_container, input_codec,
  input_duration_ms, input_channels, input_sample_rate, playback_container,
  playback_codec, playback_duration_ms, playback_channels,
  playback_sample_rate, waveform_peaks
) values (
  '99999999-9999-4999-8999-999999999991', (select entry_id from video_target),
  '99999999-9999-4999-8999-999999999993', 'webm', 'opus', 1000, 1, 48000,
  'm4a', 'aac_lc', 1000, 1, 48000, array_fill(500::smallint, array[96]));
set local role authenticated;
select extensions.throws_ok(format(
  'select * from app.revise_entry_media(%L,%L,%L,%L::uuid[],%L,%L,%L,%L,%L)',
  (select entry_id from video_target), (select revision_id from video_revision),
  'conflict', array[(select attachment_id from first_video),
    '99999999-9999-4999-8999-999999999993'::uuid],
  '2026-07-24T23:45:00+05:30', 'Asia/Kolkata', '2026-07-24', 330, 'edited'),
  'P0001', 'odiina_entry_media_limit',
  'video and standalone voice cannot coexist in one revision');

create temporary table replacement_video as select * from app.authorize_video_upload(
  (select entry_id from video_target), 'replacement.webm', 'video/webm', 4096);
select extensions.is((select entry_id from replacement_video),
  (select entry_id from video_target),
  'owner may stage one replacement against an active Video Entry');
reset role;
update app.attachments set state = 'accepted', accepted_at = now()
where id = (select attachment_id from replacement_video);
insert into app.video_metadata (
  user_id, entry_id, attachment_id, input_container, input_video_codec,
  input_audio_codec, input_duration_ms, input_width, input_height,
  input_frame_rate, input_rotation, has_audio, playback_container,
  playback_video_codec, playback_audio_codec, playback_duration_ms,
  playback_width, playback_height, playback_frame_rate, poster_width, poster_height
) values (
  '99999999-9999-4999-8999-999999999991', (select entry_id from video_target),
  (select attachment_id from replacement_video), 'webm', 'vp8', null, 3500,
  720, 1280, 24, 0, false, 'mp4', 'h264', null, 3510,
  720, 1280, 24, 360, 640);
set local role authenticated;
create temporary table replaced_video_revision as select * from app.revise_entry_media(
  (select entry_id from video_target), (select revision_id from video_revision),
  'Replacement video', array[(select attachment_id from replacement_video)],
  '2026-07-24T23:45:00+05:30', 'Asia/Kolkata', '2026-07-24', 330::smallint, 'edited');
select extensions.is((select attachment_id from app.entry_revision_attachments
  where revision_id = (select revision_id from replaced_video_revision)),
  (select attachment_id from replacement_video),
  'replacement creates new immutable current membership');
select extensions.is((select count(*)::bigint from app.entry_revision_attachments
  where revision_id = (select revision_id from video_revision)
    and attachment_id = (select attachment_id from first_video)), 1::bigint,
  'replacement preserves historical video evidence');
select extensions.throws_ok(format(
  'select * from app.revise_entry_media(%L,%L,%L,%L::uuid[],%L,%L,%L,%L,%L)',
  (select entry_id from video_target), (select revision_id from video_revision),
  'stale', array[(select attachment_id from replacement_video)],
  '2026-07-24T23:45:00+05:30', 'Asia/Kolkata', '2026-07-24', 330, 'edited'),
  'P0001', 'odiina_revision_conflict', 'stale video revision write is rejected');
select app.trash_entry((select entry_id from video_target));
select extensions.is((select video_entries from app.profile_statistics()), 0::bigint,
  'Trash excludes Video Entry from Profile statistics');
select app.restore_entry((select entry_id from video_target));
select extensions.is((select video_entries from app.profile_statistics()), 1::bigint,
  'restore returns Video Entry to Profile statistics');
create temporary table removed_video_revision as select * from app.revise_entry_media(
  (select entry_id from video_target), (select revision_id from replaced_video_revision),
  'Video removed', array[]::uuid[], '2026-07-24T23:45:00+05:30',
  'Asia/Kolkata', '2026-07-24', 330::smallint, 'edited');
select extensions.is((select count(*)::bigint from app.entry_revision_attachments
  where revision_id = (select revision_id from removed_video_revision)), 0::bigint,
  'removing video creates an empty current membership');
select extensions.is((select video_entries from app.profile_statistics()), 0::bigint,
  'historical-only video is not counted as current');

reset role;
select extensions.is((select count(*)::bigint from pg_proc as p
  join pg_namespace as n on n.oid = p.pronamespace
  where n.nspname = 'app' and p.proname in (
    'authorize_video_upload', 'mark_video_uploading',
    'finalize_video_upload', 'commit_processed_video')
    and p.prosecdef and p.proconfig @> array['search_path=""']::text[]),
  4::bigint, 'video mutation functions are SECURITY DEFINER with empty search paths');
select extensions.is((select count(*)::bigint from pg_proc as p
  join pg_namespace as n on n.oid = p.pronamespace
  where n.nspname = 'app' and p.proname like '%video%'
    and 'p_user_id' = any(coalesce(p.proargnames, array[]::text[]))),
  0::bigint, 'video functions never accept caller-supplied ownership');

select * from extensions.finish();
rollback;
