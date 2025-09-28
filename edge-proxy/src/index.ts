/* c8 ignore start */
/* istanbul ignore file */
import { receiptCacheKey, type PaymentTokenClaims, type PricingMode, type MerchantConfig, type MerchantAppConfig, type MerchantRouteConfig } from "@tribute/durable-objects";
import type { ProxyEnv } from "./env";
import { sha256Base64Url } from "./crypto";
import { getCachedReceipt, putReceiptAndArtifact, getCachedEstimate, putCachedEstimate } from "./cache";
import { MerchantClient } from "./merchant-client";
import { MerchantAppClient } from "./merchant-app-client";
import { RedeemClient } from "./redeem-client";
import { buildOriginRequest } from "./origin";
import { buildProxyContextHeader } from "./context";
import { EntitlementsClient } from "./entitlements-client";
import { maybeHandleManagementRequest, notifyReceiptEvent } from "./management";

const JSON_HEADERS = { "content-type": "application/json" } as const;
const DEFAULT_ESTIMATE_TTL_SECONDS = 90;
const LOCALHOST_SUFFIX = ".localhost";

interface EstimateResult {
  estimatedPrice: number;
  currency: string;
  estDigest: string;
  priceSig?: string | null;
  estimateIsFinal: boolean;
  pricingUnattested: boolean;
}

interface FinalizationResult {
  finalPrice: number;
  finalPriceSig?: string;
  observablesDigest?: string;
  pricingUnattested: boolean;
}

interface RouteEntitlementRule {
  feature: string;
  quotaKey?: string;
  fallbackMode?: "metered" | "block";
  upgradeUrl?: string;
}

interface EntitlementGrant extends RouteEntitlementRule {}

export default {
  async fetch(request: Request, env: ProxyEnv, ctx: ExecutionContext): Promise<Response> {
    try {
      const response = await handleRequest(request, env, ctx);
      return applyCors(request, env, response);
    } catch (error) {
      const body = JSON.stringify({ error: "proxy_failure", detail: `${error}` });
      const response = new Response(body, { status: 500, headers: JSON_HEADERS });
      return applyCors(request, env, response);
    }
  },
};

/* c8 ignore stop */

