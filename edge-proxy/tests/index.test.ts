import { describe, expect, it, vi, afterEach } from "vitest";

import proxy from "../src/index";

const createEnv = () => ({
  REDEEM_DO: {} as any,
  MERCHANT_DO: {} as any,
  USER_WALLET_DO: {} as any,
  HISTORY_DO: {} as any,
  RECEIPTS_KV: {} as any,
  ARTIFACTS_R2: {} as any,
  JWK_KV: {} as any,
});

describe("proxy fetch", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("returns 401 when token missing", async () => {
    const res = await proxy.fetch(new Request("https://proxy.example"), createEnv() as any, {} as any);
    expect(res.status).toBe(401);
  });

  it("wraps errors from handler", async () => {
    await vi.doMock("../src/token", () => ({
      extractBearer: () => "token",
      verifyPaymentToken: vi.fn(() => {
        throw new Error("boom");
      }),
    }));

    const module = await import("../src/index");
    const res = await module.default.fetch(new Request("https://proxy.example"), createEnv() as any, {} as any);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("proxy_failure");
  });
});
