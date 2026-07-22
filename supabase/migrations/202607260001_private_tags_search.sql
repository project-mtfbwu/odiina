create extension if not exists pg_trgm with schema extensions;

grant odiina_owner_api to postgres;
grant create on schema app to odiina_owner_api;

create table app.user_tags (
  user_id uuid not null references app.profiles(user_id) on delete cascade,
  id uuid not null default extensions.gen_random_uuid(),
  display_name text not null,
  normalized_name text not null,
  created_at timestamptz not null default statement_timestamp(),
  last_used_at timestamptz not null default statement_timestamp(),
  primary key (user_id, id),
  unique (user_id, normalized_name),
  constraint user_tags_display_valid check (
    char_length(display_name) between 1 and 40
    and display_name = btrim(display_name)
    and display_name !~ '[[:cntrl:]]'
  ),
  constraint user_tags_normalized_valid check (
    char_length(normalized_name) between 1 and 40
    and normalized_name = lower(normalized_name)
    and normalized_name = btrim(normalized_name)
    and normalized_name !~ '[[:cntrl:]]'
  )
);

create table app.entry_revision_tags (
  user_id uuid not null,
  entry_id uuid not null,
  revision_id uuid not null,
  tag_id uuid not null,
  tag_position smallint not null,
  created_at timestamptz not null default statement_timestamp(),
  primary key (user_id, entry_id, revision_id, tag_id),
  unique (user_id, entry_id, revision_id, tag_position),
  constraint entry_revision_tags_revision_fk
    foreign key (user_id, entry_id, revision_id)
    references app.entry_revisions(user_id, entry_id, id)
    on delete restrict,
  constraint entry_revision_tags_catalog_fk
    foreign key (user_id, tag_id)
    references app.user_tags(user_id, id)
    on delete restrict,
  constraint entry_revision_tags_position_valid check (tag_position between 0 and 9)
);

create index entry_revision_tags_tag_idx
  on app.entry_revision_tags (user_id, tag_id, revision_id);
create index user_tags_recent_idx
  on app.user_tags (user_id, last_used_at desc, normalized_name);

alter table app.user_tags enable row level security;
alter table app.user_tags force row level security;
alter table app.entry_revision_tags enable row level security;
alter table app.entry_revision_tags force row level security;

create policy user_tags_owner_read on app.user_tags
  for select to authenticated
  using (user_id = (select app.request_user_id()));
create policy user_tags_owner_api on app.user_tags
  for all to odiina_owner_api
  using (user_id = (select app.request_user_id()))
  with check (user_id = (select app.request_user_id()));
create policy entry_revision_tags_owner_read on app.entry_revision_tags
  for select to authenticated
  using (user_id = (select app.request_user_id()));
create policy entry_revision_tags_owner_api on app.entry_revision_tags
  for all to odiina_owner_api
  using (user_id = (select app.request_user_id()))
  with check (user_id = (select app.request_user_id()));

grant select on app.user_tags, app.entry_revision_tags to authenticated;
grant select, insert, update on app.user_tags to odiina_owner_api;
grant select, insert, delete on app.entry_revision_tags to odiina_owner_api;

create function app.normalize_tag_label(p_value text)
returns table (display_name text, normalized_name text)
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  cleaned text;
begin
  if p_value is null then
    raise exception using errcode = 'P0001', message = 'odiina_tag_invalid';
  end if;
  cleaned := pg_catalog.regexp_replace(
    pg_catalog.btrim(pg_catalog.normalize(p_value, 'NFKC')),
    '[[:space:]]+', ' ', 'g'
  );
  if char_length(cleaned) not between 1 and 40 or cleaned ~ '[[:cntrl:]]' then
    raise exception using errcode = 'P0001', message = 'odiina_tag_invalid';
  end if;
  return query select cleaned, pg_catalog.lower(cleaned);
end
$$;

