\set ON_ERROR_STOP on

begin;

do $$
begin
  if has_table_privilege('anon', 'public.sync_objects', 'select') then
    raise exception 'anon must not read sync_objects';
  end if;
  if not has_table_privilege('authenticated', 'public.sync_objects', 'select') then
    raise exception 'authenticated must read sync_objects through RLS';
  end if;
  if has_table_privilege('authenticated', 'public.sync_objects', 'insert,update,delete') then
    raise exception 'authenticated must not write sync_objects directly';
  end if;
  if has_table_privilege('authenticated', 'public.applied_sync_mutations', 'select,insert,update,delete') then
    raise exception 'mutation receipts must not be directly accessible';
  end if;
  if has_function_privilege('anon', 'public.apply_sync_mutation(uuid,text,text,bigint,jsonb,boolean)', 'execute') then
    raise exception 'anon must not execute mutation RPC';
  end if;
  if not has_function_privilege('authenticated', 'public.apply_sync_mutation(uuid,text,text,bigint,jsonb,boolean)', 'execute') then
    raise exception 'authenticated must execute mutation RPC';
  end if;
end $$;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('11111111-1111-4111-8111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sync-a@example.invalid', '', now(), now()),
  ('22222222-2222-4222-8222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sync-b@example.invalid', '', now(), now());

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);

do $$
declare
  first_result jsonb;
  repeated_result jsonb;
  conflict_result jsonb;
  oversized jsonb;
begin
  first_result := public.apply_sync_mutation(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'goals', 'goal-a', null,
    '{"id":"goal-a","createdAt":"2026-09-10T00:00:00.000Z","updatedAt":"2026-09-10T00:00:00.000Z","entityVersion":1,"title":"A","status":"active"}', false
  );
  if first_result->>'status' <> 'applied' or first_result#>>'{receipt,object,server_version}' <> '1' then
    raise exception 'first mutation was not applied at server version 1';
  end if;

  repeated_result := public.apply_sync_mutation(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'goals', 'goal-a', null,
    '{"id":"goal-a","createdAt":"2026-09-10T00:00:00.000Z","updatedAt":"2026-09-10T00:00:00.000Z","entityVersion":1,"title":"A","status":"active"}', false
  );
  if repeated_result is distinct from first_result then
    raise exception 'applied mutation receipt is not idempotent';
  end if;

  conflict_result := public.apply_sync_mutation(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'goals', 'goal-a', 99,
    '{"id":"goal-a","createdAt":"2026-09-10T00:00:00.000Z","updatedAt":"2026-09-10T00:01:00.000Z","entityVersion":2,"title":"stale","status":"active"}', false
  );
  if conflict_result->>'status' <> 'conflict' then
    raise exception 'stale CAS did not return conflict';
  end if;

  begin
    perform public.apply_sync_mutation(
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'goals', 'bad-extra', null,
      '{"id":"bad-extra","createdAt":"2026-09-10T00:00:00.000Z","updatedAt":"2026-09-10T00:00:00.000Z","entityVersion":1,"title":"bad","status":"active","unexpected":true}', false
    );
    raise exception 'unsupported snapshot field was accepted';
  exception when sqlstate '22023' then null;
  end;

  oversized := pg_catalog.jsonb_build_object(
    'id', 'too-large', 'createdAt', '2026-09-10T00:00:00.000Z',
    'updatedAt', '2026-09-10T00:00:00.000Z', 'entityVersion', 1,
    'title', pg_catalog.repeat('x', 270000), 'status', 'active'
  );
  begin
    perform public.apply_sync_mutation(
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'goals', 'too-large', null, oversized, false
    );
    raise exception 'oversized snapshot was accepted';
  exception when sqlstate '22023' then null;
  end;
end $$;

do $$
begin
  if (select count(*) from public.sync_objects) <> 1 then
    raise exception 'user A should see exactly one row';
  end if;
end $$;

select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);

do $$
begin
  if (select count(*) from public.sync_objects) <> 0 then
    raise exception 'RLS exposed user A rows to user B';
  end if;
end $$;

rollback;
