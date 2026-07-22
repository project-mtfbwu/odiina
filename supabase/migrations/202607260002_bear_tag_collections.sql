begin;

do $$
begin
  if current_user <> 'postgres' then
    raise exception using
      errcode = '42501', message = 'odiina_migration_requires_postgres_runner';
  end if;
end
$$;

grant odiina_owner_api to postgres;
grant create on schema app to odiina_owner_api;

create function app.tag_collection_counts()
returns table (
  display_name text,
  normalized_name text,
  depth integer,
  direct_entry_count bigint,
  collection_entry_count bigint,
  is_explicit boolean,
  has_children boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with current_tagged as (
    select distinct rt.user_id, rt.entry_id, t.display_name, t.normalized_name
    from app.entry_revision_tags rt
    join app.user_tags t
      on t.user_id = rt.user_id and t.id = rt.tag_id
    join app.entries e
      on e.user_id = rt.user_id and e.id = rt.entry_id
      and e.current_revision_id = rt.revision_id
      and e.lifecycle_state = 'active'
    where rt.user_id = app.request_user_id()
  ), expanded as (
    select c.user_id, c.entry_id, c.normalized_name as source_name,
      array_to_string((string_to_array(c.normalized_name, '/'))[1:part], '/') as path,
      array_to_string((string_to_array(c.display_name, '/'))[1:part], '/') as display_path,
      part,
      array_length(string_to_array(c.normalized_name, '/'), 1) as source_depth
    from current_tagged c
    cross join lateral generate_series(
      1, array_length(string_to_array(c.normalized_name, '/'), 1)
    ) part
  )
  select min(display_path) as display_name, path as normalized_name,
    part as depth,
    count(distinct entry_id) filter (where source_name = path) as direct_entry_count,
    count(distinct entry_id) as collection_entry_count,
    bool_or(source_name = path) as is_explicit,
    bool_or(source_depth > part) as has_children
  from expanded
  group by path, part
  order by path
$$;
alter function app.tag_collection_counts() owner to odiina_owner_api;

create function app.search_entries(
  p_query text, p_from date, p_to date, p_tag_names text[],
  p_media text[], p_has_place boolean, p_include_trash boolean,
  p_include_tag_descendants boolean, p_sort text, p_cursor_rank real,
  p_cursor_occurred_at timestamptz, p_cursor_entry_id uuid, p_limit integer
)
returns table (
  entry_id uuid, current_revision_id uuid, body_text text,
  revision_number integer, occurred_at timestamptz, occurred_timezone text,
  occurred_local_date date, created_at timestamptz, updated_at timestamptz,
  lifecycle_state text, trashed_at timestamptz, result_rank real
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := app.request_user_id();
  normalized_query text := pg_catalog.lower(pg_catalog.normalize(
    pg_catalog.btrim(coalesce(p_query, '')), 'NFKC'));
  query_value tsquery;
  normalized_tags text[] := array[]::text[];
begin
  if actor is null
    or char_length(normalized_query) > 200
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
      and not exists (
        select 1
        from unnest(normalized_tags) wanted
        where not exists (
          select 1
          from unnest(d.tag_normalized_names) actual
          where actual = wanted
            or (
              coalesce(p_include_tag_descendants, false)
              and actual like wanted || '/%'
            )
        )
      )
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
alter function app.search_entries(text,date,date,text[],text[],boolean,boolean,boolean,text,real,timestamptz,uuid,integer)
  owner to odiina_owner_api;

revoke all on function app.tag_collection_counts() from public, anon;
revoke all on function app.search_entries(text,date,date,text[],text[],boolean,boolean,boolean,text,real,timestamptz,uuid,integer)
  from public, anon;
grant execute on function app.tag_collection_counts() to authenticated;
grant execute on function app.search_entries(text,date,date,text[],text[],boolean,boolean,boolean,text,real,timestamptz,uuid,integer)
  to authenticated;

comment on function app.tag_collection_counts() is
  'Returns owner-scoped active current-revision tag collection counts without scanning Entries in the browser.';
comment on function app.search_entries(text,date,date,text[],text[],boolean,boolean,boolean,text,real,timestamptz,uuid,integer) is
  'Searches the owner current-snapshot index; descendant matching is explicit and preserves exact child collections.';

revoke create on schema app from odiina_owner_api;
revoke odiina_owner_api from postgres;

commit;
