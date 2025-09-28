import { Router } from "itty-router";

interface ApiEnv {
  MERCHANT_DO: DurableObjectNamespace;
  MERCHANT_APP_DO: DurableObjectNamespace;
  USER_WALLET_DO: DurableObjectNamespace;
  HISTORY_DO: DurableObjectNamespace;
  RECEIPTS_KV: KVNamespace;
  ARTIFACTS_R2: R2Bucket;
  JWK_KV: KVNamespace;
  TOKEN_SIGNING_KEY: string;
  ENABLE_DEV_BOOTSTRAP?: string;
}

const router = Router();

router.get("/healthz", () => json({ status: "ok" }));

router.post("/v1/tokens/issue", async (_request: Request) => {
  return json({ error: "token_issuance_removed" }, 410);
});

router.post("/v1/dev/bootstrap", async (request: Request, env: ApiEnv) => {
  const bootstrapFlag = (env.ENABLE_DEV_BOOTSTRAP ?? "").toString().toLowerCase();
  const bootstrapEnabled = ["1", "true", "yes", "on"].includes(bootstrapFlag);
  if (!bootstrapEnabled) {
    return json({ error: "bootstrap_disabled" }, 403);
  }

  let body: any;
  try {
    body = (await request.json()) as any;
  } catch (_error) {
    return json({ error: "invalid_json" }, 400);
  }

  const merchantPayloads: any[] = Array.isArray(body?.merchants) ? body.merchants : [];
  const walletPayloads: any[] = Array.isArray(body?.wallets) ? body.wallets : [];

  for (const merchant of merchantPayloads) {
    const merchantId = typeof merchant?.merchantId === "string" ? (merchant.merchantId as string) : undefined;
    if (!merchantId) {
      return json({ error: "missing_merchant_id" }, 400);
    }
    const stub = env.MERCHANT_DO.get(env.MERCHANT_DO.idFromName(merchantId));
    const res = await stub.fetch("https://merchant/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(merchant),
    });
    if (!res.ok) {
      const detail = await safeText(res);
      return json({ error: "merchant_config_failed", merchantId, detail }, res.status);
    }
  }

  for (const wallet of walletPayloads) {
    const userId = wallet?.userId as string | undefined;
    if (!userId) {
      return json({ error: "missing_user_id" }, 400);
    }
    const stub = env.USER_WALLET_DO.get(env.USER_WALLET_DO.idFromName(userId));

    const existingStateRes = await stub.fetch("https://wallet/state", { method: "GET" });
    const existingState = existingStateRes.ok ? ((await existingStateRes.json()) as { balance?: number }) : { balance: 0 };

    if (typeof wallet?.balance === "number" && Number.isFinite(wallet.balance)) {
      const desired = wallet.balance;
      const current = Number(existingState.balance ?? 0);
      const delta = desired - current;
      if (delta > 0) {
        const fundRes = await stub.fetch("https://wallet/fund", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ amount: delta }),
        });
        if (!fundRes.ok) {
          const detail = await safeText(fundRes);
          return json({ error: "wallet_fund_failed", userId, detail }, fundRes.status);
        }
      }
    }

    const budgets: Record<string, unknown> = {};
    if (wallet?.dailyCap !== undefined) {
      budgets.dailyCap = wallet.dailyCap;
    }
    if (wallet?.perMerchantCap) {
      budgets.perMerchantCap = wallet.perMerchantCap;
    }
    if (Object.keys(budgets).length > 0) {
      const configureRes = await stub.fetch("https://wallet/configure", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(budgets),
      });
      if (!configureRes.ok) {
        const detail = await safeText(configureRes);
        return json({ error: "wallet_configure_failed", userId, detail }, configureRes.status);
      }
    }
  }

  return json({ ok: true, merchants: merchantPayloads.length, wallets: walletPayloads.length });
});

router.get("/v1/wallet", async (request: Request, env: ApiEnv) => {
  const userId = request.headers.get("x-user-id");
  if (!userId) {
    return json({ error: "missing_user" }, 401);
  }
  const stub = env.USER_WALLET_DO.get(env.USER_WALLET_DO.idFromName(userId));
  const res = await stub.fetch("https://wallet/state", { method: "GET" });
  if (!res.ok) {
    return json({ error: "wallet_fetch_failed" }, 500);
  }
  const state = await res.json();
  return json(state);
});

router.post("/v1/wallet/credits/checkout", async (_req, _env: ApiEnv) => {
  return json({ checkoutUrl: "https://example.com/stripe/checkout" });
});

router.get("/v1/history", async (request: Request, env: ApiEnv) => {
  const userId = request.headers.get("x-user-id");
  if (!userId) {
    return json({ error: "missing_user" }, 401);
  }
  const cursor = request.url.includes("cursor=") ? new URL(request.url).searchParams.get("cursor") : null;
  const stub = env.HISTORY_DO.get(env.HISTORY_DO.idFromName(userId));
  const res = await stub.fetch(`https://history/list${cursor ? `?cursor=${cursor}` : ""}`, { method: "GET" });
  if (!res.ok) {
    return json({ error: "history_fetch_failed" }, 500);
  }
  return new Response(res.body, { status: res.status, headers: res.headers });
});

