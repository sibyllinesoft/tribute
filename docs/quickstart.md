# Quickstart

This guide walks through issuing a one-shot payment token and exercising the proxy locally.

1. **Start the dev stack**
   - In the project root run `npm run dev` (for proxy + API + dashboard) or `npm run dev:headless` if you only need the Workers.

2. **Configure merchant policy**
   - Call `POST https://merchant/config` on the Merchant Durable Object with a payload similar to `specs/merchant-example.json`.
   - Provide an origin `baseUrl`, authentication secret reference, and price rule for the route you plan to test.

3. **Fund a wallet**
   - Invoke `POST https://wallet/fund` on the User Wallet DO (`idFromName(userId)`) with `{ "amount": 10, "currency": "USD" }`.
   - Optional: apply budgets via `POST https://wallet/configure`.

4. **Issue a token**
   - Call the API Worker `POST /v1/tokens/issue` with headers `x-user-id: demo-user` and body:
     ```json
     {
       "rid": "/v1/demo",
       "method": "GET",
       "merchantId": "merchant-1",
       "inputs": { "doc": "https://example.com" },
       "originHost": "origin.example.com"
     }
     ```
   - Copy the `token` value from the response.

5. **Send proxied request**
   - Send an HTTP request to the edge proxy Worker with header `Authorization: Bearer <token>`.
   - Observe response headers `X-Receipt-Id`, `X-Content-Hash`, and the signed `X-Proxy-Context` envelope.

6. **Replay**
   - Re-send the same request. The proxy will return the cached artifact with identical receipt and skip the origin charge.

7. **Review history**
   - Query `GET /v1/history` with `x-user-id: demo-user` to confirm the transaction entry.
   - Download the artifact via `GET /v1/artifacts/{hash}`.

8. **Run integration checks (optional)**
   - Execute `npm run test:integration` to exercise the edge proxy through Miniflare’s runtime bundle.
