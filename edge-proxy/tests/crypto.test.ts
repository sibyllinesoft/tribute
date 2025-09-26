import { describe, expect, it } from "vitest";

import { toBase64Url, sha256Base64Url } from "../src/crypto";

describe("crypto helpers", () => {
  it("converts array buffer to base64url", () => {
    const bytes = new Uint8Array([0xff, 0xee]).buffer;
    expect(toBase64Url(bytes)).toBe("_-4");
  });

  it("hashes string to base64url", async () => {
    const digest = await sha256Base64Url("hello");
    expect(digest).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
