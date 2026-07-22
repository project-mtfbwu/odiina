\set ON_ERROR_STOP on
\timing on

begin;
set local session_replication_role = replica;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('91111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','perf-owner@example.test','',now(),'','','','',
   '{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('92222222-2222-4222-8222-222222222222','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','perf-isolated@example.test','',now(),'','','','',
   '{"provider":"email","providers":["email"]}','{}',now(),now());

insert into app.profiles (user_id, display_name, handle, handle_normalized) values
  ('91111111-1111-4111-8111-111111111111','Performance Owner','perf_owner','perf_owner'),
  ('92222222-2222-4222-8222-222222222222','Isolated Owner','isolated_owner','isolated_owner');

insert into app.entries (
  id, user_id, lifecycle_state, created_at, updated_at, finalized_at,
  trashed_at, purge_after
)
select md5('perf-entry-' || g)::uuid,
  '91111111-1111-4111-8111-111111111111'::uuid,
  case when g % 20 = 0 then 'trashed' else 'active' end,
  '2026-07-22 12:00:00+00'::timestamptz - make_interval(mins => g),
  '2026-07-22 12:00:00+00'::timestamptz,
  '2026-07-22 12:00:00+00'::timestamptz,
  case when g % 20 = 0 then '2026-07-22 12:00:00+00'::timestamptz end,
  case when g % 20 = 0 then '2026-08-21 12:00:00+00'::timestamptz end
from generate_series(1, 1000) g;

insert into app.entry_revisions (
  id, user_id, entry_id, revision_number, body_text, occurred_at,
  occurred_timezone, occurred_local_date, occurred_utc_offset_minutes,
  change_reason, created_at
)
select md5('perf-revision-1-' || g)::uuid,
  '91111111-1111-4111-8111-111111111111'::uuid,
  md5('perf-entry-' || g)::uuid, 1,
  case when g % 17 = 0
    then 'Synthetic aurora guitar recall item ' || g
    else 'Synthetic private fixture entry ' || g end,
  '2026-07-22 06:30:00+00'::timestamptz - make_interval(hours => g),
  'Asia/Kolkata',
  ('2026-07-22'::date - (g % 180)), 330, 'created',
  '2026-07-22 12:00:00+00'::timestamptz - make_interval(mins => g)
from generate_series(1, 1000) g;

insert into app.entry_revisions (
  id, user_id, entry_id, revision_number, body_text, occurred_at,
  occurred_timezone, occurred_local_date, occurred_utc_offset_minutes,
  change_reason, created_at
)
select md5('perf-revision-2-' || g)::uuid,
  '91111111-1111-4111-8111-111111111111'::uuid,
  md5('perf-entry-' || g)::uuid, 2,
  case when g % 17 = 0
    then 'Synthetic current aurora revision item ' || g
    else 'Synthetic revised private fixture entry ' || g end,
  '2026-07-22 06:30:00+00'::timestamptz - make_interval(hours => g),
  'Asia/Kolkata',
  ('2026-07-22'::date - (g % 180)), 330, 'edited',
  '2026-07-22 12:00:00+00'::timestamptz - make_interval(mins => g - 1)
from generate_series(5, 1000, 5) g;

update app.entries e set current_revision_id =
  case when n.g % 5 = 0
    then md5('perf-revision-2-' || n.g)::uuid
    else md5('perf-revision-1-' || n.g)::uuid end
from generate_series(1, 1000) n(g)
where e.user_id = '91111111-1111-4111-8111-111111111111'
  and e.id = md5('perf-entry-' || n.g)::uuid;

insert into app.user_tags (user_id, id, display_name, normalized_name, last_used_at)
select '91111111-1111-4111-8111-111111111111'::uuid,
  md5('perf-tag-' || g)::uuid, 'Fixture Tag ' || g, 'fixture tag ' || g,
  '2026-07-22 12:00:00+00'::timestamptz - make_interval(mins => g)
from generate_series(1, 21) g;

insert into app.entry_revision_tags (
  user_id, entry_id, revision_id, tag_id, tag_position
)
select '91111111-1111-4111-8111-111111111111'::uuid,
  md5('perf-entry-' || g)::uuid,
  case when g % 5 = 0 then md5('perf-revision-2-' || g)::uuid
    else md5('perf-revision-1-' || g)::uuid end,
  md5('perf-tag-' || (((g - 1) % 20) + 1))::uuid, 0
from generate_series(1, 1000) g
union all
select '91111111-1111-4111-8111-111111111111'::uuid,
  md5('perf-entry-' || g)::uuid,
  case when g % 5 = 0 then md5('perf-revision-2-' || g)::uuid
    else md5('perf-revision-1-' || g)::uuid end,
  md5('perf-tag-' || (((g + 4) % 20) + 1))::uuid, 1
