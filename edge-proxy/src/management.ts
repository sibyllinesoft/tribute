import type { MerchantAppConfig, Receipt } from "@tribute/durable-objects";
import { RECEIPT_ID_PREFIX } from "./cache";
import type { ProxyEnv } from "./env";
import type {
  DashboardSnapshot,
  ManagementEvent,
  ManagementLogEntry,
  WalletSnapshot,
  MerchantSummary,
} from "./management-types";

const JSON_HEADERS = { "content-type": "application/json" } as const;
const MANAGEMENT_PREFIX = "/_tribute";
const CONTROL_PREFIX = `${MANAGEMENT_PREFIX}/control`;
const LIVE_PATH = `${CONTROL_PREFIX}/live`;
const SNAPSHOT_PATH = `${CONTROL_PREFIX}/snapshot`;
const MERCHANT_APPS_PREFIX = `${MANAGEMENT_PREFIX}/merchant-apps`;
const APP_INDEX_KEY = "__tribute::merchant-app-index";

interface ManagementChannel {
  socket: WebSocket;
  userId?: string | null;
}

const channels = new Set<ManagementChannel>();

export const maybeHandleManagementRequest = async (
  request: Request,
  env: ProxyEnv,
  ctx?: ExecutionContext
): Promise<Response | null> => {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(MANAGEMENT_PREFIX)) {
    return null;
  }

  if (!isDirectManagementRequest(request, env)) {
    return new Response(JSON.stringify({ error: "not_found" }), {
      status: 404,
      headers: withCorsHeaders(request, env, JSON_HEADERS),
    });
  }

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: withCorsHeaders(request, env, {
        "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
        "access-control-allow-headers": "content-type,x-user-id",
      }),
    });
  }

  if (request.headers.get("upgrade")?.toLowerCase() === "websocket" && url.pathname === LIVE_PATH) {
    return acceptLiveUpdates(request, env);
  }

  if (url.pathname === SNAPSHOT_PATH && request.method === "GET") {
    const userId = resolveUserId(request);
    if (!userId) {
      return new Response(JSON.stringify({ error: "missing_user" }), {
        status: 400,
        headers: withCorsHeaders(request, env, JSON_HEADERS),
      });
    }
    try {
      const snapshot = await buildSnapshot(env, userId);
      return jsonWithCors(request, env, snapshot);
    } catch (error) {
      return new Response(JSON.stringify({ error: "snapshot_failed", detail: `${error}` }), {
        status: 500,
        headers: withCorsHeaders(request, env, JSON_HEADERS),
      });
    }
  }

  if (url.pathname === MERCHANT_APPS_PREFIX && request.method === "GET") {
    const apps = await listMerchantApps(env);
    return jsonWithCors(request, env, { apps });
  }

  if (url.pathname.startsWith(`${MERCHANT_APPS_PREFIX}/`)) {
    const [, , , ...rest] = url.pathname.split("/");
    const appId = rest[0] ?? "";
    if (!appId) {
      return new Response(JSON.stringify({ error: "missing_app_id" }), {
        status: 400,
        headers: withCorsHeaders(request, env, JSON_HEADERS),
      });
    }

    const stub = env.MERCHANT_APP_DO.get(env.MERCHANT_APP_DO.idFromName(appId));

    if (rest.length === 1 && request.method === "GET") {
      const res = await stub.fetch("https://merchant-app/config", { method: "GET" });
      return respondWithUpstream(request, env, res);
    }

    if (rest.length === 1 && request.method === "POST") {
      const body = await request.text();
      const res = await stub.fetch("https://merchant-app/config", {
        method: "POST",
        headers: { "content-type": request.headers.get("content-type") ?? "application/json" },
        body,
      });
      const response = await respondWithUpstream(request, env, res, async (parsed) => {
        if (parsed?.config?.appId) {
          await addMerchantAppToIndex(env, parsed.config.appId as string);
        }
      });
      return response;
    }

    if (rest.length === 2 && rest[1] === "routes" && request.method === "POST") {
      const body = await request.text();
      const res = await stub.fetch("https://merchant-app/routes", {
        method: "POST",
        headers: { "content-type": request.headers.get("content-type") ?? "application/json" },
        body,
      });
      return respondWithUpstream(request, env, res);
    }

    if (rest.length === 3 && rest[1] === "routes" && request.method === "PATCH") {
      const routeId = rest[2];
      const body = await request.text();
      const res = await stub.fetch(`https://merchant-app/routes/${routeId}`, {
        method: "PATCH",
        headers: { "content-type": request.headers.get("content-type") ?? "application/json" },
        body,
      });
      return respondWithUpstream(request, env, res);
    }

    if (rest.length === 3 && rest[1] === "routes" && request.method === "DELETE") {
      const routeId = rest[2];
      const res = await stub.fetch(`https://merchant-app/routes/${routeId}`, { method: "DELETE" });
      return respondWithUpstream(request, env, res);
    }

    if (rest.length >= 2 && rest[1] === "openapi" && request.method === "POST") {
      if (rest.length > 3) {
        return new Response(JSON.stringify({ error: "not_found" }), {
          status: 404,
          headers: withCorsHeaders(request, env, JSON_HEADERS),
        });
      }
      const res = await stub.fetch("https://merchant-app/openapi/sync", { method: "POST" });
      return respondWithUpstream(request, env, res, async (parsed) => {
        if (parsed?.config?.appId) {
          await addMerchantAppToIndex(env, parsed.config.appId as string);
        }
      });
    }

    if (rest.length >= 2 && rest[1] === "sitemap" && request.method === "POST") {
      if (rest.length > 3) {
        return new Response(JSON.stringify({ error: "not_found" }), {
          status: 404,
          headers: withCorsHeaders(request, env, JSON_HEADERS),
        });
      }
      const res = await stub.fetch("https://merchant-app/sitemap/sync", { method: "POST" });
      return respondWithUpstream(request, env, res, async (parsed) => {
        if (parsed?.config?.appId) {
          await addMerchantAppToIndex(env, parsed.config.appId as string);
        }
      });
    }
  }

  return new Response(JSON.stringify({ error: "not_found" }), {
    status: 404,
    headers: withCorsHeaders(request, env, JSON_HEADERS),
  });
};

