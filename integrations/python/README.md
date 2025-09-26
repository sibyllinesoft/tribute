# Python SDKs

Packages:

- `tribute_core`: canonicalization, policy, estimation, usage extraction, and OpenAPI metadata.
- `tribute_fastapi`, `tribute_flask`, `tribute_django`: thin adapters that project framework lifecycles into the core hooks.
- `extras`: optional utilities such as LLM usage extractors.

## Development goals

1. Keep decorators declarative and side-effect free.
2. Emit `x-proxy` OpenAPI metadata directly from the core.
3. Ship a CLI (`tribute-dev`) for validating OpenAPI diffs, signatures, and simulated receipts.
4. Provide contract tests shared across adapters to guarantee conformance.

## Testing

```bash
cd integrations/python
pytest
```