router.get("/v1/receipts/:id", async ({ params }, env: ApiEnv) => {
  const receipt = await env.RECEIPTS_KV.get(params?.id ?? "", "json");
  if (!receipt) {
    return json({ error: "receipt_not_found" }, 404);
  }
  return json(receipt);
});

router.get("/v1/artifacts/:hash", async ({ params }, env: ApiEnv) => {
  const obj = await env.ARTIFACTS_R2.get(params?.hash ?? "");
  if (!obj) {
    return json({ error: "artifact_not_found" }, 404);
  }
  return new Response(obj.body, {
    status: 200,
    headers: {
      "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream",
      "cache-control": obj.httpMetadata?.cacheControl ?? "private, max-age=60",
    },
  });
});

router.get("/v1/merchant-apps", async (_request: Request) => {
  // Placeholder list until control plane catalogs apps.
  return json({ apps: [] });
});

router.get("/v1/merchant-apps/:appId", async ({ params }, env: ApiEnv) => {
  const appId = params?.appId;
  if (!appId) {
    return json({ error: "missing_app_id" }, 400);
  }
  const stub = getMerchantAppStub(env, appId);
  const res = await stub.fetch("https://merchant-app/config", { method: "GET" });
  if (res.status === 404) {
    return json(defaultMerchantAppConfig(appId));
  }
  if (!res.ok) {
    const detail = await safeText(res);
    return json({ error: "merchant_app_fetch_failed", detail }, res.status);
  }
  const config = await res.json();
  return json(config);
});

router.post("/v1/merchant-apps/:appId", async (request: Request, env: ApiEnv) => {
  const url = new URL(request.url);
  const appId = url.pathname.split("/").pop();
  if (!appId) {
    return json({ error: "missing_app_id" }, 400);
  }
  const stub = getMerchantAppStub(env, appId);
  const res = await stub.fetch("https://merchant-app/config", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: await request.text(),
  });
  return forward(res);
});

router.post("/v1/merchant-apps/:appId/routes", async (request: Request, env: ApiEnv) => {
  const appId = new URL(request.url).pathname.split("/")[3] ?? null;
  if (!appId) {
    return json({ error: "missing_app_id" }, 400);
  }
  const stub = getMerchantAppStub(env, appId);
  const res = await stub.fetch("https://merchant-app/routes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: await request.text(),
  });
  return forward(res);
});

router.patch("/v1/merchant-apps/:appId/routes/:routeId", async (request: Request, env: ApiEnv) => {
  const { appId, routeId } = (request as any).params ?? {};
  const finalAppId = appId ?? new URL(request.url).pathname.split("/")[3];
  const finalRouteId = routeId ?? new URL(request.url).pathname.split("/")[5];
  if (!finalAppId || !finalRouteId) {
    return json({ error: "missing_route_context" }, 400);
  }
  const stub = getMerchantAppStub(env, finalAppId);
  const res = await stub.fetch(`https://merchant-app/routes/${finalRouteId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: await request.text(),
  });
  return forward(res);
});

router.delete("/v1/merchant-apps/:appId/routes/:routeId", async ({ params }, env: ApiEnv) => {
  const appId = params?.appId;
  const routeId = params?.routeId;
  if (!appId || !routeId) {
    return json({ error: "missing_route_context" }, 400);
  }
  const stub = getMerchantAppStub(env, appId);
  const res = await stub.fetch(`https://merchant-app/routes/${routeId}`, {
    method: "DELETE",
  });
  return forward(res);
});

router.post("/v1/merchant-apps/:appId/openapi/refresh", async ({ params }, env: ApiEnv) => {
  const appId = params?.appId;
  if (!appId) {
    return json({ error: "missing_app_id" }, 400);
  }
  const stub = getMerchantAppStub(env, appId);
  const res = await stub.fetch("https://merchant-app/openapi/sync", {
    method: "POST",
  });
  return forward(res);
});

router.post("/v1/merchant-apps/:appId/sitemap/refresh", async ({ params }, env: ApiEnv) => {
  const appId = params?.appId;
  if (!appId) {
    return json({ error: "missing_app_id" }, 400);
  }
  const stub = getMerchantAppStub(env, appId);
  const res = await stub.fetch("https://merchant-app/sitemap/sync", {
    method: "POST",
  });
  return forward(res);
});

router.all("*", () => json({ error: "not_found" }, 404));

export default {
  fetch: (request: Request, env: ApiEnv) => router.handle(request, env),
};

const safeText = async (response: Response): Promise<string> => {
  try {
    return await response.text();
  } catch (_error) {
    return "";
  }
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const forward = (response: Response) => new Response(response.body, { status: response.status, headers: response.headers });

const getMerchantAppStub = (env: ApiEnv, appId: string) => env.MERCHANT_APP_DO.get(env.MERCHANT_APP_DO.idFromName(appId));

const defaultMerchantAppConfig = (appId: string) => ({
  appId,
  merchantId: appId,
  displayName: `App ${appId}`,
  origin: null,
  routes: [],
  updatedAt: new Date().toISOString(),
  exists: false,
});
