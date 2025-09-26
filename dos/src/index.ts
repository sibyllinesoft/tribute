import { DurableObjectBase } from "./do-base";

export { RedeemDurableObject } from "./redeem-do";
export { MerchantDurableObject } from "./merchant-do";
export { UserWalletDurableObject } from "./user-wallet-do";
export { HistoryDurableObject } from "./history-do";
export { EntitlementsDurableObject } from "./entitlements-do";
export * from "./types";
export { WalletRpcClient } from "./wallet-rpc";

export default {
  async fetch(): Promise<Response> {
    return new Response("tribute durable objects worker", {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  },
};
