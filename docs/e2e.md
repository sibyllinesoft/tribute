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

- `tribute-dos`, `tribute-api`, `tribute-proxy` — Workers run with `wrangler dev`
  and share a persistent state volume for Durable Objects, KV, and R2.
- `fastapi-origin` on port `9000` and `fastify-origin` exposed on host port `3300` (container port `3000`) — sample
  metered origins secured with an API key (`x-api-key: local-dev-secret`).
- `tribute-bootstrap` — waits for the stack to become healthy, seeds merchant
  configs, and funds a `demo-user` wallet with credits.

Once bootstrap reports `bootstrap complete`, the system is ready for requests.
You can tail logs with `docker compose logs -f tribute-bootstrap`.

## Issue a token and call FastAPI

```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:8788/v1/tokens/issue \
  -H 'x-user-id: demo-user' \
  -H 'content-type: application/json' \
  -d '{
    "rid": "/v1/demo",
    "method": "GET",
    "merchantId": "merchant-fastapi",
    "inputs": {"demo": true},
    "originHost": "fastapi-origin"
  }' | jq -r '.token')

curl -v http://127.0.0.1:8787/v1/demo \
  -H "Authorization: Bearer ${TOKEN}"
```

The response includes proxy metadata headers and the FastAPI payload. Repeating
the request will hit the cache unless the origin content changes.

## Exercise the Fastify origin

```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:8788/v1/tokens/issue \
  -H 'x-user-id: demo-user' \
  -H 'content-type: application/json' \
  -d '{
    "rid": "/v1/demo",
    "method": "GET",
    "merchantId": "merchant-fastify",
    "inputs": {"demo": true},
    "originHost": "fastify-origin"
  }' | jq -r '.token')

curl -v http://127.0.0.1:8787/v1/demo \
  -H "Authorization: Bearer ${TOKEN}"
```

To test POST flows, update `method` to `POST`, set `rid` to `/v1/echo`, and pass
`-d '{"hello":"world"}'` to the proxy request.

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
