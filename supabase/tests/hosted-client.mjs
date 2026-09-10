import { createClient } from "@supabase/supabase-js";

const { TEST_SUPABASE_URL: url, TEST_SUPABASE_KEY: key, TEST_USER_EMAIL: email, TEST_USER_PASSWORD: password } = process.env;
if (!url || !key || !email || !password) throw new Error("Hosted test configuration is missing");

const client = createClient(url, key, { auth: { persistSession: false } });
const signedIn = await client.auth.signInWithPassword({ email, password });
if (signedIn.error || !signedIn.data.user) throw signedIn.error ?? new Error("Hosted sign-in failed");

const entityId = `hosted-check-${crypto.randomUUID()}`;
const opId = crypto.randomUUID();
const snapshot = {
  id: entityId,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  entityVersion: 1,
  title: "Hosted synchronization check",
  status: "active",
};
const applied = await client.rpc("apply_sync_mutation", {
  p_op_id: opId,
  p_entity_type: "goals",
  p_entity_id: entityId,
  p_base_server_version: null,
  p_desired_snapshot: snapshot,
  p_is_deleted: false,
});
if (applied.error || applied.data?.status !== "applied") throw applied.error ?? new Error("Hosted mutation failed");
if (typeof applied.data.receipt.object.server_version !== "string") throw new Error("Hosted bigint was not encoded as text");

const repeated = await client.rpc("apply_sync_mutation", {
  p_op_id: opId,
  p_entity_type: "goals",
  p_entity_id: entityId,
  p_base_server_version: null,
  p_desired_snapshot: snapshot,
  p_is_deleted: false,
});
if (repeated.error || JSON.stringify(repeated.data) !== JSON.stringify(applied.data)) throw new Error("Hosted receipt retry failed");

const pulled = await client.rpc("pull_sync_changes", { p_after_change_seq: "0", p_limit: 100 });
if (pulled.error || !pulled.data.some((row) => row.entity_id === entityId)) throw pulled.error ?? new Error("Hosted pull failed");

const directWrite = await client.from("sync_objects").insert({ user_id: signedIn.data.user.id });
if (!directWrite.error) throw new Error("Hosted direct write was unexpectedly allowed");
await client.auth.signOut({ scope: "local" });
console.log("Hosted Auth/RPC/RLS synchronization passed");
