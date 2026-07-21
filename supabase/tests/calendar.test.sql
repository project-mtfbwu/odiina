begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(17);

select extensions.ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'app.calendar_month_activity(date)',
    'EXECUTE'
  ),
  'anon cannot invoke month activity'
);
select extensions.ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'app.calendar_day_entries(date,timestamp with time zone,uuid,integer)',
    'EXECUTE'
  ),
  'anon cannot invoke selected-day Entries'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'app.calendar_month_activity(date)',
    'EXECUTE'
  ),
  'authenticated can invoke month activity'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'app.calendar_day_entries(date,timestamp with time zone,uuid,integer)',
    'EXECUTE'
  ),
  'authenticated can invoke selected-day Entries'
);
select extensions.is(
  (
    select pg_catalog.pg_get_userbyid(p.proowner)
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'calendar_month_activity'
  ),
  'odiina_owner_api',
  'calendar function uses the constrained owner role'
);
select extensions.is(
  (
    select p.proconfig
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'calendar_month_activity'
  ),
  array['search_path=""']::text[],
  'calendar function has an empty fixed search path'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '44444444-4444-4444-8444-444444444444',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'calendar-a@example.test', '', now(),
    '', '', '', '',
    '{"provider":"email","providers":["email"]}', '{}', now(), now()
  ),
  (
    '55555555-5555-4555-8555-555555555555',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'calendar-b@example.test', '', now(),
    '', '', '', '',
    '{"provider":"email","providers":["email"]}', '{}', now(), now()
  );

create temporary table calendar_ids (
  label text primary key,
  entry_id uuid not null,
  revision_id uuid not null
);
grant all on table calendar_ids to authenticated;

select set_config(
  'request.jwt.claims',
  '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}',
  true
);
set local role authenticated;
insert into calendar_ids
select 'a-july-12', result.*
from app.create_entry(
  'cccccccc-0000-4000-8000-000000000001',
  'Owner A historical Entry',
  '2026-07-12T03:45:00Z',
  'Asia/Kolkata',
  '2026-07-12',
  330::smallint
) as result;
insert into calendar_ids
select 'a-july-12-late', result.*
from app.create_entry(
  'cccccccc-0000-4000-8000-000000000002',
  'Owner A later Entry',
  '2026-07-12T15:00:00Z',
  'Asia/Kolkata',
  '2026-07-12',
  330::smallint
) as result;

select extensions.is(
  (
    select entry_count
    from app.calendar_month_activity('2026-07-01')
    where occurred_local_date = '2026-07-12'
  ),
  2::bigint,
  'month activity counts active current revisions'
);
select extensions.is(
  (
    select count(*)::bigint
    from app.calendar_day_entries('2026-07-12')
  ),
  2::bigint,
  'selected-day query returns owner Entries only'
);
select extensions.is(
  (
    select body_text
    from app.calendar_day_entries('2026-07-12')
    limit 1
  ),
  'Owner A historical Entry',
  'selected-day Entries are chronological'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}',
  true
);
set local role authenticated;
select extensions.is(
  (select count(*)::bigint from app.calendar_month_activity('2026-07-01')),
  0::bigint,
  'another owner cannot see Calendar activity'
);
insert into calendar_ids
select 'b-july-12', result.*
from app.create_entry(
  'dddddddd-0000-4000-8000-000000000001',
  'Owner B private Entry',
  '2026-07-12T04:00:00Z',
  'Asia/Kolkata',
  '2026-07-12',
  330::smallint
) as result;

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}',
  true
);
set local role authenticated;
select extensions.is(
  (select count(*)::bigint from app.calendar_day_entries('2026-07-12')),
  2::bigint,
  'owner A selected day excludes owner B'
);
select app.trash_entry(
  (select entry_id from calendar_ids where label = 'a-july-12-late')
);
select extensions.is(
  (
    select entry_count
    from app.calendar_month_activity('2026-07-01')
    where occurred_local_date = '2026-07-12'
  ),
  1::bigint,
  'Trash immediately removes Calendar activity'
);
select app.restore_entry(
  (select entry_id from calendar_ids where label = 'a-july-12-late')
);
select extensions.is(
  (
    select entry_count
    from app.calendar_month_activity('2026-07-01')
    where occurred_local_date = '2026-07-12'
  ),
  2::bigint,
  'restore recovers Calendar activity'
);

insert into calendar_ids
select 'a-corrected', result.*
from app.revise_entry(
  (select entry_id from calendar_ids where label = 'a-july-12'),
  (select revision_id from calendar_ids where label = 'a-july-12'),
  'Owner A historical Entry',
  '2026-07-13T03:45:00Z',
  'Asia/Kolkata',
  '2026-07-13',
  330::smallint,
  'occurrence_corrected'
) as result;
select extensions.is(
  (select count(*)::bigint from app.calendar_day_entries('2026-07-12')),
  1::bigint,
  'occurrence correction removes Entry from the old day'
);
select extensions.is(
  (select count(*)::bigint from app.calendar_day_entries('2026-07-13')),
  1::bigint,
  'occurrence correction moves Entry to the new day'
);
select extensions.is(
  (
    select count(*)::bigint
    from app.entry_revisions
    where entry_id = (
      select entry_id from calendar_ids where label = 'a-july-12'
    )
  ),
  2::bigint,
  'occurrence correction preserves immutable revision evidence'
);
select extensions.throws_ok(
  $$select * from app.calendar_month_activity('2026-07-12')$$,
  'P0001',
  null,
  'month activity rejects a non-month-start input'
);

select * from extensions.finish();
rollback;
