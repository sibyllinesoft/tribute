import { z } from "zod";

const walletSchema = z
  .object({
    balance: z.number().nonnegative(),
    currency: z.string().min(1),
    refreshedAt: z.string().optional(),
    reserved: z.number().nonnegative().optional(),
  })
  .transform((wallet) => ({
    balance: wallet.balance,
    currency: wallet.currency,
    refreshedAt: wallet.refreshedAt ?? new Date().toISOString(),
    reserved: wallet.reserved ?? 0,
  }));

const receiptSchema = z.object({
  receiptId: z.string(),
  finalPrice: z.number(),
  currency: z.string(),
  timestamp: z.string(),
  rid: z.string().optional(),
  policyVersion: z.number().optional(),
  status: z.string().optional(),
});

const logEntrySchema = z.object({
  id: z.string(),
  level: z.enum(["info", "warn", "error", "debug"]).default("info"),
  message: z.string(),
  timestamp: z.string(),
  source: z.string().optional(),
  requestId: z.string().optional(),
});

const creditSchema = z.object({
  id: z.string(),
  amount: z.number(),
  currency: z.string(),
  source: z.string(),
  createdAt: z.string(),
  type: z.enum(["top_up", "refund", "adjustment"]).default("top_up"),
});

const routePricingSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("metered"),
    flatAmount: z.number().nonnegative(),
    currency: z.string().default("USD"),
  }),
  z.object({
    mode: z.literal("subscription"),
    feature: z.string().default("default"),
    upgradeUrl: z.string().url().optional(),
  }),
]);

const merchantRouteSchema = z.object({
  id: z.string(),
  method: z.string(),
  path: z.string(),
  description: z.string().optional(),
  pricing: routePricingSchema,
});

const merchantPageSchema = z.object({
  id: z.string(),
  url: z.string(),
  label: z.string().optional(),
  lastModified: z.string().optional(),
});

const merchantAppSchema = z.object({
  appId: z.string(),
  merchantId: z.string(),
  displayName: z.string(),
  origin: z
    .object({
      baseUrl: z.string().optional(),
      forwardAuthHeader: z.boolean().optional(),
      openapiPath: z.string().optional(),
      sitemapPath: z.string().optional(),
    })
    .nullable()
    .optional(),
  routes: z.array(merchantRouteSchema),
  updatedAt: z.string(),
  openapi: z
    .object({
      sourceUrl: z.string().optional(),
      fetchedAt: z.string().optional(),
      operations: z.number().optional(),
      error: z.string().optional(),
    })
    .optional(),
  pages: z.array(merchantPageSchema).optional(),
  sitemap: z
    .object({
      sourceUrl: z.string().optional(),
      fetchedAt: z.string().optional(),
      entries: z.number().optional(),
      error: z.string().optional(),
    })
    .optional(),
});

export type RoutePricing = z.infer<typeof routePricingSchema>;
export type MerchantRoute = z.infer<typeof merchantRouteSchema>;
export type MerchantApp = z.infer<typeof merchantAppSchema>;
export type MerchantPage = z.infer<typeof merchantPageSchema>;

const subscriptionSchema = z.object({
  id: z.string(),
  feature: z.string(),
  status: z.enum(["active", "trialing", "expired", "paused"]).default("active"),
  platform: z.string().optional(),
  renewalAt: z.string().nullable().optional(),
  plan: z.string().optional(),
});

const merchantSummarySchema = z.object({
  merchantId: z.string(),
  appId: z.string().nullable().optional(),
  displayName: z.string(),
  totalReceipts: z.number().nonnegative(),
  totalRevenue: z.number().nonnegative(),
  currency: z.string(),
  lastReceiptAt: z.string().nullable().optional(),
  lastReceiptAmount: z.number().nullable().optional(),
});

export type WalletView = z.infer<typeof walletSchema>;
export type Receipt = z.infer<typeof receiptSchema>;
export type LogEntry = z.infer<typeof logEntrySchema>;
export type Credit = z.infer<typeof creditSchema>;
export type Subscription = z.infer<typeof subscriptionSchema>;
export type MerchantSummary = z.infer<typeof merchantSummarySchema>;

export interface DashboardSnapshot {
  wallet: WalletView;
  receipts: Receipt[];
  logs: LogEntry[];
  credits: Credit[];
  subscriptions: Subscription[];
  merchantSummaries: MerchantSummary[];
}

export const CONTROL_BASE_PATH = import.meta.env.VITE_TRIBUTE_CONTROL_PATH ?? "/_tribute/control";
export const MERCHANT_APPS_BASE_PATH = import.meta.env.VITE_TRIBUTE_APPS_PATH ?? "/_tribute/merchant-apps";
const MANAGEMENT_BASE_ENV = (import.meta.env.VITE_TRIBUTE_PROXY_BASE ?? "").trim().replace(/\/$/, "");
const MANAGEMENT_PORT = (import.meta.env.VITE_TRIBUTE_PROXY_PORT ?? "8787").trim();

let cachedManagementBase: string | null = null;