from generate_series(1, 1000) g;

insert into app.entry_revision_tags (
  user_id, entry_id, revision_id, tag_id, tag_position
) values (
  '91111111-1111-4111-8111-111111111111', md5('perf-entry-1')::uuid,
  md5('perf-revision-1-1')::uuid, md5('perf-tag-21')::uuid, 2
);

insert into app.entry_revision_places (
  user_id, entry_id, revision_id, place_name, place_area, precision, source
)
select '91111111-1111-4111-8111-111111111111'::uuid,
  md5('perf-entry-' || g)::uuid,
  case when g % 5 = 0 then md5('perf-revision-2-' || g)::uuid
    else md5('perf-revision-1-' || g)::uuid end,
  'Fixture Place ' || g, 'Fixture District', 'label_only', 'manual'
from generate_series(10, 1000, 10) g;

insert into app.attachments (
  id, user_id, entry_id, media_kind, state, expected_byte_count, accepted_at
)
select md5('perf-attachment-' || g)::uuid,
  '91111111-1111-4111-8111-111111111111'::uuid,
  md5('perf-entry-' || g)::uuid,
  case g % 3 when 0 then 'image' when 1 then 'audio' else 'video' end,
  'accepted', 1024, '2026-07-22 12:00:00+00'::timestamptz
from generate_series(9, 999, 9) g;

insert into app.entry_revision_attachments (
  user_id, entry_id, revision_id, attachment_id, position
)
select '91111111-1111-4111-8111-111111111111'::uuid,
  md5('perf-entry-' || g)::uuid,
  case when g % 5 = 0 then md5('perf-revision-2-' || g)::uuid
    else md5('perf-revision-1-' || g)::uuid end,
  md5('perf-attachment-' || g)::uuid, 1
from generate_series(9, 999, 9) g;

