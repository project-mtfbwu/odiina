begin;

do $$
begin
  if current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'odiina_migration_requires_postgres_runner';
  end if;
end
$$;

grant odiina_owner_api, odiina_ai_worker_api to postgres;
grant create on schema app to odiina_owner_api, odiina_ai_worker_api;

alter table app.ai_settings
  add column chat_enabled boolean not null default false,
  add column semantic_memory_enabled boolean not null default false
    check (not semantic_memory_enabled);
alter table app.ai_settings drop constraint if exists ai_settings_check;
alter table app.ai_settings add constraint ai_settings_master_dependencies check (
  master_enabled or (not transcription_enabled and not insights_enabled
    and not transcript_search_enabled and not auto_transcribe_enabled
    and not chat_enabled and not semantic_memory_enabled)
);
alter table app.ai_settings add constraint ai_settings_chat_dependencies check (
  not chat_enabled or (master_enabled and insights_enabled)
);

alter table app.ai_consent_events drop constraint if exists ai_consent_events_feature_check;
alter table app.ai_consent_events add constraint ai_consent_events_feature_check check (
  feature in ('master','transcription','insights','transcript_search',
    'auto_transcribe','chat','semantic_memory')
);

alter table app.ai_jobs drop constraint if exists ai_jobs_job_kind_check;
alter table app.ai_jobs add constraint ai_jobs_job_kind_check
  check (job_kind in ('transcription','insight','chat'));
alter table app.ai_jobs drop constraint if exists ai_jobs_model_id_check;
alter table app.ai_jobs add constraint ai_jobs_model_id_check check (model_id in (
  'deterministic-transcript-v1','deterministic-insight-v1','deterministic-chat-v1'
));
alter table app.ai_jobs drop constraint if exists ai_jobs_source_snapshot_check;
alter table app.ai_jobs add constraint ai_jobs_source_snapshot_check check (
  source_snapshot is null
  or (job_kind = 'insight' and jsonb_typeof(source_snapshot) = 'array')
  or (job_kind = 'chat' and jsonb_typeof(source_snapshot) = 'object')
);
alter table app.ai_jobs drop constraint if exists ai_jobs_check;
alter table app.ai_jobs add constraint ai_jobs_source_shape_check check (
  (job_kind = 'transcription' and entry_id is not null and revision_id is not null
    and attachment_id is not null and source_object_id is not null
    and source_sha256 is not null and source_kind is not null
    and source_duration_ms is not null and insight_scope is null
    and source_snapshot is null)
  or
  (job_kind = 'insight' and insight_scope is not null
    and jsonb_typeof(source_snapshot) = 'array'
    and source_snapshot_sha256 is not null and attachment_id is null
    and source_object_id is null and source_sha256 is null and source_kind is null)
  or
  (job_kind = 'chat' and insight_scope is null
    and jsonb_typeof(source_snapshot) = 'object'
    and source_snapshot_sha256 is not null and entry_id is null
    and revision_id is null and attachment_id is null and source_object_id is null
    and source_sha256 is null and source_kind is null and source_duration_ms is null)
);

alter table app.ai_usage_events drop constraint if exists ai_usage_events_usage_kind_check;
alter table app.ai_usage_events add constraint ai_usage_events_usage_kind_check
  check (usage_kind in ('transcription','insight','chat'));

create table app.chat_conversations (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references app.profiles(user_id) on delete cascade,
  mode text not null check (mode in ('saved','temporary')),
  title text not null check (char_length(title) between 1 and 120),
  status text not null default 'active' check (status in ('active','deleted')),
  context_state jsonb not null default '{}'::jsonb
    check (jsonb_typeof(context_state) = 'object' and char_length(context_state::text) <= 8000),
  provider_id text null check (provider_id is null or provider_id = 'fake-local'),
  model_id text null check (model_id is null or model_id = 'deterministic-chat-v1'),
  provider_policy_version text null check (
    provider_policy_version is null or char_length(provider_policy_version) between 1 and 80
  ),
  expires_at timestamptz null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  last_activity_at timestamptz not null default statement_timestamp(),
  unique (user_id, id),
  check ((mode = 'temporary' and expires_at is not null)
    or (mode = 'saved' and expires_at is null))
);

create table app.chat_messages (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null,
  conversation_id uuid not null,
  role text not null check (role in ('user','assistant')),
  content text not null check (char_length(content) between 1 and 8000),
  status text not null check (status in (
    'queued','retrieving','generating','validating','ready','failed','canceled','stale'
  )),
  reply_to_message_id uuid null,
  provider_id text null check (provider_id is null or provider_id = 'fake-local'),
  model_id text null check (model_id is null or model_id = 'deterministic-chat-v1'),
  safe_error_code text null check (
    safe_error_code is null or safe_error_code ~ '^[a-z0-9_]{1,64}$'
  ),
  unsupported_claims_removed boolean not null default false,
  input_characters integer not null default 0 check (input_characters between 0 and 50000),
  output_characters integer not null default 0 check (output_characters between 0 and 8000),
  created_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz null,
  unique (user_id, conversation_id, id),
  constraint chat_messages_conversation_fk foreign key (user_id, conversation_id)
    references app.chat_conversations(user_id, id) on delete cascade,
  constraint chat_messages_reply_fk foreign key (user_id, conversation_id, reply_to_message_id)
    references app.chat_messages(user_id, conversation_id, id) on delete cascade,
  check ((role = 'user' and provider_id is null and model_id is null)
    or role = 'assistant')
);

