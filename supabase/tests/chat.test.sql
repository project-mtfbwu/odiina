begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(45);

select extensions.ok((select bool_and(relrowsecurity and relforcerowsecurity)
  from pg_catalog.pg_class where oid=any(array[
    'app.chat_conversations'::regclass,'app.chat_messages'::regclass,
    'app.chat_turn_sources'::regclass,'app.chat_job_links'::regclass
  ])),'all Odiina Chat tables use FORCE RLS');
select extensions.ok(not has_function_privilege('anon',
  'app.update_ai_settings(boolean,boolean,boolean,boolean,boolean,boolean,boolean,text,text,text)','EXECUTE'),
  'anon cannot change Chat consent');
select extensions.ok(not has_function_privilege('public',
  'app.request_chat(uuid,text,text,jsonb,uuid)','EXECUTE'),
  'PUBLIC cannot request Chat work');
select extensions.ok(not has_function_privilege('public',
  'app.claim_ai_job(integer)','EXECUTE'),
  'PUBLIC cannot invoke the private AI worker queue');
select extensions.ok(has_function_privilege('authenticated',
  'app.request_chat(uuid,text,text,jsonb,uuid)','EXECUTE'),
  'authenticated owners may request Chat work');
select extensions.is((select pg_get_userbyid(proowner) from pg_proc where oid=
  'app.request_chat(uuid,text,text,jsonb,uuid)'::regprocedure),
  'odiina_owner_api','Chat request uses constrained owner');
select extensions.is((select proconfig from pg_proc where oid=
  'app.request_chat(uuid,text,text,jsonb,uuid)'::regprocedure),
  array['search_path=""']::text[],'Chat request fixes an empty search path');
select extensions.ok(not (select coalesce('user_id'=any(proargnames),false)
  from pg_proc where oid='app.request_chat(uuid,text,text,jsonb,uuid)'::regprocedure),
  'Chat request accepts no user_id');
select extensions.ok(not (select rolbypassrls from pg_roles
  where rolname='odiina_ai_worker_api'),'shared AI worker owner cannot bypass RLS');
select extensions.ok(not exists(select 1 from pg_extension where extname='vector'),
  'Chat adds no vector database or semantic index');
select extensions.ok(not has_table_privilege('anon','app.chat_conversations','SELECT'),
  'anon cannot read conversations');

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  confirmation_token,recovery_token,email_change_token_new,email_change,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('c1111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','chat-a@example.test','',now(),'','','','',
 '{"provider":"email","providers":["email"]}','{}',now(),now()),
('c2222222-2222-4222-8222-222222222222','00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','chat-b@example.test','',now(),'','','','',
 '{"provider":"email","providers":["email"]}','{}',now(),now()),
('c9999999-9999-4999-8999-999999999999','00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','chat-worker@example.test','',now(),'','','','',
 '{"provider":"email","providers":["email"],"odiina_ai_worker":true,"ai_worker_generation":1}',
 '{}',now(),now());
insert into app.ai_worker_principals(auth_user_id,generation,active)
values('c9999999-9999-4999-8999-999999999999',1,true);

select extensions.is((select chat_enabled from app.ai_settings where user_id=
  'c1111111-1111-4111-8111-111111111111'),false,'Chat consent defaults off');
select extensions.is((select semantic_memory_enabled from app.ai_settings where user_id=
  'c1111111-1111-4111-8111-111111111111'),false,'semantic memory defaults off');

