import { describe, expect, it, vi } from "vitest";

import { EntitlementsClient } from "../src/entitlements-client";

const createNamespace = () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ allowed: true, fallbackToMetered: false }), { status: 200 }));
  return {
    ns: {
      idFromName: vi.fn(() => ({} as any)),
      get: vi.fn(() => ({ fetch } as any)),
    } as any,
    fetch,
  };
};

describe("EntitlementsClient", () => {
  it("falls back when namespace missing", async () => {
    const client = new EntitlementsClient(undefined);
    const decision = await client.access({ merchantId: "m", userId: "u" });
    expect(decision.allowed).toBe(false);
    expect(decision.fallbackToMetered).toBe(true);
    expect(decision.reason).toBe("entitlements_unconfigured");
  });

  it("returns decision from durable object", async () => {
    const { ns, fetch } = createNamespace();
    const client = new EntitlementsClient(ns);
    const decision = await client.access({ merchantId: "m", userId: "u", feature: "pro" });
    expect(ns.idFromName).toHaveBeenCalledWith("m::u");
    expect(fetch).toHaveBeenCalled();
    expect(decision.allowed).toBe(true);
    expect(decision.fallbackToMetered).toBe(false);
  });

  it("falls back when response not ok", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response("err", { status: 500 }));
    const namespace = {
      idFromName: vi.fn(() => ({} as any)),
      get: vi.fn(() => ({ fetch } as any)),
    } as any;

    const client = new EntitlementsClient(namespace);
    const decision = await client.access({ merchantId: "m", userId: "u" });
    expect(decision.fallbackToMetered).toBe(true);
    expect(decision.reason).toBe("entitlements_error:500");
  });
});
