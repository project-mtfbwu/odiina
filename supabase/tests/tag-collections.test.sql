begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(17);

select extensions.ok(not pg_catalog.has_function_privilege(
  'public','app.tag_collection_counts()','EXECUTE'),
  'PUBLIC cannot read private tag counts');
select extensions.ok(not pg_catalog.has_function_privilege(
  'anon','app.tag_collection_counts()','EXECUTE'),
  'anon cannot read private tag counts');
select extensions.ok(pg_catalog.has_function_privilege(
  'authenticated','app.tag_collection_counts()','EXECUTE'),
  'authenticated users may read their own tag counts');
select extensions.ok(not pg_catalog.has_function_privilege(
  'anon','app.search_entries(text,date,date,text[],text[],boolean,boolean,boolean,text,real,timestamptz,uuid,integer)','EXECUTE'),
  'anon cannot invoke collection search');
select extensions.is((select proconfig from pg_catalog.pg_proc where oid=
  'app.tag_collection_counts()'::regprocedure),
  array['search_path=""']::text[],'count RPC has an empty fixed search path');

insert into auth.users (
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  confirmation_token,recovery_token,email_change_token_new,email_change,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
('84444444-4444-4444-8444-444444444444','00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','collections-a@example.test','',now(),'','','','',
 '{"provider":"email","providers":["email"]}','{}',now(),now()),
('85555555-5555-4555-8555-555555555555','00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','collections-b@example.test','',now(),'','','','',
 '{"provider":"email","providers":["email"]}','{}',now(),now());

create temporary table collection_ids(
  label text primary key, entry_id uuid not null, revision_id uuid not null
);
grant all on table collection_ids to authenticated;

select set_config('request.jwt.claims',
  '{"sub":"84444444-4444-4444-8444-444444444444","role":"authenticated"}',true);
set local role authenticated;
insert into collection_ids select 'parent',result.* from app.create_entry_tagged(
  '84444444-0000-4000-8000-000000000001','Parent tag',array['Work'],null,
  '2026-07-22T07:30:00Z','Asia/Kolkata','2026-07-22',330::smallint) result;
insert into collection_ids select 'oas',result.* from app.create_entry_tagged(
  '84444444-0000-4000-8000-000000000002','OAS tag',array['Work/OAS'],null,
  '2026-07-23T07:30:00Z','Asia/Kolkata','2026-07-23',330::smallint) result;
insert into collection_ids select 'pgs',result.* from app.create_entry_tagged(
  '84444444-0000-4000-8000-000000000003','PGS tag',array['Work/PGS'],null,
  '2026-07-24T07:30:00Z','Asia/Kolkata','2026-07-24',330::smallint) result;

select extensions.is((select direct_entry_count from app.tag_collection_counts()
  where normalized_name='work'),1::bigint,'parent direct count is exact');
select extensions.is((select collection_entry_count from app.tag_collection_counts()
  where normalized_name='work'),3::bigint,'parent collection counts descendants');
select extensions.is((select collection_entry_count from app.tag_collection_counts()
  where normalized_name='work/oas'),1::bigint,'child count is exact');
select extensions.ok((select has_children from app.tag_collection_counts()
  where normalized_name='work'),'parent is marked as a collection');
select extensions.is((select count(*)::bigint from app.search_entries(
  '',null,null,array['Work'],array[]::text[],false,false,true,'newest',
  null,null,null,20)),3::bigint,'parent collection query includes descendants');
select extensions.is((select count(*)::bigint from app.search_entries(
  '',null,null,array['Work'],array[]::text[],false,false,false,'newest',
  null,null,null,20)),1::bigint,'exact parent query excludes descendants');
select extensions.is((select count(*)::bigint from app.search_entries(
  '',null,null,array['Work/OAS'],array[]::text[],false,false,false,'newest',
  null,null,null,20)),1::bigint,'exact child query returns its Entry');

select app.trash_entry((select entry_id from collection_ids where label='oas'));
select extensions.is((select collection_entry_count from app.tag_collection_counts()
  where normalized_name='work'),2::bigint,'Trash immediately decreases active collection counts');
select app.restore_entry((select entry_id from collection_ids where label='oas'));
select extensions.is((select collection_entry_count from app.tag_collection_counts()
  where normalized_name='work'),3::bigint,'restore immediately returns collection counts');

reset role;
select set_config('request.jwt.claims',
  '{"sub":"85555555-5555-4555-8555-555555555555","role":"authenticated"}',true);
set local role authenticated;
insert into collection_ids select 'other',result.* from app.create_entry_tagged(
  '85555555-0000-4000-8000-000000000001','Other owner tag',array['Work/OAS'],null,
  '2026-07-22T07:30:00Z','Asia/Kolkata','2026-07-22',330::smallint) result;
select extensions.is((select collection_entry_count from app.tag_collection_counts()
  where normalized_name='work'),1::bigint,'counts are isolated to the authenticated owner');
select extensions.is((select count(*)::bigint from app.search_entries(
  '',null,null,array['Work'],array[]::text[],false,false,true,'newest',
  null,null,null,20)),1::bigint,'collection search is isolated to the authenticated owner');
select extensions.is((select count(*)::bigint from app.user_tags),1::bigint,
  'RLS hides the other owner tag catalog');

select * from extensions.finish();
rollback;
