/**
 * PTY WebSocket server for Smithers Studio 2.
 *
 * Adapted from ~/gui/zmux architecture: JSON-RPC 2.0 protocol over
 * WebSocket instead of Unix socket, session lifecycle with scrollback
 * replay on attach, event broadcasting to connected clients.
 *
 * Protocol (JSON-RPC 2.0 over WebSocket text frames):
 *
 *   Client → Server requests:
 *     session.create  { shell?, cwd?, cols?, rows? }  → { sessionId, pid }
 *     session.input   { sessionId, data }             → { ok }
 *     session.resize  { sessionId, cols, rows }       → { ok }
 *     session.close   { sessionId }                   → { ok }
 *     session.list    {}                              → [ ...sessions ]
 *     daemon.ping     {}                              → { version, sessions }
 *
 *   Server → Client notifications:
 *     pane_output     { sessionId, data }
 *     session_exited  { sessionId, exitCode, signal }
 */

import { createHash } from "node:crypto";
import { chmodSync, constants, statSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import * as pty from "node-pty";

const SCROLLBACK_LIMIT = 256 * 1024; // 256 KiB, matches zmux attach_replay_max_bytes
const VERSION = "0.1.0";

// Cap on concurrent live PTYs. A terminal pane is a real OS process plus a
// pseudo-terminal; without a ceiling a buggy (or hostile) client could spawn
// shells until the machine runs out of file descriptors / process slots.
const MAX_SESSIONS = parseInt(process.env.PTY_MAX_SESSIONS ?? "32");

// Largest WebSocket frame we will buffer/decode. Frames are JSON-RPC control
// messages (or keystroke `session.input`), so a megabyte is already generous;
// anything larger is a bug or an attempt to exhaust memory before we ever parse
// a length, so we close the connection instead of growing the buffer unbounded.
const MAX_FRAME_BYTES = 1024 * 1024; // 1 MiB

// Orphan reaper: a session whose owning socket dies should be killed promptly,
// but the close handler already does that synchronously. This is a backstop for
// sessions that somehow lose their owner (e.g. owner cleared but socket lingered)
// and for already-exited sessions whose scrollback we keep briefly for re-attach.
const ORPHAN_TTL_MS = parseInt(process.env.PTY_ORPHAN_TTL_MS ?? "60000");
const REAPER_INTERVAL_MS = 15_000;

/**
 * node-pty ships a prebuilt `spawn-helper` binary on macOS/Linux that it execs
 * to fork the PTY. Some installers (notably pnpm's content-addressable store)
 * drop the execute bit when materializing the prebuild, which makes every
 * `pty.spawn` fail with "posix_spawnp failed." Restore the bit on startup so a
 * fresh install always yields a working PTY server.
 */
function ensureSpawnHelperExecutable(): void {
  if (process.platform === "win32") return;
  try {
    const require = createRequire(import.meta.url);
    const ptyPkg = require.resolve("node-pty/package.json");
    const arch = `${process.platform}-${process.arch}`;
    const helper = join(dirname(ptyPkg), "prebuilds", arch, "spawn-helper");
    const stat = statSync(helper);
    const wantExec = constants.S_IXUSR | constants.S_IXGRP | constants.S_IXOTH;
    if ((stat.mode & wantExec) !== wantExec) {
      chmodSync(helper, stat.mode | wantExec);
    }
  } catch {
    // If the prebuild layout differs (e.g. a locally compiled build), node-pty
    // resolves its own binary; don't block startup on this best-effort fixup.
  }
}

ensureSpawnHelperExecutable();

type WsConn = {
  sendText(s: string): void;
  readyState: number;
};

type Session = {
  id: string;
  pty: pty.IPty;
  scrollback: string;
  pid: number;
  shell: string;
  cwd: string;
  cols: number;
  rows: number;
  createdAt: number;
  exited: boolean;
  exitCode: number | null;
  signal: number | null;
  // Connections currently watching this session's output. pane_output and
  // session_exited notifications are unicast to these clients only — never
  // broadcast to every connected socket (which would leak one pane's shell
  // output, including secrets, into unrelated terminals).
  subscribers: Set<WsConn>;
  // When the session has no live subscribers, the wall-clock time it became
  // orphaned. The reaper kills sessions that stay orphaned past ORPHAN_TTL_MS.
  orphanedAt: number | null;
};

const sessions = new Map<string, Session>();

const host = process.env.PTY_SERVER_HOST ?? "127.0.0.1";
const port = parseInt(process.env.PTY_SERVER_PORT ?? "7342");

// Loopback hostnames whose web origin may open a terminal. The server binds to
// 127.0.0.1, but browsers do NOT enforce same-origin policy on WebSockets, so a
// malicious page the developer visits could otherwise connect to
// ws://127.0.0.1:<port>/terminal/ws and spawn a shell (local RCE). We gate the
// upgrade on a loopback Origin; PTY_ALLOWED_ORIGINS extends it (e.g. the
// Electrobun `views://` origin once the desktop terminal is wired).
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const EXTRA_ALLOWED_ORIGINS = new Set(
  (process.env.PTY_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

function isAllowedOrigin(origin: string | undefined): boolean {
  // The threat is a browser drive-by: a malicious page the developer visits
  // opens this WebSocket. Browsers ALWAYS attach an Origin to a WebSocket and
  // cannot strip it, so that attack always presents Origin: https://evil.com,
  // which fails the loopback check below. A MISSING Origin only comes from a
  // non-browser client (curl, a local script), which is already local code with
  // shell access — not a new vector — so we allow it (and protocol tooling).
  if (!origin) return true;
  if (EXTRA_ALLOWED_ORIGINS.has(origin)) return true;
  try {
    return LOOPBACK_HOSTS.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));
}

function appendScrollback(session: Session, data: string) {
  session.scrollback += data;
  if (session.scrollback.length > SCROLLBACK_LIMIT) {
    session.scrollback = session.scrollback.slice(-SCROLLBACK_LIMIT);
  }
}

function nextSessionId() {
  return `ses-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function defaultShell() {
  return process.env.SHELL || "/bin/zsh";
}

function jsonRpcResult(id: unknown, result: unknown) {
  return JSON.stringify({ jsonrpc: "2.0", id, result });
}

function jsonRpcError(id: unknown, code: number, message: string) {
  return JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
}

function jsonRpcNotification(method: string, params: unknown) {
  return JSON.stringify({ jsonrpc: "2.0", method, params });
}

// Kill the PTY and forget the session. Safe to call more than once.
function destroySession(session: Session) {
  if (!session.exited) {
    try {
      session.pty.kill();
    } catch {}
  }
  sessions.delete(session.id);
}

function notifySession(session: Session, message: string) {
  for (const conn of session.subscribers) {
    try {
      conn.sendText(message);
    } catch {}
  }
}

function createSession(params: Record<string, unknown>, owner: WsConn): Session {
  if (sessions.size >= MAX_SESSIONS) {
    throw new Error(
      `session limit reached (${MAX_SESSIONS}); close an existing terminal first`,
    );
  }
  const shell = typeof params.shell === "string" ? params.shell : defaultShell();
  const cwd = typeof params.cwd === "string" ? params.cwd : (process.env.HOME || process.cwd());
  const cols = clamp(typeof params.cols === "number" ? params.cols : 80, 1, 500);
  const rows = clamp(typeof params.rows === "number" ? params.rows : 24, 1, 200);
  const id = nextSessionId();

  const ptyProcess = pty.spawn(shell, [], {
    name: "xterm-256color",
    cols,
    rows,
    cwd,
    env: process.env as Record<string, string>,
  });

  const session: Session = {
    id,
    pty: ptyProcess,
    scrollback: "",
    pid: ptyProcess.pid,
    shell,
    cwd,
    cols,
    rows,
    createdAt: Date.now(),
    exited: false,
    exitCode: null,
    signal: null,
    subscribers: new Set([owner]),
    orphanedAt: null,
  };

  ptyProcess.onData((data) => {
    appendScrollback(session, data);
    notifySession(
      session,
      jsonRpcNotification("pane_output", { sessionId: session.id, data }),
    );
  });

  ptyProcess.onExit(({ exitCode, signal }) => {
    session.exited = true;
    session.exitCode = exitCode;
    session.signal = signal;
    notifySession(
      session,
      jsonRpcNotification("session_exited", {
        sessionId: session.id,
        exitCode,
        signal,
      }),
    );
  });

  sessions.set(id, session);
  return session;
}

function handleRequest(
  id: unknown,
  method: string,
  params: Record<string, unknown>,
  conn: WsConn,
) {
  if (method === "daemon.ping") {
    return jsonRpcResult(id, { version: VERSION, sessions: sessions.size });
  }

  if (method === "session.create") {
    try {
      const session = createSession(params, conn);
      // Create-race guard: the owning socket can die (abrupt RST / close) WHILE
      // this create is in flight. The socket's cleanup handler runs over the
      // sessions map, but if it ran before this session was inserted it never
      // saw it — so the freshly spawned PTY would have only a dead subscriber
      // and survive until the reaper's TTL. Detect the now-closed owner and
      // destroy the session immediately so the shell is reclaimed at once.
      if (conn.readyState !== 1) {
        destroySession(session);
        return jsonRpcError(id, -32000, "connection closed during create");
      }
      return jsonRpcResult(id, {
        sessionId: session.id,
        pid: session.pid,
        shell: session.shell,
        cwd: session.cwd,
        cols: session.cols,
        rows: session.rows,
      });
    } catch (e) {
      return jsonRpcError(id, -32000, String(e));
    }
  }

  if (method === "session.attach") {
    const sessionId = typeof params.sessionId === "string" ? params.sessionId : null;
    const session = sessionId ? sessions.get(sessionId) : null;
    if (!session) return jsonRpcError(id, -32000, "session not found");
    // The attaching connection now watches this session and re-takes ownership,
    // so output is unicast to it and the orphan reaper leaves it alone.
    session.subscribers.add(conn);
    session.orphanedAt = null;
    if (typeof params.cols === "number" && typeof params.rows === "number") {
      const cols = clamp(params.cols, 1, 500);
      const rows = clamp(params.rows, 1, 200);
      if (cols !== session.cols || rows !== session.rows) {
        session.cols = cols;
        session.rows = rows;
        if (!session.exited) session.pty.resize(cols, rows);
      }
    }
    return jsonRpcResult(id, {
      sessionId: session.id,
      pid: session.pid,
      scrollback: session.scrollback,
      exited: session.exited,
      exitCode: session.exitCode,
    });
  }

  if (method === "session.input") {
    const sessionId = typeof params.sessionId === "string" ? params.sessionId : null;
    const data = typeof params.data === "string" ? params.data : "";
    const session = sessionId ? sessions.get(sessionId) : null;
    if (!session) return jsonRpcError(id, -32000, "session not found");
    if (session.exited) return jsonRpcError(id, -32000, "session has exited");
    session.pty.write(data);
    return jsonRpcResult(id, { ok: true });
  }

  if (method === "session.resize") {
    const sessionId = typeof params.sessionId === "string" ? params.sessionId : null;
    const session = sessionId ? sessions.get(sessionId) : null;
    if (!session) return jsonRpcError(id, -32000, "session not found");
    if (session.exited) return jsonRpcError(id, -32000, "session has exited");
    const cols = clamp(typeof params.cols === "number" ? params.cols : session.cols, 1, 500);
    const rows = clamp(typeof params.rows === "number" ? params.rows : session.rows, 1, 200);
    session.cols = cols;
    session.rows = rows;
    session.pty.resize(cols, rows);
    return jsonRpcResult(id, { ok: true });
  }

  if (method === "session.close") {
    const sessionId = typeof params.sessionId === "string" ? params.sessionId : null;
    const session = sessionId ? sessions.get(sessionId) : null;
    if (!session) return jsonRpcError(id, -32000, "session not found");
    session.subscribers.delete(conn);
    destroySession(session);
    return jsonRpcResult(id, { ok: true });
  }

  if (method === "session.list") {
    const list = [...sessions.values()].map((s) => ({
      sessionId: s.id,
      pid: s.pid,
      shell: s.shell,
      cwd: s.cwd,
      cols: s.cols,
      rows: s.rows,
      exited: s.exited,
      exitCode: s.exitCode,
      createdAt: s.createdAt,
    }));
    return jsonRpcResult(id, list);
  }

  return jsonRpcError(id, -32601, "method not found");
}

/**
 * Transport layer.
 *
 * node-pty's native read loop only delivers data reliably under Node — under
 * Bun the PTY file descriptor is closed before `onData`/`onExit` ever fire
 * (intermittent zero-byte reads and `ioctl EBADF` on resize). So this server
 * runs under Node and implements the small slice of RFC 6455 it needs (text
 * frames over an HTTP Upgrade) with zero extra dependencies, instead of relying
 * on `Bun.serve`'s built-in WebSocket support.
 */

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function encodeTextFrame(text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

const server = createHttpServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("Not Found");
});

server.on("upgrade", (req, socket) => {
  if (req.url !== "/terminal/ws") {
    socket.destroy();
    return;
  }
  const origin = req.headers["origin"];
  if (!isAllowedOrigin(typeof origin === "string" ? origin : undefined)) {
    // Cross-origin connection attempt (e.g. a malicious page) — refuse before
    // any shell is spawned.
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  const key = req.headers["sec-websocket-key"];
  if (typeof key !== "string") {
    socket.destroy();
    return;
  }
  const accept = createHash("sha1")
    .update(key + WS_GUID)
    .digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );

  const conn: WsConn = {
    readyState: 1,
    sendText(text: string) {
      if (socket.writable) socket.write(encodeTextFrame(text));
    },
  };

  let buffer = Buffer.alloc(0);
  // Tracks whether we have already begun tearing the socket down so the parser
  // loop and the close/error handlers don't fight over it.
  let closed = false;

  function closeSocket(code: number, reason: string) {
    if (closed) return;
    closed = true;
    conn.readyState = 3;
    // RFC 6455 close frame: FIN + opcode 0x8, 2-byte big-endian status code.
    const body = Buffer.alloc(2 + Buffer.byteLength(reason));
    body.writeUInt16BE(code, 0);
    body.write(reason, 2);
    const header = Buffer.from([0x88, body.length]);
    try {
      if (socket.writable) socket.write(Buffer.concat([header, body]));
    } catch {}
    socket.end();
  }

  function dispatch(text: string) {
    try {
      const msg = JSON.parse(text);
      const id = msg.id ?? null;
      const method = typeof msg.method === "string" ? msg.method : "";
      const params =
        typeof msg.params === "object" && msg.params !== null ? msg.params : {};
      // Notifications (no id) get processed but produce no reply frame.
      const response = handleRequest(id, method, params, conn);
      if (msg.id != null) conn.sendText(response);
    } catch {
      conn.sendText(jsonRpcError(null, -32700, "parse error"));
    }
  }

  socket.on("data", (chunk) => {
    if (closed) return;
    buffer = Buffer.concat([buffer, chunk]);
    // Parse as many complete frames as are buffered.
    while (buffer.length >= 2 && !closed) {
      const fin = (buffer[0] & 0x80) !== 0;
      const opcode = buffer[0] & 0x0f;
      const masked = (buffer[1] & 0x80) !== 0;
      let len = buffer[1] & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (buffer.length < 4) break;
        len = buffer.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (buffer.length < 10) break;
        const big = buffer.readBigUInt64BE(2);
        // A 64-bit length we will never honor; bail before we coerce to a lossy
        // Number or try to allocate gigabytes.
        if (big > BigInt(MAX_FRAME_BYTES)) {
          closeSocket(1009, "frame too large");
          return;
        }
        len = Number(big);
        offset = 10;
      }
      // Reject oversized frames before waiting to buffer their whole payload, so
      // a hostile length can't make us accumulate memory unbounded.
      if (len > MAX_FRAME_BYTES) {
        closeSocket(1009, "frame too large");
        return;
      }
      // RFC 6455 §5.1: every frame from a client MUST be masked. An unmasked
      // client frame is a protocol violation (or a non-browser client probing
      // us); refuse it rather than guessing.
      if (!masked) {
        closeSocket(1002, "unmasked client frame");
        return;
      }
      if (buffer.length < offset + 4) break;
      const maskKey = buffer.subarray(offset, offset + 4);
      offset += 4;
      if (buffer.length < offset + len) break;
      const payload = buffer.subarray(offset, offset + len);
      const decoded = Buffer.from(payload);
      for (let i = 0; i < decoded.length; i++) {
        decoded[i] ^= maskKey[i % 4];
      }
      buffer = buffer.subarray(offset + len);

      if (opcode === 0x8) {
        // close frame
        closeSocket(1000, "bye");
        return;
      }
      // We speak only whole text frames of JSON-RPC; this protocol never
      // fragments a message. A non-final text/binary frame (or a continuation
      // frame) means the peer is fragmenting — reject rather than misassemble.
      if (opcode === 0x0) {
        closeSocket(1003, "fragmentation unsupported");
        return;
      }
      if (opcode === 0x1) {
        if (!fin) {
          closeSocket(1003, "fragmentation unsupported");
          return;
        }
        dispatch(decoded.toString("utf8"));
      }
      // ping/pong (0x9/0xa) and binary (0x2) frames are ignored for this
      // protocol; they carry no JSON-RPC payload we act on.
    }
  });

  function cleanup() {
    conn.readyState = 3;
    closed = true;
    // Abrupt disconnect: drop this connection from every session it watched and
    // tear down any session that is now orphaned. Without this the PTY (a real
    // shell process) leaks for the life of the server.
    for (const session of sessions.values()) {
      if (!session.subscribers.delete(conn)) continue;
      if (session.subscribers.size === 0) {
        // No one is watching anymore. Kill it now rather than waiting for the
        // reaper — a closed terminal pane has no reason to keep a shell alive.
        destroySession(session);
      }
    }
  }
  socket.on("close", cleanup);
  socket.on("error", cleanup);
});

// Orphan reaper backstop: kill any session that has had no subscribers for
// longer than ORPHAN_TTL_MS. The socket close handler already kills sessions
// synchronously on disconnect; this catches sessions that lost their last
// subscriber some other way (e.g. a session created then never re-attached).
const reaper = setInterval(() => {
  const now = Date.now();
  for (const session of sessions.values()) {
    if (session.subscribers.size > 0) {
      session.orphanedAt = null;
      continue;
    }
    if (session.orphanedAt == null) {
      session.orphanedAt = now;
      continue;
    }
    if (now - session.orphanedAt >= ORPHAN_TTL_MS) {
      destroySession(session);
    }
  }
}, REAPER_INTERVAL_MS);
// Don't let the reaper timer hold the process open on its own.
reaper.unref?.();

function shutdown(signal: string) {
  console.log(`[pty] ${signal} received, shutting down`);
  clearInterval(reaper);
  // Kill every live shell so we never leave orphaned PTYs behind.
  for (const session of [...sessions.values()]) {
    destroySession(session);
  }
  server.close(() => process.exit(0));
  // Don't hang forever if a socket refuses to close.
  setTimeout(() => process.exit(0), 2000).unref?.();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

server.listen(port, host, () => {
  console.log(`[pty] Listening on http://${host}:${port}`);
});
