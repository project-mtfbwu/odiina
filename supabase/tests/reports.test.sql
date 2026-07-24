begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(41);

select extensions.ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_catalog.pg_class where oid=any(array[
  'app.reports'::regclass,'app.report_sources'::regclass,'app.report_sections'::regclass,
  'app.report_metrics'::regclass,'app.report_media_selections'::regclass,'app.report_exports'::regclass,
  'app.report_tags'::regclass,
  'app.report_schedules'::regclass,'app.report_shares'::regclass,'app.report_share_sections'::regclass,
  'app.report_command_receipts'::regclass
])), 'all private report tables use FORCE RLS');
select extensions.ok(not has_function_privilege('anon','app.create_factual_report(text,date,date,text,uuid[],boolean,uuid)','EXECUTE'),'anon cannot create private reports');
select extensions.ok(not has_function_privilege('public','app.publish_report_share(uuid,timestamptz,boolean,uuid)','EXECUTE'),'PUBLIC cannot publish reports');
select extensions.ok(has_function_privilege('anon','app.resolve_report_share(text)','EXECUTE'),'anon receives only narrow share resolution');
select extensions.is((select pg_get_userbyid(proowner) from pg_proc where oid='app.create_factual_report(text,date,date,text,uuid[],boolean,uuid)'::regprocedure),'odiina_owner_api','report creation uses constrained owner');
select extensions.is((select proconfig from pg_proc where oid='app.publish_report_share(uuid,timestamptz,boolean,uuid)'::regprocedure),array['search_path=""']::text[],'share publication fixes empty search path');
select extensions.ok(not (select coalesce('user_id'=any(proargnames),false) from pg_proc where oid='app.create_factual_report(text,date,date,text,uuid[],boolean,uuid)'::regprocedure),'report RPC accepts no user_id');
select extensions.ok(not exists(select 1 from information_schema.columns where table_schema='app' and table_name like 'report%' and column_name in ('latitude','longitude','object_key','bucket_id')),'report/share schema stores no coordinates or storage paths');

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,confirmation_token,recovery_token,email_change_token_new,email_change,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('b1111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','report-a@example.test','',now(),'','','','','{"provider":"email","providers":["email"]}','{}',now(),now()),
('b2222222-2222-4222-8222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','report-b@example.test','',now(),'','','','','{"provider":"email","providers":["email"]}','{}',now(),now());

create temporary table report_ids(label text primary key,entry_id uuid,revision_id uuid); grant all on report_ids to authenticated;
select set_config('request.jwt.claims','{"sub":"b1111111-1111-4111-8111-111111111111","role":"authenticated"}',true); set local role authenticated;
select app.save_preferences('Asia/Kolkata',1::smallint);
insert into report_ids select 'text',r.* from app.create_entry('b1111111-0000-4000-8000-000000000001','Factual private moment','2026-07-24T07:30:00Z','Asia/Kolkata','2026-07-24',330::smallint) r;
insert into report_ids select 'place',r.* from app.create_entry_place('b1111111-0000-4000-8000-000000000002','At rehearsal','{"placeName":"Studio","precision":"label_only","source":"manual"}'::jsonb,'2026-07-24T08:30:00Z','Asia/Kolkata','2026-07-24',330::smallint) r;

select extensions.is((select entry_count from app.preview_factual_report('daily','2026-07-24','2026-07-24','{}')),2,'factual preview works while AI remains off');
select extensions.is((select master_enabled from app.ai_settings),false,'report creation does not enable AI');
create temporary table created_report as select * from app.create_factual_report('daily','2026-07-24','2026-07-24','Private day','{}',true,'b1111111-0000-4000-8000-000000000010');
select extensions.is((select count(*) from app.reports),1::bigint,'factual report is stored privately');
select extensions.is((select generation_mode from app.reports),'factual','report defaults factual');
select extensions.is((select status from app.reports),'ready','deterministic report reaches ready without a provider');
select extensions.is((select count(*) from app.report_sources),2::bigint,'report freezes exact current revisions');
select extensions.is((select count(distinct occurred_local_date) from app.report_sources),1::bigint,'source occurrence civil dates are preserved');
select extensions.is((select metric_value from app.report_metrics where metric_key='active_days'),1::bigint,'active-day metric is precisely derived');
select extensions.is((select place_label from app.report_sources where entry_id=(select entry_id from report_ids where label='place')),'Studio','private report stores only confirmed place label');
select extensions.is((select count(*) from app.report_shares),0::bigint,'report remains private before explicit publish');
select extensions.is((select count(*) from app.report_schedules),0::bigint,'no schedule is created automatically');
select app.save_report_schedule('weekly','08:30','factual');
select extensions.is((select execution_enabled from app.report_schedules),false,'schedule execution is forced disabled without durable infrastructure');
select extensions.is((select status from app.report_schedules),'paused','schedule intent defaults paused');

