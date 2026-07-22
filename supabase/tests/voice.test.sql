begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(31);

select extensions.ok(
  not pg_catalog.has_function_privilege(
    'anon', 'app.authorize_audio_upload(uuid,text,text,bigint)', 'EXECUTE'
  ),
  'anon cannot authorize audio'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated', 'app.authorize_audio_upload(uuid,text,text,bigint)', 'EXECUTE'
  ),
  'authenticated can invoke narrow audio authorization'
);
select extensions.ok(
  not pg_catalog.has_function_privilege(
    'anon', 'app.finalize_audio_upload(uuid)', 'EXECUTE'
  ),
  'anon cannot finalize audio'
);
select extensions.ok(
  not (select rolbypassrls from pg_roles where rolname = 'odiina_worker_api'),
  'audio worker function owner cannot bypass RLS'
);
select extensions.ok(
  (
    select relrowsecurity and relforcerowsecurity
    from pg_class where oid = 'app.audio_metadata'::regclass
  ),
  'audio metadata has forced RLS'
);
select extensions.is(
  (select count(*)::bigint from storage.buckets where id = 'odiina-playback' and not public),
  1::bigint,
  'playback bucket is private'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '77777777-7777-4777-8777-777777777777',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'voice-a@example.test', '', now(),
    '', '', '', '', '{"provider":"email","providers":["email"]}', '{}', now(), now()
  ),
  (
    '88888888-8888-4888-8888-888888888888',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'voice-b@example.test', '', now(),
    '', '', '', '', '{"provider":"email","providers":["email"]}', '{}', now(), now()
  )
on conflict (id) do nothing;

select set_config(
  'request.jwt.claims',
  '{"sub":"77777777-7777-4777-8777-777777777777","role":"authenticated"}',
  true
);
set local role authenticated;
create temporary table voice_target as
select * from app.create_entry(
  '77777777-7777-4777-8777-777777777701',
  'Voice target', '2026-07-22T23:45:00+05:30', 'Asia/Kolkata',
  '2026-07-22', 330::smallint
);
create temporary table first_voice as
select * from app.authorize_audio_upload(
  (select entry_id from voice_target), 'voice.webm', 'audio/webm', 4096
);
select extensions.is(
  (
    select media_kind from app.attachments
    where id = (select attachment_id from first_voice)
  ),
  'audio',
  'authorization creates an audio attachment'
);
select extensions.is(
  (select count(*)::bigint from app.attachments),
  1::bigint,
  'owner sees the staged audio through RLS'
);
select extensions.throws_ok(
  format(
    'select * from app.authorize_audio_upload(%L,%L,%L,%L)',
    (select entry_id from voice_target), 'second.ogg', 'audio/ogg', 4096
  ),
  'P0001', 'odiina_voice_limit',
  'only one unattached live voice attempt may be staged'
);
select extensions.throws_ok(
  format(
    'select * from app.authorize_audio_upload(%L,%L,%L,%L)',
    (select entry_id from voice_target), 'wrong.m4a', 'audio/webm', 4096
  ),
  'P0001', 'odiina_audio_upload_invalid',
  'MIME and extension mismatch is rejected'
);
select extensions.throws_ok(
  format(
    'select * from app.authorize_audio_upload(%L,%L,%L,%L)',
    (select entry_id from voice_target), 'voice.mp3', 'audio/mpeg', 4096
  ),
  'P0001', 'odiina_audio_upload_invalid',
  'unsupported audio MIME is rejected'
);
select extensions.throws_ok(
  format(
    'select * from app.authorize_audio_upload(%L,%L,%L,%L)',
    (select entry_id from voice_target), 'large.webm', 'audio/webm', 26214401
  ),
  'P0001', 'odiina_audio_upload_invalid',
  'oversized audio authorization is rejected'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"88888888-8888-4888-8888-888888888888","role":"authenticated"}',
  true
);
set local role authenticated;
select extensions.is(
  (select count(*)::bigint from app.attachments),
  0::bigint,
  'another owner cannot read staged audio'
);
select extensions.throws_ok(
  format(
    'select * from app.authorize_audio_upload(%L,%L,%L,%L)',
    (select entry_id from voice_target), 'forged.webm', 'audio/webm', 4096
  ),
  'P0001', 'odiina_media_entry_unavailable',
  'another owner cannot stage audio against the Entry'
);

