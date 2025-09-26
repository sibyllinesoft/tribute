import { describe, expect, it } from "vitest";

import { buildOriginRequest } from "../src/origin";
import type { MerchantConfig } from "@tribute/durable-objects";
import type { ProxyEnv } from "../src/env";

const baseConfig: MerchantConfig = {
  merchantId: "m1",
  origin: {
    baseUrl: "https://origin.example/base",
    auth: { kind: "api_key", secretRef: "env:API_KEY", header: "x-api-key" },
  },
  pricing: {
    policyVersion: 1,
    policyDigest: "digest",
    rules: [],
    priceUnit: "USD",
  },
};

const createEnv = (overrides: Partial<ProxyEnv> = {}): ProxyEnv => ({
  REDEEM_DO: {} as any,
  MERCHANT_DO: {} as any,
  USER_WALLET_DO: {} as any,
  HISTORY_DO: {} as any,
  RECEIPTS_KV: {} as any,
  ARTIFACTS_R2: {} as any,
  JWK_KV: {} as any,
  PROXY_SIGNING_KEY: "",
  ALLOWED_ORIGINS: "",
  ...overrides,
});

describe("buildOriginRequest", () => {
  it("rewrites path and sets api key header", async () => {
    const env = createEnv({ API_KEY: "secret" } as any);
    const request = new Request("https://proxy.example/v1/resource?foo=bar", {
      headers: { authorization: "Bearer abc" },
    });

    const result = await buildOriginRequest(request, baseConfig, env);
    expect(result.url.toString()).toBe("https://origin.example/base/v1/resource?foo=bar");
    expect(result.headers.get("x-api-key")).toBe("secret");
    expect(result.headers.has("authorization")).toBe(false);
  });

  it("loads jwt secret from KV", async () => {
    const config: MerchantConfig = {
      ...baseConfig,
      origin: {
        baseUrl: "https://origin.example/base",
        auth: { kind: "jwt", secretRef: "kv:jwt-secret" },
      },
    };
    const env = createEnv({
      ORIGIN_SECRETS: { get: async () => "token" },
    } as any);
    const request = new Request("https://proxy.example/chat", {
      headers: new Headers(),
    });

    const result = await buildOriginRequest(request, config, env);
    expect(result.headers.get("authorization")).toBe("Bearer token");
  });

  it("throws when env secret missing", async () => {
    const env = createEnv();
    const request = new Request("https://proxy.example/chat");
    await expect(buildOriginRequest(request, baseConfig, env)).rejects.toThrow("secret_env_missing:API_KEY");
  });

  it("throws when KV secret missing", async () => {
    const config: MerchantConfig = {
      ...baseConfig,
      origin: {
        baseUrl: "https://origin.example/base",
        auth: { kind: "jwt", secretRef: "kv:missing" },
      },
    };
    const env = createEnv({ ORIGIN_SECRETS: { get: async () => null } } as any);
    const request = new Request("https://proxy.example/chat");

    await expect(buildOriginRequest(request, config, env)).rejects.toThrow("secret_kv_missing:missing");
  });
});