export const notifyReceiptEvent = async (env: ProxyEnv, receipt: Receipt, appId: string): Promise<void> => {
  broadcastEvent({ type: "receipt", data: { receipt } }, receipt.userId);
  try {
    const wallet = await fetchWallet(env, receipt.userId);
    broadcastEvent({ type: "wallet", data: wallet }, receipt.userId);
  } catch (_error) {
    // ignore wallet snapshot failures
  }
  try {
    await trackMerchantApp(env, appId);
  } catch (_error) {
    // ignore index update failures
  }
};

const acceptLiveUpdates = (request: Request, env: ProxyEnv): Response => {
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);

  const url = new URL(request.url);
  const userId = url.searchParams.get("userId") ?? resolveUserId(request);

  server.accept();
  const channel: ManagementChannel = { socket: server, userId };
  channels.add(channel);

  const remove = () => channels.delete(channel);
  server.addEventListener("close", remove);
  server.addEventListener("error", remove);
  server.addEventListener("message", (evt) => {
    if (typeof evt.data === "string" && evt.data === "ping") {
      server.send("pong");
    }
  });

  return new Response(null, { status: 101, webSocket: client });
};

const broadcastEvent = (event: ManagementEvent, userId?: string | null) => {
  for (const channel of channels) {
    if (channel.userId && userId && channel.userId !== userId) {
      continue;
    }
    try {
      channel.socket.send(JSON.stringify(event));
    } catch (_error) {
      channels.delete(channel);
    }
  }
};

const buildSnapshot = async (env: ProxyEnv, userId: string): Promise<DashboardSnapshot> => {
  const wallet = await fetchWallet(env, userId);
  const receipts = await fetchRecentReceipts(env, userId, 50);
  const logs = buildLogsFromReceipts(receipts.slice(0, 100));
  const merchantSummaries = await buildMerchantSummaries(env, receipts);

  return {
    wallet,
    receipts,
    logs,
    credits: [],
    subscriptions: [],
    merchantSummaries,
  };
};

