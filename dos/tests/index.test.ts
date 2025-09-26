import { describe, expect, it } from "vitest";

import * as pkg from "../src";

describe("dos index exports", () => {
  it("exposes durable objects and helpers", () => {
    expect(pkg.RedeemDurableObject).toBeDefined();
    expect(pkg.MerchantDurableObject).toBeDefined();
    expect(pkg.UserWalletDurableObject).toBeDefined();
    expect(pkg.HistoryDurableObject).toBeDefined();
    expect(pkg.EntitlementsDurableObject).toBeDefined();
    expect(pkg.WalletRpcClient).toBeDefined();
    expect(pkg.paymentTokenSchema).toBeDefined();
  });
});
