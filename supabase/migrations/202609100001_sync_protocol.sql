create table public.sync_objects (
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_type text not null check (entity_type in (
    'goals', 'goalSteps', 'calendarEvents', 'planBlocks', 'completionLogs', 'dailyReviews'
  )),
  entity_id text not null check (length(entity_id) between 1 and 512),
  server_version bigint not null check (server_version > 0),
  change_seq bigint not null check (change_seq > 0),
  snapshot jsonb,
  is_deleted boolean not null,
  changed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (user_id, entity_type, entity_id),
  unique (user_id, change_seq),
  check (
    (is_deleted and snapshot is null)
    or (not is_deleted and pg_catalog.jsonb_typeof(snapshot) = 'object')
  )
);

create index sync_objects_user_changes_idx
  on public.sync_objects (user_id, change_seq);

create table public.applied_sync_mutations (
  user_id uuid not null references auth.users(id) on delete cascade,
  op_id uuid not null,
  entity_type text not null,
  entity_id text not null,
  server_version bigint not null,
  change_seq bigint not null,
  snapshot jsonb,
  is_deleted boolean not null,
  changed_at timestamptz not null,
  applied_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (user_id, op_id),
  check (
    (is_deleted and snapshot is null)
    or (not is_deleted and pg_catalog.jsonb_typeof(snapshot) = 'object')
  )
);

alter table public.sync_objects enable row level security;
alter table public.applied_sync_mutations enable row level security;

create policy sync_objects_select_own
  on public.sync_objects
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.sync_objects from anon, authenticated;
revoke all on table public.applied_sync_mutations from anon, authenticated;
grant select on table public.sync_objects to authenticated;

