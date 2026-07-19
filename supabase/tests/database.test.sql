begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(34);

select extensions.ok(
  not (select rolbypassrls from pg_catalog.pg_roles where rolname = 'odiina_owner_api'),
  'mutation owner cannot bypass RLS'
);
select extensions.ok(
  not (select rolbypassrls from pg_catalog.pg_roles where rolname = 'odiina_provisioner'),
  'provisioner cannot bypass RLS'
);
select extensions.ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'app.create_entry(uuid,text,timestamp with time zone,text,date,smallint)',
    'EXECUTE'
  ),
  'anon and inherited PUBLIC privileges cannot invoke create_entry'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'app.create_entry(uuid,text,timestamp with time zone,text,date,smallint)',
    'EXECUTE'
  ),
  'authenticated can invoke create_entry'
);
select extensions.is(
  (
    select count(*)::bigint
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.proname in (
        'create_entry',
        'revise_entry',
        'trash_entry',
        'restore_entry',
        'save_preferences'
      )
      and p.prosecdef
      and p.proconfig @> array['search_path=""']::text[]
  ),
  5::bigint,
  'all private mutation functions are SECURITY DEFINER with empty search_path'
);
select extensions.is(
  (
    select count(*)::bigint
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.proname in (
        'create_entry',
        'revise_entry',
        'trash_entry',
        'restore_entry',
        'save_preferences'
      )
      and 'p_user_id' = any(coalesce(p.proargnames, array[]::text[]))
  ),
  0::bigint,
  'private mutation functions never accept user_id'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '22222222-2222-4222-8222-222222222222',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'owner-a@example.test', '', now(),
    '', '', '', '',
    '{"provider":"email","providers":["email"]}', '{}', now(), now()
  ),
  (
    '33333333-3333-4333-8333-333333333333',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'owner-b@example.test', '', now(),
    '', '', '', '',
    '{"provider":"email","providers":["email"]}', '{}', now(), now()
  )
on conflict (id) do nothing;

create temporary table odiina_test_ids (
  label text primary key,
  entry_id uuid not null,
  revision_id uuid not null
);
grant all on table odiina_test_ids to authenticated, odiina_owner_api, service_role;

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select extensions.throws_ok(
  $$select count(*) from app.entries$$,
  '42501',
  null,
  'anon cannot access Entries'
);
select extensions.throws_ok(
  $$select * from app.create_entry(
    'aaaaaaaa-0000-4000-8000-000000000001',
    'anonymous',
    '2026-07-19T04:00:00Z',
    'Asia/Kolkata',
    '2026-07-19',
    330::smallint
  )$$,
  '42501',
  null,
  'anonymous create is rejected'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}',
  true
);
set local role authenticated;
insert into odiina_test_ids
select 'a-first', result.*
from app.create_entry(
  'aaaaaaaa-0000-4000-8000-000000000002',
  'Owner A first Entry',
  '2026-07-19T04:00:00Z',
  'Asia/Kolkata',
  '2026-07-19',
  330::smallint
) as result;

