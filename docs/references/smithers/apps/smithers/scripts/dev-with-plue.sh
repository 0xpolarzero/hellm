#!/usr/bin/env bash
#
# dev-with-plue.sh — start apps/smithers' vite dev server with its proxies
# pointed at a local Plue checkout's docker-compose stack instead of the
# in-process fake-plue host.
#
# Default Plue origin: http://127.0.0.1:4000 (Plue's api service).
# Override with PLUE_API_BASE_URL=http://127.0.0.1:4001 etc.
#
# Usage:
#   PLUE_DIR=/Users/williamcory/plue ./scripts/dev-with-plue.sh
#
# Prereqs:
#   • A Plue checkout (PLUE_DIR or /Users/williamcory/plue).
#   • Docker running, with `docker compose` (v2).
#
# Readiness — "ready" means BOTH legs are actually reachable:
#   1. Plue answers /api/healthz on PLUE_API_BASE_URL (not just any open port).
#   2. The vite dev server is up on SMITHERS_DEV_PORT.
#   3. Vite's configured Plue proxy actually proxies — we hit
#      http://127.0.0.1:$SMITHERS_DEV_PORT/api/healthz and require the same
#      success response we got direct from Plue. A misconfigured proxy
#      (forgot env var, wrong target, dev-server bound to wrong host) fails
#      this gate instead of silently shipping a "looks-running" dev server.
#
# Exits nonzero if any leg fails, so the user gets a real error code, not a
# vite tab that 404s every fetch.

set -euo pipefail

PLUE_DIR="${PLUE_DIR:-/Users/williamcory/plue}"
PLUE_API_BASE_URL="${PLUE_API_BASE_URL:-http://127.0.0.1:4000}"
SMITHERS_DEV_PORT="${SMITHERS_DEV_PORT:-5175}"
SMITHERS_DEV_HOST="${SMITHERS_DEV_HOST:-127.0.0.1}"

if [[ ! -d "$PLUE_DIR" ]]; then
  echo "error: PLUE_DIR=$PLUE_DIR does not exist." >&2
  echo "       Either clone Plue there, or set PLUE_DIR=/path/to/plue and retry." >&2
  exit 2
fi

if [[ ! -f "$PLUE_DIR/docker-compose.yml" ]]; then
  echo "error: $PLUE_DIR/docker-compose.yml not found." >&2
  exit 2
fi

echo "[dev-with-plue] Bringing up Plue stack from $PLUE_DIR …"
(
  cd "$PLUE_DIR"
  docker compose up -d postgres migrate seed repo-host api
)

# Probe Plue directly. /api/healthz must respond — the previous "or anything on
# the port" fallback would accept any tcp listener on 4000 and was the cause of
# false-positive readiness when a stale container squatted the port.
echo "[dev-with-plue] Waiting for Plue /api/healthz at $PLUE_API_BASE_URL …"
for attempt in $(seq 1 60); do
  if curl -fsS --max-time 1 "$PLUE_API_BASE_URL/api/healthz" >/dev/null 2>&1; then
    break
  fi
  sleep 1
  if [[ $attempt -eq 60 ]]; then
    echo "error: Plue /api/healthz did not respond at $PLUE_API_BASE_URL within 60s." >&2
    exit 3
  fi
done

cd "$(dirname "$0")/.."

# Boot vite in the background so we can probe the proxy before backgrounding
# control to the user. The cleanup trap kills vite when the script exits or is
# signalled, so a failed proxy probe still tears the dev server down.
echo "[dev-with-plue] Starting vite on http://${SMITHERS_DEV_HOST}:${SMITHERS_DEV_PORT} …"
SMITHERS_AUTH_PROXY_TARGET="$PLUE_API_BASE_URL" \
SMITHERS_PLATFORM_PROXY_TARGET="$PLUE_API_BASE_URL" \
  pnpm vite --host "$SMITHERS_DEV_HOST" --port "$SMITHERS_DEV_PORT" --strictPort &
VITE_PID=$!

cleanup() {
  if kill -0 "$VITE_PID" 2>/dev/null; then
    kill "$VITE_PID" 2>/dev/null || true
    wait "$VITE_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

VITE_HEALTH_URL="http://${SMITHERS_DEV_HOST}:${SMITHERS_DEV_PORT}/api/healthz"
echo "[dev-with-plue] Waiting for vite + Plue proxy at $VITE_HEALTH_URL …"
for attempt in $(seq 1 60); do
  # The probe goes vite → proxy → Plue. A 2xx here proves both legs are real.
  if curl -fsS --max-time 2 "$VITE_HEALTH_URL" >/dev/null 2>&1; then
    echo "[dev-with-plue] Ready. Dev server proxying Plue at $PLUE_API_BASE_URL."
    wait "$VITE_PID"
    exit $?
  fi
  if ! kill -0 "$VITE_PID" 2>/dev/null; then
    echo "error: vite exited before the proxy went green." >&2
    exit 4
  fi
  sleep 1
done

echo "error: vite + Plue proxy did not return success at $VITE_HEALTH_URL within 60s." >&2
exit 5
