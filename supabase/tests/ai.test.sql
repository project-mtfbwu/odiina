begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(44);

select extensions.ok((select bool_and(relrowsecurity and relforcerowsecurity)
  from pg_catalog.pg_class where oid=any(array[
    'app.ai_settings'::regclass,'app.ai_consent_events'::regclass,
    'app.ai_worker_principals'::regclass,'app.ai_jobs'::regclass,
    'app.transcripts'::regclass,'app.transcript_segments'::regclass,
    'app.transcript_corrections'::regclass,'app.insights'::regclass,
    'app.insight_sources'::regclass,'app.ai_usage_events'::regclass
  ])),'all private AI tables use FORCE RLS');
select extensions.ok(not pg_catalog.has_function_privilege('anon',
  'app.update_ai_settings(boolean,boolean,boolean,boolean,boolean,text,text,text)','EXECUTE'),
  'anon cannot change private AI consent');
select extensions.ok(not pg_catalog.has_function_privilege('public',
  'app.request_insight(text,uuid,date,date,text[],text[],boolean,boolean,boolean,uuid)','EXECUTE'),
  'PUBLIC cannot request an insight');
select extensions.ok(pg_catalog.has_function_privilege('authenticated',
  'app.request_transcription(uuid,uuid,uuid,uuid,text)','EXECUTE'),
  'authenticated owners may request transcription');
select extensions.is((select pg_catalog.pg_get_userbyid(proowner) from pg_catalog.pg_proc
  where oid='app.request_transcription(uuid,uuid,uuid,uuid,text)'::regprocedure),
  'odiina_owner_api','transcription request uses constrained owner');
select extensions.is((select proconfig from pg_catalog.pg_proc where oid=
  'app.request_transcription(uuid,uuid,uuid,uuid,text)'::regprocedure),
  array['search_path=""']::text[],'transcription RPC fixes an empty search path');
select extensions.ok(not (select coalesce('user_id'=any(proargnames),false)
  from pg_catalog.pg_proc where oid=
  'app.request_insight(text,uuid,date,date,text[],text[],boolean,boolean,boolean,uuid)'::regprocedure),
  'insight request accepts no user_id');
select extensions.ok(not (select rolbypassrls from pg_catalog.pg_roles
  where rolname='odiina_ai_worker_api'),'AI worker owner cannot bypass RLS');
select extensions.ok(exists(select 1 from pg_catalog.pg_policies
  where schemaname='storage' and tablename='objects' and policyname='ai_worker_playback_read'),
  'worker storage policy is limited through a named playback policy');

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  confirmation_token,recovery_token,email_change_token_new,email_change,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('a1111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','ai-a@example.test','',now(),'','','','',
 '{"provider":"email","providers":["email"]}','{}',now(),now()),
('a2222222-2222-4222-8222-222222222222','00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','ai-b@example.test','',now(),'','','','',
 '{"provider":"email","providers":["email"]}','{}',now(),now()),
('a9999999-9999-4999-8999-999999999999','00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','ai-worker@example.test','',now(),'','','','',
 '{"provider":"email","providers":["email"],"odiina_ai_worker":true,"ai_worker_generation":1}',
 '{}',now(),now());

select extensions.is((select master_enabled from app.ai_settings
  where user_id='a1111111-1111-4111-8111-111111111111'),false,
  'AI master consent defaults off');
select extensions.is((select count(*) from app.profiles
  where user_id='a9999999-9999-4999-8999-999999999999'),0::bigint,
  'AI worker identity is not projected as a human profile');

