import type {
  EntityType,
  JsonObject,
  JsonValue,
  ServerBigInt,
  SyncObject,
} from "./types";

const ENTITY_TYPES: readonly EntityType[] = [
  "goals",
  "goalSteps",
  "calendarEvents",
  "planBlocks",
  "completionLogs",
  "dailyReviews",
];

const DECIMAL_BIGINT = /^(0|[1-9]\d*)$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertString(record: Record<string, unknown>, key: string): void {
  if (typeof record[key] !== "string") throw new TypeError(`${key} must be a string`);
}

function assertOptionalString(record: Record<string, unknown>, key: string): void {
  if (record[key] !== undefined && typeof record[key] !== "string") {
    throw new TypeError(`${key} must be a string when present`);
  }
}

function assertOptionalNumber(record: Record<string, unknown>, key: string): void {
  if (record[key] !== undefined && (!Number.isFinite(record[key]) || typeof record[key] !== "number")) {
    throw new TypeError(`${key} must be a finite number when present`);
  }
}

function assertNumber(record: Record<string, unknown>, key: string): void {
  if (typeof record[key] !== "number" || !Number.isFinite(record[key])) {
    throw new TypeError(`${key} must be a finite number`);
  }
}

function assertOneOf(record: Record<string, unknown>, key: string, values: readonly string[]): void {
  if (typeof record[key] !== "string" || !values.includes(record[key])) {
    throw new TypeError(`${key} must be one of: ${values.join(", ")}`);
  }
}