create function app.insert_revision_tags(
  p_entry_id uuid, p_revision_id uuid, p_tags text[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor uuid := app.request_user_id();
  raw_tag text;
  cleaned record;
  selected_tag_id uuid;
  position integer := 0;
  seen text[] := array[]::text[];
begin
  if coalesce(cardinality(p_tags), 0) > 10 then
    raise exception using errcode = 'P0001', message = 'odiina_tag_limit';
  end if;
  foreach raw_tag in array coalesce(p_tags, array[]::text[]) loop
    select * into cleaned from app.normalize_tag_label(raw_tag);
    if cleaned.normalized_name = any(seen) then
      raise exception using errcode = 'P0001', message = 'odiina_tag_duplicate';
    end if;
    seen := array_append(seen, cleaned.normalized_name);
    insert into app.user_tags (
      user_id, display_name, normalized_name, last_used_at
    ) values (
      actor, cleaned.display_name, cleaned.normalized_name, statement_timestamp()
    )
    on conflict (user_id, normalized_name) do update
      set last_used_at = excluded.last_used_at
    returning id into selected_tag_id;
    insert into app.entry_revision_tags (
      user_id, entry_id, revision_id, tag_id, tag_position
    ) values (
      actor, p_entry_id, p_revision_id, selected_tag_id, position
    );
    position := position + 1;
  end loop;
end
$$;

create table app.entry_search_documents (
  user_id uuid not null,
  entry_id uuid not null,
  revision_id uuid not null,
  lifecycle_state text not null,
  occurred_at timestamptz not null,
  occurred_local_date date not null,
  body_text text not null,
  place_name text not null default '',
  place_details text not null default '',
  tag_text text not null default '',
  tag_normalized_names text[] not null default array[]::text[],
  normalized_document text not null,
  search_vector tsvector not null,
  has_text boolean not null,
  has_image boolean not null,
  has_audio boolean not null,
  has_video boolean not null,
  has_place boolean not null,
  updated_at timestamptz not null default statement_timestamp(),
  primary key (user_id, entry_id),
  unique (user_id, entry_id, revision_id),
  constraint entry_search_documents_current_fk
    foreign key (user_id, entry_id, revision_id)
    references app.entry_revisions(user_id, entry_id, id)
    on delete restrict,
  constraint entry_search_documents_state_valid
    check (lifecycle_state in ('active', 'trashed'))
);

create index entry_search_documents_vector_idx
  on app.entry_search_documents using gin (search_vector);
create index entry_search_documents_trigram_idx
  on app.entry_search_documents using gin
  (normalized_document extensions.gin_trgm_ops);
create index entry_search_documents_tags_idx
  on app.entry_search_documents using gin (tag_normalized_names);
create index entry_search_documents_occurrence_idx
  on app.entry_search_documents
  (user_id, lifecycle_state, occurred_at desc, entry_id desc);
create index entry_search_documents_local_date_idx
  on app.entry_search_documents
  (user_id, lifecycle_state, occurred_local_date, entry_id);

alter table app.entry_search_documents enable row level security;
alter table app.entry_search_documents force row level security;
create policy entry_search_documents_owner_read on app.entry_search_documents
  for select to authenticated
  using (user_id = (select app.request_user_id()));
create policy entry_search_documents_owner_api on app.entry_search_documents
  for all to odiina_owner_api
  using (user_id = (select app.request_user_id()))
  with check (user_id = (select app.request_user_id()));
grant select on app.entry_search_documents to authenticated;
grant select, insert, update, delete on app.entry_search_documents to odiina_owner_api;

create function app.refresh_entry_search_document(
  p_owner_id uuid, p_entry_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := app.request_user_id();
  snapshot record;
  normalized text;
begin
  if actor is null or actor <> p_owner_id then
    raise exception using errcode = 'P0001', message = 'odiina_owner_required';
  end if;

  select e.user_id, e.id as entry_id, e.current_revision_id as revision_id,
    e.lifecycle_state, r.occurred_at, r.occurred_local_date, r.body_text,
    coalesce(p.place_name, '') as place_name,
    concat_ws(' ', p.place_area, p.place_address) as place_details,
    coalesce(tags.tag_text, '') as tag_text,
    coalesce(tags.normalized_names, array[]::text[]) as normalized_names,
    btrim(r.body_text) <> '' as has_text,
    coalesce(media.has_image, false) as has_image,
    coalesce(media.has_audio, false) as has_audio,
    coalesce(media.has_video, false) as has_video,
    p.revision_id is not null and p.redacted_at is null as has_place
  into snapshot
  from app.entries e
  join app.entry_revisions r
    on r.user_id = e.user_id and r.entry_id = e.id
   and r.id = e.current_revision_id
  left join app.entry_revision_places p
    on p.user_id = e.user_id and p.entry_id = e.id
   and p.revision_id = e.current_revision_id and p.redacted_at is null
  left join lateral (
    select string_agg(t.display_name, ' ' order by rt.tag_position) as tag_text,
      array_agg(t.normalized_name order by rt.tag_position) as normalized_names
    from app.entry_revision_tags rt
    join app.user_tags t on t.user_id = rt.user_id and t.id = rt.tag_id
    where rt.user_id = e.user_id and rt.entry_id = e.id
      and rt.revision_id = e.current_revision_id
  ) tags on true
  left join lateral (
    select bool_or(a.media_kind = 'image') as has_image,
      bool_or(a.media_kind = 'audio') as has_audio,
      bool_or(a.media_kind = 'video') as has_video
    from app.entry_revision_attachments ra
    join app.attachments a on a.user_id = ra.user_id and a.id = ra.attachment_id
    where ra.user_id = e.user_id and ra.entry_id = e.id
      and ra.revision_id = e.current_revision_id and a.state = 'accepted'
  ) media on true
  where e.user_id = p_owner_id and e.id = p_entry_id;

  if not found then
    delete from app.entry_search_documents
    where user_id = p_owner_id and entry_id = p_entry_id;
    return;
  end if;

  normalized := pg_catalog.lower(pg_catalog.normalize(
    concat_ws(' ', snapshot.body_text, snapshot.place_name,
      snapshot.place_details, snapshot.tag_text), 'NFKC'
  ));

  insert into app.entry_search_documents (
    user_id, entry_id, revision_id, lifecycle_state, occurred_at,
    occurred_local_date, body_text, place_name, place_details, tag_text,
    tag_normalized_names, normalized_document, search_vector, has_text,
    has_image, has_audio, has_video, has_place, updated_at
  ) values (
    snapshot.user_id, snapshot.entry_id, snapshot.revision_id,
    snapshot.lifecycle_state, snapshot.occurred_at, snapshot.occurred_local_date,
    snapshot.body_text, snapshot.place_name, snapshot.place_details,
    snapshot.tag_text, snapshot.normalized_names, normalized,
    setweight(to_tsvector('simple', snapshot.tag_text), 'A') ||
      setweight(to_tsvector('simple', snapshot.body_text), 'B') ||
      setweight(to_tsvector('simple', snapshot.place_name), 'C') ||
      setweight(to_tsvector('simple', snapshot.place_details), 'D'),
    snapshot.has_text, snapshot.has_image, snapshot.has_audio,
    snapshot.has_video, snapshot.has_place, statement_timestamp()
  )
  on conflict (user_id, entry_id) do update set
    revision_id = excluded.revision_id,
    lifecycle_state = excluded.lifecycle_state,
    occurred_at = excluded.occurred_at,
    occurred_local_date = excluded.occurred_local_date,
    body_text = excluded.body_text,
    place_name = excluded.place_name,
    place_details = excluded.place_details,
    tag_text = excluded.tag_text,
    tag_normalized_names = excluded.tag_normalized_names,
    normalized_document = excluded.normalized_document,
    search_vector = excluded.search_vector,
    has_text = excluded.has_text,
    has_image = excluded.has_image,
    has_audio = excluded.has_audio,
    has_video = excluded.has_video,
    has_place = excluded.has_place,
    updated_at = excluded.updated_at;
end
$$;

alter function app.refresh_entry_search_document(uuid, uuid) owner to odiina_owner_api;

create function app.refresh_entry_search_from_entry()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.current_revision_id is not null then
    perform app.refresh_entry_search_document(new.user_id, new.id);
  end if;
  return new;
end
$$;
alter function app.refresh_entry_search_from_entry() owner to odiina_owner_api;
create trigger entries_refresh_search
after insert or update of current_revision_id, lifecycle_state on app.entries
for each row execute function app.refresh_entry_search_from_entry();

create function app.refresh_entry_search_from_revision_child()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  target_user_id uuid;
  target_entry_id uuid;
begin
  if tg_op = 'DELETE' then
    target_user_id := old.user_id;
    target_entry_id := old.entry_id;
  else
    target_user_id := new.user_id;
    target_entry_id := new.entry_id;
  end if;
  perform app.refresh_entry_search_document(target_user_id, target_entry_id);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;
alter function app.refresh_entry_search_from_revision_child() owner to odiina_owner_api;
create trigger entry_revision_tags_refresh_search
after insert or delete on app.entry_revision_tags
for each row execute function app.refresh_entry_search_from_revision_child();
create trigger entry_revision_places_refresh_search
after insert or update or delete on app.entry_revision_places
for each row execute function app.refresh_entry_search_from_revision_child();
create trigger entry_revision_attachments_refresh_search
after insert or delete on app.entry_revision_attachments
for each row execute function app.refresh_entry_search_from_revision_child();

create function app.refresh_entry_search_from_attachment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  linked record;
begin
  if new.state is distinct from old.state then
    for linked in
      select e.user_id, e.id as entry_id
      from app.entry_revision_attachments ra
      join app.entries e on e.user_id = ra.user_id and e.id = ra.entry_id
        and e.current_revision_id = ra.revision_id
      where ra.user_id = new.user_id and ra.attachment_id = new.id
    loop
      perform app.refresh_entry_search_document(linked.user_id, linked.entry_id);
    end loop;
  end if;
  return new;
end
$$;
alter function app.refresh_entry_search_from_attachment() owner to odiina_owner_api;
create trigger attachments_refresh_search
after update of state on app.attachments
for each row execute function app.refresh_entry_search_from_attachment();

create function app.create_entry_tagged(
  p_client_request_id uuid, p_body_text text, p_tags text[], p_place jsonb,
  p_occurred_at timestamptz, p_occurred_timezone text,
  p_occurred_local_date date, p_occurred_utc_offset_minutes smallint
)
returns table (entry_id uuid, revision_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  created_entry_id uuid;
  created_revision_id uuid;
begin
  if p_place is null then
    select result.entry_id, result.revision_id
      into created_entry_id, created_revision_id
    from app.create_entry(p_client_request_id, p_body_text, p_occurred_at,
      p_occurred_timezone, p_occurred_local_date,
      p_occurred_utc_offset_minutes) result;
  else
    select result.entry_id, result.revision_id
      into created_entry_id, created_revision_id
    from app.create_entry_place(p_client_request_id, p_body_text, p_place,
      p_occurred_at, p_occurred_timezone, p_occurred_local_date,
      p_occurred_utc_offset_minutes) result;
  end if;
  if not exists (
    select 1 from app.entry_revision_tags t
    where t.user_id = app.request_user_id()
      and t.entry_id = created_entry_id
      and t.revision_id = created_revision_id
  ) then
    perform app.insert_revision_tags(
      created_entry_id, created_revision_id, p_tags
    );
  end if;
  perform app.refresh_entry_search_document(
    app.request_user_id(), created_entry_id
  );
  entry_id := created_entry_id;
  revision_id := created_revision_id;
  return next;
end
$$;
alter function app.create_entry_tagged(uuid,text,text[],jsonb,timestamptz,text,date,smallint)
  owner to odiina_owner_api;

create function app.activate_media_entry_tagged(
  p_client_request_id uuid, p_entry_id uuid, p_body_text text,
  p_attachment_ids uuid[], p_tags text[], p_place jsonb,
  p_occurred_at timestamptz, p_occurred_timezone text,
  p_occurred_local_date date, p_occurred_utc_offset_minutes smallint
)
returns table (entry_id uuid, revision_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  created_entry_id uuid;
  created_revision_id uuid;
begin
  if p_place is null then
    select result.entry_id, result.revision_id
      into created_entry_id, created_revision_id
    from app.activate_media_entry(p_client_request_id, p_entry_id, p_body_text,
      p_attachment_ids, p_occurred_at, p_occurred_timezone,
      p_occurred_local_date, p_occurred_utc_offset_minutes) result;
  else
    select result.entry_id, result.revision_id
      into created_entry_id, created_revision_id
    from app.activate_media_entry_place(p_client_request_id, p_entry_id,
      p_body_text, p_attachment_ids, p_place, p_occurred_at,
      p_occurred_timezone, p_occurred_local_date,
      p_occurred_utc_offset_minutes) result;
  end if;
  if not exists (
    select 1 from app.entry_revision_tags t
    where t.user_id = app.request_user_id()
      and t.entry_id = created_entry_id
      and t.revision_id = created_revision_id
  ) then
    perform app.insert_revision_tags(
      created_entry_id, created_revision_id, p_tags
    );
  end if;
  perform app.refresh_entry_search_document(
    app.request_user_id(), created_entry_id
  );
  entry_id := created_entry_id;
  revision_id := created_revision_id;
  return next;
end
$$;
alter function app.activate_media_entry_tagged(uuid,uuid,text,uuid[],text[],jsonb,timestamptz,text,date,smallint)
  owner to odiina_owner_api;

create function app.revise_entry_tagged(
  p_entry_id uuid, p_expected_current_revision_id uuid, p_body_text text,
  p_attachment_ids uuid[], p_tags text[], p_place jsonb,
  p_occurred_at timestamptz, p_occurred_timezone text,
  p_occurred_local_date date, p_occurred_utc_offset_minutes smallint,
  p_change_reason text
)
returns table (entry_id uuid, revision_id uuid)
language plpgsql security definer set search_path = '' as $$
begin
  select result.entry_id, result.revision_id into entry_id, revision_id
  from app.revise_entry_place(p_entry_id, p_expected_current_revision_id,
    p_body_text, p_attachment_ids, p_place, p_occurred_at,
    p_occurred_timezone, p_occurred_local_date,
    p_occurred_utc_offset_minutes, p_change_reason) result;
  perform app.insert_revision_tags(entry_id, revision_id, p_tags);
  perform app.refresh_entry_search_document(app.request_user_id(), entry_id);
  return next;
end
$$;
alter function app.revise_entry_tagged(uuid,uuid,text,uuid[],text[],jsonb,timestamptz,text,date,smallint,text)
  owner to odiina_owner_api;

create function app.revision_tags(p_revision_ids uuid[])
returns table (
  revision_id uuid, tag_id uuid, display_name text,
  normalized_name text, tag_position smallint
)
language sql stable security invoker set search_path = '' as $$
  select rt.revision_id, t.id, t.display_name, t.normalized_name,
    rt.tag_position
  from app.entry_revision_tags rt
  join app.user_tags t on t.user_id = rt.user_id and t.id = rt.tag_id
  where rt.user_id = app.request_user_id()
    and rt.revision_id = any(coalesce(p_revision_ids, array[]::uuid[]))
  order by rt.revision_id, rt.tag_position
$$;

create function app.tag_suggestions(p_prefix text, p_limit integer)
returns table (
  tag_id uuid, display_name text, normalized_name text, active_usage bigint
)
language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := app.request_user_id();
  normalized_prefix text := '';
begin
  if p_limit is null or p_limit not between 1 and 20
    or p_prefix is null or char_length(p_prefix) > 40 then
    raise exception using errcode = 'P0001', message = 'odiina_tag_query_invalid';
  end if;
  if btrim(p_prefix) <> '' then
    select n.normalized_name into normalized_prefix
    from app.normalize_tag_label(p_prefix) n;
  end if;
  return query
  select t.id, t.display_name, t.normalized_name,
    count(distinct e.id) filter (where e.lifecycle_state = 'active') as active_usage
  from app.user_tags t
  left join app.entry_revision_tags rt
    on rt.user_id = t.user_id and rt.tag_id = t.id
  left join app.entries e
    on e.user_id = rt.user_id and e.id = rt.entry_id
   and e.current_revision_id = rt.revision_id
  where t.user_id = actor
    and (normalized_prefix = '' or t.normalized_name like normalized_prefix || '%')
  group by t.user_id, t.id, t.display_name, t.normalized_name, t.last_used_at
  order by active_usage desc, t.last_used_at desc, t.normalized_name
  limit p_limit;
end
$$;
alter function app.tag_suggestions(text,integer) owner to odiina_owner_api;

create function app.search_entries(
  p_query text, p_from date, p_to date, p_tag_names text[],
  p_media text[], p_has_place boolean, p_include_trash boolean,
  p_sort text, p_cursor_rank real, p_cursor_occurred_at timestamptz,
  p_cursor_entry_id uuid, p_limit integer
)
returns table (
  entry_id uuid, current_revision_id uuid, body_text text,
  revision_number integer, occurred_at timestamptz, occurred_timezone text,
  occurred_local_date date, created_at timestamptz, updated_at timestamptz,
  lifecycle_state text, trashed_at timestamptz, result_rank real
)
language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := app.request_user_id();
  normalized_query text := pg_catalog.lower(pg_catalog.normalize(
    pg_catalog.btrim(coalesce(p_query, '')), 'NFKC'));
  query_value tsquery;
  normalized_tags text[] := array[]::text[];
begin
  if char_length(normalized_query) > 200
    or (normalized_query <> '' and char_length(normalized_query) < 2)
    or coalesce(cardinality(p_tag_names), 0) > 10
    or coalesce(cardinality(p_media), 0) > 5
    or p_limit is null or p_limit not between 1 and 50
    or p_sort not in ('relevance', 'newest', 'oldest')
    or (p_from is not null and p_to is not null and p_from > p_to)
    or exists (
      select 1 from unnest(coalesce(p_media, array[]::text[])) media_kind
      where media_kind not in ('text', 'image', 'audio', 'video', 'place')
    ) then
    raise exception using errcode = 'P0001', message = 'odiina_search_invalid';
  end if;

  if cardinality(coalesce(p_tag_names, array[]::text[])) > 0 then
    select array_agg(n.normalized_name order by n.normalized_name)
      into normalized_tags
    from unnest(p_tag_names) raw_tag
    cross join lateral app.normalize_tag_label(raw_tag) n;
    if cardinality(normalized_tags) <> cardinality(p_tag_names) then
      raise exception using errcode = 'P0001', message = 'odiina_search_invalid';
    end if;
  end if;
  if normalized_query <> '' then
    query_value := websearch_to_tsquery('simple', normalized_query);
  end if;

  return query
  with ranked as (
    select d.entry_id, d.revision_id, d.body_text, d.occurred_at,
      d.occurred_local_date, d.lifecycle_state,
      (
        case when normalized_query = any(d.tag_normalized_names) then 4 else 0 end
        + case when query_value is not null then
            ts_rank_cd(d.search_vector, query_value, 32) else 0 end
        + case when normalized_query <> '' then
            extensions.similarity(d.normalized_document, normalized_query) else 0 end
      )::real as rank_value
    from app.entry_search_documents d
    where d.user_id = actor
      and (d.lifecycle_state = 'active' or coalesce(p_include_trash, false))
      and (p_from is null or d.occurred_local_date >= p_from)
      and (p_to is null or d.occurred_local_date <= p_to)
      and d.tag_normalized_names @> normalized_tags
      and (not coalesce(p_has_place, false) or d.has_place)
      and (
        cardinality(coalesce(p_media, array[]::text[])) = 0
        or ('text' = any(p_media) and d.has_text)
        or ('image' = any(p_media) and d.has_image)
        or ('audio' = any(p_media) and d.has_audio)
        or ('video' = any(p_media) and d.has_video)
        or ('place' = any(p_media) and d.has_place)
      )
      and (
        normalized_query = ''
        or d.search_vector @@ query_value
        or d.normalized_document like '%' || normalized_query || '%'
      )
  ), filtered as (
    select ranked.* from ranked
    where p_cursor_entry_id is null
      or (
        p_sort = 'relevance' and
        (ranked.rank_value, ranked.occurred_at, ranked.entry_id)
          < (p_cursor_rank, p_cursor_occurred_at, p_cursor_entry_id)
      )
      or (
        p_sort = 'newest' and
        (ranked.occurred_at, ranked.entry_id)
          < (p_cursor_occurred_at, p_cursor_entry_id)
      )
      or (
        p_sort = 'oldest' and
        (ranked.occurred_at, ranked.entry_id)
          > (p_cursor_occurred_at, p_cursor_entry_id)
      )
  )
  select e.id, e.current_revision_id, f.body_text, r.revision_number,
    f.occurred_at, r.occurred_timezone, f.occurred_local_date,
    e.created_at, e.updated_at, e.lifecycle_state, e.trashed_at,
    f.rank_value
  from filtered f
  join app.entries e on e.user_id = actor and e.id = f.entry_id
  join app.entry_revisions r on r.user_id = e.user_id and r.entry_id = e.id
    and r.id = e.current_revision_id
  order by
    case when p_sort = 'relevance' then f.rank_value end desc,
    case when p_sort in ('relevance', 'newest') then f.occurred_at end desc,
    case when p_sort in ('relevance', 'newest') then f.entry_id end desc,
    case when p_sort = 'oldest' then f.occurred_at end asc,
    case when p_sort = 'oldest' then f.entry_id end asc
  limit p_limit;
end
$$;
alter function app.search_entries(text,date,date,text[],text[],boolean,boolean,text,real,timestamptz,uuid,integer)
  owner to odiina_owner_api;

revoke all on function app.normalize_tag_label(text) from public, anon, authenticated;
revoke all on function app.insert_revision_tags(uuid,uuid,text[]) from public, anon, authenticated;
revoke all on function app.refresh_entry_search_document(uuid,uuid) from public, anon, authenticated;
revoke all on function app.refresh_entry_search_from_entry() from public, anon, authenticated;
revoke all on function app.refresh_entry_search_from_revision_child() from public, anon, authenticated;
revoke all on function app.refresh_entry_search_from_attachment() from public, anon, authenticated;
revoke all on function app.create_entry_tagged(uuid,text,text[],jsonb,timestamptz,text,date,smallint) from public, anon;
revoke all on function app.activate_media_entry_tagged(uuid,uuid,text,uuid[],text[],jsonb,timestamptz,text,date,smallint) from public, anon;
revoke all on function app.revise_entry_tagged(uuid,uuid,text,uuid[],text[],jsonb,timestamptz,text,date,smallint,text) from public, anon;
revoke all on function app.revision_tags(uuid[]) from public, anon;
revoke all on function app.tag_suggestions(text,integer) from public, anon;
revoke all on function app.search_entries(text,date,date,text[],text[],boolean,boolean,text,real,timestamptz,uuid,integer) from public, anon;
grant execute on function app.normalize_tag_label(text) to odiina_owner_api;
grant execute on function app.insert_revision_tags(uuid,uuid,text[]) to odiina_owner_api;
grant execute on function app.refresh_entry_search_document(uuid,uuid) to odiina_owner_api;
grant execute on function app.create_entry_tagged(uuid,text,text[],jsonb,timestamptz,text,date,smallint) to authenticated;
grant execute on function app.activate_media_entry_tagged(uuid,uuid,text,uuid[],text[],jsonb,timestamptz,text,date,smallint) to authenticated;
grant execute on function app.revise_entry_tagged(uuid,uuid,text,uuid[],text[],jsonb,timestamptz,text,date,smallint,text) to authenticated;
grant execute on function app.revision_tags(uuid[]) to authenticated;
grant execute on function app.tag_suggestions(text,integer) to authenticated;
grant execute on function app.search_entries(text,date,date,text[],text[],boolean,boolean,text,real,timestamptz,uuid,integer) to authenticated;

-- Backfill only current snapshots. Existing Entries begin with no invented tags.
do $$
declare
  current_entry record;
begin
  for current_entry in select user_id, id from app.entries
    where current_revision_id is not null
  loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', current_entry.user_id, 'role', 'authenticated')::text,
      true);
    perform app.refresh_entry_search_document(current_entry.user_id, current_entry.id);
  end loop;
end
$$;

revoke all on function app.profile_statistics() from public, anon, authenticated;
drop function app.profile_statistics();
create function app.profile_statistics()
returns table (
  active_entries bigint, active_logging_days bigint,
  current_month_entries bigint, image_entries bigint, voice_entries bigint,
  video_entries bigint, place_entries bigint, tagged_entries bigint,
  edited_entries bigint
)
language sql stable security invoker set search_path = '' as $$
  with active as (
    select e.id, e.user_id, e.current_revision_id, r.occurred_local_date,
      r.revision_number
    from app.entries e
    join app.entry_revisions r on r.user_id=e.user_id and r.entry_id=e.id
      and r.id=e.current_revision_id
    where e.user_id=app.request_user_id() and e.lifecycle_state='active'
  )
  select count(*)::bigint,
    count(distinct active.occurred_local_date)::bigint,
    count(*) filter (where active.occurred_local_date >=
      date_trunc('month', current_date)::date)::bigint,
    count(*) filter (where exists (
      select 1 from app.entry_revision_attachments era join app.attachments a
        on a.user_id=era.user_id and a.id=era.attachment_id
      where era.user_id=active.user_id and era.entry_id=active.id
        and era.revision_id=active.current_revision_id
        and a.state='accepted' and a.media_kind='image'))::bigint,
    count(*) filter (where exists (
      select 1 from app.entry_revision_attachments era join app.attachments a
        on a.user_id=era.user_id and a.id=era.attachment_id
      where era.user_id=active.user_id and era.entry_id=active.id
        and era.revision_id=active.current_revision_id
        and a.state='accepted' and a.media_kind='audio'))::bigint,
    count(*) filter (where exists (
      select 1 from app.entry_revision_attachments era join app.attachments a
        on a.user_id=era.user_id and a.id=era.attachment_id
      where era.user_id=active.user_id and era.entry_id=active.id
        and era.revision_id=active.current_revision_id
        and a.state='accepted' and a.media_kind='video'))::bigint,
    count(*) filter (where exists (
      select 1 from app.entry_revision_places p
      where p.user_id=active.user_id and p.entry_id=active.id
        and p.revision_id=active.current_revision_id
        and p.redacted_at is null))::bigint,
    count(*) filter (where exists (
      select 1 from app.entry_revision_tags rt
      where rt.user_id=active.user_id and rt.entry_id=active.id
        and rt.revision_id=active.current_revision_id))::bigint,
    count(*) filter (where active.revision_number > 1)::bigint
  from active
$$;
revoke all on function app.profile_statistics() from public, anon;
grant execute on function app.profile_statistics() to authenticated;

comment on table app.entry_search_documents is
  'Owner-only derived current snapshots. Never contains historical revisions or media contents.';
comment on function app.search_entries(text,date,date,text[],text[],boolean,boolean,text,real,timestamptz,uuid,integer) is
  'Bounded owner-only current-snapshot search. Tags use AND; media types use OR.';

revoke create on schema app from odiina_owner_api;
revoke odiina_owner_api from postgres;