create table app.chat_turn_sources (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null,
  conversation_id uuid not null,
  assistant_message_id uuid not null,
  source_kind text not null check (source_kind in ('entry','transcript','report','insight')),
  citation_key text not null check (citation_key ~ '^S[1-9][0-9]{0,1}$'),
  entry_id uuid null,
  revision_id uuid null,
  transcript_id uuid null,
  transcript_segment_id uuid null,
  report_id uuid null,
  insight_id uuid null,
  occurred_local_date date null,
  start_ms integer null check (start_ms is null or start_ms >= 0),
  end_ms integer null check (end_ms is null or end_ms >= start_ms),
  evidence_excerpt text not null check (char_length(evidence_excerpt) between 1 and 1000),
  source_unavailable boolean not null default false,
  source_stale boolean not null default false,
  included_place_label boolean not null default false,
  created_at timestamptz not null default statement_timestamp(),
  unique (user_id, assistant_message_id, citation_key),
  constraint chat_sources_message_fk foreign key (user_id, conversation_id, assistant_message_id)
    references app.chat_messages(user_id, conversation_id, id) on delete cascade,
  constraint chat_sources_revision_fk foreign key (user_id, entry_id, revision_id)
    references app.entry_revisions(user_id, entry_id, id) on delete restrict,
  constraint chat_sources_transcript_fk foreign key (user_id, transcript_id)
    references app.transcripts(user_id, id) on delete restrict,
  constraint chat_sources_segment_fk foreign key (user_id, transcript_id, transcript_segment_id)
    references app.transcript_segments(user_id, transcript_id, id) on delete restrict,
  constraint chat_sources_report_fk foreign key (user_id, report_id)
    references app.reports(user_id, id) on delete restrict,
  constraint chat_sources_insight_fk foreign key (user_id, insight_id)
    references app.insights(user_id, id) on delete restrict,
  check (
    (source_kind = 'entry' and entry_id is not null and revision_id is not null
      and transcript_id is null and report_id is null and insight_id is null)
    or (source_kind = 'transcript' and entry_id is not null and revision_id is not null
      and transcript_id is not null and transcript_segment_id is not null
      and report_id is null and insight_id is null)
    or (source_kind = 'report' and report_id is not null and entry_id is null
      and revision_id is null and transcript_id is null and insight_id is null)
    or (source_kind = 'insight' and insight_id is not null and entry_id is null
      and revision_id is null and transcript_id is null and report_id is null)
  )
);

create table app.chat_job_links (
  user_id uuid not null,
  job_id uuid primary key,
  conversation_id uuid not null,
  user_message_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint chat_job_links_job_fk foreign key (user_id, job_id)
    references app.ai_jobs(user_id, id) on delete cascade,
  constraint chat_job_links_message_fk foreign key (user_id, conversation_id, user_message_id)
    references app.chat_messages(user_id, conversation_id, id) on delete cascade
);

create index chat_conversations_owner_activity_idx
  on app.chat_conversations (user_id, last_activity_at desc, id)
  where status = 'active' and mode = 'saved';
create index chat_conversations_expiry_idx on app.chat_conversations (expires_at)
  where mode = 'temporary' and status = 'active';
create index chat_messages_conversation_idx
  on app.chat_messages (user_id, conversation_id, created_at, id);
create index chat_turn_sources_entry_idx
  on app.chat_turn_sources (user_id, entry_id, revision_id);
create index chat_turn_sources_transcript_idx
  on app.chat_turn_sources (user_id, transcript_id, transcript_segment_id);

create trigger chat_conversations_set_updated_at before update on app.chat_conversations
  for each row execute function app.set_updated_at();

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'chat_conversations','chat_messages','chat_turn_sources','chat_job_links'
  ] loop
    execute format('alter table app.%I enable row level security', table_name);
    execute format('alter table app.%I force row level security', table_name);
  end loop;
end
$$;

create policy chat_conversations_owner_read on app.chat_conversations for select to authenticated
  using (user_id = (select app.request_user_id()));
create policy chat_conversations_owner_api on app.chat_conversations for all to odiina_owner_api
  using (user_id = (select app.request_user_id()))
  with check (user_id = (select app.request_user_id()));
create policy chat_messages_owner_read on app.chat_messages for select to authenticated
  using (user_id = (select app.request_user_id()));
create policy chat_messages_owner_api on app.chat_messages for all to odiina_owner_api
  using (user_id = (select app.request_user_id()))
  with check (user_id = (select app.request_user_id()));
create policy chat_sources_owner_read on app.chat_turn_sources for select to authenticated
  using (user_id = (select app.request_user_id()));
create policy chat_sources_owner_api on app.chat_turn_sources for all to odiina_owner_api
  using (user_id = (select app.request_user_id()))
  with check (user_id = (select app.request_user_id()));
create policy chat_job_links_owner_read on app.chat_job_links for select to authenticated
  using (user_id = (select app.request_user_id()));
create policy chat_job_links_owner_api on app.chat_job_links for all to odiina_owner_api
  using (user_id = (select app.request_user_id()))
  with check (user_id = (select app.request_user_id()));

create policy chat_conversations_worker on app.chat_conversations for all to odiina_ai_worker_api
  using (app.ai_worker_actor_id() is not null) with check (app.ai_worker_actor_id() is not null);
create policy chat_messages_worker on app.chat_messages for all to odiina_ai_worker_api
  using (app.ai_worker_actor_id() is not null) with check (app.ai_worker_actor_id() is not null);
create policy chat_sources_worker on app.chat_turn_sources for all to odiina_ai_worker_api
  using (app.ai_worker_actor_id() is not null) with check (app.ai_worker_actor_id() is not null);
create policy chat_job_links_worker on app.chat_job_links for all to odiina_ai_worker_api
  using (app.ai_worker_actor_id() is not null) with check (app.ai_worker_actor_id() is not null);

grant select on app.chat_conversations,app.chat_messages,app.chat_turn_sources,
  app.chat_job_links to authenticated;
grant select,insert,update,delete on app.chat_conversations,app.chat_messages,
  app.chat_turn_sources,app.chat_job_links to odiina_owner_api;
grant select,insert,update,delete on app.chat_conversations,app.chat_messages,
  app.chat_turn_sources,app.chat_job_links to odiina_ai_worker_api;

