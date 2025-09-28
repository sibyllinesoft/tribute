import { useCallback, useEffect, useRef, useState } from "react";
import { Elements, CardElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useVirtualizer } from "@tanstack/react-virtual";
import { SessionAuth } from "supertokens-auth-react/recipe/session";
import {
  CONTROL_BASE_PATH,
  fetchDashboardSnapshot,
  managementUrl,
  type Credit,
  type DashboardSnapshot,
  type LogEntry,
  type Receipt,
  type Subscription,
  type WalletView,
  type MerchantSummary,
} from "./api";
import MerchantAppsPanel from "./pages/control/MerchantApps";
import AdminPanel from "./pages/admin/AdminPanel";
import { isAuthEnabled, useSessionSummary } from "./auth";

const STRIPE_PLACEHOLDER_KEY = "pk_test_51TributeExampleKey1234567890";
const rawStripePublishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY?.trim() ?? "";
const stripeEnabled = rawStripePublishableKey.length > 0 && rawStripePublishableKey !== STRIPE_PLACEHOLDER_KEY;
const stripePromise = stripeEnabled ? loadStripe(rawStripePublishableKey) : null;
const ADMIN_USER_ID = import.meta.env.VITE_TRIBUTE_ADMIN_USER_ID ?? "";

const USER_TABS = [
  { id: "overview", label: "Dashboard" },
  { id: "logs", label: "Logs" },
  { id: "credits", label: "Credits" },
  { id: "merchant-apps", label: "Merchant Apps" },
  { id: "subscriptions", label: "Subscriptions" },
] as const;

const ADMIN_TABS = [{ id: "admin", label: "Admin" }] as const;

type TabId = typeof USER_TABS[number]["id"] | typeof ADMIN_TABS[number]["id"];

const isAdminPath = (): boolean => typeof window !== "undefined" && window.location.pathname.startsWith("/admin");

const getInitialTab = (availableTabs: readonly { id: TabId }[]): TabId => {
  if (typeof window === "undefined") {
    return availableTabs[0]?.id ?? "overview";
  }
  try {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("tab");
    if (requested && availableTabs.some((tab) => tab.id === requested)) {
      return requested as TabId;
    }
  } catch (_error) {
    // ignore malformed search params
  }
  return availableTabs[0]?.id ?? "overview";
};

const DEFAULT_USER_ID = import.meta.env.VITE_TRIBUTE_DEFAULT_USER_ID ?? "";
const LIVE_UPDATES_PATH = `${CONTROL_BASE_PATH}/live`;
const MAX_RECEIPTS = 50;
const MAX_LOGS = 200;

const computeMerchantSummaries = (receipts: Receipt[], seed: MerchantSummary[] = []): MerchantSummary[] => {
  const map = new Map<string, MerchantSummary>();

  for (const entry of seed) {
    map.set(entry.merchantId, {
      merchantId: entry.merchantId,
      appId: entry.appId ?? null,
      displayName: entry.displayName,
      totalReceipts: 0,
      totalRevenue: 0,
      currency: entry.currency,
      lastReceiptAt: undefined,
      lastReceiptAmount: undefined,
    });
  }

  for (const receipt of receipts) {
    const merchantId = receipt.merchantId ?? "unknown";
    const current = map.get(merchantId) ?? {
      merchantId,
      appId: null,
      displayName: merchantId,
      totalReceipts: 0,
      totalRevenue: 0,
      currency: receipt.currency ?? "USD",
      lastReceiptAt: undefined,
      lastReceiptAmount: undefined,
    };

    current.totalReceipts += 1;
    current.totalRevenue += Number(receipt.finalPrice ?? 0);
    current.currency = receipt.currency ?? current.currency ?? "USD";

    const ts = Date.parse(receipt.timestamp ?? "");
    const existingTs = current.lastReceiptAt ? Date.parse(current.lastReceiptAt) : 0;
    if (!Number.isNaN(ts) && (ts > existingTs || !current.lastReceiptAt)) {
      current.lastReceiptAt = receipt.timestamp;
      current.lastReceiptAmount = Number(receipt.finalPrice ?? 0);
    }

    map.set(merchantId, current);
  }

  return Array.from(map.values()).sort((a, b) => b.totalRevenue - a.totalRevenue);
};

