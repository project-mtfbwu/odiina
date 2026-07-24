begin;

do $$
begin
  if current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'odiina_migration_requires_postgres_runner';
  end if;
  if not exists (select 1 from pg_roles where rolname='odiina_share_api') then
    create role odiina_share_api nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
end
$$;

grant usage on schema app,extensions to odiina_share_api;
grant odiina_owner_api,odiina_share_api to postgres;
grant create on schema app to odiina_owner_api,odiina_share_api;

-- Keep certified private storage guarantees reproducible after a fresh reset.
-- Supabase CLI 2.109 may not materialize config.toml buckets when a retained
-- local volume is restarted, so the database also asserts the private catalog.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values
  ('odiina-quarantine','odiina-quarantine',false,262144000,array['image/jpeg','image/png','image/webp','audio/webm','audio/ogg','audio/mp4','audio/x-m4a','video/webm','video/mp4','application/mp4','video/quicktime']),
  ('odiina-originals','odiina-originals',false,262144000,array['image/jpeg','image/png','image/webp','audio/webm','audio/ogg','audio/mp4','audio/x-m4a','video/webm','video/mp4','video/quicktime']),
  ('odiina-display','odiina-display',false,8388608,array['image/jpeg']),
  ('odiina-ai','odiina-ai',false,4194304,array['image/jpeg']),
  ('odiina-playback','odiina-playback',false,188743680,array['audio/mp4','video/mp4']),
  ('odiina-posters','odiina-posters',false,2097152,array['image/jpeg'])
on conflict(id) do update set public=false;

create table app.reports (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references app.profiles(user_id) on delete cascade,
  report_type text not null check (report_type in ('daily','weekly','monthly','yearly','custom')),
  period_start date not null,
  period_end date not null check (period_end >= period_start and period_end - period_start <= 366),
  period_timezone text not null check (char_length(period_timezone) between 1 and 255),
  week_starts_on smallint not null check (week_starts_on between 0 and 6),
  title text not null check (char_length(title) between 1 and 120 and title = btrim(title)),
  introduction text not null default '' check (char_length(introduction) <= 4000),
  closing_reflection text not null default '' check (char_length(closing_reflection) <= 4000),
  generation_mode text not null default 'factual' check (generation_mode in ('factual','ai_enhanced')),
  insight_id uuid null,
  status text not null default 'draft' check (status in ('draft','ready','stale','deleted')),
  source_snapshot_sha256 bytea null check (source_snapshot_sha256 is null or octet_length(source_snapshot_sha256) = 32),
  created_at timestamptz not null default statement_timestamp(),
  generated_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  stale_at timestamptz null,
  deleted_at timestamptz null,
  unique (user_id,id),
  constraint reports_insight_fk foreign key (user_id,insight_id)
    references app.insights(user_id,id) on delete restrict,
  constraint reports_status_consistent check (
    (status='deleted' and deleted_at is not null) or (status<>'deleted' and deleted_at is null)
  ),
  constraint reports_ai_consistent check (
    (generation_mode='factual' and insight_id is null) or
    (generation_mode='ai_enhanced' and insight_id is not null)
  )
);

create table app.report_sources (
  user_id uuid not null,
  report_id uuid not null,
  source_position smallint not null check (source_position between 0 and 199),
  entry_id uuid not null,
  revision_id uuid not null,
  occurred_at timestamptz not null,
  occurred_local_date date not null,
  body_excerpt text not null check (char_length(body_excerpt) <= 4000),
  place_label text null check (place_label is null or char_length(place_label) between 1 and 120),
  edited boolean not null,
  selected boolean not null default true,
  source_unavailable boolean not null default false,
  created_at timestamptz not null default statement_timestamp(),
  primary key (user_id,report_id,source_position),
  unique (user_id,report_id,entry_id,revision_id),
  constraint report_sources_report_fk foreign key (user_id,report_id)
    references app.reports(user_id,id) on delete cascade,
  constraint report_sources_revision_fk foreign key (user_id,entry_id,revision_id)
    references app.entry_revisions(user_id,entry_id,id) on delete restrict
);

create table app.report_sections (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null,
  report_id uuid not null,
  section_kind text not null check (section_kind in (
    'cover','at_a_glance','timeline','key_moments','photos','voice','video','places','tags','reflection'
  )),
  position smallint not null check (position between 0 and 9),
  visible boolean not null default true,
  heading text not null check (char_length(heading) between 1 and 80),
  origin text not null default 'factual' check (origin in ('factual','user','ai')),
  generated_text text not null default '' check (char_length(generated_text) <= 8000),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (user_id,report_id,section_kind),
  constraint report_sections_position_unique unique (user_id,report_id,position)
    deferrable initially immediate,
  constraint report_sections_report_fk foreign key (user_id,report_id)
    references app.reports(user_id,id) on delete cascade
);

create table app.report_metrics (
  user_id uuid not null,
  report_id uuid not null,
  metric_key text not null check (metric_key in (
    'entries','active_days','text_entries','photo_entries','voice_entries','voice_duration_ms',
    'video_entries','video_duration_ms','place_entries','tagged_entries','edited_entries'
  )),
  metric_value bigint not null check (metric_value >= 0),
  primary key (user_id,report_id,metric_key),
  constraint report_metrics_report_fk foreign key (user_id,report_id)
    references app.reports(user_id,id) on delete cascade
);

