begin;

alter table app.entry_command_receipts
  drop constraint entry_command_receipts_command_kind_check;
alter table app.entry_command_receipts
  add constraint entry_command_receipts_command_kind_check
  check (command_kind in (
    'create_entry', 'activate_media_entry',
    'create_entry_place', 'activate_media_entry_place'
  ));

create table app.entry_revision_places (
  user_id uuid not null,
  entry_id uuid not null,
  revision_id uuid not null,
  place_name text null,
  place_area text null,
  place_address text null,
  latitude numeric(8,5) null,
  longitude numeric(9,5) null,
  precision text null,
  approximate_radius_meters integer null,
  source text null,
  provider text null,
  provider_place_id text null,
  country_code text null,
  created_at timestamptz not null default statement_timestamp(),
  redacted_at timestamptz null,
  primary key (user_id, entry_id, revision_id),
  constraint entry_revision_places_revision_fk
    foreign key (user_id, entry_id, revision_id)
    references app.entry_revisions(user_id, entry_id, id)
    on delete restrict,
  constraint entry_revision_places_snapshot_valid check (
    (
      redacted_at is not null
      and place_name is null and place_area is null and place_address is null
      and latitude is null and longitude is null and precision is null
      and approximate_radius_meters is null and source is null
      and provider is null and provider_place_id is null and country_code is null
    )
    or
    (
      redacted_at is null
      and place_name is not null
      and char_length(place_name) between 1 and 120
      and place_name = btrim(place_name)
      and (place_area is null or (
        char_length(place_area) between 1 and 240 and place_area = btrim(place_area)
      ))
      and (place_address is null or (
        char_length(place_address) between 1 and 240 and place_address = btrim(place_address)
      ))
      and precision in ('label_only', 'approximate', 'exact')
      and source in ('manual', 'device')
      and provider is null
      and provider_place_id is null
      and (country_code is null or country_code ~ '^[A-Z]{2}$')
      and (
        (precision = 'label_only' and latitude is null and longitude is null
          and approximate_radius_meters is null)
        or
        (precision = 'approximate' and latitude between -90 and 90
          and longitude between -180 and 180
          and mod(latitude, 0.025::numeric) = 0
          and mod(longitude, 0.025::numeric) = 0
          and approximate_radius_meters = 3000)
        or
        (precision = 'exact' and latitude between -90 and 90
          and longitude between -180 and 180
          and approximate_radius_meters is null)
      )
    )
  )
);

create index entry_revision_places_current_idx
  on app.entry_revision_places (user_id, entry_id, revision_id)
  where redacted_at is null;

alter table app.entry_revision_places enable row level security;
alter table app.entry_revision_places force row level security;

create policy entry_revision_places_owner_read on app.entry_revision_places
  for select to authenticated
  using (user_id = (select app.request_user_id()));
create policy entry_revision_places_owner_api on app.entry_revision_places
  for all to odiina_owner_api
  using (user_id = (select app.request_user_id()))
  with check (user_id = (select app.request_user_id()));

grant select on app.entry_revision_places to authenticated;
grant select, insert, update on app.entry_revision_places to odiina_owner_api;

create function app.normalize_place_snapshot(p_place jsonb)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  normalized_name text;
  normalized_area text;
  normalized_address text;
  normalized_precision text;
  normalized_source text;
  normalized_provider text;
  normalized_provider_id text;
  normalized_country text;
  normalized_latitude numeric;
  normalized_longitude numeric;
  normalized_radius integer;