reset role;
insert into app.ai_jobs(id,user_id,job_kind,status,client_request_id,consent_version,provider_id,model_id,insight_scope,range_start,range_end,source_snapshot,source_snapshot_sha256)
values('b1111111-0000-4000-8000-000000000020','b1111111-1111-4111-8111-111111111111','insight','ready','b1111111-0000-4000-8000-000000000021',1,'fake-local','deterministic-insight-v1','day','2026-07-24','2026-07-24','[]',extensions.digest('report insight','sha256'));
insert into app.insights(id,user_id,job_id,scope,range_start,range_end,title,summary,limitations,provider_id,model_id,source_snapshot_sha256,status)
values('b1111111-0000-4000-8000-000000000022','b1111111-1111-4111-8111-111111111111','b1111111-0000-4000-8000-000000000020','day','2026-07-24','2026-07-24','Evidence-backed day','A bounded fake-provider narrative.','Only selected evidence was analyzed.','fake-local','deterministic-insight-v1',extensions.digest('report insight','sha256'),'ready');
select set_config('request.jwt.claims','{"sub":"b1111111-1111-4111-8111-111111111111","role":"authenticated"}',true); set local role authenticated;
select extensions.throws_ok($$select app.update_report((select report_id from created_report),'Private day','','','{}',array['cover','at_a_glance','timeline','key_moments','photos','voice','video','places','tags','reflection'],array(select entry_id from app.report_sources where report_id=(select report_id from created_report)),'{}',null,'b1111111-0000-4000-8000-000000000022')$$,'P0001','odiina_report_ai_consent_required','AI enhancement is blocked while Master AI is off');
select * from app.update_ai_settings(true,false,true,false,false,'odiina-ai-consent-v1','fake-local-v1','settings_ai');
select app.update_report((select report_id from created_report),'Private day','','','{}',array['cover','at_a_glance','timeline','key_moments','photos','voice','video','places','tags','reflection'],array(select entry_id from app.report_sources where report_id=(select report_id from created_report)),'{}',null,'b1111111-0000-4000-8000-000000000022');
select extensions.is((select generation_mode from app.reports),'ai_enhanced','a consented matching Increment I insight can enhance the factual report');
select extensions.is((select generated_text from app.report_sections where section_kind='key_moments'),'A bounded fake-provider narrative.','AI narrative remains a separately labeled report section');

create temporary table first_share as select * from app.publish_report_share((select report_id from created_report),statement_timestamp()+interval '7 days',false,'b1111111-0000-4000-8000-000000000011');
grant select on first_share to anon,authenticated;
select extensions.is((select length(share_token) from first_share),64,'publication returns one high-entropy opaque token');
reset role;
select extensions.ok((select token_hash<>convert_to((select share_token from first_share),'UTF8') from app.report_shares),'only a token hash is stored');
select set_config('request.jwt.claims','{"role":"anon"}',true); set local role anon;
select extensions.is((select manifest->>'state' from app.resolve_report_share((select share_token from first_share))),'active','anonymous token resolves active immutable manifest');
select extensions.ok((select manifest from app.resolve_report_share((select share_token from first_share)))::text like '%bounded fake-provider narrative%','a consented AI section is copied into the reviewed immutable share snapshot');
select extensions.ok(not has_table_privilege('anon','app.reports','SELECT'),'anon cannot read private report table');
select extensions.ok(not ((select manifest from app.resolve_report_share((select share_token from first_share)))::text ~ '(entry_id|revision_id|user_id|object_key|latitude|longitude)'),'public manifest exposes no private identifiers, paths or coordinates');

