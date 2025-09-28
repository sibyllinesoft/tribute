import { z } from "zod";

import { DurableObjectBase } from "./do-base";

const JSON_HEADERS = { "content-type": "application/json" } as const;
const CONFIG_KEY = "config";
const DEFAULT_NEW_ROUTE_PRICING = { mode: "metered" as const, flatAmount: 0, currency: "USD" };
const DEFAULT_OPENAPI_PATHS = ["/openapi.json", "/docs/json", "/swagger.json"];
const DEFAULT_SITEMAP_PATHS = ["/sitemap.xml", "/sitemap_index.xml", "/sitemap.json"];
const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const SITEMAP_ENTRY_LIMIT = 200;

const randomId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 32);
  }
  return `route-${Math.random().toString(36).slice(2, 10)}`;
};

const routePricingSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("metered"),
    flatAmount: z.number().nonnegative().default(0),
    currency: z.string().default("USD"),
  }),
  z.object({
    mode: z.literal("subscription"),
    feature: z.string().default("default"),
    upgradeUrl: z.string().url().optional(),
  }),
]);

const originConfigSchema = z.object({
  baseUrl: z.string().url(),
  forwardAuthHeader: z.boolean().default(true),
  openapiPath: z.string().min(1).optional(),
  sitemapPath: z.string().min(1).optional(),
});

const pageConfigSchema = z.object({
  id: z.string().uuid().optional(),
  url: z.string().url(),
  label: z.string().optional(),
  lastModified: z.string().optional(),
});

const routeConfigSchema = z.object({
  id: z.string().uuid().optional(),
  method: z.string().default("GET"),
  path: z.string(),
  description: z.string().optional(),
  pricing: routePricingSchema,
});

const routePatchSchema = z.object({
  id: z.string().uuid(),
  method: z.string().optional(),
  path: z.string().optional(),
  description: z.string().optional(),
  pricing: routePricingSchema.optional(),
});

const createConfigSchema = z.object({
  appId: z.string().min(1),
  merchantId: z.string().min(1),
  displayName: z.string().min(1),
  origin: originConfigSchema.optional(),
  routes: z.array(routeConfigSchema).default([]),
  pages: z.array(pageConfigSchema).default([]),
});

const patchConfigSchema = createConfigSchema.partial({
  appId: true,
  merchantId: true,
});

export type MerchantRoutePricing = z.infer<typeof routePricingSchema>;
export type MerchantRouteDraft = z.infer<typeof routeConfigSchema>;
export type MerchantRouteConfig = Omit<MerchantRouteDraft, "id"> & { id: string };
export type MerchantPageDraft = z.infer<typeof pageConfigSchema>;
export type MerchantPageConfig = Omit<MerchantPageDraft, "id"> & { id: string };

export interface MerchantOpenapiState {
  sourceUrl: string;
  fetchedAt: string;
  operations: number;
  error?: string;
}

export interface MerchantSitemapState {
  sourceUrl: string;
  fetchedAt: string;
  entries: number;
  error?: string;
}

export type MerchantAppConfig = Omit<z.infer<typeof createConfigSchema>, "routes"> & {
  routes: MerchantRouteConfig[];
  updatedAt: string;
  openapi?: MerchantOpenapiState;
  pages: MerchantPageConfig[];
  sitemap?: MerchantSitemapState;
};

const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

const normalizeRoute = (
  draft: MerchantRouteDraft | (Partial<MerchantRouteConfig> & { id?: string }),
  fallback?: MerchantRouteConfig
): MerchantRouteConfig => {
  const id = draft.id ?? fallback?.id ?? randomId();
  const method = (draft.method ?? fallback?.method ?? "GET").toUpperCase();
  const path = draft.path ?? fallback?.path;
  if (!path) {
    throw new Error("route_path_required");
  }
  const description = draft.description ?? fallback?.description;
  const pricingSource = draft.pricing ?? fallback?.pricing;
  if (!pricingSource) {
    throw new Error("route_pricing_required");
  }

  if (pricingSource.mode === "metered") {
    const flatAmount =
      typeof pricingSource.flatAmount === "number" && Number.isFinite(pricingSource.flatAmount)
        ? Math.max(pricingSource.flatAmount, 0)
        : fallback?.pricing.mode === "metered"
        ? fallback.pricing.flatAmount
        : 0;
    const currency = pricingSource.currency ?? (fallback?.pricing.mode === "metered" ? fallback.pricing.currency : "USD");
    return {
      id,
      method,
      path,
      description,
      pricing: {
        mode: "metered",
        flatAmount,
        currency,
      },
    };
  }

  const feature = pricingSource.feature ?? (fallback?.pricing.mode === "subscription" ? fallback.pricing.feature : "default");
  const upgradeUrl = pricingSource.upgradeUrl ?? (fallback?.pricing.mode === "subscription" ? fallback.pricing.upgradeUrl : undefined);
  return {
    id,
    method,
    path,
    description,
    pricing: {
      mode: "subscription",
      feature,
      upgradeUrl,
    },
  };
};