function assertJsonValue(value: unknown, path = "snapshot"): asserts value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${path} contains a non-finite number`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertJsonValue(entry, `${path}[${index}]`));
    return;
  }
  if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined) throw new TypeError(`${path}.${key} cannot be undefined`);
      assertJsonValue(entry, `${path}.${key}`);
    }
    return;
  }
  throw new TypeError(`${path} is not JSON-safe`);
}

function assertBaseEntity(record: Record<string, unknown>): void {
  assertString(record, "id");
  assertString(record, "createdAt");
  assertString(record, "updatedAt");
  if (!Number.isInteger(record.entityVersion) || (record.entityVersion as number) < 0) {
    throw new TypeError("entityVersion must be a non-negative integer");
  }
  assertOptionalString(record, "deletedAt");
}

/** Validate a business snapshot before it crosses a trust boundary. */
export function validateSnapshot(entityType: EntityType, value: unknown): JsonObject {
  if (!isRecord(value)) throw new TypeError(`${entityType} snapshot must be an object`);
  assertJsonValue(value);
  assertBaseEntity(value);

  switch (entityType) {
    case "goals":
      assertString(value, "title");
      assertOneOf(value, "status", ["active", "paused", "completed", "archived"]);
      assertOptionalString(value, "description");
      assertOptionalString(value, "color");
      assertOptionalString(value, "dueDate");
      assertOptionalString(value, "calendarEventId");
      break;
    case "goalSteps":
      assertString(value, "goalId");
      assertOptionalString(value, "parentStepId");
      assertString(value, "title");
      assertOptionalString(value, "notes");
      if (typeof value.isCompleted !== "boolean") throw new TypeError("isCompleted must be boolean");
      assertNumber(value, "order");
      assertOneOf(value, "progressKind", ["binary", "manual", "count"]);
      assertNumber(value, "progressValue");
      assertOptionalNumber(value, "progressTarget");
      assertOptionalString(value, "completedAt");
      break;
    case "calendarEvents":
      assertString(value, "title");
      assertOneOf(value, "kind", ["interview", "assessment", "deadline", "personal", "other"]);
      assertString(value, "startAt");
      assertOptionalString(value, "endAt");
      assertString(value, "timezone");
      if (typeof value.isAllDay !== "boolean") throw new TypeError("isAllDay must be boolean");
      assertOptionalString(value, "notes");
      assertOptionalString(value, "goalId");
      break;
    case "planBlocks":
      assertString(value, "date");
      assertString(value, "title");
      assertOneOf(value, "status", ["planned", "completed", "cancelled"]);
      assertOptionalNumber(value, "startMinute");
      assertOptionalNumber(value, "endMinute");
      assertOptionalString(value, "goalId");
      assertOptionalString(value, "goalStepId");
      assertOptionalString(value, "notes");
      assertNumber(value, "order");
      break;
    case "completionLogs":
      assertString(value, "planBlockId");
      assertOptionalString(value, "goalId");
      assertOptionalString(value, "goalStepId");
      assertString(value, "completedAt");
      assertOptionalNumber(value, "actualMinutes");
      assertOptionalString(value, "outcome");
      assertOptionalString(value, "notes");
      assertOptionalString(value, "nextStep");
      break;
    case "dailyReviews":
      assertString(value, "date");
      assertOptionalString(value, "reflection");
      assertOptionalString(value, "blockers");
      assertOptionalString(value, "tomorrowFocus");
      break;
  }
  return value as JsonObject;
}

/** JSON round-trip removes prototypes and rejects undefined/non-JSON values. */
export function serializeEntity(entityType: EntityType, value: unknown): JsonObject {
  const valid = validateSnapshot(entityType, value);
  return validateSnapshot(entityType, JSON.parse(JSON.stringify(valid)) as unknown);
}

export function deserializeEntity(entityType: EntityType, value: unknown): JsonObject {
  return validateSnapshot(entityType, value);
}

export function parseServerBigInt(value: unknown, name: string): ServerBigInt {
  const text = typeof value === "bigint" ? value.toString() : String(value);
  if (!DECIMAL_BIGINT.test(text)) throw new TypeError(`${name} must be an unsigned decimal bigint string`);
  return text;
}

/** Validate and normalize an untrusted object returned by an RPC or HTTP server. */
export function parseSyncObject(value: unknown): SyncObject {
  if (!isRecord(value)) throw new TypeError("sync object must be an object");
  const entityType = value.entityType ?? value.entity_type;
  if (!ENTITY_TYPES.includes(entityType as EntityType)) throw new TypeError("unknown entity type");
  const snapshotValue = value.snapshot ?? null;
  const isDeleted = value.isDeleted ?? value.is_deleted;
  if (typeof isDeleted !== "boolean") throw new TypeError("isDeleted must be boolean");
  if (isDeleted && snapshotValue !== null) throw new TypeError("a tombstone cannot contain a snapshot");
  if (!isDeleted && snapshotValue === null) throw new TypeError("a live object requires a snapshot");

  const userId = value.userId ?? value.user_id;
  const entityId = value.entityId ?? value.entity_id;
  const changedAt = value.changedAt ?? value.changed_at;
  if (typeof userId !== "string" || typeof entityId !== "string" || typeof changedAt !== "string") {
    throw new TypeError("sync object identity and changedAt must be strings");
  }

  const snapshot = snapshotValue === null
    ? null
    : validateSnapshot(entityType as EntityType, snapshotValue);
  if (snapshot !== null && snapshot.id !== entityId) {
    throw new TypeError("snapshot id does not match sync object entityId");
  }

  return {
    userId,
    entityType: entityType as EntityType,
    entityId,
    serverVersion: parseServerBigInt(value.serverVersion ?? value.server_version, "serverVersion"),
    changeSeq: parseServerBigInt(value.changeSeq ?? value.change_seq, "changeSeq"),
    snapshot,
    isDeleted,
    changedAt,
  };
}

const MISSING = Symbol("missing");
type MaybeValue = JsonValue | typeof MISSING;

function valuesEqual(left: MaybeValue, right: MaybeValue): boolean {
  if (left === MISSING || right === MISSING) return left === right;
  if (left === right) return true;
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((item, index) => valuesEqual(item, right[index]));
  }
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && valuesEqual(left[key] ?? MISSING, right[key] ?? MISSING));
}

export function jsonValuesEqual(left: JsonValue, right: JsonValue): boolean {
  return valuesEqual(left, right);
}

function setMerged(target: Record<string, JsonValue>, key: string, value: MaybeValue): void {
  if (value !== MISSING) target[key] = value;
}

export type ThreeWayMergeResult =
  | { readonly kind: "merged"; readonly snapshot: JsonObject | null }
  | { readonly kind: "conflict"; readonly fields: readonly string[]; readonly conflictKind: "field" | "delete-edit" };

/** Merge independent top-level field changes and surface every divergent shared edit. */
export function mergeSnapshots(
  base: JsonObject | null,
  local: JsonObject | null,
  remote: JsonObject | null,
): ThreeWayMergeResult {
  if (valuesEqual(local ?? MISSING, remote ?? MISSING)) return { kind: "merged", snapshot: local };
  if (valuesEqual(local ?? MISSING, base ?? MISSING)) return { kind: "merged", snapshot: remote };
  if (valuesEqual(remote ?? MISSING, base ?? MISSING)) return { kind: "merged", snapshot: local };

  if (local === null || remote === null) {
    return { kind: "conflict", fields: ["$deleted"], conflictKind: "delete-edit" };
  }

  const merged: Record<string, JsonValue> = {};
  const conflicts: string[] = [];
  const keys = new Set([...Object.keys(base ?? {}), ...Object.keys(local), ...Object.keys(remote)]);
  for (const key of [...keys].sort()) {
    const baseValue: MaybeValue = base && key in base ? base[key] : MISSING;
    const localValue: MaybeValue = key in local ? local[key] : MISSING;
    const remoteValue: MaybeValue = key in remote ? remote[key] : MISSING;
    const localChanged = !valuesEqual(localValue, baseValue);
    const remoteChanged = !valuesEqual(remoteValue, baseValue);

    if (localChanged && remoteChanged && !valuesEqual(localValue, remoteValue) && key === "updatedAt") {
      // updatedAt is device-authored bookkeeping. It must never turn clock skew
      // into a content conflict; keep the timestamp associated with this edit.
      setMerged(merged, key, localValue);
    } else if (localChanged && remoteChanged && !valuesEqual(localValue, remoteValue) && key === "entityVersion") {
      const localVersion = typeof localValue === "number" ? localValue : 0;
      const remoteVersion = typeof remoteValue === "number" ? remoteValue : 0;
      setMerged(merged, key, Math.max(localVersion, remoteVersion));
    } else if (localChanged && remoteChanged && !valuesEqual(localValue, remoteValue)) {
      conflicts.push(key);
    } else if (localChanged) {
      setMerged(merged, key, localValue);
    } else {
      setMerged(merged, key, remoteValue);
    }
  }

  return conflicts.length > 0
    ? { kind: "conflict", fields: conflicts, conflictKind: "field" }
    : { kind: "merged", snapshot: merged };
}
