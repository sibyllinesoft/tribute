import { describe, expect, it, vi } from "vitest";

import {
  resolvePricingMode,
  appendEstimateSuffix,
  canonicalJson,
  readBodyBytes,
  cloneBody,
  parseEstimatePayload,
  finalizePricingFromPayload,
  ensurePolicyCompatibility,
  resolveRouteEntitlement,
  subscriptionRequired,
  safeWaitUntil,
  capExceeded,
} from "../src/index";

const jsonHeaders = new Headers({ "content-type": "application/json" });

describe("index helpers", () => {
  it("normalizes pricing mode", () => {
    expect(resolvePricingMode("EXECUTE-ONLY")).toBe("execute-only");
    expect(resolvePricingMode("invalid" as any)).toBe("estimate-first");
    expect(resolvePricingMode(null)).toBe("estimate-first");
  });

  it("appends estimate suffix", () => {
    expect(appendEstimateSuffix("/chat", "estimate")).toBe("/chat/estimate");
    expect(appendEstimateSuffix("/chat/estimate", "estimate")).toBe("/chat/estimate");
  });

  it("canonicalizes json ordering", () => {
    const output = canonicalJson({ b: 2, a: { c: 3, b: [2, 1] } });
    expect(output).toBe('{"a":{"b":[2,1],"c":3},"b":2}');
  });

  it("reads body bytes for non-GET", async () => {
    const body = JSON.stringify({ hello: "world" });
    const request = new Request("https://example", { method: "POST", body, headers: jsonHeaders });
    const bytes = await readBodyBytes(request);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(bytes ?? undefined)).toContain("hello");

    const getRequest = new Request("https://example", { method: "GET" });
    expect(await readBodyBytes(getRequest)).toBeNull();
  });

  it("clones body buffer", () => {
    const data = new Uint8Array([1, 2, 3]);
    const clone = cloneBody(data) as Uint8Array;
    expect(clone).not.toBe(data);
    expect(Array.from(clone)).toEqual([1, 2, 3]);
  });

  it("parses estimate payload only for json", async () => {
    const response = new Response(JSON.stringify({ price: 1 }), { headers: jsonHeaders });
    expect(await parseEstimatePayload(response)).toEqual({ price: 1 });

    const textResponse = new Response("oops", { headers: { "content-type": "text/plain" } });
    await expect(parseEstimatePayload(textResponse)).rejects.toThrow("estimate_json_expected");
  });

  it("finalizes pricing from payload", () => {
    const result = finalizePricingFromPayload({
      payload: { final_price: 5, price_sig: "sig", usage: { tokens: 10 } },
      estimate: { estimatedPrice: 3, currency: "USD", estDigest: "e", estimateIsFinal: false, pricingUnattested: false },
      pricingMode: "estimate-first",
      maxPrice: 10,
      finalPriceSig: "sig",
      observablesDigest: "obs",
    });
    expect(result.finalPrice).toBe(5);
    expect(result.pricingUnattested).toBe(false);
  });

  it("detects policy mismatches", () => {
    const mismatch = ensurePolicyCompatibility(2, "digest", {
      policy_ver: 1,
      policy_digest: "digest",
    } as any);
    expect(mismatch?.status).toBe(409);
    const digestMismatch = ensurePolicyCompatibility(1, "other", {
      policy_ver: 1,
      policy_digest: "digest",
    } as any);
    expect(digestMismatch?.status).toBe(409);
  });

  it("resolves route entitlements", () => {
    const config = {
      entitlements: {
        routes: {
          "GET:/chat": { feature: "chat" },
          "*": { feature: "fallback" },
        },
      },
    } as any;
    expect(resolveRouteEntitlement(config, "GET:/chat")?.feature).toBe("chat");
    expect(resolveRouteEntitlement(config, "POST:/other")?.feature).toBe("fallback");
  });

  it("builds subscription required response", async () => {
    const response = subscriptionRequired({ feature: "pro" }, { reason: "quota", upgradeUrl: "https://upgrade" });
    expect(response.status).toBe(402);
    const body = await response.json();
    expect(body.error).toBe("subscription_required");
    expect(response.headers.get("X-Upgrade-Url")).toBe("https://upgrade");
  });

  it("caps exceeded response includes headers", async () => {
    const response = capExceeded(10, 15, 2, 9);
    expect(response.status).toBe(402);
    expect(response.headers.get("X-Required-Max-Price")).toBe("15");
    const body = await response.json();
    expect(body.required_max_price).toBe(15);
  });

  it("safeWaitUntil guards outside worker", async () => {
    const fn = vi.fn(async () => {});
    const ctx = { waitUntil: vi.fn((p: Promise<void>) => p) } as any;
    safeWaitUntil(ctx, fn);
    expect(ctx.waitUntil).toHaveBeenCalled();

    // no context should not throw
    expect(() => safeWaitUntil(undefined, fn)).not.toThrow();
  });
});