reset role; select set_config('request.jwt.claims','{"sub":"b2222222-2222-4222-8222-222222222222","role":"authenticated"}',true); set local role authenticated;
select extensions.is((select count(*) from app.reports),0::bigint,'another user cannot read reports');
select extensions.is((select count(*) from app.report_shares),0::bigint,'another user cannot enumerate shares');
select app.revoke_report_share((select share_id from first_share));
reset role;
select extensions.is((select revoked_at from app.report_shares where id=(select share_id from first_share)),null::timestamptz,'another user cannot revoke a share');

select set_config('request.jwt.claims','{"sub":"b1111111-1111-4111-8111-111111111111","role":"authenticated"}',true); set local role authenticated;
select app.revoke_report_share((select share_id from first_share));
reset role; select set_config('request.jwt.claims','{"role":"anon"}',true); set local role anon;
select extensions.is((select manifest->>'state' from app.resolve_report_share((select share_token from first_share))),'revoked','revocation immediately removes report content');

reset role; select set_config('request.jwt.claims','{"sub":"b1111111-1111-4111-8111-111111111111","role":"authenticated"}',true); set local role authenticated;
create temporary table expiry_share as select * from app.publish_report_share((select report_id from created_report),statement_timestamp()+interval '1 day',false,'b1111111-0000-4000-8000-000000000013');
grant select on expiry_share to anon,authenticated;
reset role;
update app.report_shares set created_at=statement_timestamp()-interval '2 days',expires_at=statement_timestamp()-interval '1 day' where id=(select share_id from expiry_share);
select set_config('request.jwt.claims','{"role":"anon"}',true); set local role anon;
select extensions.is((select manifest->>'state' from app.resolve_report_share((select share_token from expiry_share))),'expired','expiration denies report content without deleting the private report');

reset role; select set_config('request.jwt.claims','{"sub":"b1111111-1111-4111-8111-111111111111","role":"authenticated"}',true); set local role authenticated;
create temporary table trash_share as select * from app.publish_report_share((select report_id from created_report),statement_timestamp()+interval '7 days',false,'b1111111-0000-4000-8000-000000000014');
grant select on trash_share to anon,authenticated;
select app.trash_entry((select entry_id from report_ids where label='text'));
reset role; select set_config('request.jwt.claims','{"role":"anon"}',true); set local role anon;
select extensions.is((select manifest->>'state' from app.resolve_report_share((select share_token from trash_share))),'revoked','trashing a source immediately revokes dependent shares');
reset role; select set_config('request.jwt.claims','{"sub":"b1111111-1111-4111-8111-111111111111","role":"authenticated"}',true); set local role authenticated;
select app.restore_entry((select entry_id from report_ids where label='text'));
select extensions.is((select source_unavailable from app.report_sources where entry_id=(select entry_id from report_ids where label='text')),false,'restoring a source recovers its private report reference');
select extensions.is((select status from app.reports),'stale','restoring a source does not silently rewrite or certify the report snapshot');

create temporary table place_share as select * from app.publish_report_share((select report_id from created_report),statement_timestamp()+interval '7 days',true,'b1111111-0000-4000-8000-000000000012');
grant select on place_share to anon,authenticated;
select app.redact_entry_places((select entry_id from report_ids where label='place'));
select extensions.is((select status from app.reports),'stale','place redaction marks dependent report stale');
select extensions.is((select place_label from app.report_sources where entry_id=(select entry_id from report_ids where label='place')),null,'place redaction removes report place label');
reset role; select set_config('request.jwt.claims','{"role":"anon"}',true); set local role anon;
select extensions.is((select manifest->>'state' from app.resolve_report_share((select share_token from place_share))),'revoked','place redaction revokes an active place-bearing share');

select * from extensions.finish();
rollback;
