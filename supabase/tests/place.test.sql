begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(37);

select extensions.ok(
  (select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class
   where oid = 'app.entry_revision_places'::regclass),
  'place snapshots have forced RLS'
);
select extensions.ok(not pg_catalog.has_function_privilege(
  'anon', 'app.create_entry_place(uuid,text,jsonb,timestamptz,text,date,smallint)', 'EXECUTE'),
  'anon cannot create a place Entry'
);
select extensions.ok(not pg_catalog.has_function_privilege(
  'public', 'app.create_entry_place(uuid,text,jsonb,timestamptz,text,date,smallint)', 'EXECUTE'),
  'PUBLIC cannot create a place Entry'
);
select extensions.ok(pg_catalog.has_function_privilege(
  'authenticated', 'app.create_entry_place(uuid,text,jsonb,timestamptz,text,date,smallint)', 'EXECUTE'),
  'authenticated may invoke the narrow create RPC'
);
select extensions.ok(not pg_catalog.has_function_privilege(
  'anon', 'app.redact_entry_places(uuid)', 'EXECUTE'),
  'anon cannot redact place history'
);
select extensions.is(
  (select pg_catalog.pg_get_userbyid(proowner) from pg_catalog.pg_proc
   where oid = 'app.create_entry_place(uuid,text,jsonb,timestamptz,text,date,smallint)'::regprocedure),
  'odiina_owner_api', 'create RPC uses the constrained owner role'
);
select extensions.is(
  (select proconfig from pg_catalog.pg_proc
   where oid = 'app.create_entry_place(uuid,text,jsonb,timestamptz,text,date,smallint)'::regprocedure),
  array['search_path=""']::text[], 'create RPC has an empty fixed search path'
);
select extensions.is(
  (select proconfig from pg_catalog.pg_proc
   where oid = 'app.redact_entry_places(uuid)'::regprocedure),
  array['search_path=""']::text[], 'redaction RPC has an empty fixed search path'
);
select extensions.ok(
  not (select coalesce('user_id' = any(proargnames), false) from pg_catalog.pg_proc
    where oid = 'app.create_entry_place(uuid,text,jsonb,timestamptz,text,date,smallint)'::regprocedure),
  'mutation RPC accepts no user_id'
);
select extensions.ok(not pg_catalog.has_function_privilege(
  'authenticated', 'app.insert_revision_place(uuid,uuid,jsonb)', 'EXECUTE'),
  'authenticated cannot invoke the internal insert helper'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('71111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','place-a@example.test','',now(),'','','','',
 '{"provider":"email","providers":["email"]}','{}',now(),now()),
('72222222-2222-4222-8222-222222222222','00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','place-b@example.test','',now(),'','','','',
 '{"provider":"email","providers":["email"]}','{}',now(),now());

create temporary table place_ids (
  label text primary key, entry_id uuid not null, revision_id uuid not null
);
grant all on table place_ids to authenticated;

select set_config('request.jwt.claims',
  '{"sub":"71111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
set local role authenticated;
insert into place_ids select 'created', result.* from app.create_entry_place(
  '71111111-0000-4000-8000-000000000001', '',
  '{"placeName":"Café 日本語 🧭","placeArea":"Central","placeAddress":null,"latitude":null,"longitude":null,"precision":"label_only","approximateRadiusMeters":null,"source":"manual","provider":null,"providerPlaceId":null,"countryCode":null}'::jsonb,
  '2026-07-22T07:30:00Z','Asia/Kolkata','2026-07-22',330::smallint
) as result;

select extensions.is((select count(*)::bigint from app.entry_revision_places), 1::bigint,
  'place-only creation stores one snapshot');
select extensions.is((select body_text from app.entry_revisions where id =
  (select revision_id from place_ids where label='created')), '',
  'a place-only Entry has an honest empty text body');
select extensions.is((select place_name from app.entry_revision_places), 'Café 日本語 🧭',
  'Unicode place labels are preserved');
select extensions.is((select latitude from app.entry_revision_places), null::numeric,
  'label-only storage contains no latitude');
select extensions.is((select longitude from app.entry_revision_places), null::numeric,
  'label-only storage contains no longitude');
select extensions.is(
  (select entry_id from app.create_entry_place(
    '71111111-0000-4000-8000-000000000001','',
    '{"placeName":"Café 日本語 🧭","placeArea":"Central","placeAddress":null,"latitude":null,"longitude":null,"precision":"label_only","approximateRadiusMeters":null,"source":"manual","provider":null,"providerPlaceId":null,"countryCode":null}'::jsonb,
    '2026-07-22T07:30:00Z','Asia/Kolkata','2026-07-22',330::smallint)),
  (select entry_id from place_ids where label='created'),
  'place creation is idempotent for the same canonical request'
);
select extensions.throws_ok(
  $$select * from app.create_entry_place(
    '71111111-0000-4000-8000-000000000002','bad grid',
    '{"placeName":"Approx","placeArea":null,"placeAddress":null,"latitude":12.9716,"longitude":77.5946,"precision":"approximate","approximateRadiusMeters":3000,"source":"device","provider":null,"providerPlaceId":null,"countryCode":null}'::jsonb,
    '2026-07-22T07:30:00Z','Asia/Kolkata','2026-07-22',330::smallint)$$,
  'P0001', null, 'server rejects an unquantized approximate coordinate'
);
select extensions.throws_ok(
  $$select * from app.create_entry_place(
    '71111111-0000-4000-8000-000000000004','reserved source',
    '{"placeName":"Provider result","placeArea":null,"placeAddress":null,"latitude":null,"longitude":null,"precision":"label_only","approximateRadiusMeters":null,"source":"search","provider":null,"providerPlaceId":null,"countryCode":null}'::jsonb,
    '2026-07-22T07:30:00Z','Asia/Kolkata','2026-07-22',330::smallint)$$,
  'P0001', null, 'database rejects reserved provider-backed sources'
);
select extensions.throws_ok(
  $$select * from app.create_entry_place(
    '71111111-0000-4000-8000-000000000005','provider identifier',
    '{"placeName":"Manual place","placeArea":null,"placeAddress":null,"latitude":null,"longitude":null,"precision":"label_only","approximateRadiusMeters":null,"source":"manual","provider":"unapproved","providerPlaceId":"external-1","countryCode":null}'::jsonb,
    '2026-07-22T07:30:00Z','Asia/Kolkata','2026-07-22',330::smallint)$$,
  'P0001', null, 'database rejects unapproved provider identifiers'
);

select extensions.throws_ok(
  $$update app.entry_revision_places set place_name='tampered'$$,
  '42501', null, 'normal authenticated SQL cannot edit a snapshot'
);
select extensions.throws_ok(
  $$delete from app.entry_revision_places$$,
  '42501', null, 'normal authenticated SQL cannot delete a snapshot'
);

reset role;
select set_config('request.jwt.claims',
  '{"sub":"72222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
set local role authenticated;
select extensions.is((select count(*)::bigint from app.entry_revision_places), 0::bigint,
  'another owner cannot read private place data');
select extensions.throws_ok(
  format('select * from app.redact_entry_places(%L)',
    (select entry_id from place_ids where label='created')),
  'P0001', null, 'another owner cannot redact private place data'
);

reset role;
select set_config('request.jwt.claims',
  '{"sub":"71111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
set local role authenticated;
insert into place_ids select 'revised', result.* from app.revise_entry_place(
  (select entry_id from place_ids where label='created'),
  (select revision_id from place_ids where label='created'),
  '', array[]::uuid[],
  '{"placeName":"Exact pin","placeArea":null,"placeAddress":null,"latitude":12.9716,"longitude":77.5946,"precision":"exact","approximateRadiusMeters":null,"source":"device","provider":null,"providerPlaceId":null,"countryCode":null,"exactConfirmed":true}'::jsonb,
  '2026-07-22T07:30:00Z','Asia/Kolkata','2026-07-22',330::smallint,'edited'
) as result;
select extensions.is((select count(*)::bigint from app.entry_revisions where entry_id=
  (select entry_id from place_ids where label='created')), 2::bigint,
  'changing a place creates a second immutable revision');
select extensions.is((select place_name from app.entry_revision_places where revision_id=
  (select revision_id from place_ids where label='created')), 'Café 日本語 🧭',
  'the historical place remains unchanged');
select extensions.is((select precision from app.entry_revision_places where revision_id=
  (select revision_id from place_ids where label='revised')), 'exact',
  'the new revision stores the separately confirmed exact place');
select extensions.is((select count(*)::bigint from app.revision_places(array[
  (select revision_id from place_ids where label='created'),
  (select revision_id from place_ids where label='revised')])), 2::bigint,
  'authorized revision history returns both place snapshots');
select extensions.is((select place_entries from app.profile_statistics()), 1::bigint,
  'Profile statistics count the active current place once');
select extensions.is((select redacted_count from app.redact_entry_places(
  (select entry_id from place_ids where label='created'))), 2,
  'explicit privacy redaction clears every revision place');
select extensions.is((select count(*)::bigint from app.entry_revision_places
  where place_name is null and latitude is null and redacted_at is not null), 2::bigint,
  'redaction removes labels and coordinates while recording the event');
select extensions.is((select count(*)::bigint from app.entry_revisions where entry_id=
  (select entry_id from place_ids where label='created')), 2::bigint,
  'redaction preserves immutable revision records');
select extensions.is((select place_entries from app.profile_statistics()), 0::bigint,
  'redacted current places no longer count in Profile statistics');

create temporary table place_media_draft as
select * from app.authorize_image_upload(
  null, 'place-combination.jpg', 'image/jpeg', 1024
);
reset role;
update app.attachments set state='accepted', accepted_at=statement_timestamp()
where id=(select attachment_id from place_media_draft);
set local role authenticated;
create temporary table place_media_activation as
select * from app.activate_media_entry_place(
  '71111111-0000-4000-8000-000000000003',
  (select entry_id from place_media_draft), '',
  array[(select attachment_id from place_media_draft)],
  '{"placeName":"Photo place","placeArea":null,"placeAddress":null,"latitude":null,"longitude":null,"precision":"label_only","approximateRadiusMeters":null,"source":"manual","provider":null,"providerPlaceId":null,"countryCode":null}'::jsonb,
  '2026-07-22T08:30:00Z','Asia/Kolkata','2026-07-22',330::smallint
);
select extensions.is((select place_name from app.entry_revision_places where revision_id=
  (select revision_id from place_media_activation)), 'Photo place',
  'media activation atomically stores its place snapshot');
select extensions.is((select count(*)::bigint from app.entry_revision_attachments where revision_id=
  (select revision_id from place_media_activation)), 1::bigint,
  'media and place share the same immutable revision');
select extensions.is((select revision_id from app.activate_media_entry_place(
  '71111111-0000-4000-8000-000000000003',
  (select entry_id from place_media_draft), '',
  array[(select attachment_id from place_media_draft)],
  '{"placeName":"Photo place","placeArea":null,"placeAddress":null,"latitude":null,"longitude":null,"precision":"label_only","approximateRadiusMeters":null,"source":"manual","provider":null,"providerPlaceId":null,"countryCode":null}'::jsonb,
  '2026-07-22T08:30:00Z','Asia/Kolkata','2026-07-22',330::smallint
)), (select revision_id from place_media_activation),
  'media plus place activation is idempotent');

reset role;
select extensions.throws_ok(
  $$insert into app.entry_revision_places(user_id,entry_id,revision_id,place_name,
      precision,source) values(
    '71111111-1111-4111-8111-111111111111',
    (select entry_id from place_ids where label='created'),
    '79999999-9999-4999-8999-999999999999','Wrong revision','label_only','manual')$$,
  '23503', null, 'a place cannot reference another or nonexistent revision'
);
select extensions.is(
  (select count(*)::bigint from information_schema.role_table_grants
   where table_schema='app' and table_name='entry_revision_places'
     and grantee in ('anon','PUBLIC')), 0::bigint,
  'anon and PUBLIC have no place-table privileges'
);

select * from extensions.finish();
rollback;