create function app.purge_chat_conversation(p_user_id uuid, p_conversation_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  update app.ai_jobs j set status = case when j.status in ('queued','sending','generating')
      then 'canceled' else j.status end,
    cancel_requested = true, safe_error_code = 'chat_deleted',
    completed_at = coalesce(j.completed_at, statement_timestamp()),
    source_snapshot = '{}'::jsonb,
    source_snapshot_sha256 = extensions.digest(convert_to('{}','UTF8'),'sha256')
  where j.user_id = p_user_id and j.job_kind = 'chat' and exists (
    select 1 from app.chat_job_links l where l.user_id = p_user_id
      and l.job_id = j.id and l.conversation_id = p_conversation_id
  );
  delete from app.chat_conversations c
  where c.user_id = p_user_id and c.id = p_conversation_id;
end
$$;

create function app.purge_expired_temporary_chats()
returns integer language plpgsql security definer set search_path = '' as $$
declare actor uuid := app.request_user_id(); selected uuid; removed integer := 0;
begin
  if actor is null then raise exception using errcode='P0001',message='odiina_auth_required'; end if;
  for selected in select id from app.chat_conversations where user_id=actor
    and mode='temporary' and status='active' and expires_at<=statement_timestamp()
    for update
  loop
    perform app.purge_chat_conversation(actor,selected); removed:=removed+1;
  end loop;
  return removed;
end
$$;
alter function app.purge_expired_temporary_chats() owner to odiina_owner_api;

create function app.update_ai_settings(
  p_master_enabled boolean,p_transcription_enabled boolean,p_insights_enabled boolean,
  p_transcript_search_enabled boolean,p_auto_transcribe_enabled boolean,
  p_chat_enabled boolean,p_semantic_memory_enabled boolean,
  p_consent_policy_version text,p_provider_policy_version text,p_source_surface text
)
returns setof app.ai_settings language plpgsql security definer set search_path = '' as $$
declare actor uuid:=app.request_user_id(); previous app.ai_settings%rowtype;
  current_settings app.ai_settings%rowtype;
begin
  if actor is null then raise exception using errcode='P0001',message='odiina_auth_required'; end if;
  if p_chat_enabled is null or p_semantic_memory_enabled is null
    or p_semantic_memory_enabled
    or (p_chat_enabled and (not p_master_enabled or not p_insights_enabled)) then
    raise exception using errcode='P0001',message='odiina_ai_settings_invalid';
  end if;
  select * into previous from app.ai_settings where user_id=actor for update;
  if not p_chat_enabled then
    update app.ai_settings set chat_enabled=false,semantic_memory_enabled=false where user_id=actor;
  end if;
  perform app.update_ai_settings(p_master_enabled,p_transcription_enabled,p_insights_enabled,
    p_transcript_search_enabled,p_auto_transcribe_enabled,p_consent_policy_version,
    p_provider_policy_version,p_source_surface);
  update app.ai_settings set chat_enabled=p_chat_enabled,
    semantic_memory_enabled=false where user_id=actor returning * into current_settings;
  if previous.chat_enabled is distinct from p_chat_enabled then
    insert into app.ai_consent_events(user_id,consent_version,feature,enabled,
      consent_policy_version,provider_policy_version,source_surface)
    values(actor,current_settings.consent_version,'chat',p_chat_enabled,
      p_consent_policy_version,p_provider_policy_version,p_source_surface);
  end if;
  if previous.semantic_memory_enabled is distinct from false then
    insert into app.ai_consent_events(user_id,consent_version,feature,enabled,
      consent_policy_version,provider_policy_version,source_surface)
    values(actor,current_settings.consent_version,'semantic_memory',false,
      p_consent_policy_version,p_provider_policy_version,p_source_surface);
  end if;
  if not p_chat_enabled then
    update app.ai_jobs set status=case when status='queued' then 'canceled' else status end,
      cancel_requested=true,safe_error_code='consent_revoked',
      completed_at=case when status='queued' then statement_timestamp() else completed_at end
    where user_id=actor and job_kind='chat'
      and status in ('queued','sending','generating','processing_response');
  end if;
  return query select * from app.ai_settings where user_id=actor;
end
$$;
alter function app.update_ai_settings(boolean,boolean,boolean,boolean,boolean,boolean,boolean,text,text,text)
  owner to odiina_owner_api;

create function app.build_chat_evidence(p_plan jsonb)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare actor uuid:=app.request_user_id(); result jsonb; query_text text;
  from_date date; to_date date; place_text text; media_values text[]; tag_values text[];
  include_transcripts boolean; max_sources integer;
begin
  if actor is null or jsonb_typeof(p_plan)<>'object' then
    raise exception using errcode='P0001',message='odiina_chat_plan_invalid';
  end if;
  if exists(select 1 from jsonb_object_keys(p_plan) key where key not in
    ('query','tags','media','place','from','to','sort','includeTranscripts','resolvedLabel')) then
    raise exception using errcode='P0001',message='odiina_chat_plan_invalid';
  end if;
  query_text:=btrim(coalesce(p_plan->>'query',''));
  place_text:=btrim(coalesce(p_plan->>'place',''));
  from_date:=nullif(p_plan->>'from','')::date;
  to_date:=nullif(p_plan->>'to','')::date;
  include_transcripts:=coalesce((p_plan->>'includeTranscripts')::boolean,false);
  max_sources:=20;
  select coalesce(array_agg(value),array[]::text[]) into media_values
    from jsonb_array_elements_text(coalesce(p_plan->'media','[]'::jsonb));
  select coalesce(array_agg(pg_catalog.lower(pg_catalog.normalize(pg_catalog.btrim(value),'NFKC'))),array[]::text[])
    into tag_values from jsonb_array_elements_text(coalesce(p_plan->'tags','[]'::jsonb));
  if char_length(query_text)>200 or char_length(place_text)>120
    or cardinality(media_values)>5 or cardinality(tag_values)>10
    or exists(select 1 from unnest(media_values) value
      where value not in ('text','image','audio','video','place'))
    or (from_date is not null and to_date is not null and from_date>to_date) then
    raise exception using errcode='P0001',message='odiina_chat_plan_invalid';
  end if;
  with entry_matches as (
    select d.*,
      case when include_transcripts and d.has_transcript and query_text<>''
        and pg_catalog.lower(d.transcript_text) like '%'||pg_catalog.lower(pg_catalog.normalize(query_text,'NFKC'))||'%'
        then true else false end as transcript_match
    from app.entry_search_documents d
    where d.user_id=actor and d.lifecycle_state='active'
      and (from_date is null or d.occurred_local_date>=from_date)
      and (to_date is null or d.occurred_local_date<=to_date)
      and (query_text='' or d.search_vector @@ websearch_to_tsquery('simple',query_text)
        or d.normalized_document like '%'||pg_catalog.lower(pg_catalog.normalize(query_text,'NFKC'))||'%')
      and (place_text='' or pg_catalog.lower(d.place_name) like '%'||pg_catalog.lower(pg_catalog.normalize(place_text,'NFKC'))||'%')
      and (cardinality(tag_values)=0 or d.tag_normalized_names @> tag_values)
      and (cardinality(media_values)=0
        or ('text'=any(media_values) and d.has_text)
        or ('image'=any(media_values) and d.has_image)
        or ('audio'=any(media_values) and d.has_audio)
        or ('video'=any(media_values) and d.has_video)
        or ('place'=any(media_values) and d.has_place))
    order by case when coalesce(p_plan->>'sort','newest')='oldest' then d.occurred_at end,
      case when coalesce(p_plan->>'sort','newest')<>'oldest' then d.occurred_at end desc,
      d.entry_id limit max_sources
  ), normalized as (
    select row_number() over() as position,
      case when e.transcript_match and ts.id is not null then 'transcript' else 'entry' end source_kind,
      case when e.transcript_match and ts.id is not null then ts.id else e.entry_id end source_id,
      e.entry_id,e.revision_id,e.occurred_local_date,e.body_text,e.tag_text,
      case when e.has_place then e.place_name else null end place_label,
      e.has_image,e.has_audio,e.has_video,
      case when e.transcript_match then e.transcript_text else null end transcript_text,
      t.id transcript_id,ts.id transcript_segment_id,ts.start_ms,ts.end_ms
    from entry_matches e
    left join lateral (
      select tr.id from app.transcripts tr where tr.user_id=actor and tr.entry_id=e.entry_id
        and tr.revision_id=e.revision_id and tr.current and tr.status='ready'
        and tr.search_enabled order by tr.completed_at desc limit 1
    ) t on e.transcript_match
    left join lateral (
      select seg.id,seg.start_ms,seg.end_ms from app.transcript_segments seg
      left join lateral (select c.corrected_text from app.transcript_corrections c
        where c.user_id=actor and c.transcript_id=t.id and c.segment_id=seg.id
        order by c.created_at desc,c.id desc limit 1) correction on true
      where seg.user_id=actor and seg.transcript_id=t.id and query_text<>''
        and pg_catalog.lower(coalesce(correction.corrected_text,seg.machine_text))
          like '%'||pg_catalog.lower(pg_catalog.normalize(query_text,'NFKC'))||'%'
      order by seg.position limit 1
    ) ts on true
  ), report_matches as (
    select r.id report_id,r.period_start,r.period_end,r.status,
      left(concat_ws(' ',r.title,r.introduction,r.closing_reflection,
        sections.section_text),2000) body_text
    from app.reports r
    left join lateral (
      select string_agg(s.generated_text,' ' order by s.position) section_text
      from app.report_sections s where s.user_id=r.user_id and s.report_id=r.id
        and s.visible and s.generated_text is not null
    ) sections on true
    where r.user_id=actor and r.status<>'deleted' and query_text<>''
      and pg_catalog.lower(concat_ws(' ',r.title,r.introduction,
        r.closing_reflection,sections.section_text))
        like '%'||pg_catalog.lower(pg_catalog.normalize(query_text,'NFKC'))||'%'
      and (from_date is null or r.period_end>=from_date)
      and (to_date is null or r.period_start<=to_date)
      and cardinality(media_values)=0 and cardinality(tag_values)=0 and place_text=''
    order by r.generated_at desc,r.id limit 5
  ), combined as (
    select position,source_kind,source_id,entry_id,revision_id,
      null::uuid report_id,occurred_local_date,body_text,tag_text,place_label,
      has_image,has_audio,has_video,transcript_text,transcript_id,
      transcript_segment_id,start_ms,end_ms from normalized
    union all
    select 20+row_number() over(), 'report',report_id, null::uuid,null::uuid,
      report_id,period_start,body_text,''::text,null::text,false,false,false,
      null::text,null::uuid,null::uuid,null::integer,null::integer
    from report_matches
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'sourceId',source_id,'sourceKind',source_kind,'entryId',entry_id,
    'revisionId',revision_id,'reportId',report_id,
    'occurredLocalDate',occurred_local_date,
    'authoredText',left(nullif(body_text,''),1000),
    'transcriptText',left(nullif(transcript_text,''),1000),
    'tags',left(nullif(tag_text,''),300),'placeLabel',left(place_label,200),
    'hasImage',has_image,'hasAudio',has_audio,'hasVideo',has_video,
    'transcriptId',transcript_id,'segmentId',transcript_segment_id,
    'startMs',start_ms,'endMs',end_ms
  ) order by position),'[]'::jsonb) into result from combined;
  if char_length(result::text)>50000 then
    raise exception using errcode='P0001',message='odiina_chat_evidence_limit';
  end if;
  return result;