const derivePageLabel = (url: string): string => {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length === 0) {
      return parsed.hostname;
    }
    return segments[segments.length - 1].replace(/[-_]+/g, " ").replace(/\.[^/.]+$/, "");
  } catch (_error) {
    return url;
  }
};

const normalizePage = (
  draft: MerchantPageDraft | (Partial<MerchantPageConfig> & { id?: string }),
  fallback?: MerchantPageConfig
): MerchantPageConfig => {
  const url = (draft.url ?? fallback?.url ?? "").trim();
  if (!url) {
    throw new Error("page_url_required");
  }
  const id = draft.id ?? fallback?.id ?? randomId();
  const label = draft.label ?? fallback?.label ?? derivePageLabel(url);
  const lastModified = draft.lastModified ?? fallback?.lastModified;
  return {
    id,
    url,
    label,
    lastModified,
  };
};

interface OpenapiOperation {
  method: string;
  path: string;
  summary?: string;
  description?: string;
  pricing?: MerchantRoutePricing;
}

const buildRouteKey = (method: string, path: string) => `${method.toUpperCase()} ${path}`;

const extractOperationsFromOpenapi = (spec: unknown): OpenapiOperation[] => {
  if (!spec || typeof spec !== "object" || !("paths" in spec)) {
    return [];
  }
  const paths = (spec as any).paths;
  if (!paths || typeof paths !== "object") {
    return [];
  }
  const operations: OpenapiOperation[] = [];
  for (const [path, pathItem] of Object.entries(paths as Record<string, any>)) {
    if (!pathItem || typeof pathItem !== "object") {
      continue;
    }
    for (const [methodRaw, operation] of Object.entries(pathItem as Record<string, any>)) {
      const method = methodRaw.toUpperCase();
      if (!ALLOWED_METHODS.has(method)) {
        continue;
      }
      if (!operation || typeof operation !== "object") {
        continue;
      }
      if (operation.deprecated) {
        continue;
      }

      const summary = typeof operation.summary === "string" ? operation.summary : undefined;
      const description = typeof operation.description === "string" ? operation.description : undefined;
      let pricing: MerchantRoutePricing | undefined;
      const pricingExt = operation["x-tribute-pricing"];
      if (pricingExt && typeof pricingExt === "object") {
        if (pricingExt.mode === "subscription" && typeof pricingExt.feature === "string") {
          pricing = {
            mode: "subscription",
            feature: pricingExt.feature,
            upgradeUrl: typeof pricingExt.upgradeUrl === "string" ? pricingExt.upgradeUrl : undefined,
          };
        } else if (pricingExt.mode === "metered") {
          const flatAmount = typeof pricingExt.flatAmount === "number" ? Math.max(pricingExt.flatAmount, 0) : 0;
          pricing = {
            mode: "metered",
            flatAmount,
            currency: typeof pricingExt.currency === "string" ? pricingExt.currency : "USD",
          };
        }
      }

      operations.push({
        method,
        path,
        summary,
        description,
        pricing,
      });
    }
  }
  return operations;
};

