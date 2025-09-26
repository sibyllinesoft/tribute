import { describe, expect, it } from "vitest";
import { HmacSigner, JWKSManager, estimate, verifySignature } from "../src";

describe("estimate", () => {
  it("signs and verifies tokens", () => {
    const signer = new HmacSigner("primary", Buffer.from("topsecret"));
    const manager = new JWKSManager();
    manager.register(signer);

    const result = estimate({
      estimatedPrice: 0.12345,
      observables: { tokens: 42 },
      signer,
    });

    expect(result.priceSignature).toBeDefined();
    const token = result.priceSignature!;

    const ok = verifySignature(token, (kid) => manager.resolve(kid)?.secretBytes());
    expect(ok).toBe(true);
  });
});
