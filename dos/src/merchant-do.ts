import { z } from "zod";

import { DurableObjectBase } from "./do-base";

const JSON_HEADERS = { "content-type": "application/json" } as const;

const pricingRuleSchema = z.object({
  match: z.object({
    method: z.string(),
    path: z.string(),
  }),
  price: z.object({
    flat: z.number().nonnegative().optional(),
    perMbReq: z.number().nonnegative().optional(),
    perMbResp: z.number().nonnegative().optional(),
    min: z.number().nonnegative().optional(),
  }),
});

const merchantConfigSchema = z.object({
  merchantId: z.string(),
  origin: z.object({
    baseUrl: z.string(),
    auth: z.object({
      kind: z.enum(["jwt", "api_key"]),
      secretRef: z.string(),
      header: z.string().optional(),
    }),
  }),
  pricing: z.object({
    policyVersion: z.number().int(),
    policyDigest: z.string(),
    variablePricing: z.boolean().optional(),
    estimatePathSuffix: z.string().optional(),
    priceUnit: z.string().default("USD"),
    estimateIsFinal: z.boolean().optional(),
    estimateTtlSeconds: z.number().int().optional(),
    rules: z.array(pricingRuleSchema),
  }),
  entitlements: z
    .object({
      routes: z.record(
        z.object({
          feature: z.string(),
          quotaKey: z.string().optional(),
          fallbackMode: z.enum(["metered", "block"]).optional(),
          upgradeUrl: z.string().optional(),
        })
      ),
    })
    .optional(),
  cache: z.object({
    maxKvBytes: z.number().int(),
    ttlSeconds: z.number().int(),
  }).optional(),
  context: z.object({
    forwardCct: z.boolean().optional(),
    allowedClaims: z.array(z.string()).optional(),
  }).optional(),
  limits: z.object({
    qps: z.number().int().optional(),
    maxArtifactMb: z.number().int().optional(),
  }).optional(),
});

export type MerchantConfig = z.infer<typeof merchantConfigSchema>;

export class MerchantDurableObject extends DurableObjectBase {
  private readonly storage: DurableObjectStorage;

  constructor(state: DurableObjectState, _env: unknown) {
    super(state, _env);
    this.storage = state.storage;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    if (method === "GET" && url.pathname === "/config") {
      const config = await this.storage.get<MerchantConfig>("config");
      if (!config) {
        return new Response(JSON.stringify({ error: "config_missing" }), { status: 404, headers: JSON_HEADERS });
      }
      return new Response(JSON.stringify(config), { status: 200, headers: JSON_HEADERS });
    }

    if (method === "POST" && url.pathname === "/config") {
      const body = merchantConfigSchema.parse(await request.json());
      await this.storage.put("config", body);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: JSON_HEADERS });
    }

    if (method === "POST" && (url.pathname === "/price" || url.pathname === "/estimate")) {
      const config = await this.storage.get<MerchantConfig>("config");
      if (!config) {
        return new Response(JSON.stringify({ error: "config_missing" }), { status: 404, headers: JSON_HEADERS });
      }
      const body = await request.json();
      const price = this.computePrice(config, String(body.method ?? "GET"), String(body.path ?? "/"), body.requestBytes ?? 0, body.responseBytes ?? 0);
      const responseBody = {
        estimated_price: price,
        currency: config.pricing.priceUnit ?? "USD",
        policy_ver: config.pricing.policyVersion,
        policy_digest: config.pricing.policyDigest,
        estimate_is_final: config.pricing.estimateIsFinal ?? false,
        estimate_ttl_seconds: config.pricing.estimateTtlSeconds ?? undefined,
        price_sig: null,
      } as const;
      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: JSON_HEADERS,
      });
    }

    return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: JSON_HEADERS });
  }

  private computePrice(config: MerchantConfig, method: string, path: string, reqBytes: number, respBytes: number): number {
    for (const rule of config.pricing.rules) {
      if (!pathMatches(path, rule.match.path)) {
        continue;
      }
      if (rule.match.method.toUpperCase() !== method.toUpperCase()) {
        continue;
      }
      const price =
        (rule.price.flat ?? 0) +
        (rule.price.perMbReq ?? 0) * (reqBytes / (1024 * 1024)) +
        (rule.price.perMbResp ?? 0) * (respBytes / (1024 * 1024));
      return Math.max(price, rule.price.min ?? 0);
    }
    return 0;
  }
}

const pathMatches = (actual: string, template: string) => {
  if (template.includes("{")) {
    const regex = new RegExp("^" + template.replace(/\{[^/]+\}/g, "[^/]+") + "$");
    return regex.test(actual);
  }
  return actual === template;
};
