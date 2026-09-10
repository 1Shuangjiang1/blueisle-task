export class SyncTransportError extends Error {
  constructor(
    message: string,
    readonly kind: "network" | "unauthorized" | "server" | "invalid-response",
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "SyncTransportError";
  }
}

export function isUnauthorizedError(error: unknown): boolean {
  return error instanceof SyncTransportError && error.kind === "unauthorized";
}

export function isRetryableError(error: unknown): boolean {
  return error instanceof SyncTransportError
    ? error.retryable
    : error instanceof TypeError
      ? false
      : true;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

