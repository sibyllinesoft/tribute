# Pay-per-demo example

This example shows how to call the proxy directly with your application session
header—no token issuance required.

```bash
# 1. Call the proxied route (assumes edge worker on 8787)
curl -v http://127.0.0.1:8787/v1/demo \
  -H 'Authorization: Bearer session-token-123'

# The first call fetches origin and caches the artifact; subsequent calls reuse
# the cached body and receipt until the estimate or policy changes.
```