const handleRequest = async (request: Request, env: ProxyEnv, ctx: ExecutionContext): Promise<Response> => {
  const managementResponse = await maybeHandleManagementRequest(request, env, ctx);
  if (managementResponse) {
    return managementResponse;
  }
  if (request.method.toUpperCase() === "OPTIONS") {
    return handlePreflight(request, env);
  }
  const url = new URL(request.url);
  let appId = url.hostname;
  if (appId.endsWith(LOCALHOST_SUFFIX)) {
    appId = appId.slice(0, -LOCALHOST_SUFFIX.length);
  }

  const merchantAppClient = new MerchantAppClient(env.MERCHANT_APP_DO);
  let merchantAppConfig: MerchantAppConfig | null = null;
  try {
    merchantAppConfig = await merchantAppClient.getConfig(appId);
  } catch (_error) {
    merchantAppConfig = null;
  }
  const merchantId = merchantAppConfig?.merchantId ?? appId;

  const merchantClient = new MerchantClient(env.MERCHANT_DO);
  const merchantConfig = await merchantClient.getConfig(merchantId);
  const routeConfig = resolveMerchantAppRoute(merchantAppConfig, request.method, url.pathname);

  const identity = resolveUserIdentity(request, merchantConfig);
  if (!identity) {
    return proxyPassthrough(request, env, merchantConfig, undefined);
  }

  const claimedRid = resolveRouteId(routeConfig?.path ?? url.pathname, request.method);
  const now = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomUUID();

  const bodyBytes = await readBodyBytes(request);
  const preflightConfig = merchantConfig.preflight ?? { auto: true, defaultCap: 0.5, identity: { header: "authorization", required: true } };

  if (!preflightConfig.auto) {
    return proxyPassthrough(request, env, merchantConfig, bodyBytes);
  }

  const inputsHash = await computeInputsHash(url, request.method, bodyBytes);

  const forcedPricingMode = routeConfig?.pricing.mode === "subscription" ? "subscription" : null;
  const requestedPricingMode = forcedPricingMode ?? resolvePricingMode(request.headers.get("x-meter-mode") ?? request.headers.get("x-pricing-mode"));
  const defaultCap =
    routeConfig?.pricing.mode === "metered"
      ? routeConfig.pricing.flatAmount
      : preflightConfig.defaultCap ?? 0.5;
  const resolvedCap = resolveCap({
    header: request.headers.get("x-meter-max-price") ?? request.headers.get("x-max-price"),
    defaultCap,
    capMultiplier: preflightConfig.capMultiplier,
  });
  if (resolvedCap.error) {
    return resolvedCap.error;
  }
  const maxPrice = routeConfig?.pricing.mode === "subscription" ? 0 : resolvedCap.value;

  const claims: PaymentTokenClaims = {
    nonce,
    sub: identity,
    mer: merchantConfig.merchantId ?? merchantId,
    rid: claimedRid,
    method: request.method,
    inputs_hash: inputsHash,
    max_price: maxPrice,
    ccy: merchantConfig.pricing.priceUnit ?? "USD",
    policy_ver: merchantConfig.pricing.policyVersion,
    policy_digest: merchantConfig.pricing.policyDigest,
    aud: "proxy",
    iss: "tribute",
    iat: now,
    exp: now + 300,
    origin_host: new URL(merchantConfig.origin.baseUrl).hostname,
    price_sig: await sha256Base64Url(`${maxPrice}|${merchantConfig.pricing.policyDigest}|${inputsHash}`),
  } as PaymentTokenClaims;

  const tokenFingerprint = await sha256Base64Url(`${claims.mer}|${claims.sub}|${claims.nonce}`);
  const proxyContext = await buildProxyContextHeader(claims, claims.sub, {});
  const receiptKey = receiptCacheKey(claims.rid, claims.inputs_hash, claims.policy_ver);

  const cached = await getCachedReceipt(env, receiptKey);
  if (cached && cached.receipt.userId === claims.sub && cached.content) {
    return buildResponse(cached.receipt, cached.content, cached.contentType, tokenFingerprint, proxyContext);
  }

  const policyMismatch = ensurePolicyCompatibility(merchantConfig.pricing.policyVersion, merchantConfig.pricing.policyDigest, claims);
  if (policyMismatch) {
    return policyMismatch;
  }

  const routeEntitlement = resolveRouteEntitlement(merchantConfig, claims.rid, routeConfig);
  let entitlementGrant: EntitlementGrant | null = null;
  const entitlementsClient = routeEntitlement ? new EntitlementsClient(env.ENTITLEMENTS_DO) : null;
  if (routeEntitlement && !entitlementsClient) {
    return subscriptionRequired(routeEntitlement, { reason: "entitlements_unconfigured", upgradeUrl: routeEntitlement.upgradeUrl });
  }
  if (routeEntitlement && entitlementsClient) {
    const decision = await entitlementsClient.access({
      userId: claims.sub,
      merchantId: claims.mer,
      feature: routeEntitlement.feature,
      quotaKey: routeEntitlement.quotaKey,
      consume: false,
    });
    if (decision.allowed) {
      entitlementGrant = { ...routeEntitlement };
    } else if (!decision.fallbackToMetered) {
      return subscriptionRequired(routeEntitlement, decision);
    }
  }

  if (entitlementGrant) {
    return handleEntitledRequest({
      request,
      env,
      claims,
      merchantConfig,
      tokenFingerprint,
      proxyContext,
      receiptKey,
      entitlementGrant,
      entitlementsClient,
      bodyBytes,
      ctx,
      appId,
    });
  }

  return handleMeteredRequest({
    request,
    env,
    claims,
    merchantConfig,
    tokenFingerprint,
    proxyContext,
    receiptKey,
    requestedPricingMode,
    maxPrice,
    bodyBytes,
    routeConfig,
    ctx,
    appId,
  });
};

const handleEntitledRequest = async ({
  request,
  env,
  claims,
  merchantConfig,
  tokenFingerprint,
  proxyContext,
  receiptKey,
  entitlementGrant,
  entitlementsClient,
  bodyBytes,
  ctx,
  appId,
}: {
  request: Request;
  env: ProxyEnv;
  claims: PaymentTokenClaims;
  merchantConfig: MerchantConfig;
  tokenFingerprint: string;
  proxyContext: string;
  receiptKey: string;
  entitlementGrant: EntitlementGrant;
  entitlementsClient: EntitlementsClient | null;
  bodyBytes: Uint8Array | null;
  ctx: ExecutionContext;
  appId: string;
}): Promise<Response> => {
  const originContext = await buildOriginRequest(request, merchantConfig, env);
  const originRequest = new Request(originContext.url.toString(), {
    method: request.method,
    headers: originContext.headers,
    body: cloneBody(bodyBytes),
    redirect: request.redirect,
  });

  const originResponse = await fetch(originRequest);
  if (!originResponse.ok) {
    return cloneResponse(originResponse);
  }

  const contentBuffer = await originResponse.arrayBuffer();
  const contentHash = await sha256Base64Url(contentBuffer);
  const proxySignature = await buildProxySignature({ claims, contentHash });

  const finalization = await finalizePricing({
    response: originResponse,
    body: contentBuffer,
    estimate: null,
    pricingMode: "subscription",
    maxPrice: 0,
  });

  if (entitlementsClient) {
    safeWaitUntil(ctx, async () => {
      try {
        await entitlementsClient.access({
          userId: claims.sub,
          merchantId: claims.mer,
          feature: entitlementGrant.feature,
          quotaKey: entitlementGrant.quotaKey,
          consume: true,
        });
      } catch (_error) {
        // Best-effort; entitlement sync is eventually consistent.
      }
    });
  }

  const receipt = buildSubscriptionReceipt({
    claims,
    tokenFingerprint,
    contentHash,
    originResponse,
    proxySignature,
    observablesDigest: finalization.observablesDigest,
  });

  await putReceiptAndArtifact(env, receiptKey, receipt, contentBuffer, {
    contentType: originResponse.headers.get("content-type") ?? undefined,
    cacheControl: originResponse.headers.get("cache-control") ?? undefined,
  });

  safeWaitUntil(ctx, async () => {
    await notifyReceiptEvent(env, receipt, appId);
  });

  return buildResponse(receipt, contentBuffer, originResponse.headers.get("content-type") ?? undefined, tokenFingerprint, proxyContext);
};

