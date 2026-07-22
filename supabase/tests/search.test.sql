begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(58);

select extensions.ok((select relrowsecurity and relforcerowsecurity
  from pg_catalog.pg_class where oid='app.user_tags'::regclass),
  'tag catalog has forced RLS');
select extensions.ok((select relrowsecurity and relforcerowsecurity
  from pg_catalog.pg_class where oid='app.entry_revision_tags'::regclass),
  'revision tags have forced RLS');
select extensions.ok((select relrowsecurity and relforcerowsecurity
  from pg_catalog.pg_class where oid='app.entry_search_documents'::regclass),
  'search documents have forced RLS');
select extensions.ok(not pg_catalog.has_function_privilege(
  'anon','app.create_entry_tagged(uuid,text,text[],jsonb,timestamptz,text,date,smallint)','EXECUTE'),
  'anon cannot invoke tagged creation');
select extensions.ok(not pg_catalog.has_function_privilege(
  'public','app.search_entries(text,date,date,text[],text[],boolean,boolean,text,real,timestamptz,uuid,integer)','EXECUTE'),
  'PUBLIC cannot search');
select extensions.ok(pg_catalog.has_function_privilege(
  'authenticated','app.search_entries(text,date,date,text[],text[],boolean,boolean,text,real,timestamptz,uuid,integer)','EXECUTE'),
  'authenticated users may invoke bounded search');
select extensions.is((select pg_catalog.pg_get_userbyid(proowner)
  from pg_catalog.pg_proc where oid=
  'app.create_entry_tagged(uuid,text,text[],jsonb,timestamptz,text,date,smallint)'::regprocedure),
  'odiina_owner_api','tagged mutation uses the constrained owner');
select extensions.is((select proconfig from pg_catalog.pg_proc where oid=
  'app.create_entry_tagged(uuid,text,text[],jsonb,timestamptz,text,date,smallint)'::regprocedure),
  array['search_path=""']::text[],'tagged mutation has an empty fixed search path');
select extensions.ok(not (select coalesce('user_id'=any(proargnames),false)
  from pg_catalog.pg_proc where oid=
  'app.create_entry_tagged(uuid,text,text[],jsonb,timestamptz,text,date,smallint)'::regprocedure),
  'tagged mutation accepts no user_id');
select extensions.ok(not pg_catalog.has_function_privilege(
  'authenticated','app.insert_revision_tags(uuid,uuid,text[])','EXECUTE'),
  'authenticated cannot call the internal tag helper');

select extensions.is((select normalized_name from app.normalize_tag_label(' Work ')),
  'work','normalization trims and lowercases comparison text');
select extensions.is((select normalized_name from app.normalize_tag_label(
  U&'\FF26\FF29\FF2C\FF2D\3000\3000\FF29\FF24\FF25\FF21\FF33')),
  'film ideas','database normalization applies NFKC and whitespace collapse');
select extensions.is((select display_name from app.normalize_tag_label(U&'\+01F3B8')),
  U&'\+01F3B8','emoji-only tags are intentionally allowed');
select extensions.throws_ok(
  $$select * from app.normalize_tag_label(E'bad\007tag')$$,
  'P0001',null,'control characters are rejected');