reset role;
select extensions.throws_ok(
  format(
    'insert into app.entry_revision_attachments
      (user_id,entry_id,revision_id,attachment_id,position)
     values (%L,%L,%L,%L,1)',
    '77777777-7777-4777-8777-777777777777',
    (select entry_id from voice_target),
    (select revision_id from voice_target),
    (select attachment_id from first_voice)
  ),
  'P0001', 'odiina_entry_media_required',
  'pending audio cannot enter an immutable revision'
);

update app.attachments set state = 'accepted', accepted_at = now()
where id = (select attachment_id from first_voice);
insert into app.audio_metadata (
  user_id, entry_id, attachment_id, input_container, input_codec,
  input_duration_ms, input_channels, input_sample_rate, playback_container,
  playback_codec, playback_duration_ms, playback_channels,
  playback_sample_rate, waveform_peaks
) values (
  '77777777-7777-4777-8777-777777777777',
  (select entry_id from voice_target), (select attachment_id from first_voice),
  'webm', 'opus', 1200, 1, 48000, 'm4a', 'aac_lc', 1210, 1, 48000,
  array_fill(500::smallint, array[96])
);

select set_config(
  'request.jwt.claims',
  '{"sub":"77777777-7777-4777-8777-777777777777","role":"authenticated"}',
  true
);
set local role authenticated;
create temporary table voice_revision as
select * from app.revise_entry_media(
  (select entry_id from voice_target), (select revision_id from voice_target),
  'Voice target', array[(select attachment_id from first_voice)],
  '2026-07-22T23:45:00+05:30', 'Asia/Kolkata', '2026-07-22',
  330::smallint, 'edited'
);
select extensions.is(
  (
    select count(*)::bigint from app.entry_revision_attachments
    where revision_id = (select revision_id from voice_revision)
  ),
  1::bigint,
  'accepted owned voice can enter a new revision'
);
select extensions.is(
  (
    select media_kind from app.revision_media(
      array[(select revision_id from voice_revision)]
    )
  ),
  'audio',
  'revision media truthfully identifies audio'
);
select extensions.is(
  (
    select duration_ms from app.revision_media(
      array[(select revision_id from voice_revision)]
    )
  ),
  1210,
  'revision media exposes accepted playback duration'
);
select extensions.is(
  (select voice_entries from app.profile_statistics()),
  1::bigint,
  'Profile counts one active current Voice Entry'
);

