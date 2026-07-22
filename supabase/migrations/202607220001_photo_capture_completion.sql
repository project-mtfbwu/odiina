begin;

alter table app.entry_command_receipts
  drop constraint entry_command_receipts_command_kind_check;
alter table app.entry_command_receipts
  add constraint entry_command_receipts_command_kind_check
  check (command_kind in ('create_entry', 'activate_media_entry'));

grant odiina_owner_api to postgres;
grant create on schema app to odiina_owner_api;

create or replace function app.authorize_image_upload(
  p_entry_id uuid,
  p_original_filename text,
  p_declared_mime text,
  p_expected_byte_count bigint
)
returns table (
  entry_id uuid,
  attachment_id uuid,
  object_id uuid,
  bucket_id text,
  object_key text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := app.request_user_id();
  target_entry app.entries%rowtype;
  target_id uuid := p_entry_id;
  created_attachment uuid := extensions.gen_random_uuid();
  created_object uuid := extensions.gen_random_uuid();
  created_key text := extensions.gen_random_uuid()::text || '/' || extensions.gen_random_uuid()::text;
  safe_filename text := nullif(left(btrim(p_original_filename), 180), '');
  current_count integer := 0;
  unattached_count integer := 0;
begin
  if actor is null then
    raise exception using errcode = '42501', message = 'odiina_auth_required';
  end if;
  if p_expected_byte_count is null
    or p_expected_byte_count not between 1 and 15728640
    or p_declared_mime not in ('image/jpeg', 'image/png', 'image/webp') then
    raise exception using errcode = 'P0001', message = 'odiina_image_upload_invalid';
  end if;

  if target_id is null then
    target_id := extensions.gen_random_uuid();
    insert into app.entries (
      id, user_id, lifecycle_state, current_revision_id, finalized_at
    ) values (target_id, actor, 'draft', null, null);
  else
    select e.* into target_entry
    from app.entries as e
    where e.id = target_id and e.user_id = actor
    for update;
    if not found or target_entry.lifecycle_state not in ('draft', 'active') then
      raise exception using errcode = 'P0001', message = 'odiina_media_entry_unavailable';
    end if;
  end if;

  if target_entry.lifecycle_state = 'active' then
    select count(*) into current_count
    from app.entry_revision_attachments as ra
    where ra.user_id = actor
      and ra.entry_id = target_id
      and ra.revision_id = target_entry.current_revision_id;

    select count(*) into unattached_count
    from app.attachments as a
    where a.user_id = actor
      and a.entry_id = target_id
      and a.purpose = 'entry'
      and a.state not in ('rejected', 'failed', 'deleting', 'deleted')
      and not exists (
        select 1
        from app.entry_revision_attachments as membership
        where membership.user_id = a.user_id
          and membership.entry_id = a.entry_id
          and membership.attachment_id = a.id
      );
  else
    select count(*) into unattached_count
    from app.attachments as a
    where a.user_id = actor
      and a.entry_id = target_id
      and a.purpose = 'entry'
      and a.state not in ('rejected', 'failed', 'deleting', 'deleted');
  end if;

  if current_count + unattached_count >= 5 then
    raise exception using errcode = 'P0001', message = 'odiina_attachment_limit';
  end if;

  insert into app.attachments (
    id, user_id, entry_id, media_kind, purpose, state, original_filename,
    declared_mime, expected_byte_count
  ) values (
    created_attachment, actor, target_id, 'image', 'entry', 'pending_upload',
    safe_filename, p_declared_mime, p_expected_byte_count
  );
  insert into app.attachment_objects (
    id, user_id, entry_id, attachment_id, variant, bucket_id, object_key, state
  ) values (
    created_object, actor, target_id, created_attachment, 'quarantine',
    'odiina-quarantine', created_key, 'expected'
  );
  return query
  select target_id, created_attachment, created_object,
    'odiina-quarantine'::text, created_key;
end
$$;

revoke all on function app.activate_media_entry(
  uuid, text, uuid[], timestamptz, text, date, smallint
) from public, anon, authenticated;
drop function app.activate_media_entry(
  uuid, text, uuid[], timestamptz, text, date, smallint
);

create function app.activate_media_entry(
  p_client_request_id uuid,
  p_entry_id uuid,
  p_body_text text,
  p_attachment_ids uuid[],
  p_occurred_at timestamptz,
  p_occurred_timezone text,
  p_occurred_local_date date,
  p_occurred_utc_offset_minutes smallint
)
returns table (entry_id uuid, revision_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := app.request_user_id();
  normalized_body text := btrim(coalesce(p_body_text, ''));
  created_revision uuid := extensions.gen_random_uuid();
  requested_count integer := coalesce(array_length(p_attachment_ids, 1), 0);
  canonical_hash bytea;
  receipt app.entry_command_receipts%rowtype;
begin
  if actor is null then
    raise exception using errcode = '42501', message = 'odiina_auth_required';
  end if;
  if p_client_request_id is null then
    raise exception using errcode = 'P0001', message = 'odiina_entry_invalid';
  end if;
  perform app.assert_occurrence(
    p_occurred_at, p_occurred_timezone, p_occurred_local_date,
    p_occurred_utc_offset_minutes
  );
  if char_length(normalized_body) > 100000
    or requested_count > 5
    or (char_length(normalized_body) = 0 and requested_count = 0)
    or requested_count <> (
      select count(distinct value)
      from unnest(coalesce(p_attachment_ids, array[]::uuid[])) as value
    ) then
    raise exception using errcode = 'P0001', message = 'odiina_entry_invalid';
  end if;

  canonical_hash := extensions.digest(
    convert_to(
      jsonb_build_object(
        'entry_id', p_entry_id,
        'body_text', normalized_body,
        'attachment_ids', p_attachment_ids,
        'occurred_at', p_occurred_at,
        'occurred_timezone', p_occurred_timezone,
        'occurred_local_date', p_occurred_local_date,
        'occurred_utc_offset_minutes', p_occurred_utc_offset_minutes
      )::text,
      'UTF8'
    ),
    'sha256'
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      actor::text || ':activate_media_entry:' || p_client_request_id::text,
      0
    )
  );
  select r.* into receipt
  from app.entry_command_receipts as r
  where r.user_id = actor
    and r.command_kind = 'activate_media_entry'
    and r.client_request_id = p_client_request_id;
  if found then
    if receipt.request_hash <> canonical_hash then
      raise exception using errcode = 'P0001', message = 'odiina_idempotency_conflict';
    end if;
    return query select receipt.entry_id, receipt.revision_id;
    return;
  end if;

  perform 1 from app.entries
  where id = p_entry_id and user_id = actor and lifecycle_state = 'draft'
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'odiina_media_draft_unavailable';
  end if;
  if requested_count <> (
    select count(*)
    from app.attachments as a
    where a.id = any(coalesce(p_attachment_ids, array[]::uuid[]))
      and a.user_id = actor
      and a.entry_id = p_entry_id
      and a.media_kind = 'image'
      and a.purpose = 'entry'
      and a.state = 'accepted'
  ) then
    raise exception using errcode = 'P0001', message = 'odiina_attachment_unavailable';
  end if;

  insert into app.entry_revisions (
    id, user_id, entry_id, revision_number, body_text, occurred_at,
    occurred_timezone, occurred_local_date, occurred_utc_offset_minutes,
    change_reason
  ) values (
    created_revision, actor, p_entry_id, 1, normalized_body, p_occurred_at,
    p_occurred_timezone, p_occurred_local_date, p_occurred_utc_offset_minutes,
    'created'
  );
  insert into app.entry_revision_attachments (
    user_id, entry_id, revision_id, attachment_id, position
  )
  select actor, p_entry_id, created_revision, value, ordinality::smallint
  from unnest(coalesce(p_attachment_ids, array[]::uuid[]))
    with ordinality as selected(value, ordinality);
  update app.entries
  set current_revision_id = created_revision,
      lifecycle_state = 'active',
      finalized_at = statement_timestamp()
  where id = p_entry_id and user_id = actor;
  insert into app.entry_command_receipts (
    user_id, command_kind, client_request_id, request_hash, entry_id, revision_id
  ) values (
    actor, 'activate_media_entry', p_client_request_id, canonical_hash,
    p_entry_id, created_revision
  );
  return query select p_entry_id, created_revision;
end
$$;

revoke all on function app.authorize_image_upload(uuid, text, text, bigint)
  from public, anon;
revoke all on function app.activate_media_entry(
  uuid, uuid, text, uuid[], timestamptz, text, date, smallint
) from public, anon;
grant execute on function app.authorize_image_upload(uuid, text, text, bigint)
  to authenticated;
grant execute on function app.activate_media_entry(
  uuid, uuid, text, uuid[], timestamptz, text, date, smallint
) to authenticated;

alter function app.authorize_image_upload(uuid, text, text, bigint)
  owner to odiina_owner_api;
alter function app.activate_media_entry(
  uuid, uuid, text, uuid[], timestamptz, text, date, smallint
) owner to odiina_owner_api;

comment on function app.activate_media_entry(
  uuid, uuid, text, uuid[], timestamptz, text, date, smallint
) is 'Idempotently activates one accepted private-media draft using the Entry command-receipt boundary.';

revoke create on schema app from odiina_owner_api;
revoke odiina_owner_api from postgres;

commit;
