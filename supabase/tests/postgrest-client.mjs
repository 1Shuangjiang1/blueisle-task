import { createClient } from "@supabase/supabase-js";

const { TEST_SUPABASE_URL: url, TEST_SUPABASE_KEY: key, TEST_SUPABASE_SERVICE_KEY: serviceKey } = process.env;
if (!url || !key || !serviceKey) throw new Error("Local Supabase test environment is missing");

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const password = `Test-${crypto.randomUUID()}-Aa1!`;
const users = [];

async function createUser(label) {
  const email = `${label}-${suffix}@example.invalid`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("Unable to create test user");
  users.push(data.user.id);
  const client = createClient(url, key, { auth: { persistSession: false } });
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;
  return client;
}

try {
  const clientA = await createUser("sync-a");
  const clientB = await createUser("sync-b");
  const snapshot = {
    id: "postgrest-goal",
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z",
    entityVersion: 1,
    title: "PostgREST round trip",
    status: "active",
  };
  const opId = crypto.randomUUID();
  const first = await clientA.rpc("apply_sync_mutation", {
    p_op_id: opId,
    p_entity_type: "goals",
    p_entity_id: snapshot.id,
    p_base_server_version: null,
    p_desired_snapshot: snapshot,
    p_is_deleted: false,
  });
  if (first.error || first.data?.status !== "applied") throw first.error ?? new Error("RPC apply failed");
  if (first.data.receipt.object.server_version !== "1") throw new Error("bigint server version was not returned as text");

  const repeat = await clientA.rpc("apply_sync_mutation", {
    p_op_id: opId,
    p_entity_type: "goals",
    p_entity_id: snapshot.id,
    p_base_server_version: null,
    p_desired_snapshot: snapshot,
    p_is_deleted: false,
  });
  if (repeat.error || JSON.stringify(repeat.data) !== JSON.stringify(first.data)) throw new Error("PostgREST retry was not idempotent");

  const pullA = await clientA.rpc("pull_sync_changes", { p_after_change_seq: "0", p_limit: 100 });
  if (pullA.error || pullA.data.length !== 1 || typeof pullA.data[0].change_seq !== "string") throw new Error("User A pull or bigint text conversion failed");
  const pullB = await clientB.rpc("pull_sync_changes", { p_after_change_seq: "0", p_limit: 100 });
  if (pullB.error || pullB.data.length !== 0) throw new Error("RLS exposed user A data to user B");

  const directWrite = await clientA.from("sync_objects").insert({ user_id: users[0] });
  if (!directWrite.error) throw new Error("authenticated direct table write was allowed");
  console.log("PostgREST/Auth/RPC/RLS integration passed");
} finally {
  for (const userId of users) await admin.auth.admin.deleteUser(userId);
}
