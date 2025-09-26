import { describe, expect, it, vi } from "vitest";

vi.mock("../src/crypto", () => ({
  sha256Base64Url: vi.fn(async () => "signature"),
}));

import { buildProxyContextHeader } from "../src/context";
import type { PaymentTokenClaims } from "@tribute/durable-objects";

const claims: PaymentTokenClaims = {
  nonce: "nonce",
  sub: "sub",
  mer: "merchant",
  rid: "GET:/chat",
  method: "POST",
  inputs_hash: "hash",
  max_price: 100,
  ccy: "USD",
  policy_ver: 1,
  policy_digest: "digest",
  aud: "proxy",
  iss: "tribute",
  exp: Math.floor(Date.now() / 1000) + 300,
  iat: Math.floor(Date.now() / 1000),
  origin_host: "origin.example",
  price_sig: "sig",
};

describe("buildProxyContextHeader", () => {
  it("encodes payload and appends signature", async () => {
    const header = await buildProxyContextHeader(claims, "user-123", { appId: "app" });
    const [encodedPayload, signature] = header.split(".");
    expect(signature).toBe("signature");
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64").toString("utf8"));
    expect(payload.sub).toBe(`user-123@${claims.mer}`);
    expect(payload.app).toBe("app");
    expect(payload.inputs_hash).toBe("hash");
  });
});
