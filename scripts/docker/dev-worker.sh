#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 2 ]; then
  echo "usage: dev-worker.sh <wrangler-config> <port> [extra args...]" >&2
  exit 1
fi

CONFIG="$1"
PORT="$2"
shift 2

PERSIST_DIR="${PERSIST_DIR:-/app/.wrangler/state}"
IP_ADDR="${WRANGLER_BIND_IP:-0.0.0.0}"

if ! command -v pnpm >/dev/null 2>&1; then
  corepack enable >/dev/null 2>&1 || true
fi

if [ ! -d node_modules ]; then
  echo "[dev-worker] installing workspace dependencies" >&2
  pnpm install --frozen-lockfile
fi

DEV_VARS_FILE="${DEV_VARS_FILE:-/app/.dev.vars}"
>"${DEV_VARS_FILE}"

write_dev_var() {
  local name="$1"
  local value="${!name-}"
  if [ -n "${value}" ]; then
    printf '%s=%s\n' "$name" "$value" >>"${DEV_VARS_FILE}"
  fi
}

write_dev_var TOKEN_SIGNING_KEY
write_dev_var ENABLE_DEV_BOOTSTRAP
write_dev_var EXAMPLE_ORIGIN_TOKEN

ENV_FILE_ARGS=()
if [ -s "${DEV_VARS_FILE}" ]; then
  ENV_FILE_ARGS+=(--env-file "${DEV_VARS_FILE}")
else
  rm -f "${DEV_VARS_FILE}"
fi

exec pnpm wrangler dev \
  --config "${CONFIG}" \
  --ip "${IP_ADDR}" \
  --port "${PORT}" \
  --persist-to "${PERSIST_DIR}" \
  --local-protocol http \
  "${ENV_FILE_ARGS[@]}" \
  "$@"
