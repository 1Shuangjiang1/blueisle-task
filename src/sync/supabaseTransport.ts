import type { SupabaseClient } from "@supabase/supabase-js";
import { SyncTransportError } from "./errors";
import { parseSyncObject } from "./serializer";
import type {
  AuthSession,
  OutboxOp,
  PullPage,
  PushMutationResult,
  SyncTransport,
} from "./types";

function classifySupabaseError(error: { message: string; code?: string }): SyncTransportError {
  const unauthorized = error.code === "42501" || error.code === "PGRST301";
  return new SyncTransportError(
    error.message,
    unauthorized ? "unauthorized" : "server",
    !unauthorized && !error.code?.startsWith("22"),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Supabase adapter. This is the only sync module that imports supabase-js. */
export class SupabaseSyncTransport implements SyncTransport {
  constructor(private readonly client: SupabaseClient) {}

  async pushMutation(session: AuthSession, operation: OutboxOp): Promise<PushMutationResult> {
    if (session.userId !== operation.userId) {
      throw new SyncTransportError("operation belongs to another user", "unauthorized", false);
    }
    const { data, error } = await this.client.rpc("apply_sync_mutation", {
      p_op_id: operation.opId,
      p_entity_type: operation.entityType,
      p_entity_id: operation.entityId,
      p_base_server_version: operation.baseServerVersion,
      p_desired_snapshot: operation.desiredSnapshot,
      p_is_deleted: operation.desiredSnapshot === null,
    });
    if (error) throw classifySupabaseError(error);
    if (!isRecord(data) || (data.status !== "applied" && data.status !== "conflict")) {
      throw new SyncTransportError("invalid apply_sync_mutation response", "invalid-response", false);
    }

    if (data.status === "conflict") {
      return { status: "conflict", remote: parseSyncObject(data.remote) };
    }
    if (!isRecord(data.receipt) || data.receipt.op_id !== operation.opId) {
      throw new SyncTransportError("invalid mutation receipt", "invalid-response", false);
    }
    return {
      status: "applied",
      receipt: { opId: operation.opId, object: parseSyncObject(data.receipt.object) },
    };
  }

  async pullChanges(session: AuthSession, afterChangeSeq: string, limit: number): Promise<PullPage> {
    if (!/^\d+$/.test(afterChangeSeq) || !Number.isInteger(limit) || limit < 1) {
      throw new TypeError("invalid pull cursor or page size");
    }
    // The read RPC casts bigint columns to text before JSON encoding. Selecting
    // raw bigint columns through PostgREST could lose precision in JSON.parse.
    // It is SECURITY INVOKER, so sync_objects RLS still enforces ownership.
    const { data, error } = await this.client.rpc("pull_sync_changes", {
      p_after_change_seq: afterChangeSeq,
      p_limit: limit + 1,
    });
    if (error) throw classifySupabaseError(error);
    if (!Array.isArray(data)) {
      throw new SyncTransportError("invalid pull_sync_changes response", "invalid-response", false);
    }
    const parsed = data.map(parseSyncObject);
    if (parsed.some((object) => object.userId !== session.userId)) {
      throw new SyncTransportError("RLS returned another user's object", "invalid-response", false);
    }
    const hasMore = parsed.length > limit;
    const changes = parsed.slice(0, limit);
    return {
      changes,
      nextCursor: changes.at(-1)?.changeSeq ?? afterChangeSeq,
      hasMore,
    };
  }
}
