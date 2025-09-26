# JavaScript/TypeScript SDKs

Packages are managed as an npm workspace. Each adapter depends on `@tribute/core`, which owns canonicalization, pricing, policy helpers, usage tracking, and OpenAPI tooling. Adapters only translate framework lifecycles into the core hooks.

```
packages/
  core/      # shared logic (decorators, canonicalization, signing, policy, CLI helpers)
  express/   # connects Express middleware to core hooks
  fastify/   # Fastify route registration + estimate mirror
  next/      # Next.js API route wrapper
  nest/      # NestJS interceptor for canonicalization/usage
extras/
  llm-openai.ts
```

## Development

```bash
cd integrations/js
npm install
npm run test
```
