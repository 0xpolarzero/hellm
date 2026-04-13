#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
MACHINE_NAME="${HELLM_E2E_ORB_MACHINE:-hellm-e2e}"
BUN_VERSION="$(
  sed -n 's/.*"packageManager": "bun@\([^"]*\)".*/\1/p' "$ROOT_DIR/package.json" | head -n 1
)"

if [[ -z "$BUN_VERSION" ]]; then
  echo "Could not determine Bun version from package.json." >&2
  exit 1
fi

if ! command -v orb >/dev/null 2>&1; then
  echo "OrbStack CLI ('orb') is not installed or not on PATH." >&2
  exit 1
fi

if ! orb status >/dev/null 2>&1; then
  echo "OrbStack is not running." >&2
  exit 1
fi

host_arch="$(uname -m)"
case "$host_arch" in
  arm64 | aarch64)
    machine_arch="arm64"
    ;;
  x86_64 | amd64)
    machine_arch="amd64"
    ;;
  *)
    echo "Unsupported host architecture for OrbStack machine setup: $host_arch" >&2
    exit 1
    ;;
esac

if ! orb info "$MACHINE_NAME" >/dev/null 2>&1; then
  orb create -a "$machine_arch" ubuntu:24.04 "$MACHINE_NAME"
fi

orb -m "$MACHINE_NAME" bash -s -- "$BUN_VERSION" <<'EOF'
set -euo pipefail

bun_version="$1"

sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
  bash \
  build-essential \
  ca-certificates \
  cmake \
  curl \
  dbus-x11 \
  git \
  libayatana-appindicator3-dev \
  libgtk-3-dev \
  librsvg2-dev \
  libwebkit2gtk-4.1-dev \
  pkg-config \
  ripgrep \
  rsync \
  unzip \
  xauth \
  xvfb

export PATH="$HOME/.bun/bin:$PATH"

if ! command -v bun >/dev/null 2>&1 || [[ "$(bun --version)" != "$bun_version" ]]; then
  rm -rf "$HOME/.bun"
  curl -fsSL https://bun.sh/install | bash -s -- "bun-v${bun_version}"
fi

mkdir -p "$HOME/code"
EOF

echo "OrbStack e2e machine '$MACHINE_NAME' is ready."
