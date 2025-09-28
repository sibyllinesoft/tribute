#!/usr/bin/env sh
set -eu

API_BASE=${API_BASE:-http://tribute-workers:8788}
MERCHANT_SECRET=${MERCHANT_SECRET:-env:EXAMPLE_ORIGIN_TOKEN}

configure_fastapi_app() {
  payload_file=$(mktemp)
  cat >"${payload_file}" <<'JSON'
{
  "appId": "merchant-fastapi",
  "merchantId": "merchant-fastapi",
  "displayName": "FastAPI Demo App",
  "origin": {
    "baseUrl": "http://fastapi-origin:9000",
    "forwardAuthHeader": true,
    "openapiPath": "/openapi.json"
  },
  "routes": [
    {
      "method": "GET",
      "path": "/v1/demo",
      "description": "Public demo endpoint",
      "pricing": { "mode": "metered", "flatAmount": 0.05, "currency": "USD" }
    },
    {
      "method": "POST",
      "path": "/v1/echo",
      "description": "Echo with subscription gate",
      "pricing": { "mode": "subscription", "feature": "echo-pro", "upgradeUrl": "https://example.com/upgrade" }
    }
  ]
}
JSON

  response_file=$(mktemp)
  status=$(curl -s -o "${response_file}" -w "%{http_code}" \
    -X POST "http://tribute-workers:8789/internal/merchant-app/config?id=merchant-fastapi" \
    -H "content-type: application/json" \
    --data-binary @"${payload_file}")
  cat "${response_file}"
  echo
  rm -f "${response_file}" "${payload_file}"
  if [ "${status}" != "200" ] && [ "${status}" != "201" ]; then
    echo "merchant app bootstrap failed for merchant-fastapi (status ${status})" >&2
    return 1
  fi
}

configure_fastify_app() {
  payload_file=$(mktemp)
  cat >"${payload_file}" <<'JSON'
{
  "appId": "merchant-fastify",
  "merchantId": "merchant-fastify",
  "displayName": "Fastify Demo App",
  "origin": {
    "baseUrl": "http://fastify-origin:3000",
    "forwardAuthHeader": true,
    "openapiPath": "/docs/json"
  },
  "routes": [
    {
      "method": "GET",
      "path": "/v1/demo",
      "description": "Public demo endpoint",
      "pricing": { "mode": "metered", "flatAmount": 0.05, "currency": "USD" }
    },
    {
      "method": "POST",
      "path": "/v1/echo",
      "description": "Metered echo endpoint",
      "pricing": { "mode": "metered", "flatAmount": 0.1, "currency": "USD" }
    }
  ]
}
JSON

  response_file=$(mktemp)
  status=$(curl -s -o "${response_file}" -w "%{http_code}" \
    -X POST "http://tribute-workers:8789/internal/merchant-app/config?id=merchant-fastify" \
    -H "content-type: application/json" \
    --data-binary @"${payload_file}")
  cat "${response_file}"
  echo
  rm -f "${response_file}" "${payload_file}"
  if [ "${status}" != "200" ] && [ "${status}" != "201" ]; then
    echo "merchant app bootstrap failed for merchant-fastify (status ${status})" >&2
    return 1
  fi
}

configure_merchant_apps() {
  configure_fastapi_app || return 1
  configure_fastify_app || return 1
}

configure_fastapi_merchant() {
  payload_file=$(mktemp)
  cat >"${payload_file}" <<JSON
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
}
JSON

  response_file=$(mktemp)
  status=$(curl -s -o "${response_file}" -w "%{http_code}" \
    -X POST "http://tribute-workers:8789/internal/merchant/config?id=merchant-fastapi" \
    -H "content-type: application/json" \
    --data-binary @"${payload_file}")
  cat "${response_file}"
  echo
  rm -f "${response_file}" "${payload_file}"
  if [ "${status}" != "200" ]; then
    echo "merchant DO bootstrap failed for merchant-fastapi (status ${status})" >&2
    return 1
  fi
}

configure_fastify_merchant() {
  payload_file=$(mktemp)
  cat >"${payload_file}" <<JSON
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
JSON

  response_file=$(mktemp)
  status=$(curl -s -o "${response_file}" -w "%{http_code}" \
    -X POST "http://tribute-workers:8789/internal/merchant/config?id=merchant-fastify" \
    -H "content-type: application/json" \
    --data-binary @"${payload_file}")
  cat "${response_file}"
  echo
  rm -f "${response_file}" "${payload_file}"
  if [ "${status}" != "200" ]; then
    echo "merchant DO bootstrap failed for merchant-fastify (status ${status})" >&2
    return 1
  fi
}