begin
  if p_place is null or jsonb_typeof(p_place) <> 'object' then
    raise exception using errcode = 'P0001', message = 'odiina_place_invalid';
  end if;
  normalized_name := btrim(coalesce(p_place ->> 'placeName', ''));
  normalized_area := nullif(btrim(coalesce(p_place ->> 'placeArea', '')), '');
  normalized_address := nullif(btrim(coalesce(p_place ->> 'placeAddress', '')), '');
  normalized_precision := p_place ->> 'precision';
  normalized_source := p_place ->> 'source';
  normalized_provider := nullif(btrim(coalesce(p_place ->> 'provider', '')), '');
  normalized_provider_id := nullif(btrim(coalesce(p_place ->> 'providerPlaceId', '')), '');
  normalized_country := nullif(upper(btrim(coalesce(p_place ->> 'countryCode', ''))), '');

  if char_length(normalized_name) not between 1 and 120
    or (normalized_area is not null and char_length(normalized_area) > 240)
    or (normalized_address is not null and char_length(normalized_address) > 240)
    or normalized_precision not in ('label_only', 'approximate', 'exact')
    or normalized_source not in ('manual', 'device')
    or normalized_provider is not null
    or normalized_provider_id is not null
    or (normalized_country is not null and normalized_country !~ '^[A-Z]{2}$') then
    raise exception using errcode = 'P0001', message = 'odiina_place_invalid';
  end if;

  if normalized_precision = 'label_only' then
    if p_place -> 'latitude' <> 'null'::jsonb
      or p_place -> 'longitude' <> 'null'::jsonb
      or p_place -> 'approximateRadiusMeters' <> 'null'::jsonb then
      raise exception using errcode = 'P0001', message = 'odiina_place_precision_invalid';
    end if;
  else
    if jsonb_typeof(p_place -> 'latitude') <> 'number'
      or jsonb_typeof(p_place -> 'longitude') <> 'number' then
      raise exception using errcode = 'P0001', message = 'odiina_place_coordinate_invalid';
    end if;
    normalized_latitude := (p_place ->> 'latitude')::numeric;
    normalized_longitude := (p_place ->> 'longitude')::numeric;
    if normalized_latitude not between -90 and 90
      or normalized_longitude not between -180 and 180 then
      raise exception using errcode = 'P0001', message = 'odiina_place_coordinate_invalid';
    end if;
    if normalized_precision = 'approximate' then
      normalized_radius := (p_place ->> 'approximateRadiusMeters')::integer;
      if normalized_radius <> 3000
        or mod(normalized_latitude, 0.025::numeric) <> 0
        or mod(normalized_longitude, 0.025::numeric) <> 0 then
        raise exception using errcode = 'P0001', message = 'odiina_place_approximation_invalid';
      end if;
    elsif coalesce((p_place ->> 'exactConfirmed')::boolean, false) is not true
      or p_place -> 'approximateRadiusMeters' <> 'null'::jsonb then
      raise exception using errcode = 'P0001', message = 'odiina_place_exact_confirmation_required';
    end if;
  end if;

  return jsonb_build_object(
    'placeName', normalized_name,
    'placeArea', normalized_area,
    'placeAddress', normalized_address,
    'latitude', normalized_latitude,
    'longitude', normalized_longitude,
    'precision', normalized_precision,
    'approximateRadiusMeters', normalized_radius,
    'source', normalized_source,
    'provider', normalized_provider,
    'providerPlaceId', normalized_provider_id,
    'countryCode', normalized_country
  );
end
$$;

