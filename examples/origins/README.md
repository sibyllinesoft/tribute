# Tribute Example Origins

These FastAPI and Fastify services act as simple metered origins that the Tribute
proxy can call during end-to-end testing. Each container exposes a `/v1/demo`
endpoint that returns pricing metadata alongside a payload, as well as a
`/v1/demo/estimate` endpoint for variable pricing lookups.

Both services expect requests to include an `x-api-key` header whose value
matches the `TRIBUTE_API_KEY` environment variable (defaults to
`local-dev-secret`). When the Tribute proxy rewrites origin authentication, it
will inject this header automatically.

- `fastapi/` — Python implementation served by Uvicorn on port `9000`.
- `fastify/` — Node.js implementation served by Fastify on port `3000` (Docker Compose maps it to host port `3300`).

You can run either service locally with Docker, for example:

```bash
docker build -t tribute-fastapi examples/origins/fastapi
docker run --rm -p 9000:9000 tribute-fastapi
```

```bash
docker build -t tribute-fastify examples/origins/fastify
docker run --rm -p 3000:3000 tribute-fastify
```
