#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
MACHINE_NAME="${HELLM_E2E_ORB_MACHINE:-hellm-e2e}"
LINUX_WORKSPACE="${HELLM_E2E_ORB_WORKSPACE:-\$HOME/code/hellm}"
MAC_ROOT="/mnt/mac$ROOT_DIR"

if ! command -v orb >/dev/null 2>&1; then
  echo "OrbStack CLI ('orb') is not installed or not on PATH." >&2
  exit 1
fi

if ! orb info "$MACHINE_NAME" >/dev/null 2>&1; then
  echo "OrbStack machine '$MACHINE_NAME' is not set up. Run 'bun run setup:e2e' first." >&2
  exit 1
fi

orb -m "$MACHINE_NAME" bash -s -- "$LINUX_WORKSPACE" "$MAC_ROOT" "$@" <<'EOF'
set -euo pipefail

linux_workspace_input="$1"
mac_root="$2"
shift 2

case "$linux_workspace_input" in
  '$HOME'/*)
    linux_workspace="$HOME/${linux_workspace_input#\$HOME/}"
    ;;
  '~'/*)
    linux_workspace="$HOME/${linux_workspace_input#~/}"
    ;;
  *)
    linux_workspace="$linux_workspace_input"
    ;;
esac

export PATH="$HOME/.bun/bin:$PATH"

for required in bun dbus-run-session rsync rg xvfb-run; do
  if ! command -v "$required" >/dev/null 2>&1; then
    echo "Missing '$required' on the OrbStack machine. Run 'bun run setup:e2e' again." >&2
    exit 1
  fi
done

export LIBGL_ALWAYS_SOFTWARE=1
export GDK_BACKEND=x11
export GSK_RENDERER=cairo
export WEBKIT_DISABLE_COMPOSITING_MODE=1
export WEBKIT_DISABLE_DMABUF_RENDERER=1
export HELLM_E2E_LAUNCH_RETRIES=2
export HELLM_E2E_LAUNCH_RETRY_DELAY_MS=750

mkdir -p "$(dirname "$linux_workspace")"
rsync -a --delete \
  --exclude build \
  --exclude dist \
  --exclude node_modules \
  "$mac_root/" "$linux_workspace/"

cd "$linux_workspace"
rm -rf build dist
bun install --frozen-lockfile
bun run build

if [[ "$#" -gt 0 ]]; then
  test_cmd=(bun test --max-concurrency=1 "$@")
else
  mapfile -t test_files < <(
    rg --files e2e -g '*.test.ts' -g '*.spec.ts' -g '*_test.ts' -g '*_spec.ts' |
      sed 's#^#./#'
  )
  test_cmd=(bun test --max-concurrency=1 "${test_files[@]}")
fi

dbus-run-session -- xvfb-run -a -s "-screen 0 1440x900x24" "${test_cmd[@]}"
EOF