create function app.insert_revision_place(
  p_entry_id uuid, p_revision_id uuid, p_place jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor uuid := app.request_user_id();
  normalized jsonb := app.normalize_place_snapshot(p_place);
begin
  insert into app.entry_revision_places (
    user_id, entry_id, revision_id, place_name, place_area, place_address,
    latitude, longitude, precision, approximate_radius_meters, source,
    provider, provider_place_id, country_code
  ) values (
    actor, p_entry_id, p_revision_id, normalized ->> 'placeName',
    normalized ->> 'placeArea', normalized ->> 'placeAddress',
    (normalized ->> 'latitude')::numeric, (normalized ->> 'longitude')::numeric,
    normalized ->> 'precision', (normalized ->> 'approximateRadiusMeters')::integer,
    normalized ->> 'source', normalized ->> 'provider',
    normalized ->> 'providerPlaceId', normalized ->> 'countryCode'
  );
end
$$;

create function app.create_entry_place(
  p_client_request_id uuid, p_body_text text, p_place jsonb,
  p_occurred_at timestamptz, p_occurred_timezone text,
  p_occurred_local_date date, p_occurred_utc_offset_minutes smallint
)
returns table (entry_id uuid, revision_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := app.request_user_id();
  normalized_body text := btrim(coalesce(p_body_text, ''));
  normalized_place jsonb := app.normalize_place_snapshot(p_place);
  canonical_hash bytea;
  receipt app.entry_command_receipts%rowtype;
  created_entry_id uuid := extensions.gen_random_uuid();
  created_revision_id uuid := extensions.gen_random_uuid();
begin
  if actor is null then
    raise exception using errcode = 'P0001', message = 'odiina_auth_required';
  end if;
  if p_client_request_id is null or char_length(normalized_body) > 100000 then
    raise exception using errcode = 'P0001', message = 'odiina_entry_invalid';
  end if;
  perform app.assert_occurrence(p_occurred_at, p_occurred_timezone,
    p_occurred_local_date, p_occurred_utc_offset_minutes);
  canonical_hash := extensions.digest(convert_to(jsonb_build_object(
    'body_text', normalized_body, 'place', normalized_place,
    'occurred_at', p_occurred_at, 'occurred_timezone', p_occurred_timezone,
    'occurred_local_date', p_occurred_local_date,
    'occurred_utc_offset_minutes', p_occurred_utc_offset_minutes
  )::text, 'UTF8'), 'sha256');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    actor::text || ':create_entry_place:' || p_client_request_id::text, 0));
  select r.* into receipt from app.entry_command_receipts as r
  where r.user_id = actor and r.command_kind = 'create_entry_place'
    and r.client_request_id = p_client_request_id;
  if found then
    if receipt.request_hash <> canonical_hash then
      raise exception using errcode = 'P0001', message = 'odiina_idempotency_conflict';
    end if;
    return query select receipt.entry_id, receipt.revision_id;
    return;
  end if;
  insert into app.entries (id, user_id) values (created_entry_id, actor);
  insert into app.entry_revisions (
    id, user_id, entry_id, revision_number, body_text, occurred_at,
    occurred_timezone, occurred_local_date, occurred_utc_offset_minutes, change_reason
  ) values (
    created_revision_id, actor, created_entry_id, 1, normalized_body,
    p_occurred_at, p_occurred_timezone, p_occurred_local_date,
    p_occurred_utc_offset_minutes, 'created'
  );
  perform app.insert_revision_place(created_entry_id, created_revision_id, normalized_place);
  update app.entries set current_revision_id = created_revision_id
  where id = created_entry_id and user_id = actor;
  insert into app.entry_command_receipts (
    user_id, command_kind, client_request_id, request_hash, entry_id, revision_id
  ) values (
    actor, 'create_entry_place', p_client_request_id, canonical_hash,
    created_entry_id, created_revision_id
  );
  return query select created_entry_id, created_revision_id;
end
$$;

