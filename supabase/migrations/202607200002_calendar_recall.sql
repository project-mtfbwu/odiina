begin;

do $$
begin
  if current_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'odiina_migration_requires_postgres_runner';
  end if;
end
$$;

create index entry_revisions_calendar_day_idx
  on app.entry_revisions (
    user_id,
    occurred_local_date,
    occurred_at,
    entry_id
  );

create function app.calendar_month_activity(p_month_start date)
returns table (
  occurred_local_date date,
  entry_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := app.request_user_id();
begin
  if actor is null then
    raise exception using errcode = 'P0001', message = 'odiina_auth_required';
  end if;
  if p_month_start is null
    or p_month_start <> date_trunc('month', p_month_start)::date then
    raise exception using errcode = 'P0001', message = 'odiina_calendar_month_invalid';
  end if;

  return query
  select
    r.occurred_local_date,
    count(*)::bigint
  from app.entries as e
  join app.entry_revisions as r
    on r.user_id = e.user_id
   and r.entry_id = e.id
   and r.id = e.current_revision_id
  where e.user_id = actor
    and e.lifecycle_state = 'active'
    and r.occurred_local_date >= p_month_start
    and r.occurred_local_date < (p_month_start + interval '1 month')::date
  group by r.occurred_local_date
  order by r.occurred_local_date;
end
$$;

create function app.calendar_day_entries(
  p_local_date date,
  p_cursor_occurred_at timestamptz default null,
  p_cursor_entry_id uuid default null,
  p_limit integer default 24
)
returns table (
  entry_id uuid,
  current_revision_id uuid,
  body_text text,
  revision_number integer,
  occurred_at timestamptz,
  occurred_timezone text,
  occurred_local_date date,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := app.request_user_id();
begin
  if actor is null then
    raise exception using errcode = 'P0001', message = 'odiina_auth_required';
  end if;
  if p_local_date is null
    or p_limit is null
    or p_limit < 1
    or p_limit > 50
    or ((p_cursor_occurred_at is null) <> (p_cursor_entry_id is null)) then
    raise exception using errcode = 'P0001', message = 'odiina_calendar_day_invalid';
  end if;

  return query
  select
    e.id,
    e.current_revision_id,
    r.body_text,
    r.revision_number,
    r.occurred_at,
    r.occurred_timezone,
    r.occurred_local_date,
    e.created_at,
    e.updated_at
  from app.entries as e
  join app.entry_revisions as r
    on r.user_id = e.user_id
   and r.entry_id = e.id
   and r.id = e.current_revision_id
  where e.user_id = actor
    and e.lifecycle_state = 'active'
    and r.occurred_local_date = p_local_date
    and (
      p_cursor_occurred_at is null
      or (r.occurred_at, e.id) > (p_cursor_occurred_at, p_cursor_entry_id)
    )
  order by r.occurred_at, e.id
  limit p_limit;
end
$$;

revoke all on function app.calendar_month_activity(date)
  from public, anon;
revoke all on function app.calendar_day_entries(date, timestamptz, uuid, integer)
  from public, anon;
grant execute on function app.calendar_month_activity(date)
  to authenticated;
grant execute on function app.calendar_day_entries(date, timestamptz, uuid, integer)
  to authenticated;

comment on function app.calendar_month_activity(date) is
  'Owner-scoped active Entry counts by civil day for one calendar month.';
comment on function app.calendar_day_entries(date, timestamptz, uuid, integer) is
  'Owner-scoped chronological active Entries for one civil day.';

grant odiina_owner_api to postgres;
grant create on schema app to odiina_owner_api;
alter function app.calendar_month_activity(date)
  owner to odiina_owner_api;
alter function app.calendar_day_entries(date, timestamptz, uuid, integer)
  owner to odiina_owner_api;
revoke create on schema app from odiina_owner_api;
revoke odiina_owner_api from postgres;

commit;