export const handleMeteredRequest = async ({
  request,
  env,
  claims,
  merchantConfig,
  tokenFingerprint,
  proxyContext,
  receiptKey,
  requestedPricingMode,
  maxPrice,
  bodyBytes,
  routeConfig,
  ctx,
  appId,
}: {
  request: Request;
  env: ProxyEnv;
  claims: PaymentTokenClaims;
  merchantConfig: MerchantConfig;
  tokenFingerprint: string;
  proxyContext: string;
  receiptKey: string;
  requestedPricingMode: PricingMode;
  maxPrice: number;
  bodyBytes: Uint8Array | null;
  routeConfig?: MerchantRouteConfig | null;
  ctx?: ExecutionContext;
  appId: string;
}): Promise<Response> => {
  const redeem = new RedeemClient(env.REDEEM_DO);
  const shardId = `${claims.sub}:${claims.mer}`;
  const effectiveMode: PricingMode = merchantConfig.pricing.estimateIsFinal ? "estimate-is-final" : requestedPricingMode;
  const begin = await redeem.begin(
    shardId,
    buildBeginPayload(claims, tokenFingerprint, maxPrice, effectiveMode)
  );

  if (begin.status === "replay" && begin.receipt) {
    const receipt = begin.receipt;
    const artifact = receipt.contentHash ? await env.ARTIFACTS_R2.get(receipt.contentHash) : null;
    const body = artifact ? await artifact.arrayBuffer() : new ArrayBuffer(0);
    return buildResponse(receipt, body, artifact?.httpMetadata?.contentType, tokenFingerprint, proxyContext);
  }

  if (begin.status === "reject") {
    return new Response(JSON.stringify({ error: begin.reason ?? "redeem_rejected" }), {
      status: 402,
      headers: JSON_HEADERS,
    });
  }

  const variablePricing = merchantConfig.pricing.variablePricing ?? false;
  const estimateSuffix = merchantConfig.pricing.estimatePathSuffix ?? "/estimate";
  const defaultEstimateTtlSeconds = merchantConfig.pricing.estimateTtlSeconds ?? DEFAULT_ESTIMATE_TTL_SECONDS;
  const estimateKey = receiptCacheKey(claims.rid, claims.inputs_hash, claims.policy_ver);

  let estimateResult: EstimateResult | null = null;

  if (variablePricing && effectiveMode !== "execute-only") {
    const cachedEstimate = await getCachedEstimate(env, estimateKey);
    if (
      cachedEstimate &&
      cachedEstimate.estimatedPrice <= maxPrice &&
      cachedEstimate.policyVersion === claims.policy_ver &&
      cachedEstimate.policyDigest === claims.policy_digest
    ) {
      estimateResult = {
        estimatedPrice: cachedEstimate.estimatedPrice,
        currency: cachedEstimate.currency,
        estDigest: cachedEstimate.estDigest,
        priceSig: cachedEstimate.priceSig,
        estimateIsFinal: cachedEstimate.estimateIsFinal ?? false,
        pricingUnattested: !cachedEstimate.priceSig,
      };
    }

    if (!estimateResult) {
      const estimatePath = appendEstimateSuffix(new URL(request.url).pathname, estimateSuffix);
      const estimateContext = await buildOriginRequest(request, merchantConfig, env, { overridePath: estimatePath });
      const estimateRequest = new Request(estimateContext.url.toString(), {
        method: request.method,
        headers: estimateContext.headers,
        body: cloneBody(bodyBytes),
        redirect: request.redirect,
      });
      const estimateResponse = await fetch(estimateRequest);
      if (!estimateResponse.ok) {
        await redeem.cancel(shardId, { nonce: claims.nonce, reason: `estimate_status_${estimateResponse.status}` });
        return new Response(JSON.stringify({ error: "estimate_failed", status: estimateResponse.status }), {
          status: 502,
          headers: JSON_HEADERS,
        });
      }
      const estimatePayload = await parseEstimatePayload(estimateResponse);
      if (estimatePayload.policy_ver !== claims.policy_ver) {
        await redeem.cancel(shardId, { nonce: claims.nonce, reason: "estimate_policy_mismatch" });
        return new Response(
          JSON.stringify({
            error: "policy_mismatch",
            token_policy_ver: claims.policy_ver,
            server_policy_ver: estimatePayload.policy_ver,
          }),
          {
            status: 409,
            headers: JSON_HEADERS,
          }
        );
      }
      if (estimatePayload.policy_digest && estimatePayload.policy_digest !== claims.policy_digest) {
        await redeem.cancel(shardId, { nonce: claims.nonce, reason: "estimate_policy_digest_mismatch" });
        return new Response(
          JSON.stringify({
            error: "policy_digest_mismatch",
            token_policy_digest: claims.policy_digest,
            server_policy_digest: estimatePayload.policy_digest,
          }),
          {
            status: 409,
            headers: JSON_HEADERS,
          }
        );
      }
      const estimatedPrice = Number(estimatePayload.estimated_price ?? NaN);
      if (!Number.isFinite(estimatedPrice) || estimatedPrice < 0) {
        await redeem.cancel(shardId, { nonce: claims.nonce, reason: "estimate_invalid" });
        return new Response(JSON.stringify({ error: "estimate_invalid" }), { status: 502, headers: JSON_HEADERS });
      }
      if (estimatedPrice > maxPrice) {
        await redeem.cancel(shardId, { nonce: claims.nonce, reason: "estimate_cap_exceeded" });
        return capExceeded(maxPrice, estimatedPrice, claims.policy_ver);
      }

      const estDigest = await sha256Base64Url(canonicalJson(estimatePayload));
      const estimateIsFinal = Boolean(estimatePayload.estimate_is_final ?? merchantConfig.pricing.estimateIsFinal);
      const ttlHint = Number(estimatePayload.estimate_ttl_seconds ?? defaultEstimateTtlSeconds);
      const effectiveTtl = Number.isFinite(ttlHint) && ttlHint > 0 ? Math.min(Math.max(ttlHint, 1), 600) : defaultEstimateTtlSeconds;
      estimateResult = {
        estimatedPrice,
        currency: estimatePayload.currency ?? claims.ccy,
        estDigest,
        priceSig: estimatePayload.price_sig ?? null,
        estimateIsFinal,
        pricingUnattested: !estimatePayload.price_sig,
      };

      await putCachedEstimate(
        env,
        estimateKey,
        {
          estimatedPrice,
          currency: estimatePayload.currency ?? claims.ccy,
          policyVersion: claims.policy_ver,
          policyDigest: claims.policy_digest,
          priceSig: estimatePayload.price_sig ?? null,
          estDigest,
          estimateIsFinal,
        },
        effectiveTtl
      );
    }
  }

  if (!variablePricing && !estimateResult) {
    const syntheticEstimatePayload = {
      estimated_price: maxPrice,
      currency: claims.ccy,
      policy_ver: claims.policy_ver,
      policy_digest: claims.policy_digest,
      estimate_is_final: true,
    } as const;
    const estDigest = await sha256Base64Url(canonicalJson(syntheticEstimatePayload));
    estimateResult = {
      estimatedPrice: maxPrice,
      currency: claims.ccy,
      estDigest,
      priceSig: null,
      estimateIsFinal: true,
      pricingUnattested: true,
    };
  }

  const originContext = await buildOriginRequest(request, merchantConfig, env);
  const originRequest = new Request(originContext.url.toString(), {
    method: request.method,
    headers: originContext.headers,
    body: cloneBody(bodyBytes),
    redirect: request.redirect,
  });

  const originResponse = await fetch(originRequest);

  if (!originResponse.ok) {
    await redeem.cancel(shardId, { nonce: claims.nonce, reason: `origin_status_${originResponse.status}` });
    return cloneResponse(originResponse);
  }

  const contentBuffer = await originResponse.arrayBuffer();
  const contentHash = await sha256Base64Url(contentBuffer);
  const proxySignature = await buildProxySignature({ claims, contentHash });

  const finalization = await finalizePricing({
    response: originResponse,
    body: contentBuffer,
    estimate: estimateResult,
    pricingMode: effectiveMode,
    maxPrice,
  });

  if (finalization.finalPrice > maxPrice) {
    await redeem.cancel(shardId, { nonce: claims.nonce, reason: "final_price_cap_exceeded" });
    return capExceeded(maxPrice, finalization.finalPrice, claims.policy_ver, estimateResult?.estimatedPrice);
  }

  const commitPayload = buildCommitPayload({
    claims,
    tokenFingerprint,
    contentHash,
    originStatus: originResponse.status,
    headers: pickHeaders(originResponse.headers),
    proxySignature,
    finalPrice: finalization.finalPrice,
    estimatedPrice: estimateResult?.estimatedPrice,
    pricingMode: effectiveMode,
    estDigest: estimateResult?.estDigest,
    observablesDigest: finalization.observablesDigest,
    finalPriceSig: finalization.finalPriceSig,
    pricingUnattested: Boolean(finalization.pricingUnattested || estimateResult?.pricingUnattested),
  });

  const commitRes = await redeem.commit(shardId, commitPayload);
  const commitBody = (await commitRes.json()) as { status: string; receipt?: any; error?: string };
  if (commitBody.status !== "ok" || !commitBody.receipt) {
    await redeem.cancel(shardId, { nonce: claims.nonce, reason: "commit_failed" });
    return new Response(JSON.stringify({ error: "commit_failed", detail: commitBody }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }

  const receipt = commitBody.receipt;
  await putReceiptAndArtifact(env, receiptKey, receipt, contentBuffer, {
    contentType: originResponse.headers.get("content-type") ?? undefined,
    cacheControl: originResponse.headers.get("cache-control") ?? undefined,
  });

  safeWaitUntil(ctx, async () => {
    await notifyReceiptEvent(env, receipt, appId);
  });

  return buildResponse(receipt, contentBuffer, originResponse.headers.get("content-type") ?? undefined, tokenFingerprint, proxyContext);
};

export const buildBeginPayload = (
  claims: PaymentTokenClaims,
  tokenFingerprint: string,
  maxPrice: number,
  pricingMode: PricingMode
) => ({
  nonce: claims.nonce,
  userId: claims.sub,
  merchantId: claims.mer,
  rid: claims.rid,
  method: claims.method,
  inputsHash: claims.inputs_hash,
  maxPrice,
  currency: claims.ccy,
  policyVersion: claims.policy_ver,
  policyDigest: claims.policy_digest,
  tokenFingerprint,
  pricingMode,
  priceSig: claims.price_sig,
});

export const buildCommitPayload = ({
  claims,
  tokenFingerprint,
  contentHash,
  originStatus,
  headers,
  proxySignature,
  finalPrice,
  estimatedPrice,
  pricingMode,
  estDigest,
  observablesDigest,
  finalPriceSig,
  pricingUnattested,
}: {
  claims: PaymentTokenClaims;
  tokenFingerprint: string;
  contentHash: string;
  originStatus: number;
  headers: Record<string, string>;
  proxySignature: string;
  finalPrice: number;
  estimatedPrice?: number;
  pricingMode: PricingMode;
  estDigest?: string;
  observablesDigest?: string;
  finalPriceSig?: string;
  pricingUnattested?: boolean;
}) => ({
  nonce: claims.nonce,
  rid: claims.rid,
  inputsHash: claims.inputs_hash,
  policyVersion: claims.policy_ver,
  policyDigest: claims.policy_digest,
  finalPrice,
  ...(estimatedPrice !== undefined ? { estimatedPrice } : {}),
  currency: claims.ccy,
  userId: claims.sub,
  merchantId: claims.mer,
  contentHash,
  originStatus,
  originHeaders: headers,
  tokenFingerprint,
  proxySignature,
  pricingMode,
  estDigest,
  observablesDigest,
  finalPriceSig,
  pricingUnattested,
});

export const buildSubscriptionReceipt = ({
  claims,
  tokenFingerprint,
  contentHash,
  originResponse,
  proxySignature,
  observablesDigest,
}: {
  claims: PaymentTokenClaims;
  tokenFingerprint: string;
  contentHash: string;
  originResponse: Response;
  proxySignature: string;
  observablesDigest?: string;
}) => ({
  receiptId: crypto.randomUUID(),
  nonce: claims.nonce,
  userId: claims.sub,
  merchantId: claims.mer,
  rid: claims.rid,
  inputsHash: claims.inputs_hash,
  policyVersion: claims.policy_ver,
  policyDigest: claims.policy_digest,
  maxPrice: 0,
  estimatedPrice: 0,
  finalPrice: 0,
  currency: claims.ccy,
  timestamp: new Date().toISOString(),
  status: "paid",
  contentHash,
  originStatus: originResponse.status,
  originHeadersSubset: pickHeaders(originResponse.headers),
  tokenFingerprint,
  proxySignature,
  pricingMode: "subscription" as PricingMode,
  pricingUnattested: true,
  observablesDigest,
});

export const buildResponse = (
  receipt: any,
  body: ArrayBuffer,
  contentType: string | undefined,
  tokenFingerprint: string,
  proxyContext: string
) => {
  const headers = new Headers();
  headers.set("X-Receipt-Id", receipt.receiptId);
  headers.set("X-Content-Hash", receipt.contentHash ?? "");
  headers.set("X-Token-Fingerprint", tokenFingerprint);
  headers.set("X-Proxy-Context", proxyContext);
  if (contentType) {
    headers.set("content-type", contentType);
  }
  return new Response(body, {
    status: 200,
    headers,
  });
};

export const cloneResponse = (response: Response): Response => {
  const headers = new Headers(response.headers);
  return new Response(response.body, {
    status: response.status,
    headers,
  });
};

export const pickHeaders = (headers: Headers): Record<string, string> => {
  const allowlist = ["content-type", "cache-control", "etag", "last-modified"];
  const result: Record<string, string> = {};
  for (const key of allowlist) {
    const value = headers.get(key);
    if (value) {
      result[key] = value;
    }
  }
  return result;
};

export const buildProxySignature = async ({ claims, contentHash }: { claims: PaymentTokenClaims; contentHash: string }) => {
  const serialized = `${claims.sub}|${claims.mer}|${claims.rid}|${claims.inputs_hash}|${claims.policy_ver}|${contentHash}`;
  return sha256Base64Url(serialized);
};

export const resolvePricingMode = (header: string | null): PricingMode => {
  const normalized = header?.toLowerCase() ?? "estimate-first";
  if (
    normalized === "execute-only" ||
    normalized === "estimate-is-final" ||
    normalized === "estimate-first" ||
    normalized === "subscription"
  ) {
    return normalized;
  }
  return "estimate-first";
};

export const appendEstimateSuffix = (path: string, suffix: string): string => {
  if (path.endsWith(suffix)) {
    return path;
  }
  if (suffix.startsWith("/")) {
    return `${path}${suffix}`;
  }
  return `${path}/${suffix}`;
};

export const canonicalJson = (value: unknown): string => {
  const canonicalize = (input: unknown): unknown => {
    if (Array.isArray(input)) {
      return input.map((item) => canonicalize(item));
    }
    if (input && typeof input === "object") {
      const entries = Object.entries(input as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b));
      const result: Record<string, unknown> = {};
      for (const [key, val] of entries) {
        result[key] = canonicalize(val);
      }
      return result;
    }
    return input;
  };
  return JSON.stringify(canonicalize(value));
};

export const readBodyBytes = async (request: Request): Promise<Uint8Array | null> => {
  const method = request.method?.toUpperCase() ?? "GET";
  if (method === "GET" || method === "HEAD") {
    return null;
  }
  const clone = request.clone();
  const buffer = new Uint8Array(await clone.arrayBuffer());
  return buffer;
};

export const cloneBody = (body: Uint8Array | null): BodyInit | undefined => {
  if (!body) {
    return undefined;
  }
  return body.slice();
};

const parseList = (value?: string): string[] =>
  (value ?? "")
    .split(/[\s,]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

const applyCors = (request: Request, env: ProxyEnv, response: Response): Response => {
  if (response.status === 101 || (response as any).webSocket) {
    return response;
  }
  const origin = request.headers.get("origin");
  if (!origin) {
    return response;
  }
  if (response.headers.has("access-control-allow-origin")) {
    return response;
  }
  const allowed = parseList(env.ALLOWED_ORIGINS);
  if (allowed.length === 0) {
    return response;
  }
  const allowAll = allowed.includes("*");
  const normalizedOrigin = origin.toLowerCase();
  if (!allowAll && !allowed.includes(normalizedOrigin)) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", allowAll ? "*" : origin);
  if (!allowAll) {
    const existingVary = headers.get("vary");
    headers.set("vary", existingVary ? `${existingVary}, Origin` : "Origin");
    if (!headers.has("access-control-allow-credentials")) {
      headers.set("access-control-allow-credentials", "true");
    }
  }

  return new Response(response.body, {
    status: response.status,
    headers,
  });
};

const handlePreflight = (request: Request, env: ProxyEnv): Response => {
  const headers = new Headers();
  const requestHeaders = request.headers.get("access-control-request-headers");
  if (requestHeaders) {
    headers.set("access-control-allow-headers", requestHeaders);
    headers.set("vary", "Access-Control-Request-Headers");
  } else {
    headers.set(
      "access-control-allow-headers",
      "authorization,x-meter-max-price,x-meter-mode,x-pricing-mode,x-user-id,content-type"
    );
  }
  headers.set("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  headers.set("access-control-max-age", "600");
  const response = new Response(null, { status: 204, headers });
  return applyCors(request, env, response);
};

export const parseEstimatePayload = async (response: Response): Promise<any> => {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) {
    throw new Error("estimate_json_expected");
  }
  return response.json();
};

export const finalizePricing = async ({
  response,
  body,
  estimate,
  pricingMode,
  maxPrice,
}: {
  response: Response;
  body: ArrayBuffer;
  estimate: EstimateResult | null;
  pricingMode: PricingMode;
  maxPrice: number;
}): Promise<FinalizationResult> => {
  const buffer = new Uint8Array(body);
  const contentType = response.headers.get("content-type") ?? "";
  let payload: any = null;
  if (contentType.includes("json")) {
    try {
      const text = new TextDecoder().decode(buffer);
      payload = JSON.parse(text);
    } catch (error) {
      payload = null;
    }
  }

  const observables = payload?.usage ?? payload?.observables ?? undefined;
  const measurement = {
    ...(observables !== undefined ? { observables } : {}),
    response_bytes: buffer.byteLength,
  };
  const observablesDigest = await sha256Base64Url(canonicalJson(measurement));

  return finalizePricingFromPayload({
    payload,
    estimate,
    pricingMode,
    maxPrice,
    finalPriceSig: typeof payload?.price_sig === "string" ? payload.price_sig : undefined,
    observablesDigest,
  });
};

export const finalizePricingFromPayload = ({
  payload,
  estimate,
  pricingMode,
  maxPrice,
  finalPriceSig,
  observablesDigest,
}: {
  payload: any;
  estimate: EstimateResult | null;
  pricingMode: PricingMode;
  maxPrice: number;
  finalPriceSig: string | undefined;
  observablesDigest: string | undefined;
}): FinalizationResult => {
  let finalPrice = typeof payload?.final_price === "number" ? payload.final_price : undefined;

  if (finalPrice === undefined) {
    if (pricingMode === "estimate-is-final" && estimate) {
      finalPrice = estimate.estimatedPrice;
    } else if (estimate?.estimateIsFinal) {
      finalPrice = estimate.estimatedPrice;
    } else if (estimate) {
      finalPrice = estimate.estimatedPrice;
    } else {
      finalPrice = maxPrice;
    }
  }

  if (finalPrice === undefined || !Number.isFinite(finalPrice)) {
    throw new Error("final_price_unavailable");
  }

  return {
    finalPrice,
    finalPriceSig,
    observablesDigest,
    pricingUnattested: !finalPriceSig,
  };
};

export const capExceeded = (maxPrice: number, required: number, policyVersion: number, estimated?: number) => {
  const body = {
    error: "cap_exceeded",
    required_max_price: required,
    policy_ver: policyVersion,
    ...(estimated !== undefined ? { estimated_price: estimated } : {}),
  };
  const headers = new Headers(JSON_HEADERS);
  headers.set("X-Required-Max-Price", String(required));
  headers.set("X-Policy-Ver", String(policyVersion));
  return new Response(JSON.stringify(body), { status: 402, headers });
};

export const ensurePolicyCompatibility = (
  serverPolicyVersion: number,
  serverPolicyDigest: string,
  claims: PaymentTokenClaims
): Response | null => {
  const expectedVersion = Number(serverPolicyVersion);
  const claimVersion = Number(claims.policy_ver);
  if (Number.isFinite(expectedVersion) && Number.isFinite(claimVersion) && expectedVersion !== claimVersion) {
    return new Response(
      JSON.stringify({
        error: "policy_mismatch",
        token_policy_ver: claims.policy_ver,
        server_policy_ver: serverPolicyVersion,
        accepts_policy_vers: [serverPolicyVersion],
      }),
      { status: 409, headers: JSON_HEADERS }
    );
  }
  if (serverPolicyDigest !== claims.policy_digest) {
    return new Response(
      JSON.stringify({
        error: "policy_digest_mismatch",
        token_policy_digest: claims.policy_digest,
        server_policy_digest: serverPolicyDigest,
      }),
      { status: 409, headers: JSON_HEADERS }
    );
  }
  return null;
};

const resolveUserIdentity = (request: Request, config: MerchantConfig): string | null => {
  const identity = config.preflight?.identity ?? { header: "authorization", required: true };
  if (!identity.header) {
    return null;
  }
  const value = request.headers.get(identity.header);
  if ((!value || value.trim() === "") && identity.required) {
    return null;
  }
  return value?.trim() ?? null;
};

const resolveRouteId = (pathname: string, method: string): string => {
  return pathname || `${method.toUpperCase()} /`;
};

const computeInputsHash = async (url: URL, method: string, bodyBytes: Uint8Array | null): Promise<string> => {
  const queryEntries = Array.from(url.searchParams.entries());
  const normalized = canonicalJson({
    method: method.toUpperCase(),
    path: url.pathname,
    query: queryEntries,
    bodyHash: bodyBytes ? await sha256Base64Url(bodyBytes.buffer) : null,
  });
  return sha256Base64Url(normalized);
};

const resolveCap = ({
  header,
  defaultCap,
  capMultiplier,
}: {
  header: string | null;
  defaultCap: number;
  capMultiplier?: number;
}): { value: number; error?: Response } => {
  if (!header || header.trim() === "") {
    return { value: defaultCap };
  }
  const parsed = Number(header);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return {
      value: defaultCap,
      error: new Response(JSON.stringify({ error: "invalid_max_price" }), { status: 400, headers: JSON_HEADERS }),
    };
  }
  if (capMultiplier && parsed > defaultCap * capMultiplier) {
    return {
      value: defaultCap,
      error: new Response(
        JSON.stringify({ error: "max_price_exceeds_limit", limit: defaultCap * capMultiplier }),
        { status: 400, headers: JSON_HEADERS }
      ),
    };
  }
  return { value: parsed };
};

const proxyPassthrough = async (
  request: Request,
  env: ProxyEnv,
  merchantConfig: MerchantConfig,
  bodyBytes?: Uint8Array | null
): Promise<Response> => {
  const originContext = await buildOriginRequest(request, merchantConfig, env);
  let body: BodyInit | undefined;
  if (bodyBytes === undefined) {
    body = request.body ?? undefined;
  } else if (bodyBytes === null) {
    body = undefined;
  } else {
    body = cloneBody(bodyBytes);
  }
  const originRequest = new Request(originContext.url.toString(), {
    method: request.method,
    headers: originContext.headers,
    body,
    redirect: request.redirect,
  });
  return fetch(originRequest);
};

export const resolveRouteEntitlement = (
  merchantConfig: MerchantConfig,
  rid: string,
  appRoute?: MerchantRouteConfig | null
): RouteEntitlementRule | null => {
  const entConfig = merchantConfig.entitlements?.routes;
  const direct = entConfig ? entConfig[rid] ?? entConfig["*"] ?? null : null;
  if (direct) {
    return direct;
  }
  if (appRoute && appRoute.pricing.mode === "subscription") {
    return {
      feature: appRoute.pricing.feature,
      upgradeUrl: appRoute.pricing.upgradeUrl,
      fallbackMode: "block",
    };
  }
  return null;
};


export const resolveMerchantAppRoute = (
  appConfig: MerchantAppConfig | null,
  method: string,
  path: string
): MerchantRouteConfig | null => {
  if (!appConfig) {
    return null;
  }
  const normalizedMethod = method.toUpperCase();
  for (const route of appConfig.routes ?? []) {
    if ((route.method ?? "GET").toUpperCase() !== normalizedMethod) {
      continue;
    }
    if (routePathMatches(route.path, path)) {
      return route;
    }
  }
  return null;
};

const routePathMatches = (template: string, actual: string): boolean => {
  if (template === actual) {
    return true;
  }
  const normalize = (value: string) => (value.endsWith('/') && value !== '/' ? value.slice(0, -1) : value);
  const normalizedTemplate = normalize(template);
  const normalizedActual = normalize(actual);
  if (normalizedTemplate === normalizedActual) {
    return true;
  }
  const templateParts = normalizedTemplate.split('/').filter(Boolean);
  const actualParts = normalizedActual.split('/').filter(Boolean);

  const wildcardIndex = templateParts.indexOf('*');
  if (wildcardIndex === -1 && templateParts.length !== actualParts.length) {
    return false;
  }
  if (wildcardIndex !== -1 && actualParts.length < wildcardIndex) {
    return false;
  }

  for (let i = 0; i < templateParts.length; i += 1) {
    const templateSegment = templateParts[i];
    if (templateSegment === '*') {
      return true;
    }
    const actualSegment = actualParts[i];
    if (actualSegment === undefined) {
      return false;
    }
    if (templateSegment.startsWith(':')) {
      continue;
    }
    if (templateSegment !== actualSegment) {
      return false;
    }
  }

  return wildcardIndex !== -1 || templateParts.length === actualParts.length;
};

export const subscriptionRequired = (
  rule: RouteEntitlementRule,
  decision: { reason?: string; upgradeUrl?: string }
): Response => {
  const headers = new Headers(JSON_HEADERS);
  headers.set("X-Required-Entitlement", rule.feature);
  if (decision.upgradeUrl) {
    headers.set("X-Upgrade-Url", decision.upgradeUrl);
  }
  return new Response(
    JSON.stringify({
      error: "subscription_required",
      needed: `subscription:${rule.feature}`,
      upgrade_url: decision.upgradeUrl,
      reason: decision.reason,
    }),
    {
      status: 402,
      headers,
    }
  );
};

export const safeWaitUntil = (ctx: ExecutionContext | undefined, fn: () => Promise<void>): void => {
  try {
    ctx?.waitUntil(fn());
  } catch (_error) {
    // ignore; outside workers runtime
  }
};
