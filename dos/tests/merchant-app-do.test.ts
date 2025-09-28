import { beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "crypto";

import { MerchantAppDurableObject, __internal } from "../src/merchant-app-do";

if (!(globalThis as any).crypto) {
  (globalThis as any).crypto = webcrypto;
}

const createDurable = () => {
  const state: Record<string, unknown> = {};
  const storage = {
    get: async (key: string) => (key in state ? state[key] : null),
    put: async (key: string, value: unknown) => {
      state[key] = value;
    },
    delete: async (key: string) => {
      delete state[key];
    },
  } as any;
  const durable = new MerchantAppDurableObject({ storage } as any, {});
  return { durable, state };
};

describe("MerchantAppDurableObject", () => {
  let durable: MerchantAppDurableObject;
  let state: Record<string, unknown>;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const created = createDurable();
    durable = created.durable;
    state = created.state;
    mockFetch = vi.fn(async () => new Response(null, { status: 404 }));
    (globalThis as any).fetch = mockFetch;
  });

  it("returns 404 while config is missing", async () => {
    const res = await durable.fetch(new Request("https://merchant-app/config", { method: "GET" }));
    expect(res.status).toBe(404);
  });

  it("creates configuration and assigns route ids", async () => {
    const res = await durable.fetch(
      new Request("https://merchant-app/config", {
        method: "POST",
        body: JSON.stringify({
          appId: "app-1",
          merchantId: "merchant-1",
          displayName: "Demo App",
          routes: [
            {
              method: "GET",
              path: "/chat",
              pricing: { mode: "metered", flatAmount: 0.25, currency: "USD" },
            },
          ],
        }),
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(typeof body.config.routes[0].id).toBe("string");
    expect((state.config as any).displayName).toBe("Demo App");
    expect(Array.isArray(body.config.pages)).toBe(true);
  });

  it("updates an existing route to subscription mode", async () => {
    const createRes = await durable.fetch(
      new Request("https://merchant-app/config", {
        method: "POST",
        body: JSON.stringify({
          appId: "app-1",
          merchantId: "merchant-1",
          displayName: "Demo App",
          routes: [
            {
              method: "POST",
              path: "/images",
              pricing: { mode: "metered", flatAmount: 1 },
            },
          ],
        }),
      })
    );
    const { config } = await createRes.json();
    const routeId = config.routes[0].id;

    const updateRes = await durable.fetch(
      new Request(`https://merchant-app/routes/${routeId}`, {
        method: "PATCH",
        body: JSON.stringify({
          pricing: { mode: "subscription", feature: "images-pro" },
        }),
      })
    );
    expect(updateRes.status).toBe(200);
    const updated = await updateRes.json();
    expect(updated.route.pricing.mode).toBe("subscription");
    expect(updated.route.pricing.feature).toBe("images-pro");
  });

  it("removes a route and updates state", async () => {
    const createRes = await durable.fetch(
      new Request("https://merchant-app/config", {
        method: "POST",
        body: JSON.stringify({
          appId: "app-1",
          merchantId: "merchant-1",
          displayName: "Demo App",
          routes: [
            {
              method: "GET",
              path: "/status",
              pricing: { mode: "metered", flatAmount: 0 },
            },
          ],
        }),
      })
    );
    const { config } = await createRes.json();
    const routeId = config.routes[0].id;

    const delRes = await durable.fetch(
      new Request(`https://merchant-app/routes/${routeId}`, { method: "DELETE" })
    );
    expect(delRes.status).toBe(200);
    const stored = state.config as any;
    expect(Array.isArray(stored.routes)).toBe(true);
    expect(stored.routes.length).toBe(0);
  });

  it("pulls routes from openapi when available", async () => {
    mockFetch.mockImplementationOnce(async () =>
      new Response(
        JSON.stringify({
          openapi: "3.1.0",
          paths: {
            "/v1/demo": {
              get: { summary: "OpenAPI demo" },
            },
            "/v1/echo": {
              post: {
                summary: "OpenAPI echo",
                "x-tribute-pricing": { mode: "subscription", feature: "echo-pro" },
              },
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const res = await durable.fetch(
      new Request("https://merchant-app/config", {
        method: "POST",
        body: JSON.stringify({
          appId: "app-openapi",
          merchantId: "merchant-openapi",
          displayName: "Spec App",
          origin: { baseUrl: "https://example.com", openapiPath: "/docs/json" },
          routes: [],
        }),
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.config.routes).toHaveLength(2);
    const demoRoute = body.config.routes.find((route: any) => route.path === "/v1/demo");
    expect(demoRoute?.description).toBe("OpenAPI demo");
    const echoRoute = body.config.routes.find((route: any) => route.path === "/v1/echo");
    expect(echoRoute?.pricing.mode).toBe("subscription");
    expect(body.config.openapi.sourceUrl).toContain("/docs/json");
    expect(Array.isArray(body.config.pages)).toBe(true);
  });

  it("captures sitemap pages from xml", async () => {
    const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url><loc>https://example.com/alpha</loc><lastmod>2024-09-01</lastmod></url>
      <url><loc>https://example.com/beta</loc></url>
    </urlset>`;

    mockFetch.mockImplementationOnce(async () => new Response(null, { status: 404 }));
    mockFetch.mockImplementation(async () => new Response(sitemapXml, { status: 200, headers: { "content-type": "application/xml" } }));

    const sampleEntries = __internal.extractSitemapEntries(sitemapXml);
    expect(sampleEntries).toHaveLength(2);

    const res = await durable.fetch(
      new Request("https://merchant-app/config", {
        method: "POST",
        body: JSON.stringify({
          appId: "app-sitemap",
          merchantId: "merchant-sitemap",
          displayName: "Pages App",
          origin: { baseUrl: "https://example.com", sitemapPath: "/sitemap.xml" },
          routes: [],
        }),
      })
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.config.pages).toHaveLength(2);
    const alpha = body.config.pages.find((page: any) => page.url === "https://example.com/alpha");
    expect(alpha?.lastModified).toBe("2024-09-01");
    expect(body.config.sitemap.sourceUrl).toContain("/sitemap.xml");
    expect(body.config.sitemap.entries).toBe(2);
  });
});