const buildMerchantSummaries = async (env: ProxyEnv, receipts: Receipt[]): Promise<MerchantSummary[]> => {
  if (receipts.length === 0) {
    return [];
  }

  const accumulator = new Map<string, MerchantSummary>();

  for (const receipt of receipts) {
    const merchantId = receipt.merchantId ?? "unknown";
    const existing = accumulator.get(merchantId) ?? {
      merchantId,
      appId: null,
      displayName: merchantId,
      totalReceipts: 0,
      totalRevenue: 0,
      currency: receipt.currency ?? "USD",
      lastReceiptAt: undefined,
      lastReceiptAmount: undefined,
    };

    existing.totalReceipts += 1;
    existing.totalRevenue += Number(receipt.finalPrice ?? 0);
    existing.currency = receipt.currency ?? existing.currency ?? "USD";

    const ts = Date.parse(receipt.timestamp ?? "");
    const currentLast = existing.lastReceiptAt ? Date.parse(existing.lastReceiptAt) : 0;
    if (!Number.isNaN(ts) && (ts > currentLast || !existing.lastReceiptAt)) {
      existing.lastReceiptAt = receipt.timestamp;
      existing.lastReceiptAmount = Number(receipt.finalPrice ?? 0);
    }

    accumulator.set(merchantId, existing);
  }

  const metadata = await resolveMerchantMetadata(env, Array.from(accumulator.keys()));
  for (const [merchantId, info] of metadata.entries()) {
    const summary = accumulator.get(merchantId);
    if (summary) {
      summary.displayName = info.displayName ?? summary.displayName;
      summary.appId = info.appId ?? summary.appId ?? null;
    }
  }

  return Array.from(accumulator.values()).sort((a, b) => (b.totalRevenue ?? 0) - (a.totalRevenue ?? 0));
};

const fetchWallet = async (env: ProxyEnv, userId: string): Promise<WalletSnapshot> => {
  const stub = env.USER_WALLET_DO.get(env.USER_WALLET_DO.idFromName(userId));
  const res = await stub.fetch("https://wallet/state", { method: "GET" });
  if (!res.ok) {
    return {
      balance: 0,
      currency: "USD",
      reserved: 0,
      refreshedAt: new Date().toISOString(),
    };
  }
  const json = (await res.json()) as { balance?: number; currency?: string; budgets?: { reserved?: number } };
  return {
    balance: Number(json.balance ?? 0),
    currency: String(json.currency ?? "USD"),
    reserved: Number(json.budgets?.reserved ?? 0) || 0,
    refreshedAt: new Date().toISOString(),
  };
};

const fetchRecentReceipts = async (env: ProxyEnv, userId: string, limit: number): Promise<Receipt[]> => {
  const list = await env.RECEIPTS_KV.list({ prefix: RECEIPT_ID_PREFIX, limit: 200 });
  const receipts: Receipt[] = [];

  const keys = [...list.keys].reverse();

  for (const key of keys) {
    const data = await env.RECEIPTS_KV.get(key.name, "json");
    if (!data) {
      continue;
    }
    const receipt = data as Receipt;
    if (receipt.userId !== userId) {
      continue;
    }
    receipts.push(receipt);
    if (receipts.length >= limit) {
      break;
    }
  }

  receipts.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return receipts.slice(0, limit);
};

const buildLogsFromReceipts = (receipts: Receipt[]): ManagementLogEntry[] =>
  receipts.map((receipt) => ({
    id: receipt.receiptId,
    level: receipt.status === "paid" ? "info" : "warn",
    message: buildLogMessage(receipt),
    timestamp: receipt.timestamp,
    source: "edge-proxy",
    requestId: receipt.rid,
  }));

const buildLogMessage = (receipt: Receipt): string => {
  const ridParts = receipt.rid.split(":", 2);
  const method = ridParts[0] ?? "";
  const route = ridParts[1] ?? receipt.rid;
  return `Processed ${method} ${route} for ${receipt.finalPrice.toFixed(2)} ${receipt.currency}`;
};

const resolveUserId = (request: Request): string | null => {
  const header = request.headers.get("x-user-id");
  if (header) return header;
  const url = new URL(request.url);
  const query = url.searchParams.get("userId");
  return query;
};

const isDirectManagementRequest = (request: Request, env: ProxyEnv): boolean => {
  const host = (request.headers.get("host") ?? "").toLowerCase();
  const allowedHosts = parseList(env.MANAGEMENT_ALLOWED_HOSTS);
  if (allowedHosts.length > 0 && !allowedHosts.includes(host)) {
    return false;
  }
  if (request.headers.get("x-tribute-target")) {
    return false;
  }
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) {
    const normalizedForwarded = forwardedHost.toLowerCase();
    if (normalizedForwarded !== host) {
      if (allowedHosts.length === 0 || !allowedHosts.includes(normalizedForwarded)) {
        return false;
      }
    }
  }
  return true;
};

