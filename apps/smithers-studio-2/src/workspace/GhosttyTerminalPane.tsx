import { GhosttyCore } from "@wterm/ghostty";
import { Terminal, useTerminal } from "@wterm/react";
import { use, useCallback, useEffect, useRef, useState } from "react";
import { useStudioStore } from "../useStudioStore";

type TerminalTab = { id: string; title: string; createdAt: Date };

type CoreResult =
  | { ok: true; core: Awaited<ReturnType<typeof GhosttyCore.load>> }
  | { ok: false; error: string };

/**
 * One Ghostty core per pane, cached by tab id. Each terminal pane MUST own its
 * own core: a GhosttyCore wraps a single WASM terminal grid, so sharing one
 * instance across panes makes every tab render the same buffer (typing in one
 * tab appears in all of them). The cache is keyed by tab id (not created in
 * render) so the promise stays stable across the Suspense unmount/remount cycle
 * — creating a new promise on every suspended render would loop forever.
 *
 * Each `GhosttyCore.load()` instantiates its OWN WebAssembly module with its
 * own linear memory (see @wterm/ghostty wasm-bindings); the only way the runtime
 * can reclaim that memory is for every reference to the core to be dropped so it
 * becomes garbage-collectible. So when a tab is CLOSED we must evict its entry
 * (see evictTerminalCore) — otherwise this module-level map pins the core, and
 * thus a whole WASM instance, for the life of the page and leaks WASM memory on
 * every open/close cycle.
 */
const coreByTab = new Map<string, Promise<CoreResult>>();

function terminalCoreFor(tabId: string): Promise<CoreResult> {
  let promise = coreByTab.get(tabId);
  if (!promise) {
    promise = GhosttyCore.load({ scrollbackLimit: 4_000 })
      .then((core): CoreResult => ({ ok: true, core }))
      .catch(
        (error): CoreResult => ({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    coreByTab.set(tabId, promise);
  }
  return promise;
}

/**
 * Drop the cached core for a tab so its WASM instance can be garbage-collected.
 * Called when a tab is permanently gone (closed, or the last pane unmounts) —
 * NOT during the transient Suspense / StrictMode unmount/remount cycle, where
 * the tab still exists and a fresh `load()` would needlessly re-instantiate the
 * WASM module and blank the terminal grid.
 */
function evictTerminalCore(tabId: string): void {
  coreByTab.delete(tabId);
}

type PtyStatus = "connecting" | "creating" | "attached" | "exited" | "error";

function terminalStatusLabel(status: PtyStatus): string {
  switch (status) {
    case "connecting":
      return "Connecting…";
    case "creating":
      return "Starting session…";
    case "attached":
      return "Attached";
    case "exited":
      return "Session ended";
    case "error":
      return "PTY server unavailable — start with: bun scripts/dev.ts";
  }
}

let rpcIdCounter = 0;

type RpcCallbacks = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
};

type Dims = { cols: number; rows: number };

function usePtySession(
  tabId: string,
  write: (data: string) => void,
  getDims: () => Dims,
) {
  const wsRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const pendingRef = useRef<Map<number, RpcCallbacks>>(new Map());
  // Set while this pane is intentionally tearing down its socket (unmount or
  // StrictMode's mount/unmount/mount cycle) so the resulting onclose is not
  // mistaken for a failed PTY connection.
  const closingRef = useRef(false);
  // Keep the latest dimension reader in a ref so the connect effect can call it
  // at session.create time without listing getDims as a dependency (which would
  // tear down and rebuild the socket whenever the measured size changed).
  const getDimsRef = useRef(getDims);
  getDimsRef.current = getDims;
  const [status, setStatus] = useState<PtyStatus>("connecting");

  const rpcCall = useCallback(
    (method: string, params: Record<string, unknown>): Promise<unknown> => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error("not connected"));
      }
      const id = ++rpcIdCounter;
      return new Promise((resolve, reject) => {
        pendingRef.current.set(id, { resolve, reject });
        ws.send(
          JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        );
      });
    },
    [],
  );

  useEffect(() => {
    closingRef.current = false;
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(
      `${protocol}//${location.host}/terminal/ws`,
    );
    wsRef.current = ws;

    ws.onopen = async () => {
      setStatus("creating");
      try {
        // Spawn the PTY at the terminal's actual measured size (Ghostty's
        // autoResize has already sized the grid to the pane) rather than a
        // hardcoded 80x24, so the very first frame the shell renders matches the
        // viewport instead of reflowing on the first resize.
        const { cols, rows } = getDimsRef.current();
        const result = (await rpcCall("session.create", {
          cols,
          rows,
        })) as { sessionId: string; scrollback?: string };
        sessionIdRef.current = result.sessionId;
        if (result.scrollback) write(result.scrollback);
        setStatus("attached");
      } catch {
        setStatus("error");
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if ("id" in msg && msg.id != null) {
          const cb = pendingRef.current.get(msg.id);
          if (cb) {
            pendingRef.current.delete(msg.id);
            if (msg.error) {
              cb.reject(new Error(msg.error.message));
            } else {
              cb.resolve(msg.result);
            }
          }
          return;
        }

        if (msg.method === "pane_output") {
          if (msg.params.sessionId === sessionIdRef.current) {
            write(msg.params.data);
          }
        } else if (msg.method === "session_exited") {
          if (msg.params.sessionId === sessionIdRef.current) {
            const code = msg.params.exitCode ?? "unknown";
            write(
              `\r\n\x1b[90m[process exited with code ${code}]\x1b[0m\r\n`,
            );
            setStatus("exited");
          }
        }
      } catch {}
    };

    ws.onclose = () => {
      for (const cb of pendingRef.current.values()) {
        cb.reject(new Error("connection closed"));
      }
      pendingRef.current.clear();
      // A close that lands before we ever attached (or created) the session
      // means the PTY server never accepted us — surface the actionable error
      // instead of a perpetual "Connecting…". Skip this for an intentional
      // teardown; a close after attach is a normal session end reported via the
      // session_exited notification.
      if (closingRef.current) return;
      setStatus((prev) =>
        prev === "connecting" || prev === "creating" ? "error" : prev,
      );
    };

    ws.onerror = () => setStatus("error");

    return () => {
      closingRef.current = true;
      const sid = sessionIdRef.current;
      if (sid && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "session.close",
            params: { sessionId: sid },
          }),
        );
      }
      ws.close();
      wsRef.current = null;
      sessionIdRef.current = null;
      for (const cb of pendingRef.current.values()) {
        cb.reject(new Error("terminal unmounted"));
      }
      pendingRef.current.clear();
    };
  }, [tabId, write, rpcCall]);

  const sendInput = useCallback((data: string) => {
    const ws = wsRef.current;
    const sid = sessionIdRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !sid) return;
    ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session.input",
        params: { sessionId: sid, data },
      }),
    );
  }, []);

  const sendResize = useCallback(
    (cols: number, rows: number) => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      rpcCall("session.resize", { sessionId: sid, cols, rows }).catch(
        () => {},
      );
    },
    [rpcCall],
  );

  return { status, sendInput, sendResize };
}

