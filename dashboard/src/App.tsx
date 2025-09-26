import { useEffect, useRef, useState } from "react";
import { Elements, CardElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useVirtualizer } from "@tanstack/react-virtual";
import { SessionAuth } from "supertokens-auth-react/recipe/session";
import { fetchDashboardSnapshot, type Credit, type DashboardSnapshot, type LogEntry, type Receipt, type Subscription, type WalletView } from "./api";

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ?? "pk_test_51TributeExampleKey1234567890");

const tabs = [
  { id: "overview", label: "Dashboard" },
  { id: "logs", label: "Logs" },
  { id: "credits", label: "Credits" },
  { id: "subscriptions", label: "Subscriptions" },
] as const;

type TabId = (typeof tabs)[number]["id"];

const App = () => {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("overview");

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const data = await fetchDashboardSnapshot();
        if (mounted) {
          setSnapshot(data);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : "Unable to load dashboard data");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };
    load();
    const interval = setInterval(load, 60_000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const wallet = snapshot?.wallet ?? null;

  const requireAuth = import.meta.env.PROD;

  return (
    <SessionAuth requireAuth={requireAuth}>
      <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-4 px-6 py-8 text-slate-100">
        <header className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold">Tribute Control Center</h1>
              <p className="text-sm text-slate-400">Manage wallet balances, subscriptions, and real-time proxy telemetry.</p>
            </div>
            <div className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-slate-300">
              Signed in as <span className="font-medium text-slate-100">demo-user</span>
            </div>
          </div>
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
            {activeTab === "overview" && (
              <DashboardOverview wallet={snapshot.wallet} receipts={snapshot.receipts} logs={snapshot.logs.slice(0, 8)} subscriptions={snapshot.subscriptions} />
            )}
            {activeTab === "logs" && <LogsPanel logs={snapshot.logs} />}
            {activeTab === "credits" && (
              <Elements stripe={stripePromise} options={{ appearance: { theme: "night" } }}>
                <CreditsPanel credits={snapshot.credits} wallet={wallet} />
              </Elements>
            )}
            {activeTab === "subscriptions" && <SubscriptionsPanel subscriptions={snapshot.subscriptions} />}
          </section>
        )}
      </main>
    </SessionAuth>
  );
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
}

const CreditsPanel = ({ credits, wallet }: CreditsPanelProps) => {
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
          Connect your Stripe account to purchase additional usage credits instantly. This form simulates the
          checkout flow in this demo environment.
        </p>
        <TopUpForm currency={wallet?.currency ?? "USD"} />
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