select set_config('request.jwt.claims',
  '{"sub":"c1111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
set local role authenticated;
select extensions.throws_ok($$select * from app.update_ai_settings(false,false,false,false,
  false,true,false,'odiina-ai-consent-v1','fake-local-v1','settings_ai')$$,
  'P0001','odiina_ai_settings_invalid','Chat cannot bypass Master AI and Insights consent');
select * from app.update_ai_settings(true,false,true,false,false,true,false,
  'odiina-ai-consent-v1','fake-local-v1','settings_ai');
select extensions.is((select chat_enabled from app.ai_settings),true,
  'owner can explicitly enable Chat with its dependencies');

create temporary table chat_entry as select * from app.create_entry_tagged(
  'c1111111-0000-4000-8000-000000000001','Private guitar practice',array['guitar'],null,
  '2026-07-22T07:30:00Z','Asia/Kolkata','2026-07-22',330::smallint);
grant select on chat_entry to authenticated;
create temporary table requested as select * from app.request_chat(null,'saved',
  'What did I practice on guitar last month?',
  '{"query":"guitar","tags":[],"media":[],"place":"","from":"2026-07-01","to":"2026-07-31","sort":"newest","includeTranscripts":false,"resolvedLabel":"July 2026"}',
  'c1111111-0000-4000-8000-000000000010');
grant select on requested to authenticated;
select extensions.is((select count(*) from app.chat_conversations),1::bigint,
  'saved conversation is private and persisted');
select extensions.is((select count(*) from app.chat_messages where role='user'),1::bigint,
  'bounded user message is stored');
select extensions.is((select count(*) from app.ai_jobs where job_kind='chat'),1::bigint,
  'Chat reuses the durable AI job queue');
select extensions.ok(not ((select source_snapshot::text from app.ai_jobs where job_kind='chat')
  ~ '(latitude|longitude|object_key|bucket_id|filename|exif)'),
  'bounded evidence contains no coordinates, paths, filenames or EXIF');
select * from app.request_chat((select conversation_id from requested),'saved',
  'What did I practice on guitar last month?',
  '{"query":"guitar","tags":[],"media":[],"place":"","from":"2026-07-01","to":"2026-07-31","sort":"newest","includeTranscripts":false,"resolvedLabel":"July 2026"}',
  'c1111111-0000-4000-8000-000000000010');
select extensions.is((select count(*) from app.ai_jobs where job_kind='chat'),1::bigint,
  'client request id makes Chat request idempotent');

reset role;
select set_config('request.jwt.claims',
  '{"sub":"c9999999-9999-4999-8999-999999999999","role":"authenticated","app_metadata":{"odiina_ai_worker":true,"ai_worker_generation":1}}',true);
set local role authenticated;
create temporary table claimed as select * from app.claim_ai_job(180);
grant select on claimed to authenticated;
select extensions.is((select job_kind from claimed),'chat','restricted worker claims Chat from shared queue');
create temporary table finished as select app.finish_chat_job((select job_id from claimed),(select lease_token from claimed),
  jsonb_build_object('answer','You wrote about guitar practice. [S1]',
    'citations',jsonb_build_array(jsonb_build_object(
      'sourceId',(select entry_id from chat_entry),'excerpt','Private guitar practice')),
    'unsupportedClaimsRemoved',false)) assistant_id;
reset role;
select set_config('request.jwt.claims',
  '{"sub":"c1111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
set local role authenticated;
select extensions.is((select status from app.chat_messages where role='assistant'),'ready',
  'worker stores only a validated ready answer');
select extensions.is((select entry_id from app.chat_turn_sources),
  (select entry_id from chat_entry),'citation binds exact owner Entry evidence');
select extensions.is((select revision_id from app.chat_turn_sources),
  (select revision_id from chat_entry),'citation binds exact immutable revision');
select extensions.is((select questions_today from app.chat_usage_summary()),1::bigint,
  'zero-cost Chat usage is counted transactionally');
select extensions.is((select source_snapshot from app.ai_jobs where job_kind='chat'),
  '{}'::jsonb,'completed job evidence is scrubbed after normalization');

reset role;
select set_config('request.jwt.claims',
  '{"sub":"c2222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
set local role authenticated;
select extensions.is((select count(*) from app.chat_conversations),0::bigint,
  'another user cannot read conversations');
select extensions.is((select count(*) from app.chat_turn_sources),0::bigint,
  'another user cannot read citation excerpts');
select extensions.throws_ok($$select app.delete_chat((select conversation_id from requested))$$,
  'P0001','odiina_chat_unavailable','another user cannot delete an owner conversation');
reset role;
select extensions.is((select count(*) from app.chat_conversations
  where id=(select conversation_id from requested)),1::bigint,
  'another user cannot delete an owner conversation');

select set_config('request.jwt.claims',
  '{"sub":"c1111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
set local role authenticated;
select app.rename_chat((select conversation_id from requested),'Guitar memory');
select extensions.is((select title from app.chat_conversations),'Guitar memory',
  'owner can rename a saved conversation');
select app.clear_chat_context((select conversation_id from requested));
select extensions.is((select context_state from app.chat_conversations),'{}'::jsonb,
  'owner can reset multi-turn context without deleting messages');

create temporary table edited as select * from app.revise_entry(
  (select entry_id from chat_entry),(select revision_id from chat_entry),
  'Private guitar practice changed','2026-07-22T07:30:00Z','Asia/Kolkata','2026-07-22',
  330::smallint,'edited');
select extensions.is((select source_stale from app.chat_turn_sources),true,
  'later Entry revision marks historical citation stale');
select app.trash_entry((select entry_id from chat_entry));
select extensions.is((select source_unavailable from app.chat_turn_sources),true,
  'Trash makes historical citation unavailable');
select app.restore_entry((select entry_id from chat_entry));
select extensions.ok((select not source_unavailable and source_stale from app.chat_turn_sources),
  'restore recovers availability but does not recertify old evidence');

create temporary table temporary_request as select * from app.request_chat(null,'temporary',
  'Find guitar',
  '{"query":"guitar","tags":[],"media":[],"place":"","from":null,"to":null,"sort":"newest","includeTranscripts":false,"resolvedLabel":"All dates"}',
  'c1111111-0000-4000-8000-000000000020');
grant select on temporary_request to authenticated;
select extensions.is((select count(*) from app.chat_conversations where mode='temporary'),1::bigint,
  'temporary Chat is explicitly labeled and excluded from saved history');
reset role;
update app.chat_conversations set expires_at=statement_timestamp()-interval '1 second'
  where id=(select conversation_id from temporary_request);
select set_config('request.jwt.claims',
  '{"sub":"c1111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
set local role authenticated;
select app.purge_expired_temporary_chats();
select extensions.is((select count(*) from app.chat_conversations where mode='temporary'),0::bigint,
  'expired temporary content and its job link are deleted');

create temporary table queued as select * from app.request_chat((select conversation_id from requested),
  'saved','Only voice notes',
  '{"query":"guitar","tags":[],"media":["audio"],"place":"","from":"2026-07-01","to":"2026-07-31","sort":"newest","includeTranscripts":false,"resolvedLabel":"July 2026"}',
  'c1111111-0000-4000-8000-000000000030');
select * from app.update_ai_settings(false,false,false,false,false,false,false,
  'odiina-ai-consent-v1',null,'settings_ai');
select extensions.is((select status from app.ai_jobs where id=(select job_id from queued)),
  'canceled','Master kill switch cancels queued Chat before provider egress');
select extensions.is((select count(*) from app.ai_consent_events where feature='chat'
  and not enabled),1::bigint,'Chat consent revocation has content-free audit evidence');

select * from app.update_ai_settings(true,false,true,false,false,true,false,
  'odiina-ai-consent-v1','fake-local-v1','settings_ai');
select app.delete_chat((select conversation_id from requested));
select extensions.is((select count(*) from app.chat_messages),0::bigint,
  'deleting a Chat removes messages and answers');
select extensions.is((select count(*) from app.chat_turn_sources),0::bigint,
  'deleting a Chat removes normalized citations');
select extensions.is((select count(*) from app.entries where id=(select entry_id from chat_entry)),
  1::bigint,'deleting Chat never deletes source Entries');
select extensions.ok(has_function_privilege('authenticated',
  'app.finish_chat_job(uuid,uuid,jsonb)','EXECUTE'),
  'worker entrypoint is callable only through authenticated worker identity checks');
select extensions.ok(has_function_privilege('authenticated',
  'app.update_ai_settings(boolean,boolean,boolean,boolean,boolean,text,text,text)','EXECUTE'),
  'legacy non-Chat consent signature remains compatible without enabling Chat');
select extensions.is((select count(*) from app.chat_job_links),0::bigint,
  'conversation deletion removes Chat job links');

select * from extensions.finish();
rollback;
