-- Synthetic local-development identities only. No real user data.
insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values (
  '11111111-1111-4111-8111-111111111111',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'ada@example.test',
  '',
  now(),
  '',
  '',
  '',
  '',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Ada Example"}'::jsonb,
  now(),
  now()
)
on conflict (id) do nothing;

begin;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","email":"ada@example.test"}',
  true
);
select app.save_preferences('Asia/Kolkata', 1::smallint);
select *
from app.create_entry(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Synthetic seed Entry: reviewed the first Odiina vertical slice.',
  '2026-07-19T09:30:00+05:30'::timestamptz,
  'Asia/Kolkata',
  '2026-07-19'::date,
  330::smallint
);
commit;