select set_config('request.jwt.claims',
  '{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
set local role authenticated;
select extensions.throws_ok($$insert into app.ai_jobs(user_id,job_kind,client_request_id,
  consent_version,provider_id,model_id,insight_scope,range_start,range_end,source_snapshot,
  source_snapshot_sha256) values('a1111111-1111-4111-8111-111111111111','insight',
  gen_random_uuid(),1,'fake-local','deterministic-insight-v1','day',current_date,current_date,
  '[]',decode(repeat('00',32),'hex'))$$,'42501',null,
  'owners cannot insert jobs directly');

create temporary table ai_entry as select * from app.create_entry(
  'a1111111-0000-4000-8000-000000000001','Private reflection about guitar',
  '2026-07-22T07:30:00Z','Asia/Kolkata','2026-07-22',330::smallint);
create temporary table ai_audio as select * from app.authorize_audio_upload(
  (select entry_id from ai_entry),'voice.webm','audio/webm',4096);
reset role;
update app.attachments set state='accepted',accepted_at=now()
  where id=(select attachment_id from ai_audio);
insert into app.attachment_objects(user_id,entry_id,attachment_id,variant,bucket_id,
  object_key,state,byte_count,sha256,detected_mime,verified_at)
values('a1111111-1111-4111-8111-111111111111',(select entry_id from ai_entry),
  (select attachment_id from ai_audio),'playback','odiina-playback',
  gen_random_uuid()::text||'/'||gen_random_uuid()::text,'verified',2048,
  decode(repeat('ab',32),'hex'),'audio/mp4',now());
insert into app.audio_metadata(user_id,entry_id,attachment_id,input_container,input_codec,
  input_duration_ms,input_channels,input_sample_rate,playback_container,playback_codec,
  playback_duration_ms,playback_channels,playback_sample_rate,waveform_peaks)
values('a1111111-1111-4111-8111-111111111111',(select entry_id from ai_entry),
  (select attachment_id from ai_audio),'webm','opus',2000,1,48000,'m4a','aac_lc',2000,1,48000,
  array_fill(500::smallint,array[96]));
set local role authenticated;
create temporary table ai_revision as select * from app.revise_entry_media(
  (select entry_id from ai_entry),(select revision_id from ai_entry),
  'Private reflection about guitar',array[(select attachment_id from ai_audio)],
  '2026-07-22T07:30:00Z','Asia/Kolkata','2026-07-22',330::smallint,'edited');

select * from app.update_ai_settings(true,true,true,true,false,
  'odiina-ai-consent-v1','fake-local-v1','settings_ai');
select extensions.is((select master_enabled from app.ai_settings),true,
  'owner can explicitly enable the AI master switch');
select extensions.is((select auto_transcribe_enabled from app.ai_settings),false,
  'automatic transcription remains impossible');
select extensions.is((select count(*) from app.ai_consent_events),4::bigint,
  'changed consent switches create append-only evidence');
select extensions.throws_ok($$update app.ai_consent_events set enabled=false$$,
  '42501',null,'authenticated users cannot update consent evidence directly');
select extensions.is((select entry_count from app.preview_insight('day',null,
  '2026-07-22','2026-07-22',array[]::text[],array[]::text[],true,true,false)),1,
  'insight preview reports bounded matching Entries without provider egress');

create temporary table canceled_insight as select * from app.request_insight('day',null,
  '2026-07-22','2026-07-22',array[]::text[],array[]::text[],true,true,false,
  'a1111111-0000-4000-8000-000000000010');
select extensions.is((select job_status from canceled_insight),'queued',
  'consented insight request creates a durable queued job');
select * from app.update_ai_settings(false,false,false,false,false,
  'odiina-ai-consent-v1',null,'settings_ai');
select extensions.is((select status from app.ai_jobs where id=(select job_id from canceled_insight)),
  'canceled','master kill switch cancels queued work');
select * from app.update_ai_settings(true,true,true,true,false,
  'odiina-ai-consent-v1','fake-local-v1','settings_ai');
create temporary table transcription_job as select * from app.request_transcription(
  (select entry_id from ai_entry),(select revision_id from ai_revision),
  (select attachment_id from ai_audio),'a1111111-0000-4000-8000-000000000020',null);
select extensions.is((select job_status from transcription_job),'queued',
  'accepted private audio can be queued explicitly');

reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select app.register_ai_worker('a9999999-9999-4999-8999-999999999999',1);
select extensions.ok(exists(select 1 from app.ai_worker_principals
  where auth_user_id='a9999999-9999-4999-8999-999999999999' and active),
  'service role registers a restricted generated worker principal');
select set_config('request.jwt.claims',
  '{"sub":"a9999999-9999-4999-8999-999999999999","role":"authenticated","app_metadata":{"odiina_ai_worker":"true","ai_worker_generation":"1"}}',true);
set local role authenticated;
create temporary table claimed_transcript as select * from app.claim_ai_job(180);
select extensions.is((select job_id from claimed_transcript),
  (select job_id from transcription_job),'restricted worker claims the oldest eligible job');
select extensions.ok((select app.finish_transcription_job((select job_id from claimed_transcript),
  (select lease_token from claimed_transcript),'{"language":"ta-IN","languageConfidence":0.91,
  "timingKind":"segment","segments":[{"startMs":0,"endMs":1000,
  "text":"Guitar practice"},{"startMs":1000,"endMs":2000,
  "text":"வேலை complete"}]}'::jsonb)) is not null,'worker persists validated segment output');

reset role;
select set_config('request.jwt.claims',
  '{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
set local role authenticated;
select extensions.is((select count(*) from app.transcript_segments),2::bigint,
  'transcript stores bounded timed segments');
select extensions.is((select max(end_ms) from app.transcript_segments),2000,
  'transcript timestamps do not exceed accepted duration');
select extensions.is((select has_transcript from app.entry_search_documents
  where entry_id=(select entry_id from ai_entry)),true,
  'consented transcript Search projection is populated');
create temporary table correction as select app.correct_transcript_segment(
  (select id from app.transcripts),(select id from app.transcript_segments where position=0),
  'Corrected guitar rehearsal') id;
select extensions.is((select count(*) from app.transcript_corrections),1::bigint,
  'user correction is stored separately');
select extensions.is((select machine_text from app.transcript_segments where position=0),
  'Guitar practice','correction preserves immutable machine evidence');
select extensions.ok(exists(select 1 from app.transcript_match_entries(
  array[(select entry_id from ai_entry)],'corrected guitar')),
  'private Search uses the latest correction');

reset role;
select set_config('request.jwt.claims',
  '{"sub":"a2222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
set local role authenticated;
select extensions.is((select count(*) from app.transcripts),0::bigint,
  'another user cannot read transcripts');
select extensions.is((select count(*) from app.ai_jobs),0::bigint,
  'another user cannot read jobs');

reset role;
select set_config('request.jwt.claims',
  '{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
set local role authenticated;
select extensions.is((select deleted_transcripts from app.delete_ai_derived_data(
  'transcript',(select id from app.transcripts))),1,
  'owner can delete a selected AI-derived transcript');
select extensions.ok(exists(select 1 from app.attachments
  where id=(select attachment_id from ai_audio)),'transcript deletion preserves original media');
select extensions.is((select has_transcript from app.entry_search_documents
  where entry_id=(select entry_id from ai_entry)),false,
  'transcript deletion removes the Search derivative');

create temporary table insight_job as select * from app.request_insight('day',null,
  '2026-07-22','2026-07-22',array[]::text[],array[]::text[],true,true,false,
  'a1111111-0000-4000-8000-000000000030');
reset role;
select set_config('request.jwt.claims',
  '{"sub":"a9999999-9999-4999-8999-999999999999","role":"authenticated","app_metadata":{"odiina_ai_worker":"true","ai_worker_generation":"1"}}',true);
set local role authenticated;
create temporary table claimed_insight as select * from app.claim_ai_job(180);
select extensions.is((select job_id from claimed_insight),(select job_id from insight_job),
  'worker claims the insight snapshot job');
select app.finish_insight_job((select job_id from claimed_insight),(select lease_token from claimed_insight),
  jsonb_build_object('title','Private evidence summary','summary','One selected Entry.',
    'keyMoments',jsonb_build_array('Guitar reflection'),'topics',jsonb_build_array('Practice'),
    'openLoops','[]'::jsonb,'limitations','Only the selected accepted revision was analyzed.',
    'citations',jsonb_build_array(jsonb_build_object(
      'sourceId',(select source_snapshot->0->>'sourceId' from claimed_insight),
      'claim','Private reflection about guitar'))));

reset role;
select set_config('request.jwt.claims',
  '{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
set local role authenticated;
select extensions.is((select status from app.insights),'ready',
  'validated insight becomes ready');
select extensions.is((select revision_id from app.insight_sources),
  (select revision_id from ai_revision),'citation binds the exact accepted revision');
create temporary table edited as select * from app.revise_entry(
  (select entry_id from ai_entry),(select revision_id from ai_revision),
  'Private reflection changed','2026-07-22T07:30:00Z','Asia/Kolkata','2026-07-22',
  330::smallint,'edited');
select extensions.is((select status from app.insights),'stale',
  'later Entry revision marks prior insight stale without rewriting it');
select extensions.is((select deleted_insights from app.delete_ai_derived_data(
  'insight',(select id from app.insights))),1,
  'owner can delete a selected insight derivative');
select extensions.ok((select insight_requests_month >= 1 from app.ai_usage_summary()),
  'usage summary counts completed provider work');
select extensions.throws_ok($$select * from app.update_ai_settings(true,true,false,false,true,
  'odiina-ai-consent-v1','fake-local-v1','settings_ai')$$,'P0001',
  'odiina_ai_settings_invalid','automatic transcription cannot be enabled through RPC');
select extensions.is((select count(*) from app.ai_jobs where user_id=
  'a1111111-1111-4111-8111-111111111111'),3::bigint,
  'idempotent requests created only the intended private jobs');
select extensions.is((select count(*) from app.transcripts where status='deleted'),1::bigint,
  'deleted transcript retains only a non-content tombstone');
select extensions.is((select count(*) from app.insight_sources),0::bigint,
  'insight deletion removes normalized citation excerpts');

select * from extensions.finish();
rollback;