const mergeOperationsIntoRoutes = (
  existingRoutes: MerchantRouteConfig[],
  operations: OpenapiOperation[]
): { routes: MerchantRouteConfig[]; additions: number; updated: number } => {
  if (operations.length === 0) {
    return { routes: existingRoutes, additions: 0, updated: 0 };
  }

  const operationsByKey = new Map<string, OpenapiOperation>();
  for (const operation of operations) {
    operationsByKey.set(buildRouteKey(operation.method, operation.path), operation);
  }

  const updatedRoutes: MerchantRouteConfig[] = [];
  const existingMap = new Map<string, MerchantRouteConfig>();
  let updatedDescriptions = 0;

  for (const route of existingRoutes) {
    const key = buildRouteKey(route.method, route.path);
    const operation = operationsByKey.get(key);
    if (operation && (!route.description || route.description.trim() === "")) {
      const enriched: MerchantRouteConfig = {
        ...route,
        description: operation.summary ?? operation.description ?? route.description,
      };
      updatedRoutes.push(enriched);
      existingMap.set(key, enriched);
      updatedDescriptions += 1;
    } else {
      updatedRoutes.push(route);
      existingMap.set(key, route);
    }
  }

  let additions = 0;
  for (const operation of operations) {
    const key = buildRouteKey(operation.method, operation.path);
    if (existingMap.has(key)) {
      continue;
    }
    const pricing = operation.pricing ?? DEFAULT_NEW_ROUTE_PRICING;
    const route = normalizeRoute({
      method: operation.method,
      path: operation.path,
      description: operation.summary ?? operation.description,
      pricing,
    });
    updatedRoutes.push(route);
    existingMap.set(key, route);
    additions += 1;
  }

  if (additions === 0 && updatedDescriptions === 0) {
    return { routes: existingRoutes, additions: 0, updated: 0 };
  }

  return { routes: updatedRoutes, additions, updated: updatedDescriptions };
};

interface SitemapEntry {
  url: string;
  lastModified?: string;
}

const extractSitemapEntries = (xml: string): SitemapEntry[] => {
  const lastModRegex = /<lastmod>([^<]+)<\/lastmod>/i;
  const entries: SitemapEntry[] = [];

  const urlRegex = /<url>([\s\S]*?)<\/url>/gi;
  let urlMatch: RegExpExecArray | null;
  while ((urlMatch = urlRegex.exec(xml)) !== null) {
    const urlBlock = urlMatch[1];
    const locMatch = /<loc>([^<]+)<\/loc>/i.exec(urlBlock);
    if (!locMatch) {
      continue;
    }
    const loc = locMatch[1].trim();
    if (!loc) {
      continue;
    }
    const lastModMatch = lastModRegex.exec(urlBlock);
    entries.push({ url: loc, lastModified: lastModMatch ? lastModMatch[1].trim() : undefined });
  }

  if (entries.length === 0) {
    // fallback to sitemap index
    const fallbackRegex = /<loc>([^<]+)<\/loc>/gi;
    let match: RegExpExecArray | null;
    while ((match = fallbackRegex.exec(xml)) !== null) {
      const loc = match[1].trim();
      if (loc) {
        entries.push({ url: loc });
        if (entries.length >= SITEMAP_ENTRY_LIMIT) {
          break;
        }
      }
    }
  }

  const unique = new Map<string, SitemapEntry>();
  for (const entry of entries) {
    if (!unique.has(entry.url)) {
      unique.set(entry.url, entry);
    }
  }
  return Array.from(unique.values()).slice(0, SITEMAP_ENTRY_LIMIT);
};

const mergeSitemapEntries = (
  existingPages: MerchantPageConfig[],
  entries: SitemapEntry[]
): { pages: MerchantPageConfig[]; additions: number; updated: number } => {
  if (entries.length === 0) {
    return { pages: existingPages, additions: 0, updated: 0 };
  }

  const pageMap = new Map<string, MerchantPageConfig>();
  for (const page of existingPages) {
    pageMap.set(page.url, page);
  }

  let additions = 0;
  let updates = 0;

  for (const entry of entries) {
    const current = pageMap.get(entry.url);
    if (current) {
      if (entry.lastModified && entry.lastModified !== current.lastModified) {
        pageMap.set(entry.url, { ...current, lastModified: entry.lastModified });
        updates += 1;
      }
      continue;
    }
    const normalized = normalizePage({ url: entry.url, lastModified: entry.lastModified });
    pageMap.set(entry.url, normalized);
    additions += 1;
  }

  const pages = Array.from(pageMap.values()).sort((a, b) => a.url.localeCompare(b.url));
  return { pages, additions, updated: updates };
};

export class MerchantAppDurableObject extends DurableObjectBase {
  private readonly storage: DurableObjectStorage;

