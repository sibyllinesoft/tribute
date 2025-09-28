import Fastify from "fastify";
import swagger from "@fastify/swagger";
import swaggerUI from "@fastify/swagger-ui";

const API_KEY = process.env.TRIBUTE_API_KEY ?? "local-dev-secret";
const DEFAULT_PRICE = Number(process.env.TRIBUTE_PRICE ?? "0.05");
const DEFAULT_ESTIMATE = Number(process.env.TRIBUTE_ESTIMATE ?? "0.05");
const PORT = Number(process.env.PORT ?? "3000");

const fastify = Fastify({ logger: true });

await fastify.register(swagger, {
  openapi: {
    openapi: "3.1.0",
    info: {
      title: "Tribute Fastify Example",
      version: "0.1.0",
      description: "Sample origin demonstrating Swagger discovery for Tribute proxy",
    },
    servers: [{ url: "http://localhost:3300" }],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "x-api-key",
        },
      },
    },
  },
});

await fastify.register(swaggerUI, {
  routePrefix: "/docs",
  staticCSP: false,
  uiConfig: {
    docExpansion: "list",
    deepLinking: false,
  },
});

fastify.addHook("onSend", async (request, reply, payload) => {
  const path = request.raw.url?.split("?")[0] ?? request.url;
  if (path && path.startsWith("/docs")) {
    reply.removeHeader("content-security-policy");
    reply.removeHeader("x-frame-options");
    reply.header("content-security-policy", "frame-ancestors 'self' http://localhost:8080");
  }
  return payload;
});

fastify.addHook("onRequest", async (request, reply) => {
  const path = request.raw.url?.split("?")[0] ?? request.url;
  if (path === "/healthz" || path === "/" || path === "/sitemap.xml" || path.startsWith("/docs")) {
    return;
  }
  const apiKey = request.headers["x-api-key"];
  if (apiKey !== API_KEY) {
    return reply.code(401).send({ error: "unauthorized" });
  }
});

fastify.get("/healthz", async () => ({ status: "ok", ts: Date.now() }));

fastify.get(
  "/",
  { schema: { hide: true } },
  async (_request, reply) =>
    reply.type("text/html").send(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Tribute Fastify Demo</title>
    <style>
      body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 2rem; }
      a { color: #6366f1; }
      code { background: rgba(148, 163, 184, 0.15); padding: 0.2rem 0.4rem; border-radius: 0.25rem; }
    </style>
  </head>
  <body>
    <h1>Tribute Fastify Demo</h1>
    <p>Use the proxy to call <code>/v1/demo</code> or <code>/v1/echo</code>. Swagger UI lives at <a href="/docs">/docs</a>.</p>
  </body>
</html>`)
);

fastify.get(
  "/sitemap.xml",
  { schema: { hide: true } },
  async (_request, reply) =>
    reply
      .type("application/xml")
      .send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>http://localhost:${PORT}/</loc>
  </url>
  <url>
    <loc>http://localhost:${PORT}/docs</loc>
  </url>
  <url>
    <loc>http://localhost:${PORT}/v1/demo</loc>
  </url>
</urlset>`)
);

fastify.get(
  "/v1/demo",
  {
    schema: {
      summary: "Public demo endpoint",
      tags: ["demo"],
      security: [{ ApiKeyAuth: [] }],
      response: {
        200: {
          type: "object",
          properties: {
            result: { type: "string" },
            final_price: { type: "number" },
            currency: { type: "string" },
            usage: {
              type: "object",
              properties: {
                prompt_tokens: { type: "number" },
                completion_tokens: { type: "number" },
              },
            },
            price_sig: { type: "string", nullable: true },
          },
        },
      },
    },
  },
  async () => ({
    result: "Hello from Fastify",
    final_price: DEFAULT_PRICE,
    currency: "USD",
    usage: {
      prompt_tokens: 24,
    completion_tokens: 12,
  },
  price_sig: null,
  })
);

fastify.get(
  "/v1/demo/estimate",
  {
    schema: {
      summary: "Estimate for demo endpoint",
      tags: ["demo"],
      security: [{ ApiKeyAuth: [] }],
      response: {
        200: {
          type: "object",
          properties: {
            estimated_price: { type: "number" },
            currency: { type: "string" },
            estimate_is_final: { type: "boolean" },
            estimate_ttl_seconds: { type: "number" },
            policy_ver: { type: "number" },
            policy_digest: { type: "string" },
            price_sig: { type: "string", nullable: true },
          },
        },
      },
    },
  },
  async () => ({
    estimated_price: DEFAULT_ESTIMATE,
    currency: "USD",
    estimate_is_final: false,
    estimate_ttl_seconds: 60,
    policy_ver: 1,
    policy_digest: "dev-policy",
    price_sig: null,
  })
);

fastify.post(
  "/v1/echo",
  {
    schema: {
      summary: "Echo with usage pricing",
      tags: ["echo"],
      security: [{ ApiKeyAuth: [] }],
      body: { type: "object", additionalProperties: true, nullable: true },
      response: {
        200: {
          type: "object",
          properties: {
            echo: { type: "object", additionalProperties: true },
            final_price: { type: "number" },
            currency: { type: "string" },
            usage: {
              type: "object",
              properties: {
                input_bytes: { type: "number" },
              },
            },
            price_sig: { type: "string", nullable: true },
          },
        },
      },
    },
  },
  async (request) => ({
    echo: request.body ?? null,
    final_price: DEFAULT_PRICE,
    currency: "USD",
    usage: { input_bytes: JSON.stringify(request.body ?? "").length },
    price_sig: null,
  })
);

const start = async () => {
  try {
    await fastify.listen({ host: "0.0.0.0", port: PORT });
  } catch (error) {
    fastify.log.error(error);
    process.exit(1);
  }
};

start();