const parseList = (value?: string): string[] =>
  (value ?? "")
    .split(/[,\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

const allowOrigin = (request: Request, env: ProxyEnv): string | "*" | null => {
  const requestOrigin = request.headers.get("origin");
  if (!requestOrigin) {
    return null;
  }
  const allowed = parseList(env.ALLOWED_ORIGINS);
  if (allowed.includes("*")) {
    return "*";
  }
  const normalized = requestOrigin.toLowerCase();
  if (allowed.length === 0 || allowed.includes(normalized)) {
    return requestOrigin;
  }
  return null;
};

const withCorsHeaders = (request: Request, env: ProxyEnv, extra: Record<string, string>): HeadersInit => {
  const headers = new Headers(extra);
  const origin = allowOrigin(request, env);
  if (origin) {
    headers.set("access-control-allow-origin", origin);
    if (origin !== "*") {
      headers.set("vary", "Origin");
      headers.set("access-control-allow-credentials", "true");
    }
  }
  headers.set("cache-control", "no-store");
  return headers;
};

const jsonWithCors = (request: Request, env: ProxyEnv, body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: withCorsHeaders(request, env, JSON_HEADERS),
  });

const respondWithUpstream = async (
  request: Request,
  env: ProxyEnv,
  upstream: Response,
  onSuccess?: (parsed: any) => Promise<void>
): Promise<Response> => {
  const payload = await upstream.text();
  if (onSuccess && upstream.ok) {
    try {
      const parsed = JSON.parse(payload || "{}");
      await onSuccess(parsed);
    } catch (_error) {
      // ignore parse failure
    }
  }
  return new Response(payload, {
    status: upstream.status,
    headers: withCorsHeaders(request, env, JSON_HEADERS),
  });
};

const addMerchantAppToIndex = async (env: ProxyEnv, appId: string): Promise<void> => {
  const current = await readMerchantAppIndex(env);
  if (!current.includes(appId)) {
    current.push(appId);
    await env.RECEIPTS_KV.put(APP_INDEX_KEY, JSON.stringify(current), { expirationTtl: 60 * 60 * 24 * 365 });
  }
};

const trackMerchantApp = async (env: ProxyEnv, appId: string): Promise<void> => {
  try {
    await addMerchantAppToIndex(env, appId);
  } catch (_error) {
    // ignore failures
  }
};

const readMerchantAppIndex = async (env: ProxyEnv): Promise<string[]> => {
  const stored = await env.RECEIPTS_KV.get(APP_INDEX_KEY, "json");
  if (!stored) {
    return [];
  }
  if (Array.isArray(stored)) {
    return stored.filter((value): value is string => typeof value === "string");
  }
  try {
    const parsed = JSON.parse(String(stored));
    if (Array.isArray(parsed)) {
      return parsed.filter((value): value is string => typeof value === "string");
    }
  } catch (_error) {}
  return [];
};

const listMerchantApps = async (env: ProxyEnv): Promise<MerchantAppConfig[]> => {
  const appIds = await readMerchantAppIndex(env);
  const results: MerchantAppConfig[] = [];
  for (const appId of appIds) {
    try {
      const config = await getMerchantAppConfig(env, appId);
      if (config) {
        results.push(config);
      }
    } catch (_error) {
      // ignore missing apps
    }
  }
  return results;
};

const getMerchantAppConfig = async (env: ProxyEnv, appId: string): Promise<MerchantAppConfig | null> => {
  const stub = env.MERCHANT_APP_DO.get(env.MERCHANT_APP_DO.idFromName(appId));
  const res = await stub.fetch("https://merchant-app/config", { method: "GET" });
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`merchant_app_fetch_failed:${res.status}`);
  }
  return (await res.json()) as MerchantAppConfig;
};

const resolveMerchantMetadata = async (
  env: ProxyEnv,
  merchantIds: string[]
): Promise<Map<string, { displayName: string; appId: string | null }>> => {
  const targets = new Set(merchantIds.filter(Boolean));
  const results = new Map<string, { displayName: string; appId: string | null }>();
  if (targets.size === 0) {
    return results;
  }

  const appIds = await readMerchantAppIndex(env);
  for (const appId of appIds) {
    if (results.size === targets.size) {
      break;
    }
    try {
      const config = await getMerchantAppConfig(env, appId);
      if (!config) {
        continue;
      }
      if (!targets.has(config.merchantId)) {
        continue;
      }
      results.set(config.merchantId, {
        displayName: config.displayName ?? config.merchantId,
        appId: config.appId ?? appId,
      });
    } catch (_error) {
      // ignore lookup failures
    }
  }
  return results;
};
