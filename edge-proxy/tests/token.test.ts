import { describe, expect, it } from "vitest";
import { generateKeyPair, SignJWT, exportJWK } from "jose";

import { extractBearer, verifyPaymentToken } from "../src/token";

const baseClaims = {
  nonce: "abc123",
  sub: "user",
  mer: "merchant",
  rid: "GET:/chat",
  method: "POST",
  inputs_hash: "hash",
  max_price: 100,
  ccy: "USD",
  policy_ver: 1,
  policy_digest: "digest",
  origin_host: "origin.example",
  price_sig: "sig",
};

describe("extractBearer", () => {
  it("returns bearer token when present", () => {
    expect(extractBearer("Bearer abc.def" )).toBe("abc.def");
  });

  it("returns null when header missing", () => {
    expect(extractBearer(null)).toBeNull();
  });

  it("returns token portion for non bearer schemes", () => {
    expect(extractBearer("Basic foo")).toBe("foo");
  });
});

describe("verifyPaymentToken", () => {
  it("verifies token against JWKS", async () => {
    const { publicKey, privateKey } = await generateKeyPair("ES256");
    const kid = "kid-1";
    const token = await new SignJWT(baseClaims)
      .setProtectedHeader({ alg: "ES256", kid })
      .setIssuer("tribute")
      .setAudience("proxy")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

    const jwk = await exportJWK(publicKey);
    const env = {
      JWK_KV: {
        get: async () => ({ keys: [{ ...jwk, kid, alg: "ES256" }] }),
      },
    } as any;

    const claims = await verifyPaymentToken(token, env);
    expect(claims.origin_host).toBe("origin.example");
    expect(claims.policy_ver).toBe(1);
  });

  it("throws when JWKS missing", async () => {
    const env = {
      JWK_KV: { get: async () => null },
    } as any;
    await expect(verifyPaymentToken("token", env)).rejects.toThrow("jwks_missing");
  });

  it("throws when token header lacks kid", async () => {
    const { privateKey } = await generateKeyPair("ES256");
    const token = await new SignJWT(baseClaims)
      .setProtectedHeader({ alg: "ES256" })
      .setIssuer("tribute")
      .setAudience("proxy")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

    const env = {
      JWK_KV: { get: async () => ({ keys: [] }) },
    } as any;

    await expect(verifyPaymentToken(token, env)).rejects.toThrow("token_missing_kid");
  });

  it("throws when JWK not found", async () => {
    const { privateKey } = await generateKeyPair("ES256");
    const token = await new SignJWT(baseClaims)
      .setProtectedHeader({ alg: "ES256", kid: "missing" })
      .setIssuer("tribute")
      .setAudience("proxy")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

    const env = {
      JWK_KV: { get: async () => ({ keys: [] }) },
    } as any;

    await expect(verifyPaymentToken(token, env)).rejects.toThrow("jwk_not_found:missing");
  });
});