create function app.activate_media_entry_place(
  p_client_request_id uuid, p_entry_id uuid, p_body_text text,
  p_attachment_ids uuid[], p_place jsonb, p_occurred_at timestamptz,
  p_occurred_timezone text, p_occurred_local_date date,
  p_occurred_utc_offset_minutes smallint
)
returns table (entry_id uuid, revision_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := app.request_user_id();
  normalized_place jsonb := app.normalize_place_snapshot(p_place);
  canonical_hash bytea;
  receipt app.entry_command_receipts%rowtype;
  activated record;
begin
  if actor is null then raise exception using errcode = 'P0001', message = 'odiina_auth_required'; end if;
  canonical_hash := extensions.digest(convert_to(jsonb_build_object(
    'entry_id', p_entry_id, 'body_text', btrim(coalesce(p_body_text, '')),
    'attachment_ids', p_attachment_ids, 'place', normalized_place,
    'occurred_at', p_occurred_at, 'occurred_timezone', p_occurred_timezone,
    'occurred_local_date', p_occurred_local_date,
    'occurred_utc_offset_minutes', p_occurred_utc_offset_minutes
  )::text, 'UTF8'), 'sha256');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    actor::text || ':activate_media_entry_place:' || p_client_request_id::text, 0));
  select r.* into receipt from app.entry_command_receipts as r
  where r.user_id = actor and r.command_kind = 'activate_media_entry_place'
    and r.client_request_id = p_client_request_id;
  if found then
    if receipt.request_hash <> canonical_hash then
      raise exception using errcode = 'P0001', message = 'odiina_idempotency_conflict';
    end if;
    return query select receipt.entry_id, receipt.revision_id;
    return;
  end if;
  select * into activated from app.activate_media_entry(
    p_client_request_id, p_entry_id, p_body_text, p_attachment_ids,
    p_occurred_at, p_occurred_timezone, p_occurred_local_date,
    p_occurred_utc_offset_minutes
  );
  perform app.insert_revision_place(activated.entry_id, activated.revision_id, normalized_place);
  insert into app.entry_command_receipts (
    user_id, command_kind, client_request_id, request_hash, entry_id, revision_id
  ) values (
    actor, 'activate_media_entry_place', p_client_request_id, canonical_hash,
    activated.entry_id, activated.revision_id
  );
  return query select activated.entry_id, activated.revision_id;
end
$$;