end
$$;

create function app.request_chat(
  p_conversation_id uuid,p_mode text,p_question text,p_plan jsonb,p_client_request_id uuid
)
returns table(conversation_id uuid,user_message_id uuid,job_id uuid,job_status text)
language plpgsql security definer set search_path = '' as $$
declare actor uuid:=app.request_user_id(); settings app.ai_settings%rowtype;
  conversation app.chat_conversations%rowtype; evidence jsonb; snapshot jsonb;
  created_conversation uuid:=coalesce(p_conversation_id,extensions.gen_random_uuid());
  created_message uuid:=extensions.gen_random_uuid(); created_job uuid:=extensions.gen_random_uuid();
  existing app.ai_jobs%rowtype; daily_count integer; monthly_count integer; active_jobs integer;
begin
  if actor is null then raise exception using errcode='P0001',message='odiina_auth_required'; end if;
  perform app.purge_expired_temporary_chats();
  if p_mode not in ('saved','temporary') or p_client_request_id is null
    or char_length(btrim(coalesce(p_question,''))) not between 1 and 2000 then
    raise exception using errcode='P0001',message='odiina_chat_request_invalid';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor::text||':'||p_client_request_id::text,0));
  select * into existing from app.ai_jobs where user_id=actor
    and job_kind='chat' and client_request_id=p_client_request_id;
  if found then
    select l.conversation_id,l.user_message_id into created_conversation,created_message
      from app.chat_job_links l where l.job_id=existing.id and l.user_id=actor;
    return query select created_conversation,created_message,existing.id,existing.status; return;
  end if;
  select * into settings from app.ai_settings where user_id=actor for share;
  if not settings.master_enabled or not settings.insights_enabled or not settings.chat_enabled then
    raise exception using errcode='P0001',message='odiina_chat_consent_required';
  end if;
  if p_conversation_id is null then
    if p_mode='saved' and (select count(*) from app.chat_conversations
      where user_id=actor and mode='saved' and status='active')>=100 then
      raise exception using errcode='P0001',message='odiina_chat_conversation_limit';
    end if;
    insert into app.chat_conversations(id,user_id,mode,title,expires_at,
      provider_id,model_id,provider_policy_version)
    values(created_conversation,actor,p_mode,left(btrim(p_question),80),
      case when p_mode='temporary' then statement_timestamp()+interval '1 hour' end,
      'fake-local','deterministic-chat-v1',settings.provider_policy_version)
    returning * into conversation;
  else
    select * into conversation from app.chat_conversations where user_id=actor
      and id=p_conversation_id and status='active' and mode=p_mode for update;
    if not found or (conversation.mode='temporary' and conversation.expires_at<=statement_timestamp()) then
      raise exception using errcode='P0001',message='odiina_chat_conversation_unavailable';
    end if;
  end if;
  if (select count(*) from app.chat_messages m where m.user_id=actor
    and m.conversation_id=created_conversation)>=100 then
    raise exception using errcode='P0001',message='odiina_chat_turn_limit';
  end if;
  select count(*) filter(where created_at>=date_trunc('day',statement_timestamp())),count(*)
    into daily_count,monthly_count from app.ai_usage_events where user_id=actor
      and usage_kind='chat' and created_at>=date_trunc('month',statement_timestamp());
  if daily_count>=30 or monthly_count>=300 then
    raise exception using errcode='P0001',message='odiina_chat_quota';
  end if;
  select count(*) into active_jobs from app.ai_jobs where user_id=actor
    and status in ('queued','sending','processing_response','generating');
  if active_jobs>=2 then raise exception using errcode='P0001',message='odiina_concurrent_job_limit'; end if;
  evidence:=app.build_chat_evidence(p_plan);
  snapshot:=jsonb_build_object('question',btrim(p_question),'plan',p_plan,
    'evidence',evidence,'limitations',jsonb_build_array(
      'Only logged Odiina evidence is available.',
      'Photo and video visuals are not analyzed.',
      'Untranscribed audio cannot be interpreted.'
    ));
  if char_length(snapshot::text)>52000 then
    raise exception using errcode='P0001',message='odiina_chat_evidence_limit';
  end if;
  insert into app.chat_messages(id,user_id,conversation_id,role,content,status,input_characters)
  values(created_message,actor,created_conversation,'user',btrim(p_question),'ready',
    char_length(btrim(p_question)));
  insert into app.ai_jobs(id,user_id,job_kind,client_request_id,consent_version,
    provider_id,model_id,source_snapshot,source_snapshot_sha256)
  values(created_job,actor,'chat',p_client_request_id,settings.consent_version,
    'fake-local','deterministic-chat-v1',snapshot,
    extensions.digest(convert_to(snapshot::text,'UTF8'),'sha256'));
  insert into app.chat_job_links(user_id,job_id,conversation_id,user_message_id)
  values(actor,created_job,created_conversation,created_message);
  update app.chat_conversations set context_state=p_plan,last_activity_at=statement_timestamp()
    where user_id=actor and id=created_conversation;
  return query select created_conversation,created_message,created_job,'queued'::text;
