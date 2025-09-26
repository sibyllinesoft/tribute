# Pay-per-demo example

This example shows how to issue a one-shot token and call the proxy from Node.js.

```bash
# 1. Issue token (requires API worker running locally)
TOKEN=$(curl -s -X POST http://127.0.0.1:8788/v1/tokens/issue \
  -H 'x-user-id: demo-user' \
  -H 'content-type: application/json' \
  -d '{
    "rid": "/v1/demo",
    "method": "GET",
    "merchantId": "merchant-1",
    "inputs": {"demo": true},
    "originHost": "origin.example.com"
  }' | jq -r '.token')

# 2. Call proxy (assumes edge worker on 8787)
curl -v http://127.0.0.1:8787/v1/demo \
  -H "Authorization: Bearer $TOKEN"

# The first call fetches origin and caches artifact; subsequent calls reuse the cached body and receipt.
```
