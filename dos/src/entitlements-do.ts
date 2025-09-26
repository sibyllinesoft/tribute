import { DurableObjectBase } from "./do-base";

interface FeatureGrant {
  expiresAt?: string | null;
  graceMs?: number;
}

interface QuotaGrant {
  remaining: number;
  resetAt?: string | null;
}

interface EntitlementState {
  features: Record<string, FeatureGrant>;
  quotas: Record<string, QuotaGrant>;
  fallbackMode: "metered" | "block";
  upgradeUrl?: string;
  updatedAt: string;
}

interface SyncPayload {
  userId: string;
  merchantId: string;
  features?: Array<{ name: string; expiresAt?: string | null; graceMs?: number }>;
  quotas?: Record<string, { remaining: number; resetAt?: string | null }>;
  fallbackMode?: "metered" | "block";
  upgradeUrl?: string;
}

interface AccessPayload {
  userId: string;
  merchantId: string;
  feature?: string;
  quotaKey?: string;
  consume?: boolean;
}

const JSON_HEADERS = { "content-type": "application/json" } as const;

export class EntitlementsDurableObject extends DurableObjectBase {
  constructor(private readonly state: DurableObjectState, _env: unknown) {
    super(state, _env);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    if (method === "POST" && url.pathname === "/sync") {
      const payload = (await request.json()) as SyncPayload;
      await this.sync(payload);
      return json({ ok: true });
    }

    if (method === "POST" && url.pathname === "/access") {
      const payload = (await request.json()) as AccessPayload;
      const decision = await this.access(payload);
      return json(decision);
    }

    if (method === "GET" && url.pathname === "/user") {
      const userId = url.searchParams.get("userId");
      const merchantId = url.searchParams.get("merchantId");
      if (!userId || !merchantId) {
        return json({ error: "missing_user_or_merchant" }, 400);
      }
      const state = await this.getState(merchantId, userId);
      if (!state) {
        return json({ error: "not_found" }, 404);
      }
      return json(state);
    }

    return json({ error: "not_found" }, 404);
  }

  private async sync(payload: SyncPayload): Promise<void> {
    const key = this.stateKey(payload.merchantId, payload.userId);
    const features: Record<string, FeatureGrant> = {};
    for (const feature of payload.features ?? []) {
      features[feature.name] = {
        expiresAt: feature.expiresAt ?? null,
        graceMs: feature.graceMs,
      };
    }
    const quotas: Record<string, QuotaGrant> = {};
    for (const [quotaKey, quota] of Object.entries(payload.quotas ?? {})) {
      quotas[quotaKey] = {
        remaining: Math.max(0, Math.floor(quota.remaining ?? 0)),
        resetAt: quota.resetAt ?? null,
      };
    }
    const state: EntitlementState = {
      features,
      quotas,
      fallbackMode: payload.fallbackMode ?? "metered",
      upgradeUrl: payload.upgradeUrl,
      updatedAt: new Date().toISOString(),
    };
    await this.state.storage.put(key, state);
  }

  private async access(payload: AccessPayload): Promise<{
    allowed: boolean;
    fallbackToMetered: boolean;
    reason?: string;
    upgradeUrl?: string;
    quotaRemaining?: number;
  }> {
    const key = this.stateKey(payload.merchantId, payload.userId);
    const state = await this.getState(payload.merchantId, payload.userId);
    if (!state) {
      return {
        allowed: false,
        fallbackToMetered: true,
        reason: "entitlements_missing",
      };
    }

    let allowed = true;
    let quotaRemaining: number | undefined;
    let reason: string | undefined;

    if (payload.feature) {
      const grant = state.features[payload.feature];
      if (!grant) {
        allowed = false;
        reason = "feature_missing";
      } else if (grant.expiresAt) {
        const expiryMs = Date.parse(grant.expiresAt);
        const graceMs = grant.graceMs ?? 0;
        if (!Number.isFinite(expiryMs)) {
          allowed = false;
          reason = "feature_expired";
        } else {
          const now = Date.now();
          if (now > expiryMs + graceMs) {
            allowed = false;
            reason = "feature_expired";
          }
        }
      }
    }

    if (allowed && payload.quotaKey) {
      const quota = state.quotas[payload.quotaKey];
      if (!quota) {
        allowed = false;
        reason = "quota_missing";
      } else {
        quotaRemaining = quota.remaining;
        if (quota.remaining <= 0) {
          allowed = false;
          reason = "quota_exhausted";
        } else if (payload.consume) {
          quota.remaining = quota.remaining - 1;
          quotaRemaining = quota.remaining;
          await this.state.storage.put(key, state);
        }
      }
    }

    if (allowed && payload.consume && !payload.quotaKey) {
      // No quota to decrement; still persist timestamp for auditing.
      state.updatedAt = new Date().toISOString();
      await this.state.storage.put(key, state);
    }

    return {
      allowed,
      fallbackToMetered: state.fallbackMode !== "block",
      reason,
      upgradeUrl: state.upgradeUrl,
      quotaRemaining,
    };
  }

  private async getState(merchantId: string, userId: string): Promise<EntitlementState | null> {
    if (!merchantId || !userId) {
      return null;
    }
    return (await this.state.storage.get<EntitlementState>(this.stateKey(merchantId, userId))) ?? null;
  }

  private stateKey(merchantId: string, userId: string): string {
    return `${merchantId}::${userId}`;
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