create table app.report_media_selections (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null,
  report_id uuid not null,
  entry_id uuid not null,
  revision_id uuid not null,
  attachment_id uuid not null,
  media_kind text not null check (media_kind in ('image','audio','video')),
  presentation_role text not null default 'gallery' check (presentation_role in ('gallery','cover')),
  position smallint not null check (position between 0 and 99),
  selected boolean not null default false,
  created_at timestamptz not null default statement_timestamp(),
  unique (user_id,report_id,attachment_id),
  constraint report_media_report_fk foreign key (user_id,report_id)
    references app.reports(user_id,id) on delete cascade,
  constraint report_media_source_fk foreign key (user_id,report_id,entry_id,revision_id)
    references app.report_sources(user_id,report_id,entry_id,revision_id) on delete cascade,
  constraint report_media_attachment_fk foreign key (user_id,entry_id,attachment_id)
    references app.attachments(user_id,entry_id,id) on delete restrict
);

create table app.report_tags (
  user_id uuid not null,
  report_id uuid not null,
  normalized_name text not null check (char_length(normalized_name) between 1 and 40),
  display_name text not null check (char_length(display_name) between 1 and 40),
  entry_count integer not null check (entry_count between 1 and 200),
  primary key (user_id,report_id,normalized_name),
  constraint report_tags_report_fk foreign key (user_id,report_id)
    references app.reports(user_id,id) on delete cascade
);

create table app.report_exports (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null,
  report_id uuid not null,
  export_kind text not null check (export_kind in ('print_html','markdown')),
  status text not null default 'ready' check (status in ('ready','revoked')),
  created_at timestamptz not null default statement_timestamp(),
  revoked_at timestamptz null,
  constraint report_exports_report_fk foreign key (user_id,report_id)
    references app.reports(user_id,id) on delete cascade
);

create table app.report_schedules (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references app.profiles(user_id) on delete cascade,
  report_type text not null check (report_type in ('daily','weekly','monthly','yearly')),
  local_time time not null,
  timezone text not null check (char_length(timezone) between 1 and 255),
  generation_mode text not null default 'factual' check (generation_mode in ('factual','ai_enhanced')),
  status text not null default 'paused' check (status in ('paused','active')),
  execution_enabled boolean not null default false check (not execution_enabled),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (user_id,report_type)
);

