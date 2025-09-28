import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";

import {
  fetchMerchantApps,
  saveMerchantApp,
  refreshMerchantAppOpenapi,
  refreshMerchantAppSitemap,
  type MerchantApp,
  type MerchantRoute,
  type MerchantSummary,
  type WalletView,
} from "../../api";
import MerchantAppsPanel from "../control/MerchantApps";

interface AdminPanelProps {
  userId: string;
  userWallet: WalletView | null;
  ownerId: string | null;
  ownerWallet: WalletView | null;
  ownerError?: string | null;
  summaries: MerchantSummary[];
  onRefreshOwner?: () => void;
}

interface ExecutionResult {
  routeId: string;
  status: number;
  ok: boolean;
  bodyPreview: string;
}

const PROXY_PORT = import.meta.env.VITE_TRIBUTE_PROXY_PORT ?? "8787";

const AdminPanel = ({ userId, userWallet, ownerId, ownerWallet, ownerError, summaries, onRefreshOwner }: AdminPanelProps) => {
  const [apps, setApps] = useState<MerchantApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [execution, setExecution] = useState<ExecutionResult | null>(null);
  const [runningRouteId, setRunningRouteId] = useState<string | null>(null);
  const [linkForm, setLinkForm] = useState({ appId: "", merchantId: "", displayName: "", baseUrl: "" });
  const [linking, setLinking] = useState(false);
  const [linkStatus, setLinkStatus] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const fetched = await fetchMerchantApps();
        if (!cancelled) {
          setApps(fetched);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unable to load merchant apps");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(() => {
    return summaries.map((summary) => {
      const matchingApp = apps.find((app) => app.merchantId === summary.merchantId || app.appId === summary.appId);
      const routes = matchingApp ? matchingApp.routes : [];
      const displayName = matchingApp?.displayName ?? summary.displayName ?? summary.merchantId;
      return {
        summary,
        app: matchingApp,
        routes,
        displayName,
      };
    });
  }, [summaries, apps]);

  const buildProxiedUrl = (appId: string, path: string): string => {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const protocol = window.location.protocol === "https:" ? "https:" : "http:";
    return `${protocol}//${appId}.localhost:${PROXY_PORT}${normalizedPath}`;
  };

  const runRoute = async (
    context: { summary: MerchantSummary; app: MerchantApp | undefined },
    route: MerchantRoute
  ): Promise<void> => {
    if (!userId) {
      setError("User identifier missing. Configure VITE_TRIBUTE_DEFAULT_USER_ID or sign in.");
      return;
    }
    setError(null);
    setExecution(null);
    setRunningRouteId(route.id);
    try {
      const hostId = context.app?.appId ?? context.summary.appId ?? context.summary.merchantId;
      const url = buildProxiedUrl(hostId, route.path);
      const headers = new Headers();
      headers.set("authorization", userId);
      headers.set("x-meter-max-price", "5");
      headers.set("cache-control", "no-store");

      const method = route.method?.toUpperCase() ?? "GET";
      let body: BodyInit | undefined;
      if (["POST", "PUT", "PATCH"].includes(method)) {
        headers.set("content-type", "application/json");
        body = JSON.stringify({ message: "Hello from Tribute admin" });
      }

      const response = await fetch(url, {
        method,
        headers,
        body,
        mode: "cors",
      });
      const text = await response.text();
      setExecution({
        routeId: route.id,
        status: response.status,
        ok: response.ok,
        bodyPreview: truncateBody(text),
      });
      if (!response.ok) {
        setError(`Request failed with status ${response.status}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setRunningRouteId(null);
    }
  };

  const handleLinkInput = (event: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target;
    setLinkForm((prev) => ({ ...prev, [name]: value }));
  };

  const linkApp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLinkStatus(null);
    setLinkError(null);

    const rawAppId = linkForm.appId.trim();
    const rawMerchantId = linkForm.merchantId.trim();
    const rawDisplayName = linkForm.displayName.trim();
    let baseUrl = linkForm.baseUrl.trim();

    if (!rawAppId) {
      setLinkError("App ID is required.");
      return;
    }
    if (!baseUrl) {
      setLinkError("Base URL is required.");
      return;
    }

    if (!/^https?:\/\//i.test(baseUrl)) {
      baseUrl = `http://${baseUrl}`;
    }

    try {
      // validate URL format
      const parsed = new URL(baseUrl);
      if (!parsed.hostname) {
        throw new Error("Invalid base URL");
      }
    } catch (err) {
      setLinkError("Provide a valid origin URL (e.g., https://api.example.com).");
      return;
    }

    setLinking(true);
    try {
      const merchantId = rawMerchantId || rawAppId;
      const displayName = rawDisplayName || rawAppId;

      const payload: Partial<MerchantApp> = {
        appId: rawAppId,
        merchantId,
        displayName,
        origin: {
          baseUrl,
          forwardAuthHeader: true,
        },
        routes: [],
        pages: [],
        updatedAt: new Date().toISOString(),
      } as Partial<MerchantApp>;

      let latest = await saveMerchantApp(rawAppId, payload);
      const refreshedOpenapi = await refreshMerchantAppOpenapi(rawAppId);
      if (refreshedOpenapi) {
        latest = refreshedOpenapi;
      }
      const refreshedSitemap = await refreshMerchantAppSitemap(rawAppId);
      if (refreshedSitemap) {
        latest = refreshedSitemap;
      }

      setApps((prev) => {
        const filtered = prev.filter((app) => app.appId !== latest.appId);
        return [...filtered, latest].sort((a, b) => a.displayName.localeCompare(b.displayName));
      });

      setLinkStatus("App linked and discovery completed.");
      setLinkForm({ appId: "", merchantId: "", displayName: "", baseUrl: "" });
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : "Unable to link app");
    } finally {
      setLinking(false);
    }
  };

  const ownerCardActions = ownerId
    ? (
        <button
          type="button"
          onClick={() => onRefreshOwner?.()}
          className="rounded-md border border-indigo-500 px-3 py-1 text-xs font-medium text-indigo-200 hover:bg-indigo-500/10"
        >
          Refresh Owner Snapshot
        </button>
      )
    : null;

  return (
    <div className="flex flex-col gap-6">
      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
          <h2 className="text-sm font-semibold text-slate-200">User Wallet ({userId || "unknown"})</h2>
          <dl className="mt-3 space-y-2 text-sm text-slate-300">
            <div className="flex items-center justify-between">
              <dt>Balance</dt>
              <dd className="font-mono">{userWallet ? `${userWallet.balance.toFixed(2)} ${userWallet.currency}` : "—"}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt>Reserved</dt>
              <dd className="font-mono">{userWallet ? `${(userWallet.reserved ?? 0).toFixed(2)} ${userWallet.currency}` : "—"}</dd>
            </div>
          </dl>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
          <h2 className="text-sm font-semibold text-slate-200">Automation Toolkit</h2>
          <p className="mt-2 text-sm text-slate-400">
            Use the controls below to invoke routes through the proxy. Each call should debit the user wallet and the
            merchant summary will refresh once the receipt is issued.
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Requests are sent to <code className="font-mono">{`http(s)://${'<app-id>'}.localhost:${PROXY_PORT}`}</code> with the
            user&apos;s authorization header.
          </p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-200">Merchant Wallet ({ownerId ?? "not configured"})</h2>
              {!ownerId && (
                <p className="mt-2 text-xs text-amber-300">
                  Set <code className="font-mono">VITE_TRIBUTE_ADMIN_USER_ID</code> to monitor the owner wallet in real time.
                </p>
              )}
            </div>
            {ownerCardActions}
          </div>
          <dl className="mt-3 space-y-2 text-sm text-slate-300">
            <div className="flex items-center justify-between">
              <dt>Balance</dt>
              <dd className="font-mono">{ownerWallet ? `${ownerWallet.balance.toFixed(2)} ${ownerWallet.currency}` : "—"}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt>Reserved</dt>
              <dd className="font-mono">{ownerWallet ? `${(ownerWallet.reserved ?? 0).toFixed(2)} ${ownerWallet.currency}` : "—"}</dd>
            </div>
          </dl>
          {ownerError && <p className="mt-2 text-xs text-red-300">{ownerError}</p>}
        </div>
      </section>

      {error && <div className="rounded-md border border-red-500/40 bg-red-950/50 p-3 text-sm text-red-200">{error}</div>}
      {execution && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-900/20 p-3 text-sm text-emerald-200">
          <div className="flex items-center justify-between">
            <span>
              Last invocation: {execution.status} {execution.ok ? "✓" : "✗"}
            </span>
            <span className="font-mono">route id: {execution.routeId}</span>
          </div>
          {execution.bodyPreview && (
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-xs text-emerald-100">
              {execution.bodyPreview}
            </pre>
          )}
        </div>
      )}

      <section className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
        <header className="mb-4">
          <h2 className="text-sm font-semibold text-slate-200">Link a Merchant App</h2>
          <p className="mt-1 text-xs text-slate-500">
            Provide the app identifiers and base URL. The proxy will automatically scan for OpenAPI and sitemap documents.
          </p>
        </header>
        <form className="grid gap-3 md:grid-cols-2" onSubmit={linkApp}>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            App ID
            <input
              required
              name="appId"
              value={linkForm.appId}
              onChange={handleLinkInput}
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
              placeholder="merchant-fastapi"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Merchant ID
            <input
              name="merchantId"
              value={linkForm.merchantId}
              onChange={handleLinkInput}
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
              placeholder="merchant-fastapi"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Display Name
            <input
              name="displayName"
              value={linkForm.displayName}
              onChange={handleLinkInput}
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
              placeholder="FastAPI Origin"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Base URL
            <input
              required
              name="baseUrl"
              value={linkForm.baseUrl}
              onChange={handleLinkInput}
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
              placeholder="http://fastapi-origin:9000"
            />
          </label>
          <div className="md:col-span-2 flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={linking}
              className={`rounded-md px-4 py-2 text-xs font-medium transition ${
                linking
                  ? "cursor-wait border border-slate-700 bg-slate-800 text-slate-500"
                  : "border border-indigo-500 text-indigo-200 hover:bg-indigo-500/10"
              }`}
            >
              {linking ? "Linking…" : "Link App and Scan"}
            </button>
            {linkStatus && <span className="text-xs text-emerald-300">{linkStatus}</span>}
            {linkError && <span className="text-xs text-red-300">{linkError}</span>}
          </div>
        </form>
      </section>

      <section className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
        <header className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-200">Merchant Summaries</h2>
          {loading && <span className="text-xs text-slate-500">Loading apps…</span>}
        </header>
        {rows.length === 0 ? (
          <div className="text-sm text-slate-400">No receipts yet. Invoke a route to see activity.</div>
        ) : (
          <div className="space-y-4">
            {rows.map(({ summary, app, routes, displayName }) => (
              <article key={summary.merchantId} className="rounded-md border border-slate-800 bg-slate-950/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-200">{displayName}</h3>
                    <p className="text-xs text-slate-500">
                      Merchant <span className="font-mono">{summary.merchantId}</span>
                      {app && app.appId !== summary.merchantId && (
                        <span className="ml-1 text-slate-500">(app id {app.appId})</span>
                      )}
                    </p>
                  </div>
                  <div className="text-right text-xs text-slate-400">
                    <div>{summary.totalReceipts} receipts</div>
                    <div>
                      {summary.totalRevenue.toFixed(2)} {summary.currency}
                    </div>
                    {summary.lastReceiptAt && (
                      <div>
                        Last {new Date(summary.lastReceiptAt).toLocaleTimeString()} • {summary.lastReceiptAmount?.toFixed(2)} {summary.currency}
                      </div>
                    )}
                  </div>
                </div>
                <div className="mt-4 space-y-2">
                  {routes.length === 0 ? (
                    <p className="text-xs text-slate-500">No routes discovered for this app.</p>
                  ) : (
                    routes.map((route) => (
                      <div
                        key={route.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded border border-slate-800 bg-slate-900/60 p-3"
                      >
                        <div>
                          <div className="text-xs font-semibold text-slate-200">
                            {route.method} {route.path}
                          </div>
                          {route.description && <div className="text-xs text-slate-500">{route.description}</div>}
                        </div>
                        <button
                          type="button"
                          onClick={() => runRoute({ summary, app }, route)}
                          disabled={runningRouteId === route.id}
                          className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                            runningRouteId === route.id
                              ? "cursor-wait border border-slate-700 bg-slate-800 text-slate-500"
                              : "border border-emerald-500 text-emerald-200 hover:bg-emerald-500/10"
                          }`}
                        >
                          {runningRouteId === route.id ? "Invoking…" : "Invoke via Proxy"}
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
        <header className="mb-4 flex flex-col gap-1">
          <h2 className="text-sm font-semibold text-slate-200">Manage Merchant App Configuration</h2>
          <p className="text-xs text-slate-500">
            Edit pricing, routes, and discovered pages for any linked origin. Changes apply immediately once saved.
          </p>
        </header>
        <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4">
          <MerchantAppsPanel />
        </div>
      </section>
    </div>
  );
};

const truncateBody = (body: string, limit = 320): string => {
  if (!body) {
    return "";
  }
  if (body.length <= limit) {
    return body;
  }
  return `${body.slice(0, limit)}…`;
};

export default AdminPanel;
