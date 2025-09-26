import { Router } from "itty-router";
import { SignJWT } from "jose";

interface ApiEnv {
  MERCHANT_DO: DurableObjectNamespace;
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

router.post("/v1/tokens/issue", async (request: Request, env: ApiEnv) => {
  const body = (await request.json()) as any;
  const rid = body.rid as string;
  const method = body.method as string;
  const merchantId = body.merchantId as string;
  const inputs = body.inputs;
  const inputsHash = body.inputsHash as string | undefined;
  const originHost = body.originHost as string | undefined;
  const requestedMaxPrice = body.maxPrice !== undefined ? Number(body.maxPrice) : undefined;
  const userId = request.headers.get("x-user-id");
  if (!userId) {
    return json({ error: "missing_user" }, 401);
  }
  const hash = inputsHash ?? (await sha256Base64Url(JSON.stringify(inputs ?? {})));
  const merchantStub = env.MERCHANT_DO.get(env.MERCHANT_DO.idFromName(merchantId));
  const priceRes = await merchantStub.fetch("https://merchant/estimate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, path: rid, requestBytes: JSON.stringify(inputs ?? {}).length, responseBytes: 0 }),
  });
  if (!priceRes.ok) {
    return json({ error: "price_lookup_failed" }, 500);
  }
  const priceBody = (await priceRes.json()) as {
    estimated_price: number;
    currency: string;
    policy_ver: number;
    policy_digest: string;
    estimate_is_final?: boolean;
  };
  await ensureJwks(env);
  const now = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomUUID();
  const estimate = Number(priceBody.estimated_price ?? 0);
  if (!Number.isFinite(estimate) || estimate < 0) {
    return json({ error: "invalid_estimate" }, 400);
  }
  const policyVersion = priceBody.policy_ver;
  const policyDigest = priceBody.policy_digest;
  if (!policyDigest) {
    return json({ error: "missing_policy_digest" }, 500);
  }
  const maxPrice = normalizeMaxPrice(requestedMaxPrice, estimate);
  const priceSig = await sha256Base64Url(`${maxPrice}|${policyDigest}|${hash}`);
  const claims = {
    nonce,
    sub: userId,
    mer: merchantId,
    rid,
    method,
    inputs_hash: hash,
    max_price: maxPrice,
    ccy: priceBody.currency,
    policy_ver: policyVersion,
    policy_digest: policyDigest,
    aud: "proxy",
    iss: "tribute",
    iat: now,
    exp: now + 300,
    origin_host: originHost ?? "origin.example.com",
    price_sig: priceSig,
  } as const;

  const token = await new SignJWT(claims as any)
    .setProtectedHeader({ alg: "HS256", kid: "primary" })
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(getSigningKey(env));

  return json({
    token,
    exp: claims.exp,
    estimate: {
      estimatedPrice: estimate,
      currency: priceBody.currency,
      policyVersion,
      policyDigest,
      suggestedMaxPrice: maxPrice,
    },
  });
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

const ensureJwks = async (env: ApiEnv) => {
  const existing = await env.JWK_KV.get("signing/jwks");
  if (existing) return;
  const key = base64UrlEncode(env.TOKEN_SIGNING_KEY);
  const jwks = {
    keys: [
      {
        kty: "oct",
        k: key,
        alg: "HS256",
        kid: "primary",
      },
    ],
  };
  await env.JWK_KV.put("signing/jwks", JSON.stringify(jwks));
};

const getSigningKey = (env: ApiEnv): Uint8Array => new TextEncoder().encode(env.TOKEN_SIGNING_KEY);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const sha256Base64Url = async (input: string): Promise<string> => {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(digest);
};

const normalizeMaxPrice = (requested: number | undefined, estimate: number): number => {
  if (typeof requested === "number" && Number.isFinite(requested) && !Number.isNaN(requested) && requested > 0) {
    return Number(Math.max(requested, estimate).toFixed(6));
  }
  const padding = estimate * 1.25;
  return Number(Math.max(padding, estimate).toFixed(6));
};

const base64UrlEncode = (input: ArrayBuffer | string): string => {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
