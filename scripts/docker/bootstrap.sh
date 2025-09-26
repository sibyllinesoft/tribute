#!/usr/bin/env sh
set -eu

API_BASE=${API_BASE:-http://tribute-api:8788}
MERCHANT_SECRET=${MERCHANT_SECRET:-env:EXAMPLE_ORIGIN_TOKEN}

wait_for_api() {
  retries=60
  while [ "$retries" -gt 0 ]; do
    if curl -sf "${API_BASE}/healthz" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    retries=$((retries - 1))
  done
  echo "bootstrap: API never became ready" >&2
  return 1
}

bootstrap_payload() {
  cat <<JSON
{
  "merchants": [
    {
      "merchantId": "merchant-fastapi",
      "origin": {
        "baseUrl": "http://fastapi-origin:9000",
        "auth": {
          "kind": "api_key",
          "secretRef": "${MERCHANT_SECRET}",
          "header": "x-api-key"
        }
      },
      "pricing": {
        "policyVersion": 1,
        "policyDigest": "dev-policy",
        "variablePricing": true,
        "estimatePathSuffix": "/estimate",
        "priceUnit": "USD",
        "rules": [
          { "match": { "method": "GET", "path": "/v1/demo" }, "price": { "flat": 0.05 } },
          { "match": { "method": "POST", "path": "/v1/echo" }, "price": { "flat": 0.1 } }
        ]
      },
      "cache": { "maxKvBytes": 120000, "ttlSeconds": 3600 }
    },
    {
      "merchantId": "merchant-fastify",
      "origin": {
        "baseUrl": "http://fastify-origin:3000",
        "auth": {
          "kind": "api_key",
          "secretRef": "${MERCHANT_SECRET}",
          "header": "x-api-key"
        }
      },
      "pricing": {
        "policyVersion": 1,
        "policyDigest": "dev-policy",
        "variablePricing": true,
        "estimatePathSuffix": "/estimate",
        "priceUnit": "USD",
        "rules": [
          { "match": { "method": "GET", "path": "/v1/demo" }, "price": { "flat": 0.05 } },
          { "match": { "method": "POST", "path": "/v1/echo" }, "price": { "flat": 0.1 } }
        ]
      },
      "cache": { "maxKvBytes": 120000, "ttlSeconds": 3600 }
    }
  ],
  "wallets": [
    {
      "userId": "demo-user",
      "balance": 20,
      "perMerchantCap": {
        "merchant-fastapi": 20,
        "merchant-fastify": 20
      }
    }
  ]
}
JSON
}

wait_for_api

payload_file=$(mktemp)
bootstrap_payload >"${payload_file}"
response_file=$(mktemp)

http_code=$(curl -s -o "${response_file}" -w "%{http_code}" \
  -X POST "${API_BASE}/v1/dev/bootstrap" \
  -H "content-type: application/json" \
  --data-binary @"${payload_file}")

cat "${response_file}"

if [ "${http_code}" != "200" ]; then
  echo "bootstrap failed with status ${http_code}" >&2
  exit 1
fi

echo "bootstrap complete"