create function app.revise_entry_place(
  p_entry_id uuid, p_expected_current_revision_id uuid, p_body_text text,
  p_attachment_ids uuid[], p_place jsonb, p_occurred_at timestamptz,
  p_occurred_timezone text, p_occurred_local_date date,
  p_occurred_utc_offset_minutes smallint, p_change_reason text
)
returns table (entry_id uuid, revision_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := app.request_user_id();
  revised record;
  locked_entry app.entries%rowtype;
  created_revision_id uuid := extensions.gen_random_uuid();
  next_revision integer;
begin
  if actor is null then raise exception using errcode = 'P0001', message = 'odiina_auth_required'; end if;
  if p_place is null
    and char_length(btrim(coalesce(p_body_text, ''))) = 0
    and coalesce(array_length(p_attachment_ids, 1), 0) = 0 then
    raise exception using errcode = 'P0001', message = 'odiina_entry_invalid';
  end if;
  if char_length(btrim(coalesce(p_body_text, ''))) = 0
    and coalesce(array_length(p_attachment_ids, 1), 0) = 0 then
    if p_change_reason not in ('edited', 'occurrence_corrected') then
      raise exception using errcode = 'P0001', message = 'odiina_entry_invalid';
    end if;
    perform app.assert_occurrence(p_occurred_at, p_occurred_timezone,
      p_occurred_local_date, p_occurred_utc_offset_minutes);
    perform app.normalize_place_snapshot(p_place);
    select e.* into locked_entry from app.entries as e
    where e.id = p_entry_id and e.user_id = actor for update;
    if not found or locked_entry.lifecycle_state <> 'active' then
      raise exception using errcode = 'P0001', message = 'odiina_entry_unavailable';
    end if;
    if locked_entry.current_revision_id <> p_expected_current_revision_id then
      raise exception using errcode = 'P0001', message = 'odiina_revision_conflict';
    end if;
    select coalesce(max(r.revision_number), 0) + 1 into next_revision
    from app.entry_revisions as r where r.user_id = actor and r.entry_id = p_entry_id;
    insert into app.entry_revisions (
      id, user_id, entry_id, revision_number, body_text, occurred_at,
      occurred_timezone, occurred_local_date, occurred_utc_offset_minutes, change_reason
    ) values (
      created_revision_id, actor, p_entry_id, next_revision, '', p_occurred_at,
      p_occurred_timezone, p_occurred_local_date,
      p_occurred_utc_offset_minutes, p_change_reason
    );
    perform app.insert_revision_place(p_entry_id, created_revision_id, p_place);
    update app.entries set current_revision_id = created_revision_id
    where id = p_entry_id and user_id = actor;
    return query select p_entry_id, created_revision_id;
    return;
  end if;
  select * into revised from app.revise_entry_media(
    p_entry_id, p_expected_current_revision_id, p_body_text, p_attachment_ids,
    p_occurred_at, p_occurred_timezone, p_occurred_local_date,
    p_occurred_utc_offset_minutes, p_change_reason
  );
  if p_place is not null then
    perform app.insert_revision_place(revised.entry_id, revised.revision_id, p_place);
  end if;
  return query select revised.entry_id, revised.revision_id;
end
$$;

create function app.redact_entry_places(p_entry_id uuid)
returns table (redacted_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare actor uuid := app.request_user_id(); affected integer;
begin
  if actor is null then raise exception using errcode = 'P0001', message = 'odiina_auth_required'; end if;
  perform 1 from app.entries as e where e.user_id = actor and e.id = p_entry_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'odiina_entry_unavailable'; end if;
  update app.entry_revision_places set
    place_name = null, place_area = null, place_address = null,
    latitude = null, longitude = null, precision = null,
    approximate_radius_meters = null, source = null, provider = null,
    provider_place_id = null, country_code = null,
    redacted_at = statement_timestamp()
  where user_id = actor and entry_id = p_entry_id and redacted_at is null;
  get diagnostics affected = row_count;
  return query select affected;
end
$$;

create function app.revision_places(p_revision_ids uuid[])
returns table (
  revision_id uuid, place_name text, place_area text, place_address text,
  latitude numeric, longitude numeric, "precision" text,
  approximate_radius_meters integer, source text, provider text,
  provider_place_id text, country_code text, created_at timestamptz,
  redacted_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.revision_id, p.place_name, p.place_area, p.place_address,
    p.latitude, p.longitude, p.precision, p.approximate_radius_meters,
    p.source, p.provider, p.provider_place_id, p.country_code,
    p.created_at, p.redacted_at
  from app.entry_revision_places as p
  where p.user_id = app.request_user_id()
    and p.revision_id = any(coalesce(p_revision_ids, array[]::uuid[]))
  order by p.created_at
$$;

revoke all on function app.normalize_place_snapshot(jsonb) from public, anon, authenticated;
revoke all on function app.insert_revision_place(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function app.create_entry_place(uuid, text, jsonb, timestamptz, text, date, smallint) from public, anon;
revoke all on function app.activate_media_entry_place(uuid, uuid, text, uuid[], jsonb, timestamptz, text, date, smallint) from public, anon;
revoke all on function app.revise_entry_place(uuid, uuid, text, uuid[], jsonb, timestamptz, text, date, smallint, text) from public, anon;
revoke all on function app.redact_entry_places(uuid) from public, anon;
revoke all on function app.revision_places(uuid[]) from public, anon;
grant execute on function app.create_entry_place(uuid, text, jsonb, timestamptz, text, date, smallint) to authenticated;
grant execute on function app.activate_media_entry_place(uuid, uuid, text, uuid[], jsonb, timestamptz, text, date, smallint) to authenticated;
grant execute on function app.revise_entry_place(uuid, uuid, text, uuid[], jsonb, timestamptz, text, date, smallint, text) to authenticated;
grant execute on function app.redact_entry_places(uuid) to authenticated;
grant execute on function app.revision_places(uuid[]) to authenticated;
grant execute on function app.normalize_place_snapshot(jsonb) to odiina_owner_api;
grant execute on function app.insert_revision_place(uuid, uuid, jsonb) to odiina_owner_api;

comment on function app.redact_entry_places(uuid) is
  'Authenticated destructive privacy exception: clears place fields only, preserving revision identity and timestamps.';

grant odiina_owner_api to postgres;
grant create on schema app to odiina_owner_api;
alter function app.create_entry_place(uuid, text, jsonb, timestamptz, text, date, smallint) owner to odiina_owner_api;
alter function app.activate_media_entry_place(uuid, uuid, text, uuid[], jsonb, timestamptz, text, date, smallint) owner to odiina_owner_api;
alter function app.revise_entry_place(uuid, uuid, text, uuid[], jsonb, timestamptz, text, date, smallint, text) owner to odiina_owner_api;
alter function app.redact_entry_places(uuid) owner to odiina_owner_api;
revoke create on schema app from odiina_owner_api;
revoke odiina_owner_api from postgres;

drop function app.profile_statistics();
create function app.profile_statistics()
returns table (
  active_entries bigint, active_logging_days bigint,
  current_month_entries bigint, image_entries bigint,
  voice_entries bigint, video_entries bigint, place_entries bigint,
  edited_entries bigint
)
language sql stable security invoker set search_path = '' as $$
  with owner_context as (
    select p.user_id,
      (statement_timestamp() at time zone coalesce(up.iana_timezone, 'UTC'))::date as local_today
    from app.profiles as p left join app.user_preferences as up on up.user_id = p.user_id
    where p.user_id = app.request_user_id()
  ), active as (
    select e.id, e.user_id, e.current_revision_id, r.occurred_local_date,
      r.revision_number
    from owner_context as owner
    join app.entries as e on e.user_id = owner.user_id and e.lifecycle_state = 'active'
    join app.entry_revisions as r on r.user_id = e.user_id and r.entry_id = e.id
      and r.id = e.current_revision_id
  )
  select count(active.id)::bigint,
    count(distinct active.occurred_local_date)::bigint,
    count(*) filter (where active.occurred_local_date >= date_trunc('month', owner.local_today)::date
      and active.occurred_local_date < (date_trunc('month', owner.local_today) + interval '1 month')::date)::bigint,
    count(*) filter (where exists (
      select 1 from app.entry_revision_attachments as era
      join app.attachments as a on a.user_id = era.user_id and a.entry_id = era.entry_id and a.id = era.attachment_id
      where era.user_id = active.user_id and era.entry_id = active.id
        and era.revision_id = active.current_revision_id and a.media_kind = 'image'
        and a.purpose = 'entry' and a.state = 'accepted'))::bigint,
    count(*) filter (where exists (
      select 1 from app.entry_revision_attachments as era
      join app.attachments as a on a.user_id = era.user_id and a.entry_id = era.entry_id and a.id = era.attachment_id
      where era.user_id = active.user_id and era.entry_id = active.id
        and era.revision_id = active.current_revision_id and a.media_kind = 'audio'
        and a.purpose = 'entry' and a.state = 'accepted'))::bigint,
    count(*) filter (where exists (
      select 1 from app.entry_revision_attachments as era
      join app.attachments as a on a.user_id = era.user_id and a.entry_id = era.entry_id and a.id = era.attachment_id
      where era.user_id = active.user_id and era.entry_id = active.id
        and era.revision_id = active.current_revision_id and a.media_kind = 'video'
        and a.purpose = 'entry' and a.state = 'accepted'))::bigint,
    count(*) filter (where exists (
      select 1 from app.entry_revision_places as place
      where place.user_id = active.user_id and place.entry_id = active.id
        and place.revision_id = active.current_revision_id
        and place.redacted_at is null))::bigint,
    count(*) filter (where active.revision_number > 1)::bigint
  from owner_context as owner left join active on active.user_id = owner.user_id
  group by owner.user_id, owner.local_today
$$;
revoke all on function app.profile_statistics() from public, anon;
grant execute on function app.profile_statistics() to authenticated;

comment on table app.entry_revision_places is
  'Private immutable place snapshots per Entry revision. Normal edits append; explicit privacy redaction clears place fields across one owned Entry.';

commit;