configure_merchants() {
  configure_fastapi_merchant || return 1
  configure_fastify_merchant || return 1
}

sync_openapi_for_app() {
  app_id="$1"
  attempts=6
  while [ "$attempts" -gt 0 ]; do
    response_file=$(mktemp)
    status=$(curl -s -o "${response_file}" -w "%{http_code}" \
      -X POST "${API_BASE}/v1/merchant-apps/${app_id}/openapi/refresh" \
      -H "content-type: application/json" \
      -H "x-user-id: demo-user")
    cat "${response_file}"
    echo
    rm -f "${response_file}"
    if [ "${status}" = "200" ]; then
      return 0
    fi
    attempts=$((attempts - 1))
    sleep 2
  done
  echo "openapi sync failed for ${app_id}" >&2
  return 1
}

sync_openapi_catalog() {
  sync_openapi_for_app "merchant-fastapi" || return 1
  sync_openapi_for_app "merchant-fastify" || return 1
}

sync_sitemap_for_app() {
  app_id="$1"
  attempts=6
  while [ "$attempts" -gt 0 ]; do
    response_file=$(mktemp)
    status=$(curl -s -o "${response_file}" -w "%{http_code}" \
      -X POST "${API_BASE}/v1/merchant-apps/${app_id}/sitemap/refresh" \
      -H "content-type: application/json" \
      -H "x-user-id: demo-user")
    cat "${response_file}"
    echo
    rm -f "${response_file}"
    if [ "${status}" = "200" ]; then
      return 0
    fi
    attempts=$((attempts - 1))
    sleep 2
  done
  echo "sitemap sync failed for ${app_id}" >&2
  return 1
}

sync_sitemap_catalog() {
  sync_sitemap_for_app "merchant-fastapi" || return 1
  sync_sitemap_for_app "merchant-fastify" || return 1
}

configure_wallet() {
  fund_payload=$(mktemp)
  cat >"${fund_payload}" <<'JSON'
{
  "amount": 20,
  "currency": "USD"
}
JSON
  response_file=$(mktemp)
  status=$(curl -s -o "${response_file}" -w "%{http_code}" \
    -X POST "http://tribute-workers:8789/internal/wallet/fund?id=demo-user" \
    -H "content-type: application/json" \
    --data-binary @"${fund_payload}")
  cat "${response_file}"
  echo
  if [ "${status}" != "200" ]; then
    rm -f "${response_file}" "${fund_payload}"
    echo "wallet fund failed (status ${status})" >&2
    return 1
  fi

  configure_payload=$(mktemp)
  cat >"${configure_payload}" <<'JSON'
{
  "perMerchantCap": {
    "merchant-fastapi": 20,
    "merchant-fastify": 20
  }
}
JSON
  status=$(curl -s -o "${response_file}" -w "%{http_code}" \
    -X POST "http://tribute-workers:8789/internal/wallet/configure?id=demo-user" \
    -H "content-type: application/json" \
    --data-binary @"${configure_payload}")
  cat "${response_file}"
  echo
  rm -f "${response_file}" "${fund_payload}" "${configure_payload}"
  if [ "${status}" != "200" ]; then
    echo "wallet configure failed (status ${status})" >&2
    return 1
  fi
}

wait_for_dos() {
  retries=60
  while [ "$retries" -gt 0 ]; do
    if curl -sf http://tribute-workers:8789 >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    retries=$((retries - 1))
  done
  echo "bootstrap: DO worker never became ready" >&2
  return 1
}

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

wait_for_api
wait_for_dos

if ! configure_merchants; then
  echo "merchant DO configuration failed" >&2
  exit 1
fi

if ! configure_merchant_apps; then
  echo "merchant app configuration failed" >&2
  exit 1
fi

if ! sync_openapi_catalog; then
  echo "openapi discovery failed" >&2
  exit 1
fi

if ! sync_sitemap_catalog; then
  echo "sitemap discovery failed" >&2
  exit 1
fi

if ! configure_wallet; then
  echo "wallet configuration failed" >&2
  exit 1
fi

echo "bootstrap complete"