const buildLogEntry = (receipt: Receipt): LogEntry => {
  const [method, path] = receipt.rid.split(":", 2);
  return {
    id: receipt.receiptId,
    level: receipt.status === "paid" ? "info" : "warn",
    message: `Processed ${method ?? ""} ${path ?? receipt.rid} for ${receipt.finalPrice.toFixed(2)} ${receipt.currency}`,
    timestamp: receipt.timestamp,
    source: "edge-proxy",
    requestId: receipt.rid,
  };
};

const App = () => {
  const authEnabled = isAuthEnabled;
  const session = useSessionSummary();
  const adminMode = isAdminPath();
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [ownerSnapshot, setOwnerSnapshot] = useState<DashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ownerError, setOwnerError] = useState<string | null>(null);
  const tabs = adminMode ? ADMIN_TABS : USER_TABS;
  const [activeTab, setActiveTab] = useState<TabId>(() => getInitialTab(tabs));
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (adminMode || typeof window === "undefined") {
      return;
    }
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("tab") === "admin") {
        window.location.replace("/admin");
      }
    } catch (_error) {
      // ignore redirect failures on non-browser environments
    }
  }, [adminMode]);

  const fallbackUserId = DEFAULT_USER_ID || "demo-user";
  const effectiveUserId = session.loading ? null : session.userId ?? fallbackUserId;
  const adminUserId = ADMIN_USER_ID.trim() || null;

  useEffect(() => {
    let cancelled = false;
    setSnapshot(null);
    setError(null);
    if (!effectiveUserId && !(adminMode && adminUserId)) {
      setLoading(false);
      setError("Missing user context. Update VITE_TRIBUTE_DEFAULT_USER_ID or enable auth.");
      return () => {
        cancelled = true;
      };
    }

    const load = async () => {
      try {
        const targetUser = adminMode && adminUserId ? adminUserId : effectiveUserId;
        const data = await fetchDashboardSnapshot(targetUser);
        if (!cancelled) {
          const merchantSummaries = computeMerchantSummaries(data.receipts, data.merchantSummaries ?? []);
          setSnapshot({ ...data, merchantSummaries });
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unable to load dashboard data");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    setLoading(true);
    load();
    const interval = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [effectiveUserId, session.loading, adminMode, adminUserId]);

  useEffect(() => {
    if (!adminUserId) {
      setOwnerSnapshot(null);
      setOwnerError(null);
    }
  }, [adminUserId]);

  const refreshOwnerSnapshot = useCallback(async () => {
    if (!adminUserId) {
      setOwnerSnapshot(null);
      setOwnerError(null);
      return;
    }
    try {
      setOwnerError(null);
      const data = await fetchDashboardSnapshot(adminUserId);
      const merchantSummaries = computeMerchantSummaries(data.receipts, data.merchantSummaries ?? []);
      setOwnerSnapshot({ ...data, merchantSummaries });
    } catch (err) {
      setOwnerError(err instanceof Error ? err.message : "Unable to load owner snapshot");
    }
  }, [adminUserId]);

  useEffect(() => {
    if (!effectiveUserId) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      return () => undefined;
    }

    const target = managementUrl(LIVE_UPDATES_PATH);
    const url = target.startsWith("http") || target.startsWith("https") ? new URL(target) : new URL(target, window.location.origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const wsUserId = adminMode && adminUserId ? adminUserId : effectiveUserId;
    url.searchParams.set("userId", wsUserId ?? "");

    const socket = new WebSocket(url.toString());
    wsRef.current = socket;

    const handleMessage = (event: MessageEvent) => {
      if (typeof event.data !== "string") {
        return;
      }
      try {
        const payload = JSON.parse(event.data) as { type: string; data?: any };
        if (payload.type === "receipt" && payload.data?.receipt) {
          const receipt = payload.data.receipt as Receipt;
          const watcherId = adminMode && adminUserId ? adminUserId : effectiveUserId;
          if (receipt.userId !== watcherId) {
            return;
          }
          setSnapshot((prev) => {
            if (!prev) {
              return prev;
            }
            const nextReceipts = [receipt, ...prev.receipts.filter((existing) => existing.receiptId !== receipt.receiptId)].slice(0, MAX_RECEIPTS);
            const logEntry = buildLogEntry(receipt);
            const nextLogs = [logEntry, ...prev.logs.filter((entry) => entry.id !== logEntry.id)].slice(0, MAX_LOGS);
            const nextSummaries = computeMerchantSummaries(nextReceipts, prev.merchantSummaries ?? []);
            return { ...prev, receipts: nextReceipts, logs: nextLogs, merchantSummaries: nextSummaries };
          });
          if (adminUserId && adminMode) {
            void refreshOwnerSnapshot();
          }
        } else if (payload.type === "wallet" && payload.data) {
          setSnapshot((prev) => (prev ? { ...prev, wallet: { ...prev.wallet, ...payload.data } } : prev));
        }
      } catch (_error) {
        // Ignore malformed events.
      }
    };

    const handleClose = () => {
      if (wsRef.current === socket) {
        wsRef.current = null;
      }
    };

    socket.addEventListener("message", handleMessage);
    socket.addEventListener("close", handleClose);
    socket.addEventListener("error", handleClose);

    return () => {
      socket.removeEventListener("message", handleMessage);
      socket.removeEventListener("close", handleClose);
      socket.removeEventListener("error", handleClose);
      if (wsRef.current === socket) {
        wsRef.current = null;
      }
      socket.close();
    };
  }, [effectiveUserId, adminUserId, activeTab, refreshOwnerSnapshot, adminMode]);

  useEffect(() => {
    if (adminUserId && adminMode) {
      void refreshOwnerSnapshot();
    }
  }, [adminUserId, adminMode, refreshOwnerSnapshot]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", activeTab);
      window.history.replaceState({}, "", url.toString());
    } catch (_error) {
      // ignore history errors when running outside the browser
    }
  }, [activeTab]);

  useEffect(() => {
    if (!tabs.some((tab) => tab.id === activeTab)) {
      setActiveTab(tabs[0]?.id ?? "overview");
    }
  }, [tabs, activeTab]);

  const wallet = snapshot?.wallet ?? null;
  const ownerWallet = ownerSnapshot?.wallet ?? null;
  const adminSummaries = ownerSnapshot?.merchantSummaries ?? snapshot?.merchantSummaries ?? [];
  const displayUser = effectiveUserId ?? (session.loading ? "loading…" : fallbackUserId);
  const headerIdentity = adminMode
    ? adminUserId || displayUser
    : adminUserId && adminUserId !== displayUser
    ? `${displayUser} • Owner ${adminUserId}`
    : displayUser;

  const requireAuth = authEnabled && import.meta.env.PROD;

  const headerTitle = adminMode ? "Tribute Admin Console" : "Tribute Control Center";
  const headerSubtitle = adminMode
    ? "Configure merchant apps and monitor incoming microtransactions."
    : "Authorize apps, manage budgets, and track outgoing spend.";

  const content = (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-4 px-6 py-8 text-slate-100">
        <header className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold">{headerTitle}</h1>
              <p className="text-sm text-slate-400">{headerSubtitle}</p>
            </div>
            <div className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-slate-300">
              Signed in as <span className="font-medium text-slate-100">{headerIdentity}</span>
            </div>
          </div>
          {tabs.length > 1 && (
            <nav className="flex gap-2">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`rounded-md px-4 py-2 text-sm font-medium transition ${
                    activeTab === tab.id
                      ? "bg-indigo-500 text-white shadow"
                      : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                  }`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          )}
        </header>

        {loading && (
          <section className="flex flex-1 items-center justify-center text-slate-300">
            <span className="animate-pulse">Fetching the latest telemetry…</span>
          </section>
        )}

        {!loading && error && (
          <section className="rounded-lg border border-red-500/50 bg-red-500/10 p-4 text-sm text-red-200">
            {error}
          </section>
        )}

        {!loading && snapshot && (
          <section className="flex-1 rounded-xl border border-slate-700 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/40">
            {adminMode ? (
              <AdminPanel
                userId={effectiveUserId ?? fallbackUserId}
                userWallet={wallet}
                ownerId={adminUserId}
                ownerWallet={ownerWallet}
                ownerError={ownerError}
                summaries={adminSummaries}
                onRefreshOwner={refreshOwnerSnapshot}
              />
            ) : (
              <>
                {activeTab === "overview" && (
                  <DashboardOverview
                    wallet={snapshot.wallet}
                    receipts={snapshot.receipts}
                    logs={snapshot.logs.slice(0, 8)}
                    subscriptions={snapshot.subscriptions}
                  />
                )}
                {activeTab === "logs" && <LogsPanel logs={snapshot.logs} />}
                {activeTab === "credits" &&
                  (stripeEnabled && stripePromise ? (
                    <Elements stripe={stripePromise} options={{ appearance: { theme: "night" } }}>
                      <CreditsPanel credits={snapshot.credits} wallet={wallet} cardFormEnabled />
                    </Elements>
                  ) : (
                    <CreditsPanel credits={snapshot.credits} wallet={wallet} cardFormEnabled={false} />
                  ))}
                {activeTab === "merchant-apps" && <MerchantAppsPanel />}
                {activeTab === "subscriptions" && <SubscriptionsPanel subscriptions={snapshot.subscriptions} />}
              </>
            )}
          </section>
        )}
      </main>
  );

  if (!authEnabled) {
    return content;
  }

  return <SessionAuth requireAuth={requireAuth}>{content}</SessionAuth>;
};

interface DashboardOverviewProps {
  wallet: WalletView;
  receipts: Receipt[];
  logs: LogEntry[];
  subscriptions: Subscription[];
}

const DashboardOverview = ({ wallet, receipts, logs, subscriptions }: DashboardOverviewProps) => {
  const totalSpend = receipts.reduce((sum, receipt) => sum + Math.max(0, receipt.finalPrice), 0);
  const latestReceipt = receipts[0] ?? null;
  const activeSubscriptions = subscriptions.filter((sub) => sub.status === "active").length;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard title="Wallet Balance" value={`${wallet.balance.toFixed(2)} ${wallet.currency}`} subtitle={`Reserved ${wallet.reserved?.toFixed(2) ?? "0.00"} ${wallet.currency}`} />
        <StatCard title="Monthly Spend" value={`${totalSpend.toFixed(2)} ${wallet.currency}`} subtitle="Across the last 12 receipts" />
        <StatCard
          title="Active Subscriptions"
          value={String(activeSubscriptions)}
          subtitle={`${subscriptions.length} total entitlements`}
        />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="rounded-lg border border-slate-800 bg-slate-900/80 p-4">
          <header className="mb-3 flex items-center justify-between text-sm text-slate-400">
            <span>Recent Receipts</span>
            {latestReceipt && <span>Last at {new Date(latestReceipt.timestamp).toLocaleTimeString()}</span>}
          </header>
          <div className="max-h-64 overflow-auto pr-2 text-sm">
            <table className="w-full border-separate border-spacing-y-1">
              <thead className="text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-2 py-1">Receipt</th>
                  <th className="px-2 py-1">Route</th>
                  <th className="px-2 py-1 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((receipt) => (
                  <tr key={receipt.receiptId} className="rounded-md bg-slate-800/60 text-slate-200">
                    <td className="px-2 py-1 text-xs font-mono">{receipt.receiptId}</td>
                    <td className="px-2 py-1 text-xs text-slate-400">{receipt.rid ?? "n/a"}</td>
                    <td className="px-2 py-1 text-right text-sm font-semibold">
                      {receipt.finalPrice.toFixed(2)} {receipt.currency}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-lg border border-slate-800 bg-slate-900/80 p-4">
          <header className="mb-3 text-sm text-slate-400">Latest Log Entries</header>
          <ul className="flex flex-col gap-2 text-sm">
            {logs.map((log) => (
              <li key={log.id} className="rounded-md border border-slate-800 bg-slate-800/60 p-3">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span className={`badge badge-${log.level}`}>{log.level.toUpperCase()}</span>
                  <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                </div>
                <p className="mt-1 text-slate-200">{log.message}</p>
                <p className="mt-1 text-xs text-slate-500">{log.source ?? "edge"}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
};

interface LogsPanelProps {
  logs: LogEntry[];
}

const LogsPanel = ({ logs }: LogsPanelProps) => {
  const listRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: logs.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 72,
    overscan: 12,
  });

  return (
    <section className="flex h-[540px] flex-col gap-4">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Streaming Logs</h2>
          <p className="text-xs text-slate-500">Virtualized list updates in real time as events land.</p>
        </div>
        <div className="rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-xs text-slate-400">
          {logs.length} events in window
        </div>
      </header>
      <div ref={listRef} className="scrollbar-thin h-full overflow-y-auto rounded-lg border border-slate-800 bg-slate-900/60">
        <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
          {rowVirtualizer.getVirtualItems().map((virtualItem) => {
            const log = logs[virtualItem.index];
            return (
              <article
                key={log.id}
                className={`absolute inset-x-0 top-0 flex flex-col gap-1 rounded-md border border-slate-800/60 bg-slate-800/50 p-3 text-sm text-slate-200 ${
                  log.level === "error"
                    ? "border-red-500/40 bg-red-500/10"
                    : log.level === "warn"
                    ? "border-amber-500/40 bg-amber-500/10"
                    : ""
                }`}
                style={{
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              >
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span className={`badge badge-${log.level}`}>{log.level.toUpperCase()}</span>
                  <span>{new Date(log.timestamp).toLocaleString()}</span>
                </div>
                <p>{log.message}</p>
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>{log.source ?? "edge"}</span>
                  {log.requestId && <span className="font-mono">{log.requestId}</span>}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
};

interface CreditsPanelProps {
  credits: Credit[];
  wallet: WalletView | null;
  cardFormEnabled?: boolean;
}

const CreditsPanel = ({ credits, wallet, cardFormEnabled = true }: CreditsPanelProps) => {
  return (
    <div className="grid gap-6 md:grid-cols-[1fr,340px]">
      <section className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
        <header className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">Credit Ledger</h2>
            <p className="text-xs text-slate-500">Track top-ups and adjustments across your account.</p>
          </div>
          <div className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300">
            Balance: {wallet ? `${wallet.balance.toFixed(2)} ${wallet.currency}` : "n/a"}
          </div>
        </header>
        <table className="w-full border-separate border-spacing-y-1 text-sm">
          <thead className="text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-2 py-1">When</th>
              <th className="px-2 py-1">Type</th>
              <th className="px-2 py-1">Source</th>
              <th className="px-2 py-1 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {credits.map((credit) => (
              <tr key={credit.id} className="rounded-md bg-slate-800/60 text-slate-200">
                <td className="px-2 py-1 text-xs text-slate-400">{new Date(credit.createdAt).toLocaleString()}</td>
                <td className="px-2 py-1 text-xs text-slate-300">{credit.type.replace("_", " ")}</td>
                <td className="px-2 py-1 text-xs text-slate-300">{credit.source}</td>
                <td className="px-2 py-1 text-right text-sm font-semibold">
                  {credit.amount.toFixed(2)} {credit.currency}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
        <h3 className="mb-2 text-lg font-semibold text-slate-100">Top Up Credits</h3>
        <p className="mb-4 text-xs text-slate-500">
          {cardFormEnabled
            ? "Connect your Stripe account to purchase additional usage credits instantly. This form simulates the checkout flow in this demo environment."
            : "Set VITE_STRIPE_PUBLISHABLE_KEY to a valid Stripe test key to enable the card capture form. Until then the ledger remains available for review."}
        </p>
        {cardFormEnabled ? (
          <TopUpForm currency={wallet?.currency ?? "USD"} />
        ) : (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            Card capture is disabled because the placeholder publishable key is in use.
          </div>
        )}
      </section>
    </div>
  );
};

interface TopUpFormProps {
  currency: string;
}

const TopUpForm = ({ currency }: TopUpFormProps) => {
  const stripe = useStripe();
  const elements = useElements();
  const [amount, setAmount] = useState(25);
  const [status, setStatus] = useState<"idle" | "processing" | "success" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!stripe || !elements) {
      setStatus("error");
      setMessage("Stripe is still loading. Please wait a moment.");
      return;
    }
    setStatus("processing");
    setMessage(null);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    setStatus("success");
    setMessage(`Simulated top-up of ${currency} ${amount.toFixed(2)} complete.`);
  };

  return (
    <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
      <label className="flex flex-col gap-1 text-xs text-slate-400">
        Amount ({currency})
        <input
          type="number"
          min={5}
          step={5}
          value={amount}
          onChange={(event) => setAmount(Number(event.target.value))}
          className="rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-400">
        Card details
        <div className="rounded border border-slate-700 bg-slate-800 px-3 py-2">
          <CardElement options={{ hidePostalCode: true }} />
        </div>
      </label>
      <button
        type="submit"
        disabled={status === "processing"}
        className="rounded-md bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-indigo-500/60"
      >
        {status === "processing" ? "Processing…" : `Add ${currency} ${amount.toFixed(2)}`}
      </button>
      {message && (
        <div
          className={`rounded-md border px-3 py-2 text-xs ${
            status === "success"
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
              : "border-amber-500/40 bg-amber-500/10 text-amber-200"
          }`}
        >
          {message}
        </div>
      )}
    </form>
  );
};

interface SubscriptionsPanelProps {
  subscriptions: Subscription[];
}

const SubscriptionsPanel = ({ subscriptions }: SubscriptionsPanelProps) => {
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
      <header className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Current Subscriptions</h2>
          <p className="text-xs text-slate-500">Review entitlement state and upcoming renewals.</p>
        </div>
        <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300">
          {subscriptions.length} entitlements
        </span>
      </header>
      <table className="w-full border-separate border-spacing-y-1 text-sm">
        <thead className="text-left text-xs uppercase text-slate-500">
          <tr>
            <th className="px-2 py-1">Feature</th>
            <th className="px-2 py-1">Platform</th>
            <th className="px-2 py-1">Plan</th>
            <th className="px-2 py-1">Status</th>
            <th className="px-2 py-1">Renewal</th>
          </tr>
        </thead>
        <tbody>
          {subscriptions.map((subscription) => (
            <tr key={subscription.id} className="rounded-md bg-slate-800/60 text-slate-200">
              <td className="px-2 py-1 text-sm font-medium">{subscription.feature}</td>
              <td className="px-2 py-1 text-xs text-slate-400">{subscription.platform ?? "n/a"}</td>
              <td className="px-2 py-1 text-xs text-slate-400">{subscription.plan ?? "Usage"}</td>
              <td className="px-2 py-1 text-xs">
                <span className={`badge badge-${subscription.status}`}>{subscription.status}</span>
              </td>
              <td className="px-2 py-1 text-xs text-slate-400">
                {subscription.renewalAt ? new Date(subscription.renewalAt).toLocaleDateString() : "on-demand"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
};

const StatCard = ({ title, value, subtitle }: { title: string; value: string; subtitle?: string }) => (
  <article className="rounded-lg border border-slate-800 bg-slate-900/70 p-4 shadow">
    <h3 className="text-sm text-slate-400">{title}</h3>
    <p className="mt-2 text-xl font-semibold text-white">{value}</p>
    {subtitle && <p className="mt-1 text-xs text-slate-500">{subtitle}</p>}
  </article>
);

export default App;
