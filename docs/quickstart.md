# Quickstart

This guide walks through configuring a merchant app and exercising the proxy-managed auto-preflight locally.

1. **Start the dev stack**
   - With Docker: `docker compose up --build` starts the Workers, sample origins, bootstrap seeding job, the Tribute dashboard on <http://localhost:5173>, and a convenience console on <http://localhost:8080> with tabs for each app.
   - Without Docker: run `npm run dev` (for proxy + API + dashboard) or `npm run dev:headless` if you only need the Workers.

2. **Configure merchant policy**
   - Call `POST https://merchant/config` on the Merchant Durable Object with a payload similar to `specs/merchant-example.json`.
   - Provide an origin `baseUrl`, authentication secret reference, and price rule for the route you plan to test.
   - Alternatively, open the Tribute dashboard and use the **Merchant Apps** tab to add routes and choose between metered flat pricing or subscription-required access via the pricing selector. If the origin exposes an OpenAPI spec (e.g. FastAPI `/openapi.json` or Swagger `/docs/json`) and a sitemap (e.g. `/sitemap.xml`), the proxy will auto-discover API endpoints and site pages so you can price them separately.

3. **Fund a wallet**
   - Invoke `POST https://wallet/fund` on the User Wallet DO (`idFromName(userId)`) with `{ "amount": 10, "currency": "USD" }`.
   - Optional: apply budgets via `POST https://wallet/configure`.

4. **Send proxied request**
   - Hit the edge proxy Worker directly with your application’s session header, e.g.
     ```bash
     curl -H 'Authorization: Bearer session-123' \
       https://your-proxy-domain/v1/demo
     ```
   - Observe response headers `X-Receipt-Id`, `X-Content-Hash`, `X-Final-Price`, and the signed `X-Proxy-Context` envelope.

5. **Replay**
   - Re-send the same request. The proxy will return the cached artifact with identical receipt and skip the origin charge.

6. **Review history**
   - Query `GET /v1/history` with `x-user-id: demo-user` to confirm the transaction entry.
   - Download the artifact via `GET /v1/artifacts/{hash}`.

7. **Run integration checks (optional)**
   - Execute `npm run test:integration` to exercise the edge proxy through Miniflare’s runtime bundle.
