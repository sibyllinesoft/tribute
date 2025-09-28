# HTTP Contracts

## Proxy invocation

```
GET /v1/demo
Headers:
  Authorization: Bearer <app session token>
  X-Meter-Mode: estimate-first | execute-only | estimate-is-final   # optional override
  X-Meter-Max-Price: 2.00                                           # optional per-request cap override
Response headers:
  X-Receipt-Id: <uuid>
  X-Content-Hash: <sha256 base64url>
  X-Final-Price: <decimal>
  X-Proxy-Context: <base64 context envelope>
  X-Required-Entitlement: <feature flag>   # present on 402 subscription_required

Response 402 (cap exceeded):
{
  "error": "cap_exceeded",
  "required_max_price": 2.75,
  "estimated_price": 2.68,
  "policy_ver": 3,
  "upgrade_url": "https://billing.example.com/upgrade"
}
```

The proxy automatically estimates the upstream price using the merchant’s
preflight defaults. If the estimate is less than or equal to the configured cap,
execution continues and the wallet is settled. Otherwise the proxy short-circuits
with `402` and no origin body leaks.

## Wallet APIs

- `GET /v1/wallet` — returns `{ "balance": number, "currency": "USD" }`
- `POST /v1/wallet/credits/checkout` — returns Stripe Checkout URL stub.

## History and receipts

- `GET /v1/history?cursor=...` — paginated receipt summaries.
- `GET /v1/receipts/{id}` — returns signed JSON receipt (must own).
- `GET /v1/artifacts/{hash}` — downloads cached artifact (ownership enforcement forthcoming).

## Redeem Durable Object RPC

- `POST https://redeem/begin` — `{ status: "ok" | "replay" | "reject" }`
- `POST https://redeem/commit` — `{ status: "ok", receipt }`
- `POST https://redeem/cancel` — `{ status: "ok" }`