select extensions.is(
  (select count(*)::bigint from odiina_test_ids),
  1::bigint,
  'authenticated create returns identifiers'
);
select extensions.is(
  (
    select result.entry_id
    from app.create_entry(
      'aaaaaaaa-0000-4000-8000-000000000002',
      'Owner A first Entry',
      '2026-07-19T04:00:00Z',
      'Asia/Kolkata',
      '2026-07-19',
      330::smallint
    ) as result
  ),
  (select entry_id from odiina_test_ids where label = 'a-first'),
  'same command and payload is idempotent'
);
select extensions.throws_ok(
  $$select * from app.create_entry(
    'aaaaaaaa-0000-4000-8000-000000000002',
    'Different content',
    '2026-07-19T04:00:00Z',
    'Asia/Kolkata',
    '2026-07-19',
    330::smallint
  )$$,
  'P0001',
  null,
  'reusing a command identifier with different content is rejected'
);
select extensions.is(
  (select count(*)::bigint from app.entries),
  1::bigint,
  'owner reads their Entry'
);
select extensions.throws_ok(
  $$insert into app.entries (user_id)
    values ('33333333-3333-4333-8333-333333333333')$$,
  '42501',
  null,
  'authenticated user cannot forge ownership'
);
select extensions.throws_ok(
  $$update app.entries
    set user_id = '33333333-3333-4333-8333-333333333333'$$,
  '42501',
  null,
  'owner cannot change user_id directly'
);
select extensions.throws_ok(
  $$update app.entry_revisions set body_text = 'mutated'$$,
  '42501',
  null,
  'revision update is denied'
);
select extensions.throws_ok(
  $$delete from app.entry_revisions$$,
  '42501',
  null,
  'revision deletion is denied'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}',
  true
);
set local role authenticated;
select extensions.is(
  (select count(*)::bigint from app.entries),
  0::bigint,
  'non-owner reads no Entries'
);
select extensions.is(
  (select count(*)::bigint from app.entry_revisions),
  0::bigint,
  'non-owner reads no revisions'
);
insert into odiina_test_ids
select 'b-first', result.*
from app.create_entry(
  'bbbbbbbb-0000-4000-8000-000000000001',
  'Owner B first Entry',
  '2026-07-19T05:00:00Z',
  'Asia/Kolkata',
  '2026-07-19',
  330::smallint
) as result;
select extensions.is(
  (select count(*)::bigint from app.feed_page(null, null, 24, false)),
  1::bigint,
  'Feed is owner-scoped'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}',
  true
);
set local role authenticated;
insert into odiina_test_ids
select 'a-revised', result.*
from app.revise_entry(
  (select entry_id from odiina_test_ids where label = 'a-first'),
  (select revision_id from odiina_test_ids where label = 'a-first'),
  'Owner A revised Entry',
  '2026-07-19T04:00:00Z',
  'Asia/Kolkata',
  '2026-07-19',
  330::smallint,
  'edited'
) as result;
select extensions.is(
  (
    select count(*)::bigint
    from app.entry_revisions
    where entry_id = (select entry_id from odiina_test_ids where label = 'a-first')
  ),
  2::bigint,
  'revision appends an immutable row'
);
select extensions.is(
  (
    select current_revision_id
    from app.entries
    where id = (select entry_id from odiina_test_ids where label = 'a-first')
  ),
  (select revision_id from odiina_test_ids where label = 'a-revised'),
  'revision atomically advances the pointer'
);
select extensions.throws_ok(
  $$select * from app.revise_entry(
    (select entry_id from odiina_test_ids where label = 'a-first'),
    (select revision_id from odiina_test_ids where label = 'a-first'),
    'Stale replacement',
    '2026-07-19T04:00:00Z',
    'Asia/Kolkata',
    '2026-07-19',
    330::smallint,
    'edited'
  )$$,
  'P0001',
  null,
  'a second edit from the same expected revision loses with a conflict'
);
select extensions.lives_ok(
  format(
    'select app.trash_entry(%L)',
    (select entry_id from odiina_test_ids where label = 'a-first')
  ),
  'owner can Trash an Entry'
);
select extensions.is(
  (select count(*)::bigint from app.feed_page(null, null, 24, false)),
  0::bigint,
  'trashed Entry disappears from normal Feed'
);
select extensions.is(
  (select count(*)::bigint from app.feed_page(null, null, 24, true)),
  1::bigint,
  'trashed Entry appears in Trash'
);
select extensions.lives_ok(
  format(
    'select app.restore_entry(%L)',
    (select entry_id from odiina_test_ids where label = 'a-first')
  ),
  'owner can restore before purge date'
);
select extensions.is(
  (select count(*)::bigint from app.feed_page(null, null, 24, false)),
  1::bigint,
  'restored Entry returns to Feed'
);

insert into odiina_test_ids
select 'a-second', result.*
from app.create_entry(
  'aaaaaaaa-0000-4000-8000-000000000003',
  'Owner A second Entry',
  '2026-07-19T06:00:00Z',
  'Asia/Kolkata',
  '2026-07-19',
  330::smallint
) as result;

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}',
  true
);
grant odiina_owner_api to postgres;
set local role odiina_owner_api;
select extensions.throws_ok(
  $$update app.entries
    set current_revision_id = (
      select revision_id from odiina_test_ids where label = 'a-second'
    )
    where id = (
      select entry_id from odiina_test_ids where label = 'a-first'
    );
    set constraints all immediate$$,
  'P0001',
  null,
  'function owner cannot commit a pointer to another Entry revision'
);
select extensions.is(
  (
    select count(*)::bigint
    from app.entries
    where id = (select entry_id from odiina_test_ids where label = 'b-first')
  ),
  0::bigint,
  'function owner remains constrained by request-user RLS'
);

reset role;
revoke odiina_owner_api from postgres;
select extensions.throws_ok(
  $$update app.entry_revisions
    set body_text = 'postgres mutation attempt'
    where id = (
      select revision_id from odiina_test_ids where label = 'a-revised'
    )$$,
  'P0001',
  null,
  'immutable revision trigger rejects privileged update'
);
select extensions.throws_ok(
  $$delete from app.entry_revisions
    where id = (
      select revision_id from odiina_test_ids where label = 'a-revised'
    )$$,
  'P0001',
  null,
  'immutable revision trigger rejects privileged deletion'
);
select extensions.throws_ok(
  $$update app.entries
    set current_revision_id = (
      select revision_id from odiina_test_ids where label = 'b-first'
    )
    where id = (
      select entry_id from odiina_test_ids where label = 'a-first'
    );
    set constraints all immediate$$,
  '23503',
  null,
  'current pointer cannot target another owner revision'
);

set local role service_role;
select extensions.is(
  (select count(*)::bigint from app.entries where id in (
    select entry_id from odiina_test_ids
  )),
  3::bigint,
  'service role bypass behavior is tested separately'
);
select extensions.is(
  (
    select count(*)::bigint
    from app.entry_revisions
    where id in (select revision_id from odiina_test_ids)
  ),
  4::bigint,
  'service-role revision visibility is tested separately from owner RLS'
);

select * from extensions.finish();
rollback;