insert into auth.users (
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  confirmation_token,recovery_token,email_change_token_new,email_change,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
('81111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','search-a@example.test','',now(),'','','','',
 '{"provider":"email","providers":["email"]}','{}',now(),now()),
('82222222-2222-4222-8222-222222222222','00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','search-b@example.test','',now(),'','','','',
 '{"provider":"email","providers":["email"]}','{}',now(),now());

create temporary table search_ids(
  label text primary key, entry_id uuid not null, revision_id uuid not null
);
grant all on table search_ids to authenticated;

select set_config('request.jwt.claims',
  '{"sub":"81111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
set local role authenticated;
insert into search_ids select 'first',result.* from app.create_entry_tagged(
  '81111111-0000-4000-8000-000000000001','Private guitar practice',
  array[' Work ',U&'\FF26\FF29\FF2C\FF2D\3000\FF29\FF24\FF25\FF21\FF33'],null,
  '2026-07-22T07:30:00Z','Asia/Kolkata','2026-07-22',330::smallint
) result;
select extensions.is((select count(*)::bigint from app.entry_revision_tags),2::bigint,
  'tagged creation stores two immutable memberships');
select extensions.is((select count(*)::bigint from app.user_tags),2::bigint,
  'tagged creation stores two private catalog rows');
select extensions.is((select display_name from app.user_tags where normalized_name='work'),
  'Work','first clean display capitalization is preserved');
select extensions.is((select display_name from app.user_tags where normalized_name='film ideas'),
  'FILM IDEAS','NFKC display label remains clean and readable');
select extensions.is((select count(*)::bigint from app.entry_search_documents
  where entry_id=(select entry_id from search_ids where label='first')
    and body_text='Private guitar practice'),1::bigint,
  'current search document is maintained transactionally');
select extensions.is((select count(*)::bigint from app.search_entries(
  'guitar',null,null,array[]::text[],array[]::text[],false,false,'relevance',
  null,null,null,20)),1::bigint,'current Entry text is searchable');
select extensions.is((select count(*)::bigint from app.search_entries(
  'film ideas',null,null,array[]::text[],array[]::text[],false,false,'relevance',
  null,null,null,20)),1::bigint,'current tag text is searchable');

insert into search_ids select 'second',result.* from app.create_entry_tagged(
  '81111111-0000-4000-8000-000000000002','Second private note',
  array['WORK',U&'\+01F3B8'],null,'2026-07-23T07:30:00Z','Asia/Kolkata','2026-07-23',330::smallint
) result;
select extensions.is((select count(*)::bigint from app.user_tags
  where normalized_name='work'),1::bigint,
  'case variants reuse one per-user catalog row');
select extensions.is((select display_name from app.user_tags where normalized_name='work'),
  'Work','catalog reuse does not rewrite accepted display capitalization');
select extensions.throws_ok(
  $$select * from app.create_entry_tagged(
    '81111111-0000-4000-8000-000000000003','Duplicate tags',array['Work',' work '],null,
    '2026-07-24T07:30:00Z','Asia/Kolkata','2026-07-24',330::smallint)$$,
  'P0001',null,'normalized duplicates are rejected');
select extensions.throws_ok(
  $$select * from app.create_entry_tagged(
    '81111111-0000-4000-8000-000000000004','Too many tags',
    array['1','2','3','4','5','6','7','8','9','10','11'],null,
    '2026-07-24T07:30:00Z','Asia/Kolkata','2026-07-24',330::smallint)$$,
  'P0001',null,'the database enforces the ten-tag maximum');
select extensions.throws_ok(
  $$select * from app.create_entry_tagged(
    '81111111-0000-4000-8000-000000000005','',array['Work'],null,
    '2026-07-24T07:30:00Z','Asia/Kolkata','2026-07-24',330::smallint)$$,
  'P0001',null,'tags alone cannot create an Entry');

reset role;
select set_config('request.jwt.claims',
  '{"sub":"82222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
set local role authenticated;
insert into search_ids select 'other',result.* from app.create_entry_tagged(
  '82222222-0000-4000-8000-000000000001','Other owner secret',array['Work'],null,
  '2026-07-22T07:30:00Z','Asia/Kolkata','2026-07-22',330::smallint
) result;
select extensions.is((select count(*)::bigint from app.user_tags
  where normalized_name='work'),1::bigint,
  'another user may independently use the same normalized tag');
select extensions.is((select count(*)::bigint from app.user_tags),1::bigint,
  'another user cannot enumerate the first user tag catalog');
select extensions.is((select count(*)::bigint from app.search_entries(
  'guitar',null,null,array[]::text[],array[]::text[],false,false,'relevance',
  null,null,null,20)),0::bigint,'another user cannot search private text');
select extensions.is((select count(*)::bigint from app.search_entries(
  'secret',null,null,array[]::text[],array[]::text[],false,false,'relevance',
  null,null,null,20)),1::bigint,'a user can search their own current text');

reset role;
select set_config('request.jwt.claims',
  '{"sub":"81111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
set local role authenticated;
insert into search_ids select 'revised',result.* from app.revise_entry_tagged(
  (select entry_id from search_ids where label='first'),
  (select revision_id from search_ids where label='first'),
  'Current piano practice',array[]::uuid[],array['Work','New tag'],null,
  '2026-07-22T07:30:00Z','Asia/Kolkata','2026-07-22',330::smallint,'edited'
) result;
select extensions.is((select count(*)::bigint from app.entry_revisions where entry_id=
  (select entry_id from search_ids where label='first')),2::bigint,
  'tag editing creates a second immutable revision');
select extensions.is((select count(*)::bigint from app.entry_revision_tags where revision_id=
  (select revision_id from search_ids where label='first')),2::bigint,
  'historical tag membership remains unchanged');
select extensions.is((select count(*)::bigint from app.entry_revision_tags rt
  join app.user_tags t on t.user_id=rt.user_id and t.id=rt.tag_id
  where rt.revision_id=(select revision_id from search_ids where label='revised')
    and t.normalized_name='new tag'),1::bigint,
  'the current revision stores its replacement tag');
select extensions.is((select count(*)::bigint from app.search_entries(
  'guitar',null,null,array[]::text[],array[]::text[],false,false,'relevance',
  null,null,null,20) where entry_id=(select entry_id from search_ids where label='first')),
  0::bigint,'historical removed text is excluded from current search');
select extensions.is((select count(*)::bigint from app.search_entries(
  'piano',null,null,array[]::text[],array[]::text[],false,false,'relevance',
  null,null,null,20) where entry_id=(select entry_id from search_ids where label='first')),
  1::bigint,'replacement current text is searchable');
select extensions.is((select count(*)::bigint from app.search_entries(
  '',null,null,array['Work','New tag'],array[]::text[],false,false,'newest',
  null,null,null,20)),1::bigint,'multiple tag filters use AND');
select extensions.is((select count(*)::bigint from app.search_entries(
  '',null,null,array['Work','FILM IDEAS'],array[]::text[],false,false,'newest',
  null,null,null,20)),0::bigint,'a missing selected tag excludes the Entry');

select app.trash_entry((select entry_id from search_ids where label='first'));
select extensions.is((select count(*)::bigint from app.search_entries(
  'piano',null,null,array[]::text[],array[]::text[],false,false,'relevance',
  null,null,null,20)),0::bigint,'Trash is excluded by default');
select extensions.is((select lifecycle_state from app.search_entries(
  'piano',null,null,array[]::text[],array[]::text[],false,true,'relevance',
  null,null,null,20) limit 1),'trashed','Include Trash returns a visibly typed result');
select app.restore_entry((select entry_id from search_ids where label='first'));
select extensions.is((select count(*)::bigint from app.search_entries(
  'piano',null,null,array[]::text[],array[]::text[],false,false,'relevance',
  null,null,null,20)),1::bigint,'restore returns the Entry to active search');
select extensions.is((select count(*)::bigint from app.search_entries(
  '', '2026-07-23','2026-07-23',array['Work'],array[]::text[],false,false,'newest',
  null,null,null,20)),1::bigint,'occurrence civil-date boundaries filter correctly');

create temporary table first_search_page as select * from app.search_entries(
  '',null,null,array['Work'],array[]::text[],false,false,'newest',
  null,null,null,1);
select extensions.is((select count(*)::bigint from first_search_page),1::bigint,
  'bounded cursor page returns the requested size');
select extensions.isnt((select entry_id from app.search_entries(
  '',null,null,array['Work'],array[]::text[],false,false,'newest',null,
  (select occurred_at from first_search_page),(select entry_id from first_search_page),1)
  limit 1),(select entry_id from first_search_page),
  'the next cursor page does not duplicate the prior Entry');

insert into search_ids select 'place',result.* from app.create_entry_tagged(
  '81111111-0000-4000-8000-000000000006','Place evidence',array['Travel'],
  '{"placeName":"Secret Pier","placeArea":"Harbour","placeAddress":null,"latitude":null,"longitude":null,"precision":"label_only","approximateRadiusMeters":null,"source":"manual","provider":null,"providerPlaceId":null,"countryCode":null}'::jsonb,
  '2026-07-25T07:30:00Z','Asia/Kolkata','2026-07-25',330::smallint
) result;
select extensions.is((select count(*)::bigint from app.search_entries(
  'secret pier',null,null,array[]::text[],array[]::text[],false,false,'relevance',
  null,null,null,20)),1::bigint,'confirmed current place text is searchable');
select app.redact_entry_places((select entry_id from search_ids where label='place'));
select extensions.is((select count(*)::bigint from app.search_entries(
  'secret pier',null,null,array[]::text[],array[]::text[],false,false,'relevance',
  null,null,null,20)),0::bigint,'redacted place text is removed from current search');
select extensions.is((select tagged_entries from app.profile_statistics()),3::bigint,
  'Profile counts tagged active current Entries once each');

create temporary table image_draft as select * from app.authorize_image_upload(
  null,'search-image.jpg','image/jpeg',1024);
reset role;
update app.attachments set state='accepted',accepted_at=statement_timestamp()
where id=(select attachment_id from image_draft);
set local role authenticated;
insert into search_ids select 'image',result.* from app.activate_media_entry_tagged(
  '81111111-0000-4000-8000-000000000007',
  (select entry_id from image_draft),'Image recall',
  array[(select attachment_id from image_draft)],array['Photo'],null,
  '2026-07-26T07:30:00Z','Asia/Kolkata','2026-07-26',330::smallint
) result;
select extensions.is((select has_image from app.entry_search_documents where entry_id=
  (select entry_id from search_ids where label='image')),true,
  'accepted current media updates trusted search flags');
select extensions.is((select count(*)::bigint from app.search_entries(
  '',null,null,array[]::text[],array['image'],false,false,'newest',
  null,null,null,20) where entry_id=(select entry_id from search_ids where label='image')),
  1::bigint,'photo filter uses the trusted current media flag');
select extensions.is((select count(*)::bigint from app.search_entries(
  '',null,null,array[]::text[],array['image','audio'],false,false,'newest',
  null,null,null,20) where entry_id=(select entry_id from search_ids where label='image')),
  1::bigint,'multiple media filters use OR');
select extensions.is((select count(*)::bigint from app.search_entries(
  '',null,null,array[]::text[],array['place'],true,false,'newest',
  null,null,null,20)),0::bigint,'place filters exclude redacted current places');

select extensions.throws_ok(
  $$select * from app.search_entries('x',null,null,array[]::text[],array[]::text[],
    false,false,'relevance',null,null,null,20)$$,
  'P0001',null,'one-character broad search is rejected');
select extensions.throws_ok(
  $$select * from app.search_entries('',null,null,array[]::text[],array['mood'],
    false,false,'newest',null,null,null,20)$$,
  'P0001',null,'unsupported filters are rejected');
select extensions.throws_ok(
  $$select * from app.search_entries('',null,null,array[]::text[],array[]::text[],
    false,false,'newest',null,null,null,51)$$,
  'P0001',null,'page size is bounded');
select extensions.throws_ok(
  $$update app.entry_revision_tags set tag_position=9$$,
  '42501',null,'normal authenticated SQL cannot mutate tag history');
select extensions.throws_ok(
  $$delete from app.entry_revision_tags$$,
  '42501',null,'normal authenticated SQL cannot delete tag history');
reset role;
select extensions.is((select count(*)::bigint from information_schema.role_table_grants
  where table_schema='app' and table_name in
    ('user_tags','entry_revision_tags','entry_search_documents')
    and grantee in ('anon','PUBLIC')),0::bigint,
  'anon and PUBLIC have no tag or search-table privileges');

insert into auth.users (
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  confirmation_token,recovery_token,email_change_token_new,email_change,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
('83333333-3333-4333-8333-333333333333','00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','search-delete@example.test','',now(),'','','','',
 '{"provider":"email","providers":["email"]}','{}',now(),now());
insert into app.user_tags (user_id, display_name, normalized_name)
values ('83333333-3333-4333-8333-333333333333','Temporary','temporary');
select extensions.lives_ok(
  $$delete from auth.users where id='83333333-3333-4333-8333-333333333333'$$,
  'account deletion cascades through the private tag catalog');
select extensions.is((select count(*)::bigint from app.user_tags
  where user_id='83333333-3333-4333-8333-333333333333'),0::bigint,
  'account deletion leaves no private tag catalog rows');

select * from extensions.finish();
rollback;