  constructor(state: DurableObjectState, env: unknown) {
    super(state, env);
    this.storage = state.storage;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    try {
      if (method === "GET" && url.pathname === "/config") {
        const config = await this.storage.get<MerchantAppConfig>(CONFIG_KEY);
        if (!config) {
          return ok({ error: "config_missing" }, 404);
        }
        return ok(config);
      }

      if (method === "POST" && url.pathname === "/config") {
        const existing = await this.storage.get<MerchantAppConfig>(CONFIG_KEY);
        const isoNow = new Date().toISOString();
        const body = await request.json();

        if (!existing) {
          const payload = createConfigSchema.parse(body);
          const routes = payload.routes.map((route) => normalizeRoute(route));
          const pages = payload.pages.map((page) => normalizePage(page));
          let config: MerchantAppConfig = {
            appId: payload.appId,
            merchantId: payload.merchantId,
            displayName: payload.displayName,
            origin: payload.origin,
            routes,
            pages,
            updatedAt: isoNow,
          };
          config = await this.syncRoutesFromOpenapi(config);
          config = await this.syncPagesFromSitemap(config);
          config.updatedAt = isoNow;
          await this.storage.put(CONFIG_KEY, config);
          return ok({ ok: true, config }, 201);
        }

        const payload = patchConfigSchema.parse(body);
        const routes = payload.routes
          ? payload.routes.map((route) => normalizeRoute(route, existing.routes.find((r) => r.id === route.id)))
          : existing.routes;
        const pages = payload.pages
          ? payload.pages.map((page) => normalizePage(page, existing.pages.find((p) => p.id === page.id)))
          : existing.pages;
        let merged: MerchantAppConfig = {
          ...existing,
          ...payload,
          origin: payload.origin ?? existing.origin,
          routes,
          pages,
          updatedAt: isoNow,
        };
        merged = await this.syncRoutesFromOpenapi(merged);
        merged = await this.syncPagesFromSitemap(merged);
        merged.updatedAt = isoNow;
        await this.storage.put(CONFIG_KEY, merged);
        return ok({ ok: true, config: merged });
      }

      if (method === "DELETE" && url.pathname === "/config") {
        await this.storage.delete(CONFIG_KEY);
        return ok({ ok: true });
      }

      if (method === "POST" && url.pathname === "/routes") {
        const existing = await this.requireConfig();
        const routePayload = routeConfigSchema.parse(await request.json());
        const route = normalizeRoute(routePayload);
        const updated = { ...existing, routes: [...existing.routes, route], updatedAt: new Date().toISOString() };
        await this.storage.put(CONFIG_KEY, updated);
        return ok({ ok: true, route }, 201);
      }

      if (method === "POST" && url.pathname === "/openapi/sync") {
        const existing = await this.requireConfig();
        const synced = await this.syncRoutesFromOpenapi({ ...existing, updatedAt: new Date().toISOString() });
        await this.storage.put(CONFIG_KEY, synced);
        return ok({ ok: true, config: synced });
      }

      if (method === "POST" && url.pathname === "/sitemap/sync") {
        const existing = await this.requireConfig();
        const synced = await this.syncPagesFromSitemap({ ...existing, updatedAt: new Date().toISOString() });
        await this.storage.put(CONFIG_KEY, synced);
        return ok({ ok: true, config: synced });
      }

      if ((method === "PUT" || method === "PATCH") && url.pathname.startsWith("/routes/")) {
        const routeId = url.pathname.split("/").pop();
        if (!routeId) {
          return ok({ error: "route_id_missing" }, 400);
        }
        const existing = await this.requireConfig();
        const index = existing.routes.findIndex((route) => route.id === routeId);
        if (index === -1) {
          return ok({ error: "route_not_found" }, 404);
        }
        const patch = routePatchSchema.parse({ ...(await request.json()), id: routeId });
        const updatedRoute = normalizeRoute({ ...existing.routes[index], ...patch }, existing.routes[index]);
        const routes = [...existing.routes];
        routes[index] = updatedRoute;
        const updated = { ...existing, routes, updatedAt: new Date().toISOString() };
        await this.storage.put(CONFIG_KEY, updated);
        return ok({ ok: true, route: updatedRoute });
      }

      if (method === "DELETE" && url.pathname.startsWith("/routes/")) {
        const routeId = url.pathname.split("/").pop();
        if (!routeId) {
          return ok({ error: "route_id_missing" }, 400);
        }
        const existing = await this.requireConfig();
        const filtered = existing.routes.filter((route) => route.id !== routeId);
        const updated = { ...existing, routes: filtered, updatedAt: new Date().toISOString() };
        await this.storage.put(CONFIG_KEY, updated);
        return ok({ ok: true });
      }

      return ok({ error: "not_found" }, 404);
    } catch (error) {
      return ok({ error: "invalid_request", detail: `${error}` }, 400);
    }
  }