create table app.report_shares (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null,
  report_id uuid not null,
  token_hash bytea not null unique check (octet_length(token_hash)=32),
  token_prefix text not null check (token_prefix ~ '^[0-9a-f]{8}$'),
  title text not null check (char_length(title) between 1 and 120),
  report_type text not null check (report_type in ('daily','weekly','monthly','yearly','custom')),
  period_start date not null,
  period_end date not null,
  include_places boolean not null default false,
  manifest_version integer not null default 1 check (manifest_version > 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  revoked_at timestamptz null,
  revoke_reason text null check (revoke_reason is null or revoke_reason in ('owner','source_trashed','place_redacted','ai_deleted','deleted')),
  unique (user_id,id),
  constraint report_shares_report_fk foreign key (user_id,report_id)
    references app.reports(user_id,id) on delete cascade,
  check (expires_at > created_at),
  check ((revoked_at is null and revoke_reason is null) or (revoked_at is not null and revoke_reason is not null))
);

create table app.report_share_sections (
  user_id uuid not null,
  share_id uuid not null,
  position smallint not null check (position between 0 and 49),
  section_kind text not null check (section_kind ~ '^[a-z_]{1,40}$'),
  heading text not null check (char_length(heading) between 1 and 80),
  content text not null check (char_length(content) <= 10000),
  primary key (user_id,share_id,position),
  constraint report_share_sections_share_fk foreign key (user_id,share_id)
    references app.report_shares(user_id,id) on delete cascade
);

create table app.report_command_receipts (
  user_id uuid not null references app.profiles(user_id) on delete cascade,
  command_kind text not null check (command_kind in ('create_report','publish_report')),
  client_request_id uuid not null,
  artifact_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  primary key (user_id,command_kind,client_request_id)
);

create index reports_owner_idx on app.reports(user_id,created_at desc) where status<>'deleted';
create index report_sources_entry_idx on app.report_sources(user_id,entry_id,revision_id);
create index report_media_selected_idx on app.report_media_selections(user_id,report_id,position) where selected;
create unique index report_media_one_cover_idx on app.report_media_selections(user_id,report_id) where presentation_role='cover';
create index report_shares_owner_idx on app.report_shares(user_id,report_id,created_at desc);
create index report_shares_active_idx on app.report_shares(expires_at) where revoked_at is null;

alter table app.reports enable row level security; alter table app.reports force row level security;
alter table app.report_sources enable row level security; alter table app.report_sources force row level security;
alter table app.report_sections enable row level security; alter table app.report_sections force row level security;
alter table app.report_metrics enable row level security; alter table app.report_metrics force row level security;
alter table app.report_media_selections enable row level security; alter table app.report_media_selections force row level security;
alter table app.report_tags enable row level security; alter table app.report_tags force row level security;
alter table app.report_exports enable row level security; alter table app.report_exports force row level security;
alter table app.report_schedules enable row level security; alter table app.report_schedules force row level security;
alter table app.report_shares enable row level security; alter table app.report_shares force row level security;
alter table app.report_share_sections enable row level security; alter table app.report_share_sections force row level security;
alter table app.report_command_receipts enable row level security; alter table app.report_command_receipts force row level security;

create policy reports_owner_read on app.reports for select to authenticated using (user_id=(select app.request_user_id()));
create policy report_sources_owner_read on app.report_sources for select to authenticated using (user_id=(select app.request_user_id()));
create policy report_sections_owner_read on app.report_sections for select to authenticated using (user_id=(select app.request_user_id()));
create policy report_metrics_owner_read on app.report_metrics for select to authenticated using (user_id=(select app.request_user_id()));
create policy report_media_owner_read on app.report_media_selections for select to authenticated using (user_id=(select app.request_user_id()));
create policy report_tags_owner_read on app.report_tags for select to authenticated using (user_id=(select app.request_user_id()));
create policy report_exports_owner_read on app.report_exports for select to authenticated using (user_id=(select app.request_user_id()));
create policy report_schedules_owner_read on app.report_schedules for select to authenticated using (user_id=(select app.request_user_id()));
create policy report_shares_owner_read on app.report_shares for select to authenticated using (user_id=(select app.request_user_id()));
create policy report_share_sections_owner_read on app.report_share_sections for select to authenticated using (user_id=(select app.request_user_id()));

create policy reports_owner_api on app.reports for all to odiina_owner_api using (user_id=(select app.request_user_id())) with check (user_id=(select app.request_user_id()));
create policy report_sources_owner_api on app.report_sources for all to odiina_owner_api using (user_id=(select app.request_user_id())) with check (user_id=(select app.request_user_id()));
create policy report_sections_owner_api on app.report_sections for all to odiina_owner_api using (user_id=(select app.request_user_id())) with check (user_id=(select app.request_user_id()));
create policy report_metrics_owner_api on app.report_metrics for all to odiina_owner_api using (user_id=(select app.request_user_id())) with check (user_id=(select app.request_user_id()));
create policy report_media_owner_api on app.report_media_selections for all to odiina_owner_api using (user_id=(select app.request_user_id())) with check (user_id=(select app.request_user_id()));
create policy report_tags_owner_api on app.report_tags for all to odiina_owner_api using (user_id=(select app.request_user_id())) with check (user_id=(select app.request_user_id()));
create policy report_exports_owner_api on app.report_exports for all to odiina_owner_api using (user_id=(select app.request_user_id())) with check (user_id=(select app.request_user_id()));
create policy report_schedules_owner_api on app.report_schedules for all to odiina_owner_api using (user_id=(select app.request_user_id())) with check (user_id=(select app.request_user_id()));
create policy report_shares_owner_api on app.report_shares for all to odiina_owner_api using (user_id=(select app.request_user_id())) with check (user_id=(select app.request_user_id()));
create policy report_share_sections_owner_api on app.report_share_sections for all to odiina_owner_api using (user_id=(select app.request_user_id())) with check (user_id=(select app.request_user_id()));
create policy report_receipts_owner_api on app.report_command_receipts for all to odiina_owner_api using (user_id=(select app.request_user_id())) with check (user_id=(select app.request_user_id()));
create policy report_shares_token_resolver on app.report_shares for select to odiina_share_api using (true);
create policy report_share_sections_token_resolver on app.report_share_sections for select to odiina_share_api using (true);

create trigger reports_updated_at before update on app.reports for each row execute function app.set_updated_at();
create trigger report_sections_updated_at before update on app.report_sections for each row execute function app.set_updated_at();
create trigger report_schedules_updated_at before update on app.report_schedules for each row execute function app.set_updated_at();

create function app.report_period_valid(p_type text,p_start date,p_end date,p_week_start smallint)
returns boolean language sql immutable security invoker set search_path=''
as $$ select case p_type
  when 'daily' then p_end=p_start
  when 'weekly' then p_end=p_start+6 and extract(dow from p_start)::smallint=p_week_start
  when 'monthly' then p_start=date_trunc('month',p_start)::date and p_end=(date_trunc('month',p_start)+interval '1 month - 1 day')::date
  when 'yearly' then p_start=make_date(extract(year from p_start)::int,1,1) and p_end=make_date(extract(year from p_start)::int,12,31)
  when 'custom' then p_end>=p_start and p_end-p_start<=366
  else false end $$;

create function app.preview_factual_report(p_type text,p_start date,p_end date,p_entry_ids uuid[] default '{}')
returns table(entry_count integer,active_days integer,photo_entries integer,voice_entries integer,video_entries integer,place_entries integer,tagged_entries integer)
language plpgsql security definer set search_path=''
as $$
declare actor uuid:=app.request_user_id(); prefs app.user_preferences%rowtype;
begin
  select * into prefs from app.user_preferences where user_id=actor;
  if actor is null or prefs.iana_timezone is null or not app.report_period_valid(p_type,p_start,p_end,prefs.week_starts_on)
     or coalesce(cardinality(p_entry_ids),0)>200 then
    raise exception using errcode='P0001',message='odiina_report_scope_invalid';
  end if;
  return query select count(*)::int,count(distinct r.occurred_local_date)::int,
    count(*) filter(where exists(select 1 from app.entry_revision_attachments era join app.attachments a on a.user_id=era.user_id and a.entry_id=era.entry_id and a.id=era.attachment_id where era.user_id=actor and era.entry_id=e.id and era.revision_id=r.id and a.state='accepted' and a.media_kind='image'))::int,
    count(*) filter(where exists(select 1 from app.entry_revision_attachments era join app.attachments a on a.user_id=era.user_id and a.entry_id=era.entry_id and a.id=era.attachment_id where era.user_id=actor and era.entry_id=e.id and era.revision_id=r.id and a.state='accepted' and a.media_kind='audio'))::int,
    count(*) filter(where exists(select 1 from app.entry_revision_attachments era join app.attachments a on a.user_id=era.user_id and a.entry_id=era.entry_id and a.id=era.attachment_id where era.user_id=actor and era.entry_id=e.id and era.revision_id=r.id and a.state='accepted' and a.media_kind='video'))::int,
    count(*) filter(where exists(select 1 from app.entry_revision_places p where p.user_id=actor and p.entry_id=e.id and p.revision_id=r.id and p.redacted_at is null))::int,
    count(*) filter(where exists(select 1 from app.entry_revision_tags t where t.user_id=actor and t.entry_id=e.id and t.revision_id=r.id))::int
  from app.entries e join app.entry_revisions r on r.user_id=e.user_id and r.entry_id=e.id and r.id=e.current_revision_id
  where e.user_id=actor and e.lifecycle_state='active' and r.occurred_local_date between p_start and p_end
    and (cardinality(p_entry_ids)=0 or e.id=any(p_entry_ids));
end $$;
alter function app.preview_factual_report(text,date,date,uuid[]) owner to odiina_owner_api;

create function app.create_factual_report(p_type text,p_start date,p_end date,p_title text,p_entry_ids uuid[],p_include_places boolean,p_client_request_id uuid)
returns table(report_id uuid)
language plpgsql security definer set search_path=''
as $$
declare actor uuid:=app.request_user_id(); prefs app.user_preferences%rowtype; created uuid; existing uuid;
begin
  select artifact_id into existing from app.report_command_receipts where user_id=actor and command_kind='create_report' and client_request_id=p_client_request_id;
  if existing is not null then return query select existing; return; end if;
  select * into prefs from app.user_preferences where user_id=actor for share;
  if actor is null or prefs.iana_timezone is null or not app.report_period_valid(p_type,p_start,p_end,prefs.week_starts_on)
     or coalesce(cardinality(p_entry_ids),0)>200 or char_length(btrim(coalesce(p_title,''))) not between 1 and 120 then
    raise exception using errcode='P0001',message='odiina_report_scope_invalid';
  end if;
  if cardinality(p_entry_ids)=0 and (select count(*) from app.entries e join app.entry_revisions r on r.user_id=e.user_id and r.entry_id=e.id and r.id=e.current_revision_id where e.user_id=actor and e.lifecycle_state='active' and r.occurred_local_date between p_start and p_end)>200 then
    raise exception using errcode='P0001',message='odiina_report_scope_too_large';
  end if;
  insert into app.reports(user_id,report_type,period_start,period_end,period_timezone,week_starts_on,title)
  values(actor,p_type,p_start,p_end,prefs.iana_timezone,prefs.week_starts_on,btrim(p_title)) returning id into created;
  insert into app.report_sources(user_id,report_id,source_position,entry_id,revision_id,occurred_at,occurred_local_date,body_excerpt,place_label,edited)
  select actor,created,(row_number() over(order by r.occurred_at,e.id)-1)::smallint,e.id,r.id,r.occurred_at,r.occurred_local_date,left(r.body_text,4000),
    case when p_include_places then (select p.place_name from app.entry_revision_places p where p.user_id=actor and p.entry_id=e.id and p.revision_id=r.id and p.redacted_at is null) else null end,
    r.revision_number>1
  from app.entries e join app.entry_revisions r on r.user_id=e.user_id and r.entry_id=e.id and r.id=e.current_revision_id
  where e.user_id=actor and e.lifecycle_state='active' and r.occurred_local_date between p_start and p_end
    and (cardinality(p_entry_ids)=0 or e.id=any(p_entry_ids)) order by r.occurred_at,e.id limit 200;
  insert into app.report_sections(user_id,report_id,section_kind,position,visible,heading)
  values (actor,created,'cover',0,true,'Cover'),(actor,created,'at_a_glance',1,true,'At a glance'),
    (actor,created,'timeline',2,true,'Timeline'),(actor,created,'key_moments',3,false,'Key moments'),
    (actor,created,'photos',4,true,'Photos'),(actor,created,'voice',5,true,'Voice moments'),
    (actor,created,'video',6,true,'Video moments'),(actor,created,'places',7,p_include_places,'Places'),
    (actor,created,'tags',8,true,'Tags'),(actor,created,'reflection',9,true,'Reflection');
  insert into app.report_metrics(user_id,report_id,metric_key,metric_value)
  select actor,created,k,v from (values
    ('entries',(select count(*) from app.report_sources s where s.user_id=actor and s.report_id=created)),
    ('active_days',(select count(distinct occurred_local_date) from app.report_sources s where s.user_id=actor and s.report_id=created)),
    ('text_entries',(select count(*) from app.report_sources s where s.user_id=actor and s.report_id=created and s.body_excerpt<>'')),
    ('place_entries',(select count(*) from app.report_sources s where s.user_id=actor and s.report_id=created and s.place_label is not null)),
    ('edited_entries',(select count(*) from app.report_sources s where s.user_id=actor and s.report_id=created and s.edited))
  ) x(k,v);
  insert into app.report_tags(user_id,report_id,normalized_name,display_name,entry_count)
  select actor,created,t.normalized_name,t.display_name,count(distinct s.entry_id)::integer
  from app.report_sources s
  join app.entry_revision_tags rt on rt.user_id=s.user_id and rt.entry_id=s.entry_id and rt.revision_id=s.revision_id
  join app.user_tags t on t.user_id=rt.user_id and t.id=rt.tag_id
  where s.user_id=actor and s.report_id=created
  group by t.normalized_name,t.display_name;
  insert into app.report_media_selections(user_id,report_id,entry_id,revision_id,attachment_id,media_kind,position)
  select actor,created,s.entry_id,s.revision_id,a.id,a.media_kind,(row_number() over(order by s.source_position,era.position)-1)::smallint
  from app.report_sources s join app.entry_revision_attachments era on era.user_id=s.user_id and era.entry_id=s.entry_id and era.revision_id=s.revision_id
  join app.attachments a on a.user_id=era.user_id and a.entry_id=era.entry_id and a.id=era.attachment_id
  where s.user_id=actor and s.report_id=created and a.state='accepted' order by s.source_position,era.position limit 100;
  insert into app.report_metrics(user_id,report_id,metric_key,metric_value)
  select actor,created,x.k,x.v from (values
    ('photo_entries',(select count(distinct m.entry_id) from app.report_media_selections m where m.user_id=actor and m.report_id=created and m.media_kind='image')),
    ('voice_entries',(select count(distinct m.entry_id) from app.report_media_selections m where m.user_id=actor and m.report_id=created and m.media_kind='audio')),
    ('voice_duration_ms',(select coalesce(sum(am.playback_duration_ms),0)::bigint from app.report_media_selections m join app.audio_metadata am on am.user_id=m.user_id and am.entry_id=m.entry_id and am.attachment_id=m.attachment_id where m.user_id=actor and m.report_id=created and m.media_kind='audio')),
    ('video_entries',(select count(distinct m.entry_id) from app.report_media_selections m where m.user_id=actor and m.report_id=created and m.media_kind='video')),
    ('video_duration_ms',(select coalesce(sum(vm.playback_duration_ms),0)::bigint from app.report_media_selections m join app.video_metadata vm on vm.user_id=m.user_id and vm.entry_id=m.entry_id and vm.attachment_id=m.attachment_id where m.user_id=actor and m.report_id=created and m.media_kind='video')),
    ('tagged_entries',(select count(distinct s.entry_id) from app.report_sources s join app.entry_revision_tags t on t.user_id=s.user_id and t.entry_id=s.entry_id and t.revision_id=s.revision_id where s.user_id=actor and s.report_id=created))
  ) x(k,v);
  update app.reports set source_snapshot_sha256=extensions.digest(coalesce((select string_agg(s.entry_id::text||':'||s.revision_id::text,',' order by s.source_position) from app.report_sources s where s.user_id=actor and s.report_id=created),''),'sha256'),status='ready' where user_id=actor and id=created;
  insert into app.report_command_receipts values(actor,'create_report',p_client_request_id,created,statement_timestamp());
  return query select created;
end $$;
alter function app.create_factual_report(text,date,date,text,uuid[],boolean,uuid) owner to odiina_owner_api;

create function app.update_report(p_report_id uuid,p_title text,p_introduction text,p_reflection text,p_hidden_sections text[],p_section_order text[],p_selected_entries uuid[],p_selected_attachments uuid[],p_cover_attachment_id uuid,p_insight_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
declare actor uuid:=app.request_user_id();
begin
  if char_length(btrim(coalesce(p_title,''))) not between 1 and 120 or char_length(coalesce(p_introduction,''))>4000 or char_length(coalesce(p_reflection,''))>4000
    or cardinality(p_hidden_sections)>10 or cardinality(p_section_order)<>10 or cardinality(p_selected_entries)>200 or cardinality(p_selected_attachments)>20
    or not exists(select 1 from app.reports where user_id=actor and id=p_report_id and status<>'deleted') then
    raise exception using errcode='P0001',message='odiina_report_update_invalid';
  end if;
  if (select count(distinct x) from unnest(p_section_order) x)<>10 or exists(select 1 from unnest(p_section_order) x where x not in ('cover','at_a_glance','timeline','key_moments','photos','voice','video','places','tags','reflection')) then
    raise exception using errcode='P0001',message='odiina_report_section_order_invalid';
  end if;
  if exists(select 1 from unnest(p_selected_attachments) x where not exists(select 1 from app.report_media_selections m where m.user_id=actor and m.report_id=p_report_id and m.attachment_id=x)) then
    raise exception using errcode='P0001',message='odiina_report_media_invalid';
  end if;
  if p_cover_attachment_id is not null and (not p_cover_attachment_id=any(p_selected_attachments) or not exists(select 1 from app.report_media_selections where user_id=actor and report_id=p_report_id and attachment_id=p_cover_attachment_id and media_kind in ('image','video'))) then
    raise exception using errcode='P0001',message='odiina_report_cover_invalid';
  end if;
  if exists(select 1 from unnest(p_selected_entries) x where not exists(select 1 from app.report_sources s where s.user_id=actor and s.report_id=p_report_id and s.entry_id=x)) then
    raise exception using errcode='P0001',message='odiina_report_source_invalid';
  end if;
  update app.reports set title=btrim(p_title),introduction=coalesce(p_introduction,''),closing_reflection=coalesce(p_reflection,'') where user_id=actor and id=p_report_id;
  update app.report_sections set visible=not(section_kind=any(p_hidden_sections)) where user_id=actor and report_id=p_report_id;
  set constraints app.report_sections_position_unique deferred;
  update app.report_sections
    set position=array_position(p_section_order,section_kind)::smallint-1
    where user_id=actor and report_id=p_report_id;
  update app.report_sources set selected=entry_id=any(p_selected_entries) where user_id=actor and report_id=p_report_id;
  update app.report_media_selections set selected=attachment_id=any(p_selected_attachments),presentation_role='gallery' where user_id=actor and report_id=p_report_id;
  update app.report_media_selections set position=array_position(p_selected_attachments,attachment_id)::smallint-1 where user_id=actor and report_id=p_report_id and attachment_id=any(p_selected_attachments);
  update app.report_media_selections set presentation_role='cover' where user_id=actor and report_id=p_report_id and attachment_id=p_cover_attachment_id;
  perform app.attach_report_insight(p_report_id,p_insight_id);
end $$;
alter function app.update_report(uuid,text,text,text,text[],text[],uuid[],uuid[],uuid,uuid) owner to odiina_owner_api;

create function app.attach_report_insight(p_report_id uuid,p_insight_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
declare actor uuid:=app.request_user_id();
begin
  if p_insight_id is null then
    update app.reports set generation_mode='factual',insight_id=null
      where user_id=actor and id=p_report_id and status<>'deleted';
    update app.report_sections set origin='factual',generated_text=''
      where user_id=actor and report_id=p_report_id and section_kind='key_moments';
    return;
  end if;
  if exists(select 1 from app.reports where user_id=actor and id=p_report_id and insight_id=p_insight_id and status<>'deleted') then return; end if;
  if not exists(select 1 from app.reports r join app.insights i on i.user_id=r.user_id and i.id=p_insight_id and i.range_start=r.period_start and i.range_end=r.period_end where r.user_id=actor and r.id=p_report_id and r.status<>'deleted' and i.status='ready') then
    raise exception using errcode='P0001',message='odiina_report_insight_invalid';
  end if;
  if not exists(select 1 from app.ai_settings where user_id=actor and master_enabled and insights_enabled) then
    raise exception using errcode='P0001',message='odiina_report_ai_consent_required';
  end if;
  update app.reports set generation_mode='ai_enhanced',insight_id=p_insight_id where user_id=actor and id=p_report_id;
  update app.report_sections s set visible=true,origin='ai',generated_text=left(i.summary,8000)
  from app.insights i where s.user_id=actor and s.report_id=p_report_id and s.section_kind='key_moments' and i.user_id=actor and i.id=p_insight_id;
end $$;
alter function app.attach_report_insight(uuid,uuid) owner to odiina_owner_api;

create function app.publish_report_share(p_report_id uuid,p_expires_at timestamptz,p_include_places boolean,p_client_request_id uuid)
returns table(share_id uuid,share_token text)
language plpgsql security definer set search_path=''
as $$
declare actor uuid:=app.request_user_id(); r app.reports%rowtype; created uuid; token text; existing uuid;
begin
  select artifact_id into existing from app.report_command_receipts where user_id=actor and command_kind='publish_report' and client_request_id=p_client_request_id;
  if existing is not null then raise exception using errcode='P0001',message='odiina_share_token_already_issued'; end if;
  select * into r from app.reports where user_id=actor and id=p_report_id and status in ('ready','stale');
  if r.id is null or p_expires_at<statement_timestamp()+interval '1 hour' or p_expires_at>statement_timestamp()+interval '30 days'
     or (select count(*) from app.report_shares where user_id=actor and revoked_at is null and expires_at>statement_timestamp())>=10 then
    raise exception using errcode='P0001',message='odiina_report_share_invalid';
  end if;
  token:=encode(extensions.gen_random_bytes(32),'hex');
  insert into app.report_shares(user_id,report_id,token_hash,token_prefix,title,report_type,period_start,period_end,include_places,expires_at)
  values(actor,r.id,extensions.digest(token,'sha256'),left(token,8),r.title,r.report_type,r.period_start,r.period_end,p_include_places,p_expires_at) returning id into created;
  insert into app.report_share_sections(user_id,share_id,position,section_kind,heading,content)
  select actor,created,0,'at_a_glance','At a glance',coalesce((select string_agg(replace(initcap(metric_key),'_',' ')||': '||metric_value,E'\n' order by metric_key) from app.report_metrics where user_id=actor and report_id=r.id),'No activity was included.')
  where exists(select 1 from app.report_sections where user_id=actor and report_id=r.id and section_kind='at_a_glance' and visible);
  insert into app.report_share_sections(user_id,share_id,position,section_kind,heading,content)
  select actor,created,1,'timeline','Timeline',coalesce(string_agg(occurred_local_date::text||case when body_excerpt<>'' then E' — '||left(body_excerpt,500) else '' end,E'\n\n' order by source_position),'No moments were included.') from app.report_sources where user_id=actor and report_id=r.id and selected and not source_unavailable
  having exists(select 1 from app.report_sections where user_id=actor and report_id=r.id and section_kind='timeline' and visible);
  insert into app.report_share_sections(user_id,share_id,position,section_kind,heading,content)
  select actor,created,2,'key_moments',heading,generated_text||coalesce(E'\n\nEvidence: '||(select string_agg('Moment '||(rs.source_position+1)::text,', ' order by rs.source_position) from app.insight_sources ins join app.report_sources rs on rs.user_id=ins.user_id and rs.report_id=r.id and rs.entry_id=ins.entry_id and rs.revision_id=ins.revision_id where ins.user_id=actor and ins.insight_id=r.insight_id),'') from app.report_sections where user_id=actor and report_id=r.id and section_kind='key_moments' and visible and generated_text<>'';
  if r.introduction<>'' and exists(select 1 from app.report_sections where user_id=actor and report_id=r.id and section_kind='cover' and visible) then insert into app.report_share_sections values(actor,created,3,'introduction','Introduction',r.introduction); end if;
  if r.closing_reflection<>'' and exists(select 1 from app.report_sections where user_id=actor and report_id=r.id and section_kind='reflection' and visible) then insert into app.report_share_sections values(actor,created,4,'reflection','Reflection',r.closing_reflection); end if;
  if p_include_places and exists(select 1 from app.report_sections where user_id=actor and report_id=r.id and section_kind='places' and visible) then
    insert into app.report_share_sections(user_id,share_id,position,section_kind,heading,content)
    select actor,created,5,'places','Places',string_agg(distinct place_label,E'\n') from app.report_sources where user_id=actor and report_id=r.id and selected and place_label is not null having count(place_label)>0;
  end if;
  insert into app.report_command_receipts values(actor,'publish_report',p_client_request_id,created,statement_timestamp());
  return query select created,token;
end $$;
alter function app.publish_report_share(uuid,timestamptz,boolean,uuid) owner to odiina_owner_api;

create function app.revoke_report_share(p_share_id uuid)
returns void language sql security definer set search_path=''
as $$ update app.report_shares set revoked_at=statement_timestamp(),revoke_reason='owner' where user_id=app.request_user_id() and id=p_share_id and revoked_at is null $$;
alter function app.revoke_report_share(uuid) owner to odiina_owner_api;

create function app.resolve_report_share(p_token text)
returns table(manifest jsonb)
language plpgsql stable security definer set search_path=''
as $$
declare selected app.report_shares%rowtype;
begin
  if char_length(p_token)<>64 then return; end if;
  select * into selected from app.report_shares where token_hash=extensions.digest(p_token,'sha256');
  if selected.id is null then return; end if;
  if selected.revoked_at is not null then return query select jsonb_build_object('state','revoked'); return; end if;
  if selected.expires_at<=statement_timestamp() then return query select jsonb_build_object('state','expired'); return; end if;
  return query select jsonb_build_object('state','active','title',selected.title,'reportType',selected.report_type,'periodStart',selected.period_start,'periodEnd',selected.period_end,
    'expiresAt',selected.expires_at,'sections',coalesce((select jsonb_agg(jsonb_build_object('kind',x.section_kind,'heading',x.heading,'content',x.content) order by x.position) from app.report_share_sections x where x.user_id=selected.user_id and x.share_id=selected.id),'[]'::jsonb));
end $$;
alter function app.resolve_report_share(text) owner to odiina_share_api;

create function app.record_report_export(p_report_id uuid,p_kind text)
returns table(export_id uuid)
language plpgsql security definer set search_path=''
as $$ declare actor uuid:=app.request_user_id(); created uuid;
begin
  if p_kind not in ('print_html','markdown') or not exists(select 1 from app.reports where user_id=actor and id=p_report_id and status<>'deleted') then raise exception using errcode='P0001',message='odiina_export_invalid'; end if;
  insert into app.report_exports(user_id,report_id,export_kind) values(actor,p_report_id,p_kind) returning id into created;
  return query select created;
end $$;
alter function app.record_report_export(uuid,text) owner to odiina_owner_api;

create function app.save_report_schedule(p_report_type text,p_local_time time,p_generation_mode text)
returns void language plpgsql security definer set search_path=''
as $$ declare actor uuid:=app.request_user_id(); tz text;
begin
  select iana_timezone into tz from app.user_preferences where user_id=actor;
  if p_report_type not in ('daily','weekly','monthly','yearly') or p_generation_mode not in ('factual','ai_enhanced') or tz is null then raise exception using errcode='P0001',message='odiina_schedule_invalid'; end if;
  insert into app.report_schedules(user_id,report_type,local_time,timezone,generation_mode,status,execution_enabled)
  values(actor,p_report_type,p_local_time,tz,p_generation_mode,'paused',false)
  on conflict(user_id,report_type) do update set local_time=excluded.local_time,timezone=excluded.timezone,generation_mode=excluded.generation_mode,status='paused',execution_enabled=false;
end $$;
alter function app.save_report_schedule(text,time,text) owner to odiina_owner_api;

create function app.mark_reports_source_changed()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  update app.reports r set status='stale',stale_at=coalesce(stale_at,statement_timestamp()) where r.user_id=new.user_id and r.status='ready' and exists(select 1 from app.report_sources s where s.user_id=r.user_id and s.report_id=r.id and s.entry_id=new.id);
  if new.lifecycle_state='trashed' then
    update app.report_sources set source_unavailable=true where user_id=new.user_id and entry_id=new.id;
    update app.report_exports ex set status='revoked',revoked_at=statement_timestamp() where ex.user_id=new.user_id and ex.status='ready' and exists(select 1 from app.report_sources s where s.user_id=ex.user_id and s.report_id=ex.report_id and s.entry_id=new.id);
    update app.report_shares sh set revoked_at=statement_timestamp(),revoke_reason='source_trashed' where sh.user_id=new.user_id and sh.revoked_at is null and exists(select 1 from app.report_sources s where s.user_id=sh.user_id and s.report_id=sh.report_id and s.entry_id=new.id);
  elsif old.lifecycle_state='trashed' and new.lifecycle_state='active' then update app.report_sources set source_unavailable=false where user_id=new.user_id and entry_id=new.id; end if;
  return null;
end $$;
alter function app.mark_reports_source_changed() owner to odiina_owner_api;
create trigger reports_entry_changed after update of current_revision_id,lifecycle_state on app.entries for each row execute function app.mark_reports_source_changed();

create function app.mark_reports_place_redacted()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if old.redacted_at is null and new.redacted_at is not null then
    update app.report_sources set place_label=null where user_id=new.user_id and entry_id=new.entry_id;
    update app.report_exports ex set status='revoked',revoked_at=statement_timestamp() where ex.user_id=new.user_id and ex.status='ready' and exists(select 1 from app.report_sources s where s.user_id=ex.user_id and s.report_id=ex.report_id and s.entry_id=new.entry_id);
    update app.reports r set status='stale',stale_at=coalesce(stale_at,statement_timestamp()) where r.user_id=new.user_id and r.status='ready' and exists(select 1 from app.report_sources s where s.user_id=r.user_id and s.report_id=r.id and s.entry_id=new.entry_id);
    update app.report_shares sh set revoked_at=statement_timestamp(),revoke_reason='place_redacted' where sh.user_id=new.user_id and sh.revoked_at is null and sh.include_places and exists(select 1 from app.report_sources s where s.user_id=sh.user_id and s.report_id=sh.report_id and s.entry_id=new.entry_id);
  end if; return null;
end $$;
alter function app.mark_reports_place_redacted() owner to odiina_owner_api;
create trigger reports_place_redacted after update of redacted_at on app.entry_revision_places for each row execute function app.mark_reports_place_redacted();

create function app.mark_reports_insight_changed()
returns trigger language plpgsql security definer set search_path=''
as $$ begin
  if new.status in ('stale','deleted') then
    update app.reports set status='stale',stale_at=coalesce(stale_at,statement_timestamp()) where user_id=new.user_id and insight_id=new.id and status='ready';
    if new.status='deleted' then
      update app.report_shares set revoked_at=statement_timestamp(),revoke_reason='ai_deleted' where user_id=new.user_id and revoked_at is null and report_id in(select id from app.reports where user_id=new.user_id and insight_id=new.id);
      update app.report_exports set status='revoked',revoked_at=statement_timestamp() where user_id=new.user_id and status='ready' and report_id in(select id from app.reports where user_id=new.user_id and insight_id=new.id);
    end if;
  end if; return null; end $$;
alter function app.mark_reports_insight_changed() owner to odiina_owner_api;
create trigger reports_insight_changed after update of status on app.insights for each row execute function app.mark_reports_insight_changed();

revoke all on table app.reports,app.report_sources,app.report_sections,app.report_metrics,app.report_media_selections,app.report_tags,app.report_exports,app.report_schedules,app.report_shares,app.report_share_sections,app.report_command_receipts from public,anon;
grant select on app.reports,app.report_sources,app.report_sections,app.report_metrics,app.report_media_selections,app.report_tags,app.report_exports,app.report_schedules,app.report_shares,app.report_share_sections to authenticated;
grant select,insert,update,delete on app.reports,app.report_sources,app.report_sections,app.report_metrics,app.report_media_selections,app.report_tags,app.report_exports,app.report_schedules,app.report_shares,app.report_share_sections,app.report_command_receipts to odiina_owner_api;
grant select on app.report_shares,app.report_share_sections to odiina_share_api;

revoke all on function app.report_period_valid(text,date,date,smallint),app.preview_factual_report(text,date,date,uuid[]),app.create_factual_report(text,date,date,text,uuid[],boolean,uuid),app.update_report(uuid,text,text,text,text[],text[],uuid[],uuid[],uuid,uuid),app.attach_report_insight(uuid,uuid),app.publish_report_share(uuid,timestamptz,boolean,uuid),app.revoke_report_share(uuid),app.resolve_report_share(text),app.record_report_export(uuid,text),app.save_report_schedule(text,time,text),app.mark_reports_source_changed(),app.mark_reports_place_redacted(),app.mark_reports_insight_changed() from public,anon,authenticated;
grant execute on function app.preview_factual_report(text,date,date,uuid[]),app.create_factual_report(text,date,date,text,uuid[],boolean,uuid),app.update_report(uuid,text,text,text,text[],text[],uuid[],uuid[],uuid,uuid),app.publish_report_share(uuid,timestamptz,boolean,uuid),app.revoke_report_share(uuid),app.record_report_export(uuid,text),app.save_report_schedule(text,time,text) to authenticated;
grant execute on function app.resolve_report_share(text) to anon,authenticated;
grant usage on schema app to anon;
grant execute on function app.report_period_valid(text,date,date,smallint) to odiina_owner_api;

comment on table app.reports is 'Private curated recap snapshots. Factual reports never require AI.';
comment on table app.report_shares is 'Text-only immutable public manifests authorized by a hashed expiring opaque token. Private report URLs are never shares.';
comment on table app.report_schedules is 'User intent only; execution is forced disabled until a durable scheduler is deployed.';

revoke create on schema app from odiina_owner_api,odiina_share_api;

commit;
