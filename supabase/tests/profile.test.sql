begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(26);

select extensions.ok(
  not (select rolbypassrls from pg_roles where rolname = 'odiina_owner_api'),
  'Profile mutation owner cannot bypass RLS'
);
select extensions.ok(
  not pg_catalog.has_function_privilege(
    'anon', 'app.save_profile(text,text,text,uuid,uuid)', 'EXECUTE'
  ),
  'anon cannot save a Profile'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated', 'app.save_profile(text,text,text,uuid,uuid)', 'EXECUTE'
  ),
  'authenticated can invoke the narrow Profile save'
);
select extensions.is(
  (
    select count(*)::bigint
    from pg_proc as p
    join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.proname in (
        'authorize_profile_image_upload', 'save_profile',
        'processing_media_purpose'
      )
      and p.prosecdef
      and p.proconfig @> array['search_path=""']::text[]
  ),
  3::bigint,
  'Profile mutation and worker functions are SECURITY DEFINER with empty search paths'
);
select extensions.is(
  (
    select count(*)::bigint
    from pg_proc as p
    join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.proname in (
        'authorize_profile_image_upload', 'save_profile',
        'profile_statistics', 'processing_media_purpose'
      )
      and 'p_user_id' = any(coalesce(p.proargnames, array[]::text[]))
  ),
  0::bigint,
  'Profile functions never accept a user ID'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '77777777-7777-4777-8777-777777777777',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'profile-a@example.test', '', now(),
    '', '', '', '', '{"provider":"email","providers":["email"]}', '{}', now(), now()
  ),
  (
    '88888888-8888-4888-8888-888888888888',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'profile-b@example.test', '', now(),
    '', '', '', '', '{"provider":"email","providers":["email"]}', '{}', now(), now()
  );

select extensions.is(
  (select display_name from app.profiles where user_id = '77777777-7777-4777-8777-777777777777'),
  'Odiina member',
  'provisioning creates the deterministic default display name'
);
select extensions.matches(
  (select handle from app.profiles where user_id = '77777777-7777-4777-8777-777777777777'),
  '^member_[a-f0-9]{23}$',
  'provisioning creates a deterministic non-email handle'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"77777777-7777-4777-8777-777777777777","role":"authenticated"}',
  true
);
set local role authenticated;
select extensions.is((select count(*)::bigint from app.profiles), 1::bigint, 'owner reads only their Profile');
select extensions.throws_ok(
  $$update app.profiles set display_name = 'Forged'$$,
  '42501', null, 'authenticated cannot update Profile fields directly'
);
select extensions.lives_ok(
  $$select * from app.save_profile('Élodie 李', 'owner_one', E'First line\nSecond line', null, null)$$,
  'owner saves Unicode identity and a multiline plain-text bio'
);
select extensions.is(
  (select handle from app.profiles), 'owner_one', 'canonical handle persists'
);
select extensions.throws_ok(
  $$select * from app.save_profile('Owner', 'profile', '', null, null)$$,
  'P0001', 'odiina_handle_unavailable', 'reserved handle is rejected in Postgres'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"88888888-8888-4888-8888-888888888888","role":"authenticated"}',
  true
);
set local role authenticated;
select extensions.is((select count(*)::bigint from app.profiles), 1::bigint, 'second owner cannot enumerate Profiles');
select extensions.throws_ok(
  $$select * from app.save_profile('Second', 'OWNER_ONE', '', null, null)$$,
  'P0001', 'odiina_handle_unavailable', 'case-insensitive handle conflict is generic and database enforced'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"77777777-7777-4777-8777-777777777777","role":"authenticated"}',
  true
);
set local role authenticated;
create temporary table profile_upload as
select * from app.authorize_profile_image_upload('avatar', 'face.png', 'image/png', 1024);
select extensions.is(
  (select purpose from app.attachments where id = (select attachment_id from profile_upload)),
  'profile_avatar',
  'Profile authorization uses the certified attachment table with an avatar purpose'
);
select extensions.throws_ok(
  format(
    'select * from app.save_profile(%L,%L,%L,%L,null)',
    'Owner One', 'owner_one', '', (select attachment_id from profile_upload)
  ),
  'P0001', 'odiina_profile_media_unready', 'an unready image cannot become the avatar'
);

reset role;
update app.attachments set state = 'accepted', accepted_at = now()
where id = (select attachment_id from profile_upload);
select set_config(
  'request.jwt.claims',
  '{"sub":"77777777-7777-4777-8777-777777777777","role":"authenticated"}',
  true
);
set local role authenticated;
select extensions.lives_ok(
  format(
    'select * from app.save_profile(%L,%L,%L,%L,null)',
    'Owner One', 'owner_one', '', (select attachment_id from profile_upload)
  ),
  'accepted owned avatar can be attached atomically'
);
select extensions.is(
  (select count(*)::bigint from app.profile_media where media_role = 'avatar'),
  1::bigint,
  'owner sees the current avatar pointer'
);
select extensions.lives_ok(
  $$select * from app.save_profile('Owner One','owner_one','',null,null)$$,
  'avatar removal clears the pointer without changing identity'
);
select extensions.is((select count(*)::bigint from app.profile_media), 0::bigint, 'removed avatar is no longer delivered as current');
select extensions.is(
  (select active_entries from app.profile_statistics()),
  0::bigint,
  'empty Profile statistics report zero active Entries'
);

create temporary table profile_entry as
select * from app.create_entry(
  '99999999-0000-4000-8000-000000000001',
  'Profile statistics entry',
  date_trunc('second', statement_timestamp()),
  'UTC',
  (statement_timestamp() at time zone 'UTC')::date,
  0::smallint
);
select extensions.is(
  (select active_entries from app.profile_statistics()),
  1::bigint,
  'active Entry updates Profile statistics'
);
select extensions.is(
  (select active_logging_days from app.profile_statistics()),
  1::bigint,
  'occurrence dates define active logging days'
);
select app.trash_entry((select entry_id from profile_entry));
select extensions.is(
  (select active_entries from app.profile_statistics()),
  0::bigint,
  'Trash excludes the Entry from Profile statistics'
);
select app.restore_entry((select entry_id from profile_entry));
select extensions.is(
  (select active_entries from app.profile_statistics()),
  1::bigint,
  'restore includes the Entry in Profile statistics again'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"88888888-8888-4888-8888-888888888888","role":"authenticated"}',
  true
);
set local role authenticated;
select extensions.is((select count(*)::bigint from app.profile_media), 0::bigint, 'second owner cannot read another Profile media pointer');

select * from extensions.finish();
rollback;
