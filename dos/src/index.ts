import { DurableObjectBase } from "./do-base";

export { RedeemDurableObject } from "./redeem-do";
export { MerchantDurableObject } from "./merchant-do";
export { MerchantAppDurableObject } from "./merchant-app-do";
export type { MerchantAppConfig, MerchantRouteConfig, MerchantRoutePricing, MerchantPageConfig } from "./merchant-app-do";
export { UserWalletDurableObject } from "./user-wallet-do";
export { HistoryDurableObject } from "./history-do";
export { EntitlementsDurableObject } from "./entitlements-do";
export * from "./types";
export { WalletRpcClient } from "./wallet-rpc";

interface RootEnv {
  MERCHANT_DO: DurableObjectNamespace;
  MERCHANT_APP_DO: DurableObjectNamespace;
  USER_WALLET_DO: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: RootEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/internal/merchant/config") {
      const merchantId = url.searchParams.get("id");
      if (!merchantId) {
        return new Response(JSON.stringify({ error: "missing_merchant_id" }), { status: 400, headers: { "content-type": "application/json" } });
      }
      const stub = env.MERCHANT_DO.get(env.MERCHANT_DO.idFromName(merchantId));
      const forward = new Request("https://merchant/config", request);
      return stub.fetch(forward);
    }

    if (url.pathname === "/internal/merchant-app/config") {
      const appId = url.searchParams.get("id");
      if (!appId) {
        return new Response(JSON.stringify({ error: "missing_app_id" }), { status: 400, headers: { "content-type": "application/json" } });
      }
      const stub = env.MERCHANT_APP_DO.get(env.MERCHANT_APP_DO.idFromName(appId));
      const forward = new Request("https://merchant-app/config", request);
      return stub.fetch(forward);
    }

    if (url.pathname.startsWith("/internal/wallet")) {
      const userId = url.searchParams.get("id");
      if (!userId) {
        return new Response(JSON.stringify({ error: "missing_user_id" }), { status: 400, headers: { "content-type": "application/json" } });
      }
      const stub = env.USER_WALLET_DO.get(env.USER_WALLET_DO.idFromName(userId));
      const suffix = url.pathname.slice("/internal/wallet".length) || "/";
      const forward = new Request(`https://wallet${suffix}`, request);
      return stub.fetch(forward);
    }

    return new Response("tribute durable objects worker", {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  },
};