-- Bigints are cast to text before PostgREST JSON encoding, avoiding JavaScript
-- precision loss. SECURITY INVOKER deliberately keeps sync_objects RLS active.
create or replace function public.pull_sync_changes(
  p_after_change_seq bigint,
  p_limit integer
)
returns table (
  user_id uuid,
  entity_type text,
  entity_id text,
  server_version text,
  change_seq text,
  snapshot jsonb,
  is_deleted boolean,
  changed_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    objects.user_id,
    objects.entity_type,
    objects.entity_id,
    objects.server_version::text,
    objects.change_seq::text,
    objects.snapshot,
    objects.is_deleted,
    objects.changed_at
  from public.sync_objects as objects
  where objects.user_id = auth.uid()
    and objects.change_seq > p_after_change_seq
  order by objects.change_seq asc
  limit case when p_limit < 1 then 1 when p_limit > 1001 then 1001 else p_limit end
$$;

revoke all on function public.pull_sync_changes(bigint, integer) from public;
revoke all on function public.pull_sync_changes(bigint, integer) from anon;
grant execute on function public.pull_sync_changes(bigint, integer) to authenticated;

create or replace function public.apply_sync_mutation(
  p_op_id uuid,
  p_entity_type text,
  p_entity_id text,
  p_base_server_version bigint,
  p_desired_snapshot jsonb,
  p_is_deleted boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_current public.sync_objects%rowtype;
  v_receipt public.applied_sync_mutations%rowtype;
  v_server_version bigint;
  v_change_seq bigint;
  v_changed_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_entity_type not in ('goals', 'goalSteps', 'calendarEvents', 'planBlocks', 'completionLogs', 'dailyReviews') then
    raise exception 'invalid entity type' using errcode = '22023';
  end if;
  if p_entity_id is null or length(p_entity_id) not between 1 and 512 then
    raise exception 'invalid entity id' using errcode = '22023';
  end if;
  if (p_is_deleted and p_desired_snapshot is not null)
    or (not p_is_deleted and (p_desired_snapshot is null or pg_catalog.jsonb_typeof(p_desired_snapshot) <> 'object')) then
    raise exception 'snapshot and deletion flag disagree' using errcode = '22023';
  end if;
  if not p_is_deleted and p_desired_snapshot->>'id' is distinct from p_entity_id then
    raise exception 'snapshot id does not match entity id' using errcode = '22023';
  end if;
  if not p_is_deleted and pg_catalog.pg_column_size(p_desired_snapshot) > 262144 then
    raise exception 'snapshot exceeds 256 KiB' using errcode = '22023';
  end if;
  if not p_is_deleted and (
    pg_catalog.jsonb_typeof(p_desired_snapshot->'id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_desired_snapshot->'createdAt') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_desired_snapshot->'updatedAt') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_desired_snapshot->'entityVersion') is distinct from 'number'
    or (p_desired_snapshot ? 'deletedAt' and pg_catalog.jsonb_typeof(p_desired_snapshot->'deletedAt') is distinct from 'string')
  ) then
    raise exception 'snapshot base fields are invalid' using errcode = '22023';
  end if;
  if not p_is_deleted and exists (
    select 1
    from pg_catalog.jsonb_object_keys(p_desired_snapshot) as snapshot_key
    where not (
      (p_entity_type = 'goals' and snapshot_key = any(array['id','createdAt','updatedAt','entityVersion','deletedAt','title','description','status','color','dueDate','calendarEventId']))
      or (p_entity_type = 'goalSteps' and snapshot_key = any(array['id','createdAt','updatedAt','entityVersion','deletedAt','goalId','parentStepId','title','notes','order','progressKind','progressValue','progressTarget','isCompleted','completedAt']))
      or (p_entity_type = 'calendarEvents' and snapshot_key = any(array['id','createdAt','updatedAt','entityVersion','deletedAt','title','kind','startAt','endAt','timezone','isAllDay','notes','goalId']))
      or (p_entity_type = 'planBlocks' and snapshot_key = any(array['id','createdAt','updatedAt','entityVersion','deletedAt','date','title','startMinute','endMinute','status','goalId','goalStepId','notes','order']))
      or (p_entity_type = 'completionLogs' and snapshot_key = any(array['id','createdAt','updatedAt','entityVersion','deletedAt','planBlockId','goalId','goalStepId','completedAt','actualMinutes','outcome','notes','nextStep']))
      or (p_entity_type = 'dailyReviews' and snapshot_key = any(array['id','createdAt','updatedAt','entityVersion','deletedAt','date','reflection','blockers','tomorrowFocus']))
    )
  ) then
    raise exception 'snapshot contains unsupported fields' using errcode = '22023';
  end if;
  if not p_is_deleted and (
    (p_entity_type = 'goals' and (pg_catalog.jsonb_typeof(p_desired_snapshot->'title') is distinct from 'string' or pg_catalog.jsonb_typeof(p_desired_snapshot->'status') is distinct from 'string'))
    or (p_entity_type = 'goalSteps' and (pg_catalog.jsonb_typeof(p_desired_snapshot->'goalId') is distinct from 'string' or pg_catalog.jsonb_typeof(p_desired_snapshot->'title') is distinct from 'string' or pg_catalog.jsonb_typeof(p_desired_snapshot->'order') is distinct from 'number' or pg_catalog.jsonb_typeof(p_desired_snapshot->'isCompleted') is distinct from 'boolean'))
    or (p_entity_type = 'calendarEvents' and (pg_catalog.jsonb_typeof(p_desired_snapshot->'title') is distinct from 'string' or pg_catalog.jsonb_typeof(p_desired_snapshot->'startAt') is distinct from 'string' or pg_catalog.jsonb_typeof(p_desired_snapshot->'timezone') is distinct from 'string' or pg_catalog.jsonb_typeof(p_desired_snapshot->'isAllDay') is distinct from 'boolean'))
    or (p_entity_type = 'planBlocks' and (pg_catalog.jsonb_typeof(p_desired_snapshot->'date') is distinct from 'string' or pg_catalog.jsonb_typeof(p_desired_snapshot->'title') is distinct from 'string' or pg_catalog.jsonb_typeof(p_desired_snapshot->'status') is distinct from 'string' or pg_catalog.jsonb_typeof(p_desired_snapshot->'order') is distinct from 'number'))
    or (p_entity_type = 'completionLogs' and (pg_catalog.jsonb_typeof(p_desired_snapshot->'planBlockId') is distinct from 'string' or pg_catalog.jsonb_typeof(p_desired_snapshot->'completedAt') is distinct from 'string'))
    or (p_entity_type = 'dailyReviews' and pg_catalog.jsonb_typeof(p_desired_snapshot->'date') is distinct from 'string')
  ) then
    raise exception 'snapshot entity fields are invalid' using errcode = '22023';
  end if;

  -- Serializes sequence allocation and commit order for one account.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 0));

  select * into v_receipt
  from public.applied_sync_mutations
  where user_id = v_user_id and op_id = p_op_id;

  if found then
    return pg_catalog.jsonb_build_object(
      'status', 'applied',
      'receipt', pg_catalog.jsonb_build_object(
        'op_id', v_receipt.op_id,
        'object', pg_catalog.jsonb_build_object(
          'user_id', v_receipt.user_id,
          'entity_type', v_receipt.entity_type,
          'entity_id', v_receipt.entity_id,
          'server_version', v_receipt.server_version::text,
          'change_seq', v_receipt.change_seq::text,
          'snapshot', v_receipt.snapshot,
          'is_deleted', v_receipt.is_deleted,
          'changed_at', v_receipt.changed_at
        )
      )
    );
  end if;

  select * into v_current
  from public.sync_objects
  where user_id = v_user_id
    and entity_type = p_entity_type
    and entity_id = p_entity_id
  for update;

  if (found and (p_base_server_version is null or v_current.server_version <> p_base_server_version))
    or (not found and p_base_server_version is not null) then
    if not found then
      raise exception 'client supplied a base version for a missing object' using errcode = '40001';
    end if;
    return pg_catalog.jsonb_build_object(
      'status', 'conflict',
      'remote', pg_catalog.jsonb_build_object(
        'user_id', v_current.user_id,
        'entity_type', v_current.entity_type,
        'entity_id', v_current.entity_id,
        'server_version', v_current.server_version::text,
        'change_seq', v_current.change_seq::text,
        'snapshot', v_current.snapshot,
        'is_deleted', v_current.is_deleted,
        'changed_at', v_current.changed_at
      )
    );
  end if;

  v_server_version := coalesce(v_current.server_version, 0) + 1;
  select coalesce(max(change_seq), 0) + 1 into v_change_seq
  from public.sync_objects
  where user_id = v_user_id;
  v_changed_at := pg_catalog.clock_timestamp();

  insert into public.sync_objects (
    user_id, entity_type, entity_id, server_version, change_seq, snapshot, is_deleted, changed_at
  ) values (
    v_user_id, p_entity_type, p_entity_id, v_server_version, v_change_seq,
    p_desired_snapshot, p_is_deleted, v_changed_at
  )
  on conflict (user_id, entity_type, entity_id) do update set
    server_version = excluded.server_version,
    change_seq = excluded.change_seq,
    snapshot = excluded.snapshot,
    is_deleted = excluded.is_deleted,
    changed_at = excluded.changed_at;

  insert into public.applied_sync_mutations (
    user_id, op_id, entity_type, entity_id, server_version, change_seq,
    snapshot, is_deleted, changed_at
  ) values (
    v_user_id, p_op_id, p_entity_type, p_entity_id, v_server_version, v_change_seq,
    p_desired_snapshot, p_is_deleted, v_changed_at
  );

  return pg_catalog.jsonb_build_object(
    'status', 'applied',
    'receipt', pg_catalog.jsonb_build_object(
      'op_id', p_op_id,
      'object', pg_catalog.jsonb_build_object(
        'user_id', v_user_id,
        'entity_type', p_entity_type,
        'entity_id', p_entity_id,
        'server_version', v_server_version::text,
        'change_seq', v_change_seq::text,
        'snapshot', p_desired_snapshot,
        'is_deleted', p_is_deleted,
        'changed_at', v_changed_at
      )
    )
  );
end;
$$;

revoke all on function public.apply_sync_mutation(uuid, text, text, bigint, jsonb, boolean) from public;
revoke all on function public.apply_sync_mutation(uuid, text, text, bigint, jsonb, boolean) from anon;
grant execute on function public.apply_sync_mutation(uuid, text, text, bigint, jsonb, boolean) to authenticated;
