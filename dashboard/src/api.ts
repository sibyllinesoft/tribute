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

const subscriptionSchema = z.object({
  id: z.string(),
  feature: z.string(),
  status: z.enum(["active", "trialing", "expired", "paused"]).default("active"),
  platform: z.string().optional(),
  renewalAt: z.string().nullable().optional(),
  plan: z.string().optional(),
});

export type WalletView = z.infer<typeof walletSchema>;
export type Receipt = z.infer<typeof receiptSchema>;
export type LogEntry = z.infer<typeof logEntrySchema>;
export type Credit = z.infer<typeof creditSchema>;
export type Subscription = z.infer<typeof subscriptionSchema>;

export interface DashboardSnapshot {
  wallet: WalletView;
  receipts: Receipt[];
  logs: LogEntry[];
  credits: Credit[];
  subscriptions: Subscription[];
}

const fallbackSnapshot = (): DashboardSnapshot => {
  const now = Date.now();
  const receipts = Array.from({ length: 12 }).map((_, idx) => ({
    receiptId: `demo-receipt-${idx}`,
    finalPrice: Math.max(0.2, Math.random() * 2),
    currency: "USD",
    timestamp: new Date(now - idx * 60_000).toISOString(),
    rid: idx % 2 === 0 ? "GET:/api/demo" : "POST:/api/demo",
    policyVersion: 3,
    status: "paid",
  }));

  const logs = Array.from({ length: 500 }).map((_, idx) => {
    const levels: Array<LogEntry["level"]> = ["info", "warn", "error", "debug"];
    const level = levels[idx % levels.length];
    return {
      id: `log-${idx}`,
      level,
      message:
        level === "error"
          ? `Origin failed to respond within SLA for request ${idx}`
          : level === "warn"
          ? `Policy fallback engaged for feature chat:${idx}`
          : `Tribute processed request ${idx} in ${(Math.random() * 400 + 50).toFixed(0)}ms`,
      timestamp: new Date(now - idx * 9_000).toISOString(),
      source: idx % 3 === 0 ? "edge-proxy" : "d.o.redeem",
      requestId: `req-${Math.random().toString(36).slice(2, 9)}`,
    } satisfies LogEntry;
  });

  const credits = Array.from({ length: 6 }).map((_, idx) => ({
    id: `credit-${idx}`,
    amount: idx % 3 === 0 ? 200 : 50,
    currency: "USD",
    source: idx % 2 === 0 ? "Stripe" : "Manual Adjustment",
    createdAt: new Date(now - idx * 86_400_000).toISOString(),
    type: idx % 3 === 0 ? "top_up" : "adjustment",
  }));

  const subscriptions = [
    {
      id: "sub-chat-pro",
      feature: "Chat Completion API",
      status: "active" as const,
      platform: "OpenAI",
      renewalAt: new Date(now + 14 * 86_400_000).toISOString(),
      plan: "Usage + Subscription",
    },
    {
      id: "sub-vision",
      feature: "Vision API",
      status: "trialing" as const,
      platform: "Anthropic",
      renewalAt: new Date(now + 7 * 86_400_000).toISOString(),
      plan: "Trial",
    },
    {
      id: "sub-synthetics",
      feature: "Synthetics",
      status: "paused" as const,
      platform: "Tribute",
      renewalAt: null,
      plan: "Add-on",
    },
  ];

  return {
    wallet: {
      balance: 128.54,
      currency: "USD",
      refreshedAt: new Date(now - 30_000).toISOString(),
      reserved: 14.32,
    },
    receipts,
    logs,
    credits,
    subscriptions,
  };
};

const safeFetch = async <T,>(path: string, schema: z.ZodType<T>, fallback: () => T): Promise<T> => {
  try {
    const response = await fetch(path, {
      headers: {
        "content-type": "application/json",
        "x-user-id": "demo-user",
      },
    });
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`);
    }
    const json = await response.json();
    return schema.parse(json);
  } catch {
    return fallback();
  }
};

const isDev = import.meta.env.DEV;

export const fetchDashboardSnapshot = async (): Promise<DashboardSnapshot> => fallbackSnapshot();
