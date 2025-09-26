# Integrations SDKs

This workspace contains the language SDKs that bridge Tribute origins with the Tribute proxy runtime. Each language ships a **core** package that owns all pricing and policy semantics, and a set of thin **framework adapters** that wire HTTP lifecycle events into the core hooks.

## High-level design

- **Canonicalization** — normalize method, path templates, headers, query, and body into a stable representation that the proxy can hash when verifying receipts.
- **Route semantics decorators** — `@metered`, `@entitlement`, and `@cacheable` (and TS equivalents) attach metadata to handlers, auto-register estimate hooks, and emit OpenAPI `x-proxy` extensions.
- **Estimate pipeline** — helpers to construct estimate payloads, sign them via JWS, and manage JWKS rotation policies.
- **Usage accounting** — utilities to stream response bodies, compute byte counts, and attach optional structured usage (LLM tokens, etc.).
- **Estimate mirrors** — generator functions that register `/…/estimate` siblings with the same validation schema as the primary handler.
- **Policy helpers** — digest/version helpers and grace-window validation for contract rollouts.
- **Dev tooling** — CLIs to diff OpenAPI contracts, verify signatures, and simulate proxy receipts locally.

Adapters never implement pricing policy. They simply:

1. Collect request data and call the core canonicalizer.
2. Register the `/estimate` sibling via the core mirror helper.
3. Wrap responses to emit usage metadata and final price details.
4. Patch OpenAPI documents (Directly for FastAPI; via generators for Express/Fastify/Nest/Next).