end
$$;
alter function app.request_chat(uuid,text,text,jsonb,uuid) owner to odiina_owner_api;

drop function app.claim_ai_job(integer);
create function app.claim_ai_job(p_visibility_seconds integer default 180)
returns table(job_id uuid,job_kind text,lease_token uuid,provider_id text,model_id text,
  entry_id uuid,revision_id uuid,attachment_id uuid,source_kind text,
  source_duration_ms integer,source_sha256_hex text,language_hint text,
  bucket_id text,object_key text,source_snapshot jsonb,client_request_id uuid)
language plpgsql security definer set search_path = '' as $$
declare worker uuid:=app.require_active_ai_worker(); selected app.ai_jobs%rowtype;
  token uuid:=extensions.gen_random_uuid();
begin
  if p_visibility_seconds not between 30 and 600 then
    raise exception using errcode='P0001',message='odiina_ai_lease_invalid';
  end if;
  update app.ai_jobs j set status='canceled',cancel_requested=true,
    safe_error_code='consent_revoked',completed_at=statement_timestamp()
  where j.status='queued' and not exists(select 1 from app.ai_settings s
    where s.user_id=j.user_id and s.master_enabled
      and ((j.job_kind='transcription' and s.transcription_enabled)
        or (j.job_kind='insight' and s.insights_enabled)
        or (j.job_kind='chat' and s.insights_enabled and s.chat_enabled)));
  select j.* into selected from app.ai_jobs j
  where (j.status='queued' or (j.status in ('sending','transcribing','processing_response','generating')
      and j.lease_expires_at<statement_timestamp()))
    and not j.cancel_requested and j.attempts<3
  order by j.queued_at,j.id for update skip locked limit 1;
  if not found then return; end if;
  update app.ai_jobs set status=case when selected.job_kind='transcription'
      then 'sending' else 'generating' end,
    attempts=attempts+1,leased_by=worker,lease_token=token,
    lease_expires_at=statement_timestamp()+make_interval(secs=>p_visibility_seconds),
    heartbeat_at=statement_timestamp(),started_at=coalesce(started_at,statement_timestamp()),
    safe_error_code=null where id=selected.id;
  return query select selected.id,selected.job_kind,token,selected.provider_id,
    selected.model_id,selected.entry_id,selected.revision_id,selected.attachment_id,
    selected.source_kind,selected.source_duration_ms,encode(selected.source_sha256,'hex'),
    selected.language_hint,o.bucket_id,o.object_key,selected.source_snapshot,
    selected.client_request_id
  from (select 1) sentinel left join app.attachment_objects o on o.id=selected.source_object_id;
