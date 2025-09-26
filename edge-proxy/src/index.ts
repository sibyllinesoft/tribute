/* c8 ignore start */
/* istanbul ignore file */
import { receiptCacheKey, type PaymentTokenClaims, type PricingMode, type MerchantConfig } from "@tribute/durable-objects";
import type { ProxyEnv } from "./env";
import { extractBearer, verifyPaymentToken } from "./token";
import { sha256Base64Url } from "./crypto";
import { getCachedReceipt, putReceiptAndArtifact, getCachedEstimate, putCachedEstimate } from "./cache";
import { MerchantClient } from "./merchant-client";
import { RedeemClient } from "./redeem-client";
import { buildOriginRequest } from "./origin";
import { buildProxyContextHeader } from "./context";
import { EntitlementsClient } from "./entitlements-client";

const JSON_HEADERS = { "content-type": "application/json" } as const;
const DEFAULT_ESTIMATE_TTL_SECONDS = 90;

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
      return await handleRequest(request, env, ctx);
    } catch (error) {
      const body = JSON.stringify({ error: "proxy_failure", detail: `${error}` });
      return new Response(body, { status: 500, headers: JSON_HEADERS });
    }
  },
};

/* c8 ignore stop */

const handleRequest = async (request: Request, env: ProxyEnv, ctx: ExecutionContext): Promise<Response> => {
  const token = extractBearer(request.headers.get("authorization"));
  if (!token) {
    return new Response(JSON.stringify({ error: "missing_token" }), { status: 401, headers: JSON_HEADERS });
  }

  const claims = await verifyPaymentToken(token, env);
  const tokenFingerprint = await sha256Base64Url(token);
  const proxyContext = await buildProxyContextHeader(claims, claims.sub, {});
  const receiptKey = receiptCacheKey(claims.rid, claims.inputs_hash, claims.policy_ver);

  const cached = await getCachedReceipt(env, receiptKey);
  if (cached && cached.receipt.userId === claims.sub && cached.content) {
    return buildResponse(cached.receipt, cached.content, cached.contentType, tokenFingerprint, proxyContext);
  }

  const requestedPricingMode = resolvePricingMode(request.headers.get("x-pricing-mode"));
  const maxPriceResult = resolveMaxPrice(request.headers.get("x-max-price"), claims.max_price);
  if (maxPriceResult.error) {
    return maxPriceResult.error;
  }
  const maxPrice = maxPriceResult.value;

  const merchantClient = new MerchantClient(env.MERCHANT_DO);
  const merchantConfig = await merchantClient.getConfig(claims.mer);
  const policyMismatch = ensurePolicyCompatibility(merchantConfig.pricing.policyVersion, merchantConfig.pricing.policyDigest, claims);
  if (policyMismatch) {
    return policyMismatch;
  }

  const routeEntitlement = resolveRouteEntitlement(merchantConfig, claims.rid);
  let entitlementGrant: EntitlementGrant | null = null;
  const entitlementsClient = routeEntitlement ? new EntitlementsClient(env.ENTITLEMENTS_DO) : null;
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

  const bodyBytes = await readBodyBytes(request);

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

export const resolveMaxPrice = (header: string | null, tokenMax: number): { value: number; error?: Response } => {
  if (!header || header.trim() === "") {
    return { value: tokenMax };
  }
  const parsed = Number(header);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return {
      value: tokenMax,
      error: new Response(JSON.stringify({ error: "invalid_max_price" }), { status: 400, headers: JSON_HEADERS }),
    };
  }
  if (parsed > tokenMax) {
    return {
      value: tokenMax,
      error: new Response(JSON.stringify({ error: "max_price_exceeds_token" }), { status: 400, headers: JSON_HEADERS }),
    };
  }
  return { value: parsed };
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
  if (serverPolicyVersion !== claims.policy_ver) {
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

export const resolveRouteEntitlement = (merchantConfig: MerchantConfig, rid: string): RouteEntitlementRule | null => {
  const entConfig = merchantConfig.entitlements?.routes;
  if (!entConfig) return null;
  return entConfig[rid] ?? entConfig["*"] ?? null;
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