export function GhosttyTerminalPane({
  active,
  tab,
}: {
  active: boolean;
  tab: TerminalTab;
}) {
  const { ref, write } = useTerminal();
  // One core per pane, keyed by tab id so each tab renders into its own grid.
  // The promise is cached by tab id (not per mount) so it stays stable across
  // the Suspense and StrictMode mount/unmount cycles — otherwise `use` would
  // suspend forever on an ever-new promise.
  const result = use(terminalCoreFor(tab.id));
  // Read the terminal's live measured grid size off the WTerm instance. When
  // the pane hasn't been measured yet (instance not mounted) fall back to the
  // conventional 80x24; the first onResize after layout corrects it.
  const getDims = useCallback((): Dims => {
    const wt = ref.current?.instance;
    if (wt && wt.cols > 0 && wt.rows > 0) {
      return { cols: wt.cols, rows: wt.rows };
    }
    return { cols: 80, rows: 24 };
  }, [ref]);
  const { status, sendInput, sendResize } = usePtySession(
    tab.id,
    write,
    getDims,
  );

  // Evict this tab's Ghostty core on unmount, but ONLY when the tab is truly
  // gone (closed via the store) — never on a transient Suspense / StrictMode
  // unmount where the tab still exists and the pane is about to remount onto the
  // same core. We read the live store state inside the cleanup (not via a hook
  // subscription) so the check reflects the moment of teardown: if the tab id is
  // no longer in `tabs`, the only remaining reference to the WASM-backed core is
  // the module-level cache, so dropping it lets the instance be collected.
  useEffect(() => {
    const tabId = tab.id;
    return () => {
      const stillOpen = useStudioStore
        .getState()
        .tabs.some((t) => t.id === tabId);
      if (!stillOpen) evictTerminalCore(tabId);
    };
  }, [tab.id]);

  const handleData = useCallback(
    (data: string) => {
      if (!active) return;
      sendInput(data);
    },
    [active, sendInput],
  );

  const handleResize = useCallback(
    (cols: number, rows: number) => {
      sendResize(cols, rows);
    },
    [sendResize],
  );

  if (!result.ok) {
    return (
      <div
        aria-hidden={!active}
        className={`terminal-pane ${active ? "active" : ""}`}
      >
        <div className="terminal-loading">
          Ghostty unavailable: {result.error}
        </div>
      </div>
    );
  }

  return (
    <div
      aria-hidden={!active}
      // `inert` takes the inactive pane out of the focus order entirely, so a
      // hidden terminal can never steal keyboard focus and locally echo input
      // meant for the active tab — keeping the two terminal sessions isolated.
      inert={!active}
      className={`terminal-pane ${active ? "active" : ""}`}
    >
      <div
        className={`terminal-status terminal-status-${status}`}
        data-status={status}
        data-testid="terminal-status"
        role="status"
      >
        {terminalStatusLabel(status)}
      </div>
      <Terminal
        autoResize
        className="ghostty-terminal"
        core={result.core}
        cursorBlink={active}
        onData={handleData}
        onResize={handleResize}
        ref={ref}
        rows={24}
        theme="monokai"
      />
    </div>
  );
}