end
$$;
alter function app.claim_ai_job(integer) owner to odiina_ai_worker_api;

create or replace function app.heartbeat_ai_job(
  p_job_id uuid,p_lease_token uuid,p_stage text,p_visibility_seconds integer default 180
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_active_ai_worker();
  if p_stage not in ('sending','transcribing','processing_response','generating')
    or p_visibility_seconds not between 30 and 600 then
    raise exception using errcode='P0001',message='odiina_ai_heartbeat_invalid';
  end if;
  update app.ai_jobs j set status=p_stage,heartbeat_at=statement_timestamp(),
    lease_expires_at=statement_timestamp()+make_interval(secs=>p_visibility_seconds)
  where j.id=p_job_id and j.lease_token=p_lease_token
    and j.leased_by=app.ai_worker_actor_id()
    and j.status in ('sending','transcribing','processing_response','generating')
    and not j.cancel_requested
    and exists(select 1 from app.ai_settings s where s.user_id=j.user_id
      and s.master_enabled and ((j.job_kind='transcription' and s.transcription_enabled)
        or (j.job_kind='insight' and s.insights_enabled)
        or (j.job_kind='chat' and s.insights_enabled and s.chat_enabled)))
    and (j.job_kind<>'transcription' or exists(
      select 1 from app.entries e join app.entry_revision_attachments ra
        on ra.user_id=e.user_id and ra.entry_id=e.id and ra.revision_id=e.current_revision_id
        and ra.attachment_id=j.attachment_id
      join app.attachments a on a.user_id=e.user_id and a.id=ra.attachment_id and a.state='accepted'
      join app.attachment_objects o on o.user_id=a.user_id and o.id=j.source_object_id
        and o.state='verified' and o.sha256=j.source_sha256
      where e.user_id=j.user_id and e.id=j.entry_id and e.current_revision_id=j.revision_id
        and e.lifecycle_state='active'));
  if not found then raise exception using errcode='P0001',message='odiina_ai_lease_lost'; end if;
end
$$;
alter function app.heartbeat_ai_job(uuid,uuid,text,integer) owner to odiina_ai_worker_api;

create or replace function app.retry_ai_job(p_job_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid:=app.request_user_id(); selected app.ai_jobs%rowtype;
  settings app.ai_settings%rowtype;
begin
  select * into selected from app.ai_jobs where id=p_job_id and user_id=actor for update;
  select * into settings from app.ai_settings where user_id=actor;
  if not found or selected.status not in ('failed','dead_letter','canceled')
    or selected.attempts>=3 or not settings.master_enabled
    or (selected.job_kind='transcription' and not settings.transcription_enabled)
    or (selected.job_kind='insight' and not settings.insights_enabled)
    or (selected.job_kind='chat' and (not settings.insights_enabled or not settings.chat_enabled)) then
    raise exception using errcode='P0001',message='odiina_ai_retry_unavailable';
  end if;
  update app.ai_jobs set status='queued',cancel_requested=false,safe_error_code=null,
    completed_at=null,lease_token=null,leased_by=null,lease_expires_at=null where id=p_job_id;
end
$$;
alter function app.retry_ai_job(uuid) owner to odiina_owner_api;

create function app.finish_chat_job(p_job_id uuid,p_lease_token uuid,p_output jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare job app.ai_jobs%rowtype; settings app.ai_settings%rowtype; link app.chat_job_links%rowtype;
  assistant_id uuid:=extensions.gen_random_uuid(); citation jsonb; source jsonb;
  citation_position integer:=0; answer_text text; unsupported_removed boolean;
begin
  perform app.require_active_ai_worker();
  select * into job from app.ai_jobs where id=p_job_id and lease_token=p_lease_token
    and leased_by=app.ai_worker_actor_id() and job_kind='chat' for update;
  if not found then raise exception using errcode='P0001',message='odiina_ai_lease_lost'; end if;
  select * into settings from app.ai_settings where user_id=job.user_id;
  select * into link from app.chat_job_links where user_id=job.user_id and job_id=job.id;
  if job.cancel_requested or not settings.master_enabled or not settings.insights_enabled
    or not settings.chat_enabled or link.job_id is null then
    update app.ai_jobs set status='canceled',safe_error_code='consent_revoked',
      completed_at=statement_timestamp(),source_snapshot='{}'::jsonb,
      source_snapshot_sha256=extensions.digest(convert_to('{}','UTF8'),'sha256') where id=job.id;
    raise exception using errcode='P0001',message='odiina_ai_consent_revoked';
  end if;
  if jsonb_typeof(p_output)<>'object' or jsonb_typeof(p_output->'citations')<>'array'
    or jsonb_array_length(p_output->'citations')>20
    or char_length(btrim(coalesce(p_output->>'answer',''))) not between 1 and 8000
    or jsonb_typeof(p_output->'unsupportedClaimsRemoved')<>'boolean' then
    raise exception using errcode='P0001',message='odiina_chat_output_invalid';
  end if;
  answer_text:=btrim(p_output->>'answer');
  unsupported_removed:=(p_output->>'unsupportedClaimsRemoved')::boolean;
  if answer_text ~* '<script|javascript:|data:text/html' then
    raise exception using errcode='P0001',message='odiina_chat_output_unsafe';
  end if;
  for citation in select value from jsonb_array_elements(p_output->'citations') loop
    if citation_position>=20 or coalesce(citation->>'sourceId','')='' then
      raise exception using errcode='P0001',message='odiina_chat_citation_invalid';
    end if;
    select value into source from jsonb_array_elements(job.source_snapshot->'evidence')
      where value->>'sourceId'=citation->>'sourceId' limit 1;
    if source is null then
      raise exception using errcode='P0001',message='odiina_chat_citation_invalid';
    end if;
    citation_position:=citation_position+1;
  end loop;
  insert into app.chat_messages(id,user_id,conversation_id,role,content,status,
    reply_to_message_id,provider_id,model_id,unsupported_claims_removed,
    output_characters,completed_at)
  values(assistant_id,job.user_id,link.conversation_id,'assistant',answer_text,'ready',
    link.user_message_id,job.provider_id,job.model_id,unsupported_removed,
    char_length(answer_text),statement_timestamp());
  citation_position:=0;
  for citation in select value from jsonb_array_elements(p_output->'citations') loop
    select value into source from jsonb_array_elements(job.source_snapshot->'evidence')
      where value->>'sourceId'=citation->>'sourceId' limit 1;
    citation_position:=citation_position+1;
    insert into app.chat_turn_sources(user_id,conversation_id,assistant_message_id,
      source_kind,citation_key,entry_id,revision_id,transcript_id,transcript_segment_id,
      report_id,occurred_local_date,start_ms,end_ms,evidence_excerpt,included_place_label)
    values(job.user_id,link.conversation_id,assistant_id,source->>'sourceKind',
      'S'||citation_position::text,nullif(source->>'entryId','')::uuid,
      nullif(source->>'revisionId','')::uuid,nullif(source->>'transcriptId','')::uuid,
      nullif(source->>'segmentId','')::uuid,nullif(source->>'reportId','')::uuid,
      nullif(source->>'occurredLocalDate','')::date,
      nullif(source->>'startMs','')::integer,nullif(source->>'endMs','')::integer,
      left(btrim(coalesce(citation->>'excerpt',source->>'authoredText',
        source->>'transcriptText','Selected Odiina evidence')),1000),
      nullif(source->>'placeLabel','') is not null);
  end loop;
  insert into app.ai_usage_events(user_id,job_id,usage_kind,input_characters,
    output_characters,cost_microunits)
  values(job.user_id,job.id,'chat',char_length(job.source_snapshot::text),
    char_length(answer_text),0);
  update app.ai_jobs set status='ready',completed_at=statement_timestamp(),
    lease_expires_at=null,heartbeat_at=statement_timestamp(),source_snapshot='{}'::jsonb,
    source_snapshot_sha256=extensions.digest(convert_to('{}','UTF8'),'sha256') where id=job.id;
  update app.chat_conversations set last_activity_at=statement_timestamp()
    where user_id=job.user_id and id=link.conversation_id;
  return assistant_id;
end
$$;
alter function app.finish_chat_job(uuid,uuid,jsonb) owner to odiina_ai_worker_api;

create function app.rename_chat(p_conversation_id uuid,p_title text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update app.chat_conversations set title=btrim(p_title)
  where user_id=app.request_user_id() and id=p_conversation_id and mode='saved'
    and status='active' and char_length(btrim(coalesce(p_title,''))) between 1 and 120;
  if not found then raise exception using errcode='P0001',message='odiina_chat_rename_invalid'; end if;
end
$$;
alter function app.rename_chat(uuid,text) owner to odiina_owner_api;

create function app.clear_chat_context(p_conversation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update app.chat_conversations set context_state='{}'::jsonb
  where user_id=app.request_user_id() and id=p_conversation_id and status='active';
  if not found then raise exception using errcode='P0001',message='odiina_chat_unavailable'; end if;
end
$$;
alter function app.clear_chat_context(uuid) owner to odiina_owner_api;

create function app.convert_temporary_chat(p_conversation_id uuid,p_title text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update app.chat_conversations set mode='saved',expires_at=null,title=btrim(p_title)
  where user_id=app.request_user_id() and id=p_conversation_id and mode='temporary'
    and status='active' and expires_at>statement_timestamp()
    and char_length(btrim(coalesce(p_title,''))) between 1 and 120;
  if not found then raise exception using errcode='P0001',message='odiina_chat_conversion_invalid'; end if;
end
$$;
alter function app.convert_temporary_chat(uuid,text) owner to odiina_owner_api;

create function app.delete_chat(p_conversation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from app.chat_conversations where user_id=app.request_user_id()
    and id=p_conversation_id) then
    raise exception using errcode='P0001',message='odiina_chat_unavailable';
  end if;
  perform app.purge_chat_conversation(app.request_user_id(),p_conversation_id);
end
$$;
alter function app.delete_chat(uuid) owner to odiina_owner_api;

create function app.delete_all_chat_history(p_include_temporary boolean default true)
returns integer language plpgsql security definer set search_path = '' as $$
declare selected uuid; removed integer:=0; actor uuid:=app.request_user_id();
begin
  for selected in select id from app.chat_conversations where user_id=actor
    and (p_include_temporary or mode='saved') for update
  loop perform app.purge_chat_conversation(actor,selected); removed:=removed+1; end loop;
  return removed;
end
$$;
alter function app.delete_all_chat_history(boolean) owner to odiina_owner_api;

create function app.delete_temporary_chat_history()
returns integer language plpgsql security definer set search_path = '' as $$
declare selected uuid; removed integer:=0; actor uuid:=app.request_user_id();
begin
  for selected in select id from app.chat_conversations where user_id=actor
    and mode='temporary' for update
  loop perform app.purge_chat_conversation(actor,selected); removed:=removed+1; end loop;
  return removed;
end
$$;
alter function app.delete_temporary_chat_history() owner to odiina_owner_api;

create function app.chat_usage_summary()
returns table(questions_today bigint,questions_month bigint,active_chat_jobs bigint)
language sql stable security definer set search_path = '' as $$
  select count(*) filter(where created_at>=date_trunc('day',statement_timestamp())),
    count(*),(select count(*) from app.ai_jobs where user_id=app.request_user_id()
      and job_kind='chat' and status in ('queued','sending','processing_response','generating'))
  from app.ai_usage_events where user_id=app.request_user_id()
    and usage_kind='chat' and created_at>=date_trunc('month',statement_timestamp())
$$;
alter function app.chat_usage_summary() owner to odiina_owner_api;

create function app.mark_chat_entry_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.current_revision_id is distinct from old.current_revision_id then
    update app.chat_turn_sources set source_stale=true
    where user_id=new.user_id and entry_id=new.id and revision_id<>new.current_revision_id;
    update app.chat_messages m set status='stale' where m.user_id=new.user_id
      and m.role='assistant' and exists(select 1 from app.chat_turn_sources s
        where s.assistant_message_id=m.id and s.entry_id=new.id and s.source_stale);
  end if;
  if new.lifecycle_state='trashed' and old.lifecycle_state is distinct from new.lifecycle_state then
    update app.chat_turn_sources set source_unavailable=true
      where user_id=new.user_id and entry_id=new.id;
  elsif new.lifecycle_state='active' and old.lifecycle_state='trashed' then
    update app.chat_turn_sources set source_unavailable=false,source_stale=true
      where user_id=new.user_id and entry_id=new.id;
  end if;
  return new;
end
$$;
alter function app.mark_chat_entry_changed() owner to odiina_owner_api;
create trigger entries_mark_chat_sources after update of current_revision_id,lifecycle_state
  on app.entries for each row execute function app.mark_chat_entry_changed();

create function app.mark_chat_place_redacted()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.redacted_at is distinct from old.redacted_at and new.redacted_at is not null then
    update app.chat_messages m set content='This answer was removed because cited place evidence was redacted. Ask Odiina again to use current evidence.',
      status='stale',unsupported_claims_removed=true
    where m.user_id=new.user_id and m.role='assistant' and exists(
      select 1 from app.chat_turn_sources s where s.assistant_message_id=m.id
        and s.entry_id=new.entry_id and s.included_place_label);
    update app.chat_turn_sources set source_unavailable=true,
      evidence_excerpt='[redacted place removed]'
    where user_id=new.user_id and entry_id=new.entry_id and included_place_label;
  end if;
  return new;
end
$$;
alter function app.mark_chat_place_redacted() owner to odiina_owner_api;
create trigger entry_places_mark_chat_redaction after update of redacted_at
  on app.entry_revision_places for each row execute function app.mark_chat_place_redacted();

create function app.mark_chat_transcript_deleted()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status='deleted' and old.status is distinct from new.status then
    update app.chat_messages m set content='This answer was removed because its transcript evidence was deleted. Ask Odiina again to use current evidence.',
      status='stale',unsupported_claims_removed=true
    where m.user_id=new.user_id and m.role='assistant' and exists(
      select 1 from app.chat_turn_sources s where s.assistant_message_id=m.id
        and s.transcript_id=new.id);
    update app.chat_turn_sources set source_unavailable=true,
      evidence_excerpt='[deleted transcript removed]'
    where user_id=new.user_id and transcript_id=new.id;
  end if;
  return new;
end
$$;
alter function app.mark_chat_transcript_deleted() owner to odiina_owner_api;
create trigger transcripts_mark_chat_deleted after update of status on app.transcripts
  for each row execute function app.mark_chat_transcript_deleted();

revoke all on function app.update_ai_settings(boolean,boolean,boolean,boolean,boolean,boolean,boolean,text,text,text)
  from public,anon;
revoke all on function app.build_chat_evidence(jsonb) from public,anon,authenticated;
revoke all on function app.purge_chat_conversation(uuid,uuid) from public,anon,authenticated;
revoke all on function app.purge_expired_temporary_chats() from public,anon;
revoke all on function app.request_chat(uuid,text,text,jsonb,uuid) from public,anon;
revoke all on function app.finish_chat_job(uuid,uuid,jsonb) from public,anon;
revoke all on function app.rename_chat(uuid,text),app.clear_chat_context(uuid),
  app.convert_temporary_chat(uuid,text),app.delete_chat(uuid),
  app.delete_all_chat_history(boolean),app.delete_temporary_chat_history(),
  app.chat_usage_summary() from public,anon;
revoke all on function app.mark_chat_entry_changed(),app.mark_chat_place_redacted(),
  app.mark_chat_transcript_deleted() from public,anon,authenticated;

grant execute on function app.update_ai_settings(boolean,boolean,boolean,boolean,boolean,boolean,boolean,text,text,text),
  app.purge_expired_temporary_chats(),app.request_chat(uuid,text,text,jsonb,uuid),
  app.rename_chat(uuid,text),app.clear_chat_context(uuid),app.convert_temporary_chat(uuid,text),
  app.delete_chat(uuid),app.delete_all_chat_history(boolean),app.delete_temporary_chat_history(),
  app.chat_usage_summary()
  to authenticated;
grant execute on function app.update_ai_settings(boolean,boolean,boolean,boolean,boolean,text,text,text)
  to authenticated;
grant execute on function app.claim_ai_job(integer),app.heartbeat_ai_job(uuid,uuid,text,integer),
  app.finish_chat_job(uuid,uuid,jsonb) to authenticated;
grant execute on function app.build_chat_evidence(jsonb),app.purge_chat_conversation(uuid,uuid)
  to odiina_owner_api;

revoke create on schema app from odiina_owner_api,odiina_ai_worker_api;
revoke odiina_owner_api,odiina_ai_worker_api from postgres;

comment on table app.chat_conversations is
  'Private Odiina Chat state. Temporary rows expire after one hour and are omitted from saved history.';
comment on table app.chat_messages is
  'Bounded user questions and fully validated assistant answers; never executable content.';
comment on table app.chat_turn_sources is
  'Normalized owner-validated citations to current private Odiina evidence.';
comment on table app.chat_job_links is
  'Private link from the shared durable AI queue to an exact Chat turn.';

commit;