create temporary table replacement_voice as
select * from app.authorize_audio_upload(
  (select entry_id from voice_target), 'replacement.m4a', 'audio/mp4', 4096
);
select extensions.is(
  (select entry_id from replacement_voice),
  (select entry_id from voice_target),
  'an owner may stage one replacement against an active voice Entry'
);
reset role;
update app.attachments set state = 'accepted', accepted_at = now()
where id = (select attachment_id from replacement_voice);
insert into app.audio_metadata (
  user_id, entry_id, attachment_id, input_container, input_codec,
  input_duration_ms, input_channels, input_sample_rate, playback_container,
  playback_codec, playback_duration_ms, playback_channels,
  playback_sample_rate, waveform_peaks
) values (
  '77777777-7777-4777-8777-777777777777',
  (select entry_id from voice_target), (select attachment_id from replacement_voice),
  'm4a', 'aac', 2200, 2, 44100, 'm4a', 'aac_lc', 2210, 1, 48000,
  array_fill(600::smallint, array[96])
);
set local role authenticated;
select extensions.throws_ok(
  format(
    'select * from app.revise_entry_media(%L,%L,%L,%L::uuid[],%L,%L,%L,%L,%L)',
    (select entry_id from voice_target), (select revision_id from voice_revision),
    'Voice target', array[
      (select attachment_id from first_voice),
      (select attachment_id from replacement_voice)
    ], '2026-07-22T23:45:00+05:30', 'Asia/Kolkata', '2026-07-22', 330, 'edited'
  ),
  'P0001', 'odiina_entry_media_limit',
  'a revision cannot contain two voice notes'
);
create temporary table replaced_revision as
select * from app.revise_entry_media(
  (select entry_id from voice_target), (select revision_id from voice_revision),
  'Voice target', array[(select attachment_id from replacement_voice)],
  '2026-07-22T23:45:00+05:30', 'Asia/Kolkata', '2026-07-22',
  330::smallint, 'edited'
);
select extensions.is(
  (
    select count(*)::bigint from app.entry_revision_attachments
    where revision_id = (select revision_id from replaced_revision)
  ),
  1::bigint,
  'replacement creates one new immutable membership'
);
select extensions.is(
  (
    select count(*)::bigint from app.entry_revision_attachments
    where revision_id = (select revision_id from voice_revision)
      and attachment_id = (select attachment_id from first_voice)
  ),
  1::bigint,
  'replacement preserves historical voice evidence'
);
select extensions.is(
  (
    select attachment_id from app.entry_revision_attachments
    where revision_id = (select revision_id from replaced_revision)
  ),
  (select attachment_id from replacement_voice),
  'current revision points only to the replacement voice'
);
select app.trash_entry((select entry_id from voice_target));
select extensions.is(
  (select voice_entries from app.profile_statistics()),
  0::bigint,
  'Trash removes the Voice Entry from Profile statistics'
);
select app.restore_entry((select entry_id from voice_target));
select extensions.is(
  (select voice_entries from app.profile_statistics()),
  1::bigint,
  'restore returns the Voice Entry to Profile statistics'
);
create temporary table removed_voice_revision as
select * from app.revise_entry_media(
  (select entry_id from voice_target), (select revision_id from replaced_revision),
  'Voice target without audio', array[]::uuid[],
  '2026-07-22T23:45:00+05:30', 'Asia/Kolkata', '2026-07-22',
  330::smallint, 'edited'
);
select extensions.is(
  (
    select count(*)::bigint from app.entry_revision_attachments
    where revision_id = (select revision_id from removed_voice_revision)
  ),
  0::bigint,
  'removing voice creates an empty current membership'
);
select extensions.is(
  (select voice_entries from app.profile_statistics()),
  0::bigint,
  'removed historical-only voice is not counted as current'
);

reset role;
insert into app.attachments (
  id, user_id, entry_id, media_kind, purpose, state, declared_mime,
  expected_byte_count, accepted_at
) values (
  '77777777-7777-4777-8777-777777777799',
  '77777777-7777-4777-8777-777777777777',
  (select entry_id from voice_target), 'image', 'profile_avatar', 'accepted',
  'image/jpeg', 1024, now()
);
select set_config(
  'request.jwt.claims',
  '{"sub":"77777777-7777-4777-8777-777777777777","role":"authenticated"}',
  true
);
set local role authenticated;
select extensions.throws_ok(
  format(
    'select * from app.revise_entry_media(%L,%L,%L,%L::uuid[],%L,%L,%L,%L,%L)',
    (select entry_id from voice_target),
    (select revision_id from removed_voice_revision), 'invalid purpose',
    array['77777777-7777-4777-8777-777777777799'::uuid],
    '2026-07-22T23:45:00+05:30', 'Asia/Kolkata', '2026-07-22', 330, 'edited'
  ),
  'P0001', 'odiina_attachment_unavailable',
  'Profile media cannot masquerade as Entry media'
);

reset role;
select extensions.is(
  (
    select count(*)::bigint from pg_proc as p
    join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.proname in (
        'authorize_audio_upload', 'mark_audio_uploading',
        'finalize_audio_upload', 'commit_processed_audio'
      )
      and p.prosecdef and p.proconfig @> array['search_path=""']::text[]
  ),
  4::bigint,
  'audio mutation functions are SECURITY DEFINER with empty search paths'
);
select extensions.is(
  (
    select count(*)::bigint from pg_proc as p
    join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.proname like '%audio%'
      and 'p_user_id' = any(coalesce(p.proargnames, array[]::text[]))
  ),
  0::bigint,
  'audio functions never accept caller-supplied ownership'
);

select * from extensions.finish();
rollback;
