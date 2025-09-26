# Tribute

Tribute is a metered proxy platform that redeems single-use payment tokens, enforces cache rights, and fans receipts to origins without requiring origin-side changes. The repository is organized into Workers, Durable Objects, adapters, and a lightweight dashboard so teams can price, sell, and observe per-call access safely.

## Structure

- `edge-proxy/` — Cloudflare Worker that verifies tokens, redeems credits atomically, rewrites origin auth, and attaches verifiable proxy context headers.
- `dos/` — Durable Objects for wallet, merchant policy, redeem state machine, and history appenders.
- `api/` — Token issuance, wallet APIs, receipt retrieval, and funding webhook consumers.
- `dashboard/` — React single-page app for wallet balances, policies, and receipts.
- `adapters/` — Funding backends (`stripe` MVP, `ap2` stub) behind a common interface.
- `infra/` — Worker configuration (`wrangler.toml`) and namespace wiring.
- `specs/` — Protocol definitions, token schema notes, and contract examples.
- `examples/` — Sample flows and origin services for end-to-end testing.
- `tests/` — Vitest suites covering redeem idempotency and proxy cache invariants.

## Getting started

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Link local environment secrets (for example, the API Worker expects `TOKEN_SIGNING_KEY`). You can use `.dev.vars` with Wrangler to supply these values during `wrangler dev` sessions.

3. Start the development stack:

   ```bash
   # Full stack (Durable Objects + proxy + API + dashboard)
   pnpm dev

   # Headless option (Durable Objects + proxy + API only)
   pnpm dev:headless
   ```

   *(Need individual processes instead? Use `pnpm --filter <name> dev` as before.)*

4. Execute tests:

   ```bash
   pnpm test
   # Miniflare-powered integration checks
   pnpm test:integration
   ```

## End-to-end examples

To spin up the Workers stack together with FastAPI and Fastify demo origins,
use the Docker Compose workflow documented in `docs/e2e.md`.

## Current status

This bootstrap implements the “happy path” for the first two tickets:

- Redeem Durable Object ensures nonce-level idempotency and consults wallet budgets before debiting.
- Edge proxy verifies tokens, fetches origins, caches artifacts by hash, and emits receipts with deterministic signatures.

Follow-up work will tighten security envelopes, flesh out funding adapters, and harden failure handling per the milestones documented in `docs/milestones.md`.
