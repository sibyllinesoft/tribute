# End-to-End Example Stack

This guide explains how to run the Tribute stack alongside sample FastAPI and
Fastify origins so you can exercise the metered proxy end-to-end.

## Prerequisites

- Docker (v24+) and Docker Compose plugin
- PNPM dependencies installed locally (`pnpm install`)

## Start the stack

```bash
# From the repository root
docker compose up --build
```

Compose launches the following services:

- `tribute-workers` — runs the Durable Objects, API worker, and proxy in one container
  so local Durable Object calls work out of the box. Ports 8787 (proxy), 8788 (API),
  and 8789 (Durable Objects) are exposed to the host. A shared `.wrangler/state`
  volume keeps local DO state between restarts.
- `tribute-dashboard` — serves the Tribute control panel via Vite dev server on
  <http://localhost:5173>. Use the **Merchant Apps** tab to edit route pricing
  for each merchant app seeded by bootstrap.
- `tribute-console` — nginx container that exposes a single static page with
  tabs for the dashboard, proxied FastAPI demo (`/apps/fastapi` routed through
  the Tribute worker), the raw Fastify origin, and JSON inspection endpoints at
  <http://localhost:8080>. Handy for hopping between tools while exercising the
  stack.
- `fastapi-origin` on host port `9100` (container `9000`) and `fastify-origin` on host port `3300` (container `3000`) — sample
  metered origins secured with an API key (`x-api-key: local-dev-secret`).
- `tribute-bootstrap` — waits for the stack to become healthy, seeds merchant
  configs, preloads the Merchant App Durable Object with route pricing
  (flat vs. subscription), and funds a `demo-user` wallet with credits.
  After the merchant apps are created, bootstrap calls the OpenAPI and sitemap
  refresh endpoints so the proxy inspects each origin's Swagger document and
  sitemap in order to enumerate API routes and site pages. Fastify serves its
  spec at `/docs/json` and sitemap at `/sitemap.xml`; FastAPI at `/openapi.json`
  and `/sitemap.xml`.

Once bootstrap reports `bootstrap complete`, the system is ready for requests.
You can tail logs with `docker compose logs -f tribute-bootstrap`.

## Call the proxied routes

### Inspect the seeded Merchant Apps

You can verify the Merchant App durable state via the API worker:

```bash
curl http://127.0.0.1:8788/v1/merchant-apps/merchant-fastapi | jq
```

The response lists each proxied route, its pricing mode (`metered` or
`subscription`), and any upgrade URL shown to users when a subscription is
required.

Auto-preflight is handled entirely by the proxy. Provide your app's session
token (or whatever header your app uses for identity) and call the proxied URL
directly:

```bash
curl --resolve merchant-fastapi:8787:127.0.0.1 \
  -v http://merchant-fastapi:8787/v1/demo \
  -H 'Authorization: demo-user'
```

You should see `X-Final-Price`, `X-Receipt-Id`, and `X-Proxy-Context` headers in the response.
Repeat the call to confirm the proxy serves the cached artifact.

The bootstrap config also created a subscription-gated route for the FastAPI
merchant. Hitting it without an entitlement returns the expected 402 guard:

```bash
curl --resolve merchant-fastapi:8787:127.0.0.1 \
  -v http://merchant-fastapi:8787/v1/echo \
  -X POST \
  -H 'content-type: application/json' \
  -H 'Authorization: demo-user' \
  --data '{"message":"hello"}'
```

Expect a `402` response indicating the call exceeded the default cap. The response
includes `X-Required-Max-Price` with the amount the proxy would need to proceed.
Once the control plane is connected you can attach entitlements or raise the cap
to allow the call.

To exercise the Fastify origin, target the same proxied paths; the merchant app
config seeded by bootstrap maps `merchant-fastify` to the Fastify routes with
flat metered pricing. Resolve the host header the same way:

```bash
curl --resolve merchant-fastify:8787:127.0.0.1 \
  -v http://merchant-fastify:8787/v1/demo \
  -H 'Authorization: demo-user'
```


## Tear down

```bash
docker compose down --volumes
```

This stops all services and clears the persisted Wrangler state. If you only
want to stop the containers but keep Durable Object state, omit `--volumes`.

## Troubleshooting

- The Workers rely on shared state mounted at `.wrangler/state`. If you see
  namespace binding errors, ensure the `wrangler_state` volume is attached.
- Rerun bootstrap manually with `docker compose run --rm tribute-bootstrap` if
  you change merchant configurations.
- Rebuild origins after code changes with `docker compose build fastapi-origin
  fastify-origin`.