  private async requireConfig(): Promise<MerchantAppConfig> {
    const config = await this.storage.get<MerchantAppConfig>(CONFIG_KEY);
    if (!config) {
      throw new Error("config_missing");
    }
    return {
      ...config,
      routes: Array.isArray(config.routes) ? config.routes : [],
      pages: Array.isArray((config as any).pages) ? (config as any).pages : [],
    };
  }

  private async syncRoutesFromOpenapi(config: MerchantAppConfig): Promise<MerchantAppConfig> {
    const origin = config.origin;
    if (!origin || !origin.baseUrl) {
      return config;
    }

    const candidates = this.buildOpenapiCandidates(origin);
    if (candidates.length === 0) {
      return config;
    }

    const now = new Date().toISOString();
    let lastError: string | undefined;

    for (const candidate of candidates) {
      try {
        const response = await fetch(candidate, {
          headers: { accept: "application/json" },
        });
        if (!response.ok) {
          lastError = `status_${response.status}`;
          continue;
        }
        const spec = await response.json();
        const operations = extractOperationsFromOpenapi(spec);
        if (operations.length === 0) {
          lastError = "no_operations";
          continue;
        }

        const merge = mergeOperationsIntoRoutes(config.routes, operations);
        return {
          ...config,
          routes: merge.routes,
          openapi: {
            sourceUrl: candidate,
            fetchedAt: now,
            operations: operations.length,
          },
        };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    return {
      ...config,
      openapi: {
        sourceUrl: candidates[0] ?? origin.baseUrl,
        fetchedAt: now,
        operations: config.routes.length,
        error: lastError ?? "openapi_fetch_failed",
      },
    };
  }

  private async syncPagesFromSitemap(config: MerchantAppConfig): Promise<MerchantAppConfig> {
    const origin = config.origin;
    if (!origin || !origin.baseUrl) {
      return { ...config, pages: config.pages ?? [] };
    }

    const candidates = this.buildSitemapCandidates(origin);
    if (candidates.length === 0) {
      return { ...config, pages: config.pages ?? [] };
    }

    const now = new Date().toISOString();
    let lastError: string | undefined;

    for (const candidate of candidates) {
      try {
        const response = await fetch(candidate, {
          headers: { accept: "application/xml,text/xml,application/json" },
        });
        if (!response.ok) {
          lastError = `status_${response.status}`;
          continue;
        }
        const body = await response.text();
        const entries = extractSitemapEntries(body);
        if (entries.length === 0) {
          lastError = "no_entries";
          continue;
        }

        const merge = mergeSitemapEntries(config.pages ?? [], entries);
        return {
          ...config,
          pages: merge.pages,
          sitemap: {
            sourceUrl: candidate,
            fetchedAt: now,
            entries: merge.pages.length,
          },
        };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    return {
      ...config,
      pages: config.pages ?? [],
      sitemap: {
        sourceUrl: candidates[0] ?? origin.baseUrl,
        fetchedAt: now,
        entries: config.pages?.length ?? 0,
        error: lastError ?? "sitemap_fetch_failed",
      },
    };
  }

  private buildOpenapiCandidates(origin: z.infer<typeof originConfigSchema>): string[] {
    const unique = new Set<string>();
    if (origin.openapiPath) {
      unique.add(origin.openapiPath);
    }
    for (const path of DEFAULT_OPENAPI_PATHS) {
      unique.add(path);
    }

    const urls: string[] = [];
    for (const path of unique) {
      try {
        const url = new URL(path, origin.baseUrl).toString();
        urls.push(url);
      } catch (_error) {
        // ignore malformed paths
      }
    }
    return urls;
  }

  private buildSitemapCandidates(origin: z.infer<typeof originConfigSchema>): string[] {
    const unique = new Set<string>();
    if (origin.sitemapPath) {
      unique.add(origin.sitemapPath);
    }
    for (const path of DEFAULT_SITEMAP_PATHS) {
      unique.add(path);
    }

    const urls: string[] = [];
    for (const path of unique) {
      try {
        const url = new URL(path, origin.baseUrl).toString();
        urls.push(url);
      } catch (_error) {
        // ignore invalid
      }
    }
    return urls;
  }
}

export const __internal = {
  normalizeRoute,
  randomId,
  extractOperationsFromOpenapi,
  mergeOperationsIntoRoutes,
  normalizePage,
  extractSitemapEntries,
  mergeSitemapEntries,
};
