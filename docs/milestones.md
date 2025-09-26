# Milestones

## Milestone 1 — Core proxy, atomic redeem, caching
- Redeem Durable Object keeps nonce state machine `missing → pending → redeemed | cancelled` with replay detection.
- Edge proxy Worker verifies tokens, rewrites origin auth, computes content hashes, and stores receipts/artifacts in KV/R2.
- Merchant policies and cache invariants enforced by deterministic hashes (`rid`, `inputs_hash`, `policy_ver`).

## Milestone 2 — Wallet (OAuth + Stripe) + budgets
- User wallet DO tracks balance, per-merchant spend, and idempotent debits.
- Stripe adapter surface for credit checkout and webhook ingestion.
- Token issuance API signs HS256 one-shot tokens bound to origin host and method.

## Milestone 3 — History & receipts
- History DO appends per-request audit entries and paginates for dashboard/API retrieval.
- Receipts and artifacts exposed via authenticated API routes with ownership checks.

## Milestone 4 — Funding adapters & ops hardening
- Funding adapter interface allows swap-in of AP2 and future settlement backends.
- Exports, nightly settlement bundles, and circuit breakers configured via DO + queues.
