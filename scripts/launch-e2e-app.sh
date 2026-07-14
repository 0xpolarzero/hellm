#!/usr/bin/env bash
set -euo pipefail

: "${SVVY_E2E_REAL_LAUNCHER:?SVVY_E2E_REAL_LAUNCHER is required}"
: "${SVVY_E2E_NATIVE_SESSION_METADATA:?SVVY_E2E_NATIVE_SESSION_METADATA is required}"
: "${SVVY_E2E_ACTIVE_LAUNCH_DIR:?SVVY_E2E_ACTIVE_LAUNCH_DIR is required}"

if [[ "${1:-}" == "--inside-native-session" ]]; then
  metadata_tmp="${SVVY_E2E_NATIVE_SESSION_METADATA}.$$"
  printf '%s\0%s\0' "$DISPLAY" "${XAUTHORITY:-}" >"$metadata_tmp"
  mv "$metadata_tmp" "$SVVY_E2E_NATIVE_SESSION_METADATA"
  set +e
  "$SVVY_E2E_REAL_LAUNCHER"
  launcher_status=$?
  set -e
  exit "$launcher_status"
fi

if [[ "${SVVY_E2E_PDEATH_ARMED:-0}" != "1" ]]; then
  export SVVY_E2E_PDEATH_ARMED=1
  exec setpriv --pdeathsig TERM -- "$0" "$@"
fi

mkdir -p "$SVVY_E2E_ACTIVE_LAUNCH_DIR"
export SVVY_E2E_LAUNCH_ROOT_PID="$$"
launch_pid_file="$SVVY_E2E_ACTIVE_LAUNCH_DIR/${SVVY_E2E_LAUNCH_ROOT_PID}.pid"
printf '%s\n' "$SVVY_E2E_LAUNCH_ROOT_PID" >"$launch_pid_file.tmp"
mv "$launch_pid_file.tmp" "$launch_pid_file"

collect_native_session_tree() {
  local pending=("$1")
  local tree=()
  local pid
  local child
  local children

  while [[ "${#pending[@]}" -gt 0 ]]; do
    pid="${pending[0]}"
    pending=("${pending[@]:1}")
    if [[ ! -r "/proc/$pid/task/$pid/children" ]]; then
      continue
    fi
    tree+=("$pid")
    children="$(<"/proc/$pid/task/$pid/children")"
    for child in $children; do
      if [[ "$child" =~ ^[1-9][0-9]*$ ]]; then
        pending+=("$child")
      fi
    done
  done

  printf '%s\n' "${tree[@]}"
}

native_session_pid=""
cleanup_native_session() {
  local native_session_tree=()
  if [[ "$native_session_pid" =~ ^[1-9][0-9]*$ ]]; then
    mapfile -t native_session_tree < <(collect_native_session_tree "$native_session_pid")
    if [[ "${#native_session_tree[@]}" -gt 0 ]]; then
      kill -TERM "${native_session_tree[@]}" 2>/dev/null || true
      kill -KILL "${native_session_tree[@]}" 2>/dev/null || true
    fi
  fi
  rm -f "$launch_pid_file" "$launch_pid_file.tmp"
}

trap cleanup_native_session EXIT
trap 'exit 130' HUP INT TERM

dbus-run-session -- \
  xvfb-run -a -s "-screen 0 1440x900x24 +extension GLX +render -noreset" \
  "$0" --inside-native-session &
native_session_pid="$!"
printf '%s\n' "$native_session_pid" >"$launch_pid_file.tmp"
mv "$launch_pid_file.tmp" "$launch_pid_file"

set +e
wait "$native_session_pid"
native_session_status=$?
set -e
exit "$native_session_status"
