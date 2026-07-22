begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(26);

select extensions.ok(
  not (select rolbypassrls from pg_roles where rolname = 'odiina_worker_api'),
  'worker function owner cannot bypass RLS'
);
select extensions.ok(
  not pg_catalog.has_schema_privilege('authenticated', 'pgmq', 'USAGE'),
  'browser authenticated role cannot use pgmq'
);
select extensions.ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'app.authorize_image_upload(uuid,text,text,bigint)',
    'EXECUTE'
  ),
  'anon cannot authorize image upload'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'app.authorize_image_upload(uuid,text,text,bigint)',
    'EXECUTE'
  ),
  'authenticated can invoke the narrow upload authorization'
);
select extensions.is(
  (
    select count(*)::bigint
    from pg_proc as p
    join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.proname in (
        'authorize_image_upload', 'mark_image_uploading',
        'finalize_image_upload', 'cancel_image_upload',
        'mark_cancelled_object_deleted', 'activate_media_entry',
        'revise_entry_media',
        'register_media_worker', 'revoke_media_worker', 'claim_media_job',
        'claim_media_orphan', 'complete_media_orphan',
        'heartbeat_media_job', 'commit_processed_image',
        'finish_media_job', 'fail_media_job'
      )
      and p.prosecdef
      and p.proconfig @> array['search_path=""']::text[]
  ),
  16::bigint,
  'all media mutation functions are SECURITY DEFINER with empty search_path'
);
select extensions.is(
  (
    select count(*)::bigint
    from pg_proc as p
    join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and 'p_user_id' = any(coalesce(p.proargnames, array[]::text[]))
  ),
  0::bigint,
  'media functions never accept user_id'
);
select extensions.is(
  (
    select count(*)::bigint
    from storage.buckets
    where id in (
      'odiina-quarantine', 'odiina-originals', 'odiina-display', 'odiina-ai'
    )
      and not public
  ),
  4::bigint,
  'all four media buckets are private'
);
select extensions.ok(
  not pg_catalog.has_table_privilege(
    'authenticated',
    'app.attachment_objects',
    'INSERT'
  ),
  'browser role cannot forge attachment object rows'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '44444444-4444-4444-8444-444444444444',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'media-a@example.test', '', now(),
    '', '', '', '',
    '{"provider":"email","providers":["email"]}', '{}', now(), now()
  ),
  (
    '55555555-5555-4555-8555-555555555555',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'media-b@example.test', '', now(),
    '', '', '', '',
    '{"provider":"email","providers":["email"]}', '{}', now(), now()
  )
on conflict (id) do nothing;

create temporary table media_test_ids (
  label text primary key,
  entry_id uuid not null,
  attachment_id uuid not null,
  object_key text not null
);
grant all on media_test_ids to authenticated, odiina_owner_api;

select set_config(
  'request.jwt.claims',
  '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}',
  true
);
set local role authenticated;
insert into media_test_ids
select 'first', entry_id, attachment_id, object_key
from app.authorize_image_upload(
  null, 'geometry.double.png', 'image/png', 1024
);
select extensions.is(
  (select count(*)::bigint from app.attachments),
  1::bigint,
  'owner sees the authorized attachment through RLS'
);
select extensions.ok(
  (
    select object_key !~* 'geometry|44444444|media-a'
      and object_key ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}$'
    from media_test_ids where label = 'first'
  ),
  'object key is opaque and excludes owner and filename material'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}',
  true
);
set local role authenticated;
select extensions.is(
  (select count(*)::bigint from app.attachments),
  0::bigint,
  'another owner cannot read attachments'
);
select extensions.throws_ok(
  format(
    'select * from app.authorize_image_upload(%L, %L, %L, %L)',
    (select entry_id from media_test_ids where label = 'first'),
    'forged.png', 'image/png', 1024
  ),
  'P0001',
  'odiina_media_entry_unavailable',
  'another owner cannot add to the draft'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}',
  true
);
set local role authenticated;
select app.authorize_image_upload(
  (select entry_id from media_test_ids where label = 'first'),
  'two.jpg', 'image/jpeg', 1024
);
select app.authorize_image_upload(
  (select entry_id from media_test_ids where label = 'first'),
  'three.webp', 'image/webp', 1024
);
select app.authorize_image_upload(
  (select entry_id from media_test_ids where label = 'first'),
  'four.png', 'image/png', 1024
);
select app.authorize_image_upload(
  (select entry_id from media_test_ids where label = 'first'),
  'five.png', 'image/png', 1024
);
select extensions.throws_ok(
  format(
    'select * from app.authorize_image_upload(%L, %L, %L, %L)',
    (select entry_id from media_test_ids where label = 'first'),
    'six.png', 'image/png', 1024
  ),
  'P0001',
  'odiina_attachment_limit',
  'database rejects a sixth live attachment'
);
select extensions.throws_ok(
  $$select * from app.authorize_image_upload(
    null, 'renamed.svg.png', 'image/svg+xml', 1024
  )$$,
  'P0001',
  'odiina_image_upload_invalid',
  'server command rejects MIME outside the image allowlist'
);

create temporary table media_active_ids as
select *
from app.create_entry(
  '44444444-aaaa-4444-8444-444444444444',
  'Synthetic geometric attachment target',
  '2026-07-20T10:00:00Z',
  'UTC',
  '2026-07-20',
  0::smallint
);
reset role;
select extensions.throws_ok(
  format(
    'insert into app.entry_revision_attachments
      (user_id,entry_id,revision_id,attachment_id,position)
     values (%L,%L,%L,%L,1)',
    '44444444-4444-4444-8444-444444444444',
    (select entry_id from media_active_ids),
    (select revision_id from media_active_ids),
    (select attachment_id from media_test_ids where label = 'first')
  ),
  '23503',
  null,
  'constraint rejects cross-Entry attachment membership'
);

