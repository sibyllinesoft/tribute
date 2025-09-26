# HTTP Contracts

## Token issuance

```
POST /v1/tokens/issue
Headers: x-user-id: <internal user id>
Body:
{
  "rid": "GET /v1/demo",     // canonical route id
  "method": "GET",
  "merchantId": "merchant-1",
  "inputs": { ... },
  "inputsHash": "optional precomputed hash",
  "originHost": "origin.example.com",
  "maxPrice": 1.25
}
Response 200:
{
  "token": "<jwt>",
  "exp": 1711326113,
  "estimate": {
    "estimatedPrice": 1.0,
    "currency": "USD",
    "policyVersion": 9,
    "policyDigest": "sha256:...",
    "suggestedMaxPrice": 1.25
  }
}
```

## Proxy invocation

```
GET /v1/demo
Headers:
  Authorization: Bearer <payment-token>
  X-Pricing-Mode: estimate-first | execute-only | estimate-is-final
  X-Max-Price: 0.90   # optional override (<= token.max_price)
  X-Client-Context: Bearer <optional app token>
Response headers:
  X-Receipt-Id: <uuid>
  X-Content-Hash: <sha256 base64url>
  X-Token-Fingerprint: <sha256 token hash>
  X-Proxy-Context: <base64 context envelope>
  X-Required-Entitlement: <feature flag>   # present on 402 subscription_required

Response 402 (subscription required):
{
  "error": "subscription_required",
  "needed": "subscription:plan_pro",
  "upgrade_url": "https://billing.example.com/upgrade"
}
```

## Wallet APIs

- `GET /v1/wallet` — returns `{ "balance": number, "currency": "USD" }`
- `POST /v1/wallet/credits/checkout` — returns Stripe Checkout URL stub.

## History and receipts

- `GET /v1/history?cursor=...` — paginated receipt summaries.
- `GET /v1/receipts/{id}` — returns signed JSON receipt (must own). Receipt payload includes `policyVersion`, `policyDigest`, `maxPrice`, `estimatedPrice`, `finalPrice`, `estDigest`, `observablesDigest`, `finalPriceSig`, `pricingMode`, `pricingUnattested`.
- `GET /v1/artifacts/{hash}` — downloads cached artifact with ownership enforcement (future enhancement).

## Redeem Durable Object RPC

- `POST https://redeem/begin` — `{ status: "ok" | "replay" | "reject" }`
- `POST https://redeem/commit` — `{ status: "ok", receipt }`
- `POST https://redeem/cancel` — `{ status: "ok" }`