insert into app.entry_search_documents (
  user_id, entry_id, revision_id, lifecycle_state, occurred_at,
  occurred_local_date, body_text, place_name, place_details, tag_text,
  tag_normalized_names, normalized_document, search_vector, has_text,
  has_image, has_audio, has_video, has_place
)
select e.user_id, e.id, r.id, e.lifecycle_state, r.occurred_at,
  r.occurred_local_date, r.body_text,
  coalesce(p.place_name, ''), coalesce(p.place_area, ''), tags.tag_text,
  tags.normalized_names,
  lower(pg_catalog.normalize(concat_ws(' ', r.body_text, p.place_name, p.place_area,
    tags.tag_text), 'NFKC')),
  setweight(to_tsvector('simple', tags.tag_text), 'A') ||
    setweight(to_tsvector('simple', r.body_text), 'B') ||
    setweight(to_tsvector('simple', coalesce(p.place_name, '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(p.place_area, '')), 'D'),
  true,
  coalesce(media.media_kind = 'image', false),
  coalesce(media.media_kind = 'audio', false),
  coalesce(media.media_kind = 'video', false),
  p.revision_id is not null
from app.entries e
join app.entry_revisions r on r.user_id = e.user_id and r.entry_id = e.id
  and r.id = e.current_revision_id
join lateral (
  select string_agg(t.display_name, ' ' order by rt.tag_position) tag_text,
    array_agg(t.normalized_name order by rt.tag_position) normalized_names
  from app.entry_revision_tags rt
  join app.user_tags t on t.user_id = rt.user_id and t.id = rt.tag_id
  where rt.user_id = e.user_id and rt.entry_id = e.id
    and rt.revision_id = e.current_revision_id
) tags on true
left join app.entry_revision_places p on p.user_id = e.user_id
  and p.entry_id = e.id and p.revision_id = e.current_revision_id
left join lateral (
  select a.media_kind from app.entry_revision_attachments ra
  join app.attachments a on a.user_id = ra.user_id and a.id = ra.attachment_id
  where ra.user_id = e.user_id and ra.entry_id = e.id
    and ra.revision_id = e.current_revision_id and a.state = 'accepted'
  limit 1
) media on true
where e.user_id = '91111111-1111-4111-8111-111111111111';

insert into app.entries (id, user_id)
select md5('isolated-entry-' || g)::uuid,
  '92222222-2222-4222-8222-222222222222'::uuid
from generate_series(1, 100) g;
insert into app.entry_revisions (
  id, user_id, entry_id, revision_number, body_text, occurred_at,
  occurred_timezone, occurred_local_date, occurred_utc_offset_minutes,
  change_reason
)
select md5('isolated-revision-' || g)::uuid,
  '92222222-2222-4222-8222-222222222222'::uuid,
  md5('isolated-entry-' || g)::uuid, 1,
  'Synthetic aurora isolated owner item ' || g,
  '2026-07-22 06:30:00+00'::timestamptz - make_interval(hours => g),
  'Asia/Kolkata', ('2026-07-22'::date - (g % 30)), 330, 'created'
from generate_series(1, 100) g;
update app.entries e set current_revision_id = md5('isolated-revision-' || g)::uuid
from generate_series(1, 100) g
where e.user_id = '92222222-2222-4222-8222-222222222222'
  and e.id = md5('isolated-entry-' || g)::uuid;
insert into app.entry_search_documents (
  user_id, entry_id, revision_id, lifecycle_state, occurred_at,
  occurred_local_date, body_text, normalized_document, search_vector,
  has_text, has_image, has_audio, has_video, has_place
)
select e.user_id, e.id, r.id, 'active', r.occurred_at,
  r.occurred_local_date, r.body_text, lower(r.body_text),
  setweight(to_tsvector('simple', r.body_text), 'B'), true, false, false, false, false
from app.entries e
join app.entry_revisions r on r.user_id = e.user_id and r.entry_id = e.id
  and r.id = e.current_revision_id
where e.user_id = '92222222-2222-4222-8222-222222222222';

set local session_replication_role = origin;
analyze app.entry_search_documents;
analyze app.entry_revision_tags;
analyze app.user_tags;

do $$
begin
  if (select count(*) from app.entries
      where user_id = '91111111-1111-4111-8111-111111111111') <> 1000 then
    raise exception 'performance fixture owner Entry count mismatch';
  end if;
  if (select count(*) from app.entry_revisions
      where user_id = '91111111-1111-4111-8111-111111111111') <> 1200 then
    raise exception 'performance fixture revision count mismatch';
  end if;
  if (select count(*) from app.entries
      where user_id = '92222222-2222-4222-8222-222222222222') <> 100 then
    raise exception 'performance fixture isolation count mismatch';
  end if;
end
$$;

select set_config('request.jwt.claims',
  '{"sub":"91111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true);
set local role authenticated;

\echo 'TEXT INDEX PLAN'
explain (analyze, buffers)
select entry_id from app.entry_search_documents
where user_id = app.request_user_id() and lifecycle_state = 'active'
  and search_vector @@ websearch_to_tsquery('simple', 'aurora 85')
order by occurred_at desc, entry_id desc limit 20;

\echo 'TAG INDEX PLAN'
explain (analyze, buffers)
select entry_id from app.entry_search_documents
where user_id = app.request_user_id() and lifecycle_state = 'active'
  and tag_normalized_names @> array['fixture tag 21']
order by occurred_at desc, entry_id desc limit 20;

\echo 'OCCURRENCE INDEX PLAN'
explain (analyze, buffers)
select entry_id from app.entry_search_documents
where user_id = app.request_user_id() and lifecycle_state = 'active'
  and occurred_local_date between '2026-06-01' and '2026-06-30'
order by occurred_local_date, entry_id limit 20;

create temporary table perf_page_one as
select * from app.search_entries(
  'aurora', null, null, array[]::text[], array[]::text[], false, false,
  'relevance', null, null, null, 20
);
create temporary table perf_cursor as
select result_rank, occurred_at, entry_id from perf_page_one
order by result_rank desc, occurred_at desc, entry_id desc offset 19 limit 1;
create temporary table perf_page_two as
select * from app.search_entries(
  'aurora', null, null, array[]::text[], array[]::text[], false, false,
  'relevance', (select result_rank from perf_cursor),
  (select occurred_at from perf_cursor), (select entry_id from perf_cursor), 20
);

do $$
begin
  if (select count(*) from perf_page_one) > 20
    or (select count(*) from perf_page_two) > 20 then
    raise exception 'search payload exceeded the page bound';
  end if;
  if exists (select entry_id from perf_page_one intersect
             select entry_id from perf_page_two) then
    raise exception 'cursor pages contain a duplicate';
  end if;
  if exists (
    select 1 from perf_page_one p join app.entries e on e.id = p.entry_id
    where e.user_id <> '91111111-1111-4111-8111-111111111111'
  ) then
    raise exception 'cross-user search row returned';
  end if;
  if (select coalesce(sum(octet_length(row_to_json(p)::text)),0)
      from perf_page_one p) > 65536 then
    raise exception 'bounded page payload exceeded 64 KiB';
  end if;
end
$$;

select count(*) as first_page_rows,
  coalesce(sum(octet_length(row_to_json(p)::text)),0) as first_page_bytes
from perf_page_one p;
select count(*) as second_page_rows from perf_page_two;
select count(*) as owner_tag_suggestions
from app.tag_suggestions('fixture', 12);

reset role;
rollback;
