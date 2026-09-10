import { describe, expect, it, vi } from "vitest";
import { createUuidV4 } from "./uuid";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("createUuidV4", () => {
  it("always returns a standard UUID v4", () => {
    expect(Array.from({ length: 10 }, createUuidV4).every((value) => UUID_V4.test(value))).toBe(true);
  });

  it("uses getRandomValues with a UUID v4-compatible fallback", () => {
    vi.stubGlobal("crypto", {
      getRandomValues(bytes: Uint8Array) {
        bytes.fill(0x11);
        return bytes;
      },
    });
    expect(createUuidV4()).toBe("11111111-1111-4111-9111-111111111111");
    vi.unstubAllGlobals();
  });
});
