import { useEffect, useMemo, useState } from "react";

import {
  fetchMerchantApps,
  saveMerchantApp,
  refreshMerchantAppOpenapi,
  refreshMerchantAppSitemap,
  type MerchantApp,
  type MerchantRoute,
  type RoutePricing,
} from "../../api";
import PricingEditor from "../../components/PricingEditor";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

const MerchantAppsPanel = () => {
  const [apps, setApps] = useState<MerchantApp[]>([]);
  const [selectedAppId, setSelectedAppId] = useState<string>("");
  const [draft, setDraft] = useState<MerchantApp | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [syncingOpenapi, setSyncingOpenapi] = useState(false);
  const [syncingSitemap, setSyncingSitemap] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const fetched = await fetchMerchantApps();
        if (!cancelled) {
          setApps(fetched);
          const firstId = fetched[0]?.appId ?? "";
          setSelectedAppId((current) => current || firstId);
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

  useEffect(() => {
    if (!selectedAppId) {
      setDraft(null);
      setDirty(false);
      return;
    }
    const app = apps.find((candidate) => candidate.appId === selectedAppId);
    if (!app) {
      setDraft(null);
      setDirty(false);
      return;
    }
    setDraft(clone(app));
    setDirty(false);
    setStatus(null);
    setError(null);
  }, [apps, selectedAppId]);

  const updatedAtLabel = useMemo(() => {
    if (!draft?.updatedAt) {
      return "never";
    }
    try {
      const date = new Date(draft.updatedAt);
      return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
    } catch (_error) {
      return draft.updatedAt;
    }
  }, [draft?.updatedAt]);

  const updateAppField = <K extends keyof MerchantApp>(key: K, value: MerchantApp[K]) => {
    setDraft((prev) => {
      if (!prev) return prev;
      setDirty(true);
      setStatus(null);
      return { ...prev, [key]: value };
    });
  };

  const updateRoute = (routeId: string, updates: Partial<MerchantRoute>) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const routes = prev.routes.map((route) => (route.id === routeId ? { ...route, ...updates } : route));
      setDirty(true);
      setStatus(null);
      return { ...prev, routes };
    });
  };

  const updateRoutePricing = (routeId: string, pricing: RoutePricing) => updateRoute(routeId, { pricing });

  const addRoute = () => {
    setDraft((prev) => {
      if (!prev) return prev;
      const route: MerchantRoute = {
        id: randomId(),
        method: "GET",
        path: "/",
        description: "",
        pricing: { mode: "metered", flatAmount: 0.1, currency: "USD" },
      };
      setDirty(true);
      setStatus(null);
      return { ...prev, routes: [...prev.routes, route] };
    });
  };

  const removeRoute = (routeId: string) => {
    setDraft((prev) => {
      if (!prev) return prev;
      setDirty(true);
      setStatus(null);
      return { ...prev, routes: prev.routes.filter((route) => route.id !== routeId) };
    });
  };

  const save = async () => {
    if (!draft) {
      return;
    }
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const sanitizedRoutes = draft.routes.map((route) =>
        route.pricing.mode === "metered"
          ? {
              ...route,
              method: route.method.toUpperCase(),
              pricing: { mode: "metered" as const, flatAmount: Number(route.pricing.flatAmount ?? 0), currency: route.pricing.currency ?? "USD" },
            }
          : {
              ...route,
              method: route.method.toUpperCase(),
              pricing: {
                mode: "subscription" as const,
                feature: route.pricing.feature ?? "default",
                upgradeUrl: route.pricing.upgradeUrl,
              },
            }
      );
      const payload: MerchantApp = {
        ...draft,
        origin: draft.origin?.baseUrl ? draft.origin : null,
        routes: sanitizedRoutes,
      };
      const saved = await saveMerchantApp(draft.appId, payload);
      setApps((prev) => {
        const idx = prev.findIndex((app) => app.appId === saved.appId);
        if (idx === -1) {
          return [...prev, saved];
        }
        const next = [...prev];
        next[idx] = saved;
        return next;
      });
      setDraft(clone(saved));
      setDirty(false);
      setStatus(`Saved ${new Date().toLocaleTimeString()}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save configuration");
    } finally {
      setSaving(false);
    }
  };

  const refreshOpenapi = async () => {
    if (!draft) {
      return;
    }
    setSyncingOpenapi(true);
    setError(null);
    setStatus(null);
    try {
      const refreshed = await refreshMerchantAppOpenapi(draft.appId);
      if (refreshed) {
        setApps((prev) => {
          const index = prev.findIndex((app) => app.appId === refreshed.appId);
          if (index === -1) {
            return [...prev, refreshed];
          }
          const next = [...prev];
          next[index] = refreshed;
          return next;
        });
        setDraft(clone(refreshed));
        setDirty(false);
        setStatus(`OpenAPI synced ${new Date().toLocaleTimeString()}`);
      } else {
        setError("Unable to sync OpenAPI. Check that the origin exposes a JSON spec.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "OpenAPI sync failed");
    } finally {
      setSyncingOpenapi(false);
    }
  };

  const refreshSitemap = async () => {
    if (!draft) {
      return;
    }
    setSyncingSitemap(true);
    setError(null);
    setStatus(null);
    try {
      const refreshed = await refreshMerchantAppSitemap(draft.appId);
      if (refreshed) {
        setApps((prev) => {
          const index = prev.findIndex((app) => app.appId === refreshed.appId);
          if (index === -1) {
            return [...prev, refreshed];
          }
          const next = [...prev];
          next[index] = refreshed;
          return next;
        });
        setDraft(clone(refreshed));
        setDirty(false);
        setStatus(`Sitemap synced ${new Date().toLocaleTimeString()}`);
      } else {
        setError("Unable to sync sitemap. Verify the origin exposes a sitemap.xml file.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sitemap sync failed");
    } finally {
      setSyncingSitemap(false);
    }
  };

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-slate-400">Loading merchant apps…</div>;
  }

  if (!draft) {
    return <div className="text-sm text-slate-400">No merchant app selected.</div>;
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Select App</label>
          <select
            value={selectedAppId}
            onChange={(event) => setSelectedAppId(event.target.value)}
            className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
          >
            {apps.map((app) => (
              <option key={app.appId} value={app.appId}>
                {app.displayName}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs uppercase text-slate-500">Display Name</label>
            <input
              type="text"
              value={draft.displayName}
              onChange={(event) => updateAppField("displayName", event.target.value)}
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs uppercase text-slate-500">Origin Base URL</label>
            <input
              type="url"
              value={draft.origin?.baseUrl ?? ""}
              placeholder="https://app.example.com"
              onChange={(event) =>
                updateAppField("origin", {
                  ...draft.origin,
                  baseUrl: event.target.value,
                })
              }
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs uppercase text-slate-500">Merchant ID</label>
            <input
              type="text"
              value={draft.merchantId}
              onChange={(event) => updateAppField("merchantId", event.target.value)}
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs uppercase text-slate-500">OpenAPI Path</label>
            <input
              type="text"
              value={draft.origin?.openapiPath ?? ""}
              placeholder="/openapi.json"
              onChange={(event) =>
                updateAppField("origin", {
                  ...draft.origin,
                  openapiPath: event.target.value || undefined,
                })
              }
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs uppercase text-slate-500">Sitemap Path</label>
            <input
              type="text"
              value={draft.origin?.sitemapPath ?? ""}
              placeholder="/sitemap.xml"
              onChange={(event) =>
                updateAppField("origin", {
                  ...draft.origin,
                  sitemapPath: event.target.value || undefined,
                })
              }
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <div className="flex flex-col justify-end text-xs text-slate-500">
            <span className="text-slate-400">Last updated</span>
            <span className="font-mono text-slate-300">{updatedAtLabel}</span>
          </div>
          <div className="flex flex-col gap-1 md:col-span-2">
            <label className="text-xs uppercase text-slate-500">OpenAPI Source</label>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-slate-300">
                {draft.openapi?.sourceUrl ? draft.openapi.sourceUrl : "Not discovered yet"}
              </span>
              <button
                type="button"
                onClick={refreshOpenapi}
                disabled={syncingOpenapi || !draft.origin?.baseUrl}
                className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                  syncingOpenapi || !draft.origin?.baseUrl
                    ? "cursor-not-allowed border border-slate-800 bg-slate-900 text-slate-500"
                    : "border border-indigo-500 bg-transparent text-indigo-300 hover:bg-indigo-500/10"
                }`}
              >
                {syncingOpenapi ? "Syncing…" : "Rescan OpenAPI"}
              </button>
            </div>
            <div className="text-xs text-slate-500">
              {draft.openapi?.fetchedAt && (
                <span>
                  Last fetched {new Date(draft.openapi.fetchedAt).toLocaleString()} • {draft.openapi?.operations ?? 0} operations
                </span>
              )}
              {draft.openapi?.error && (
                <span className="ml-2 text-amber-300">Warning: {draft.openapi.error}</span>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-1 md:col-span-2">
            <label className="text-xs uppercase text-slate-500">Sitemap Source</label>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-slate-300">
                {draft.sitemap?.sourceUrl ? draft.sitemap.sourceUrl : "Not discovered yet"}
              </span>
              <button
                type="button"
                onClick={refreshSitemap}
                disabled={syncingSitemap || !draft.origin?.baseUrl}
                className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                  syncingSitemap || !draft.origin?.baseUrl
                    ? "cursor-not-allowed border border-slate-800 bg-slate-900 text-slate-500"
                    : "border border-indigo-500 bg-transparent text-indigo-300 hover:bg-indigo-500/10"
                }`}
              >
                {syncingSitemap ? "Syncing…" : "Rescan Sitemap"}
              </button>
            </div>
            <div className="text-xs text-slate-500">
              {draft.sitemap?.fetchedAt && (
                <span>
                  Last fetched {new Date(draft.sitemap.fetchedAt).toLocaleString()} • {draft.sitemap?.entries ?? 0} pages
                </span>
              )}
              {draft.sitemap?.error && <span className="ml-2 text-amber-300">Warning: {draft.sitemap.error}</span>}
            </div>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <header className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Route Pricing</h2>
            <p className="text-xs text-slate-500">Configure whether each origin route is metered or requires a subscription.</p>
          </div>
          <button
            type="button"
            className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-indigo-500 hover:text-white"
            onClick={addRoute}
          >
            Add Route
          </button>
        </header>

        <div className="flex flex-col gap-4">
          {draft.routes.length === 0 && (
            <div className="rounded-md border border-dashed border-slate-700 bg-slate-900/60 p-4 text-sm text-slate-400">
              No routes yet. Add one to define pricing or entitlements.
            </div>
          )}

          {draft.routes.map((route) => (
            <div key={route.id} className="rounded-lg border border-slate-800 bg-slate-900/80 p-4 shadow-inner shadow-slate-950/30">
              <div className="grid gap-3 md:grid-cols-[0.8fr_1.2fr_1fr_auto]">
                <div className="flex flex-col gap-1">
                  <label className="text-xs uppercase text-slate-500">Method</label>
                  <select
                    value={route.method.toUpperCase()}
                    onChange={(event) => updateRoute(route.id, { method: event.target.value.toUpperCase() })}
                    className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
                  >
                    {HTTP_METHODS.map((method) => (
                      <option key={method} value={method}>
                        {method}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs uppercase text-slate-500">Path</label>
                  <input
                    type="text"
                    value={route.path}
                    onChange={(event) => updateRoute(route.id, { path: event.target.value })}
                    placeholder="/chat"
                    className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs uppercase text-slate-500">Description</label>
                  <input
                    type="text"
                    value={route.description ?? ""}
                    onChange={(event) => updateRoute(route.id, { description: event.target.value })}
                    placeholder="What does this route do?"
                    className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div className="flex items-start justify-end">
                  <button
                    type="button"
                    onClick={() => removeRoute(route.id)}
                    className="rounded-md border border-transparent px-3 py-2 text-xs text-slate-400 transition hover:border-red-600 hover:bg-red-500/10 hover:text-red-200"
                  >
                    Remove
                  </button>
                </div>
              </div>
              <div className="mt-4">
                <PricingEditor pricing={route.pricing} onChange={(pricing) => updateRoutePricing(route.id, pricing)} />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <header className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Site Pages</h2>
            <p className="text-xs text-slate-500">Discovered from the origin's sitemap. Labels are derived from the URL slugs.</p>
          </div>
        </header>

        <div className="flex flex-col gap-2">
          {(draft.pages?.length ?? 0) === 0 && (
            <div className="rounded-md border border-dashed border-slate-700 bg-slate-900/60 p-4 text-sm text-slate-400">
              No pages discovered yet. Ensure the origin exposes a sitemap and run a rescan.
            </div>
          )}

          {draft.pages?.map((page) => (
            <div key={page.id} className="flex flex-col gap-1 rounded-lg border border-slate-800 bg-slate-900/80 p-4 text-sm text-slate-200">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-slate-100">{page.label ?? page.url}</span>
                {page.lastModified && <span className="text-xs text-slate-500">Last modified {new Date(page.lastModified).toLocaleDateString()}</span>}
              </div>
              <a
                href={page.url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-indigo-300 hover:text-indigo-200"
              >
                {page.url}
              </a>
            </div>
          ))}
        </div>
      </section>

      <section className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-900/80 px-4 py-3 text-sm">
        <div className="flex flex-col gap-1">
          {error && <span className="text-red-300">{error}</span>}
          {!error && status && <span className="text-slate-400">{status}</span>}
          {!error && !status && dirty && <span className="text-slate-500">Unsaved changes</span>}
        </div>
        <button
          type="button"
          disabled={!dirty || saving}
          className={`rounded-md px-4 py-2 text-sm font-medium transition ${
            !dirty || saving
              ? "cursor-not-allowed border border-slate-800 bg-slate-800 text-slate-500"
              : "border border-indigo-500 bg-indigo-500 text-white hover:bg-indigo-400"
          }`}
          onClick={save}
        >
          {saving ? "Saving…" : "Save Changes"}
        </button>
      </section>
    </div>
  );
};

const clone = <T,>(value: T): T => {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
};

const randomId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `route-${Math.random().toString(36).slice(2, 10)}`;
};

export default MerchantAppsPanel;