const resolveManagementBase = (): string => {
  if (cachedManagementBase !== null) {
    return cachedManagementBase;
  }

  if (MANAGEMENT_BASE_ENV) {
    cachedManagementBase = MANAGEMENT_BASE_ENV;
    return cachedManagementBase;
  }

  if (typeof window !== "undefined") {
    try {
      const current = new URL(window.location.origin);
      if (current.port && current.port !== MANAGEMENT_PORT) {
        current.port = MANAGEMENT_PORT;
        cachedManagementBase = current.origin;
        return cachedManagementBase;
      }
      if (!current.port && MANAGEMENT_PORT) {
        if (current.hostname === "localhost" || current.hostname === "127.0.0.1") {
          const fallback = new URL(window.location.origin);
          fallback.port = MANAGEMENT_PORT;
          cachedManagementBase = fallback.origin;
          return cachedManagementBase;
        }
      }
      cachedManagementBase = current.origin;
      return cachedManagementBase;
    } catch (_error) {
      // ignore parse errors, fallback to relative path
    }
  }

  cachedManagementBase = "";
  return cachedManagementBase;
};

export const managementUrl = (path: string): string => {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const base = resolveManagementBase();
  return base ? `${base}${path}` : path;
};

const dashboardSnapshotSchema = z.object({
  wallet: walletSchema,
  receipts: z.array(receiptSchema),
  logs: z.array(logEntrySchema),
  credits: z.array(creditSchema),
  subscriptions: z.array(subscriptionSchema),
  merchantSummaries: z.array(merchantSummarySchema).default([]),
});

const normalizeMerchantApp = (app: MerchantApp): MerchantApp => ({
  ...app,
  routes: app.routes.map((route) =>
    route.pricing.mode === "metered"
      ? {
          ...route,
          pricing: {
            mode: "metered" as const,
            flatAmount: Number.isFinite(route.pricing.flatAmount) ? route.pricing.flatAmount : 0,
            currency: route.pricing.currency ?? "USD",
          },
        }
      : {
          ...route,
          pricing: {
            mode: "subscription" as const,
            feature: route.pricing.feature ?? "default",
            upgradeUrl: route.pricing.upgradeUrl,
          },
        }
  ),
  pages: (app.pages ?? []).map((page) => ({
    ...page,
    label: page.label ?? deriveLabelFromUrl(page.url),
  })),
});

export const fetchDashboardSnapshot = async (userId: string): Promise<DashboardSnapshot> => {
  if (!userId) {
    throw new Error("A user identifier is required to load the dashboard.");
  }
  const response = await fetch(managementUrl(`${CONTROL_BASE_PATH}/snapshot`), {
    method: "GET",
    headers: {
      "content-type": "application/json",
      "x-user-id": userId,
    },
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`Unable to load dashboard snapshot (${response.status})`);
  }
  const json = await response.json();
  return dashboardSnapshotSchema.parse(json);
};

const merchantAppsResponseSchema = z.object({
  apps: z.array(merchantAppSchema).optional(),
});

const merchantAppSaveResponseSchema = z.object({
  ok: z.boolean().default(true),
  config: merchantAppSchema.optional(),
});

const deriveLabelFromUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length === 0) {
      return parsed.hostname ?? url;
    }
    return segments[segments.length - 1].replace(/[-_]+/g, " ").replace(/\.[^/.]+$/, "");
  } catch (_error) {
    return url;
  }
};

export const fetchMerchantApps = async (): Promise<MerchantApp[]> => {
  const response = await fetch(managementUrl(MERCHANT_APPS_BASE_PATH), {
    method: "GET",
    headers: {
      "content-type": "application/json",
    },
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`Unable to load merchant apps (${response.status})`);
  }
  const json = await response.json();
  const parsed = merchantAppsResponseSchema.parse(json);
  return (parsed.apps ?? []).map(normalizeMerchantApp);
};

export const saveMerchantApp = async (appId: string, payload: Partial<MerchantApp>): Promise<MerchantApp> => {
  const response = await fetch(managementUrl(`${MERCHANT_APPS_BASE_PATH}/${encodeURIComponent(appId)}`), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Unable to save merchant app (${response.status})`);
  }
  const json = await response.json();
  const parsed = merchantAppSaveResponseSchema.parse(json);
  if (!parsed.config) {
    throw new Error("Merchant app save response missing config");
  }
  return normalizeMerchantApp(parsed.config);
};

export const refreshMerchantAppOpenapi = async (appId: string): Promise<MerchantApp | null> => {
  const response = await fetch(managementUrl(`${MERCHANT_APPS_BASE_PATH}/${encodeURIComponent(appId)}/openapi/refresh`), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    credentials: "include",
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`OpenAPI refresh failed (${response.status})`);
  }
  const json = await response.json();
  const parsed = merchantAppSaveResponseSchema.parse(json);
  return parsed.config ? normalizeMerchantApp(parsed.config) : null;
};

export const refreshMerchantAppSitemap = async (appId: string): Promise<MerchantApp | null> => {
  const response = await fetch(managementUrl(`${MERCHANT_APPS_BASE_PATH}/${encodeURIComponent(appId)}/sitemap/refresh`), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    credentials: "include",
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Sitemap refresh failed (${response.status})`);
  }
  const json = await response.json();
  const parsed = merchantAppSaveResponseSchema.parse(json);
  return parsed.config ? normalizeMerchantApp(parsed.config) : null;
};