insert into app.attachments (
  id, user_id, entry_id, media_kind, state, declared_mime,
  expected_byte_count, accepted_at
) values (
  '66666666-6666-4666-8666-666666666666',
  '44444444-4444-4444-8444-444444444444',
  (select entry_id from media_active_ids),
  'image', 'accepted', 'image/png', 1024, now()
);
insert into app.entry_revision_attachments (
  user_id, entry_id, revision_id, attachment_id, position
) values (
  '44444444-4444-4444-8444-444444444444',
  (select entry_id from media_active_ids),
  (select revision_id from media_active_ids),
  '66666666-6666-4666-8666-666666666666',
  1
);
set local role authenticated;
create temporary table media_revision_after_remove as
select *
from app.revise_entry_media(
  (select entry_id from media_active_ids),
  (select revision_id from media_active_ids),
  'Synthetic geometric attachment target',
  array[]::uuid[],
  '2026-07-20T10:00:00Z',
  'UTC',
  '2026-07-20',
  0::smallint,
  'edited'
);
reset role;
select extensions.is(
  (
    select count(*)::bigint
    from app.entry_revision_attachments
    where revision_id = (select revision_id from media_active_ids)
  ),
  1::bigint,
  'removing media leaves historical revision membership intact'
);
select extensions.is(
  (
    select count(*)::bigint
    from app.entry_revision_attachments
    where revision_id = (select revision_id from media_revision_after_remove)
  ),
  0::bigint,
  'removing media records an empty membership in the new revision'
);
select extensions.throws_ok(
  $$update app.entry_revision_attachments
    set position = 2
    where attachment_id = '66666666-6666-4666-8666-666666666666'$$,
  'P0001',
  'odiina_revision_immutable',
  'historical attachment order cannot be updated'
);
select extensions.throws_ok(
  $$delete from app.entry_revision_attachments
    where attachment_id = '66666666-6666-4666-8666-666666666666'$$,
  'P0001',
  'odiina_revision_immutable',
  'historical attachment membership cannot be deleted'
);

select extensions.is(
  (
    select count(*)::bigint
    from pg_proc as p
    join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.proname = 'activate_media_entry'
      and p.pronargs = 7
  ),
  0::bigint,
  'non-idempotent media activation signature is removed'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'app.activate_media_entry(uuid,uuid,text,uuid[],timestamptz,text,date,smallint)',
    'EXECUTE'
  ),
  'authenticated receives only the idempotent activation signature'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}',
  true
);
set local role authenticated;
create temporary table active_revision_upload as
select *
from app.authorize_image_upload(
  (select entry_id from media_active_ids),
  'new-revision.jpg', 'image/jpeg', 1024
);
select extensions.is(
  (select entry_id from active_revision_upload),
  (select entry_id from media_active_ids),
  'an owner can authorize a new photo against an active Entry revision'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}',
  true
);
set local role authenticated;
select extensions.throws_ok(
  format(
    'select * from app.authorize_image_upload(%L,%L,%L,%L)',
    (select entry_id from media_active_ids),
    'cross-owner.jpg', 'image/jpeg', 1024
  ),
  'P0001',
  'odiina_media_entry_unavailable',
  'another owner cannot add a photo to an active Entry'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}',
  true
);
set local role authenticated;
create temporary table idempotent_media_draft as
select * from app.authorize_image_upload(
  null, 'idempotent.jpg', 'image/jpeg', 1024
);
reset role;
update app.attachments
set state = 'accepted', accepted_at = statement_timestamp()
where id = (select attachment_id from idempotent_media_draft);
set local role authenticated;
create temporary table first_media_activation as
select * from app.activate_media_entry(
  '88888888-8888-4888-8888-888888888888',
  (select entry_id from idempotent_media_draft),
  '',
  array[(select attachment_id from idempotent_media_draft)],
  '2026-07-20T12:00:00Z', 'UTC', '2026-07-20', 0::smallint
);
select extensions.is(
  (
    select revision_id
    from app.activate_media_entry(
      '88888888-8888-4888-8888-888888888888',
      (select entry_id from idempotent_media_draft),
      '',
      array[(select attachment_id from idempotent_media_draft)],
      '2026-07-20T12:00:00Z', 'UTC', '2026-07-20', 0::smallint
    )
  ),
  (select revision_id from first_media_activation),
  'replaying a media activation returns the original revision'
);
reset role;
select extensions.is(
  (
    select count(*)::bigint
    from app.entry_revisions
    where entry_id = (select entry_id from idempotent_media_draft)
  ),
  1::bigint,
  'an activation replay creates no duplicate revision'
);
set local role authenticated;
select extensions.throws_ok(
  format(
    'select * from app.activate_media_entry(%L,%L,%L,%L::uuid[],%L,%L,%L,%L)',
    '88888888-8888-4888-8888-888888888888',
    (select entry_id from idempotent_media_draft),
    'changed body',
    array[(select attachment_id from idempotent_media_draft)],
    '2026-07-20T12:00:00Z', 'UTC', '2026-07-20', 0
  ),
  'P0001',
  'odiina_idempotency_conflict',
  'reusing an activation key with different content is rejected'
);
reset role;

select * from extensions.finish();
rollback;
