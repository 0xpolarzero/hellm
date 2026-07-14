#!/usr/bin/env bash
set -uo pipefail

ulimit -c unlimited

evidence_root="${SVVY_E2E_EVIDENCE_DIR:-e2e-results}"
if [[ "$evidence_root" != /* ]]; then
  evidence_root="$PWD/$evidence_root"
fi
export SVVY_E2E_EVIDENCE_DIR="$evidence_root"

active_launch_dir="$SVVY_E2E_EVIDENCE_DIR/${SVVY_E2E_RUN_ID:-untracked-run}/active-launches"
mkdir -p "$active_launch_dir"
export SVVY_E2E_ACTIVE_LAUNCH_DIR="$active_launch_dir"

collect_launch_tree() {
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

cleanup_active_launches() {
  local pid_file
  local root_pid
  local command_line
  local launch_tree=()

  shopt -s nullglob
  for pid_file in "$active_launch_dir"/*.pid; do
    root_pid="$(<"$pid_file")"
    if [[ "$root_pid" =~ ^[1-9][0-9]*$ ]] && [[ -r "/proc/$root_pid/cmdline" ]]; then
      command_line="$(tr '\0' ' ' <"/proc/$root_pid/cmdline")"
      if [[ "$command_line" == *"launch-e2e-app.sh"* ]]; then
        mapfile -t launch_tree < <(collect_launch_tree "$root_pid")
        if [[ "${#launch_tree[@]}" -gt 0 ]]; then
          kill -TERM "${launch_tree[@]}" 2>/dev/null || true
          kill -KILL "${launch_tree[@]}" 2>/dev/null || true
        fi
      fi
    fi
    rm -f "$pid_file"
  done
  shopt -u nullglob
  rmdir "$active_launch_dir" 2>/dev/null || true
}

trap cleanup_active_launches EXIT
trap 'exit 130' HUP INT TERM

test_files=()
bun_test_options=()

if [[ "$#" -gt 0 ]]; then
  for forwarded_arg in "$@"; do
    if [[ -f "$forwarded_arg" ]]; then
      test_files+=("$forwarded_arg")
    elif [[ -d "$forwarded_arg" ]]; then
      mapfile -t directory_test_files < <(
        rg --files "$forwarded_arg" \
          -g '*.test.ts' -g '*.spec.ts' -g '*_test.ts' -g '*_spec.ts'
      )
      test_files+=("${directory_test_files[@]}")
    else
      bun_test_options+=("$forwarded_arg")
    fi
  done
fi

if [[ "${#test_files[@]}" -eq 0 ]]; then
  mapfile -t test_files < <(
    rg --files e2e -g '*.test.ts' -g '*.spec.ts' -g '*_test.ts' -g '*_spec.ts' |
      sed 's#^#./#'
  )
fi

run_test_file() {
  bun test --max-concurrency=1 "$@"
}

test_status=0
for test_file in "${test_files[@]}"; do
  run_test_file "${bun_test_options[@]}" "$test_file"
  file_status=$?
  if [[ "$file_status" -ne 0 ]] && [[ "$test_status" -eq 0 ]]; then
    test_status="$file_status"
  fi
done

mapfile -t core_paths < <(
  find build -type f -name 'core' -print 2>/dev/null
  find "$SVVY_E2E_EVIDENCE_DIR/${SVVY_E2E_RUN_ID:-untracked-run}/native-cores" \
    -type f -name '*.core' -print 2>/dev/null
)

if [[ "${#core_paths[@]}" -gt 0 ]]; then
  printf 'Detected %s native crash core(s); failing the e2e run.\n' "${#core_paths[@]}" >&2
  test_status=1
  crash_evidence_dir="$SVVY_E2E_EVIDENCE_DIR/${SVVY_E2E_RUN_ID:-untracked-run}/native-crashes"
  mkdir -p "$crash_evidence_dir"

  for core_path in "${core_paths[@]}"; do
    if [[ "$core_path" == *.core ]]; then
      core_name="$(basename "$core_path" .core)"
      bin_dir_path="${core_path%.core}.bin-dir.txt"
      bin_dir="$(cat "$bin_dir_path" 2>/dev/null || true)"
    else
      core_name="$(printf '%s' "$core_path" | sha256sum | cut -c1-12)"
      bin_dir="$(dirname "$core_path")"
      bin_dir_path=""
    fi
    backtrace_path="$crash_evidence_dir/$core_name.gdb.txt"
    resolver_path="$crash_evidence_dir/$core_name.resolver.txt"
    executable_receipt_path="$crash_evidence_dir/$core_name.executable.txt"
    resolver_output="$(gdb --batch --nx \
      -ex 'set debuginfod enabled off' \
      -ex 'set pagination off' \
      -ex 'info proc exe' \
      -c "$core_path" 2>&1 || true)"
    printf '%s\n' "$resolver_output" >"$resolver_path"
    reported_command="$(printf '%s\n' "$resolver_output" | sed -n "s/^exe = '\(.*\)'$/\1/p" | head -n 1)"

    candidates=()
    if [[ -d "$bin_dir" ]]; then
      candidates+=(
        "$bin_dir/bun"
        "$bin_dir/launcher"
        "$bin_dir/bun Helper"
        "$bin_dir/bun Helper (Renderer)"
        "$bin_dir/bun Helper (GPU)"
        "$bin_dir/bun Helper (Plugin)"
        "$bin_dir/bun Helper (Alerts)"
      )
    fi

    executable=""
    if [[ -n "$reported_command" ]] && [[ -d "$bin_dir" ]]; then
      reported_candidates=(
        "$bin_dir/bun Helper (Renderer)"
        "$bin_dir/bun Helper (Plugin)"
        "$bin_dir/bun Helper (Alerts)"
        "$bin_dir/bun Helper (GPU)"
        "$bin_dir/bun Helper"
        "$bin_dir/launcher"
        "$bin_dir/bun"
      )
      for candidate in "${reported_candidates[@]}"; do
        if [[ "$reported_command" == "$candidate" ]] || [[ "$reported_command" == "$candidate "* ]]; then
          executable="$candidate"
          printf 'Resolved exact core executable from command: %s\n' "$reported_command" \
            >>"$resolver_path"
          break
        fi
      done
    fi

    if [[ -n "$executable" ]]; then
      candidates=("$executable")
    fi

    executable=""
    for candidate in "${candidates[@]}"; do
      if [[ ! -x "$candidate" ]]; then
        continue
      fi
      probe_output="$(gdb --batch --nx \
        -ex 'set debuginfod enabled off' \
        -ex 'set pagination off' \
        -ex 'info files' \
        "$candidate" "$core_path" 2>&1)"
      probe_status=$?
      printf '\n=== candidate: %s (status %s) ===\n%s\n' \
        "$candidate" "$probe_status" "$probe_output" >>"$resolver_path"
      if [[ "$probe_status" -eq 0 ]] && \
        [[ "$probe_output" != *"core file may not match specified executable file"* ]]; then
        executable="$candidate"
        break
      fi
    done

    backtrace_valid=0
    if [[ -n "$executable" ]]; then
      printf '%s\n' "$executable" >"$executable_receipt_path"
      gdb --batch --nx \
        -ex 'set debuginfod enabled off' \
        -ex 'set pagination off' \
        -ex 'p $_siginfo' \
        -ex 'info registers' \
        -ex 'x/16i $pc-32' \
        -ex 'info threads' \
        -ex 'thread apply all bt full' \
        -ex 'info sharedlibrary' \
        "$executable" "$core_path" >"$backtrace_path" 2>&1
      gdb_status=$?
      if [[ "$gdb_status" -eq 0 ]] && \
        ! rg -q "core file may not match specified executable file" "$backtrace_path"; then
        backtrace_valid=1
      fi
    else
      printf 'Could not resolve an executable matching %s. See %s.\n' \
        "$core_path" "$resolver_path" >"$backtrace_path"
    fi

    if [[ "$backtrace_valid" -eq 1 ]]; then
      rm -f "$core_path"
      if [[ -n "$bin_dir_path" ]]; then
        rm -f "$bin_dir_path"
      fi
    fi
  done
fi

exit "$test_status"
