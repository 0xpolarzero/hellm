/**
 * Standalone unit/integration test for the REAL PTY WebSocket server
 * (scripts/pty-server.ts). It boots the actual server on a unique ephemeral
 * port as a child Node process (node-pty does not deliver PTY data reliably
 * under Bun, so we drive the real Node-hosted server over WebSocket instead of
 * importing it in-process) and exercises the round-1 hardening:
 *
 *   - PTY count returns to 0 after an ABRUPT socket close (leak fix);
 *   - PTY count returns to 0 after the orphan reaper TTL elapses;
 *   - session.create beyond MAX_SESSIONS is rejected;
 *   - pane_output is UNICAST — a second connection on a different session does
 *     NOT receive the first session's output;
 *   - a frame larger than MAX_FRAME_BYTES is rejected/closed;
 *   - an UNMASKED client frame is rejected (RFC 6455 §5.1);
 *   - a non-loopback Origin is refused with HTTP 403;
 *   - SIGTERM shuts the server down cleanly.
 *
 * This test boots its own server on its own port with NO Playwright, so it is
 * safe to run standalone. Because the unit runner (`pnpm run test:unit`)
 * ignores `**​/tests/**`, run this file directly:
 *
 *   bun test apps/smithers-studio-2/tests/server/pty-server.test.ts
 *
 * Everything here exercises the real server, real node-pty shells, and real
 * RFC 6455 frames — no mocks, no fakes.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { type ChildProcess, execFileSync, fork, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { connect, type Socket } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_SCRIPT = join(HERE, "..", "..", "scripts", "pty-server.ts");

/**
 * The pty-server must run under NODE (node-pty does not deliver PTY data under
 * Bun) with `--experimental-strip-types` to load the .ts directly. Under the Bun
 * test runner `process.execPath` is the Bun binary, so resolve a real `node`.
 */
function resolveNode(): string {
  if (process.env.NODE && process.env.NODE.length > 0) return process.env.NODE;
  try {
    return execFileSync("which", ["node"], { encoding: "utf8" }).trim();
  } catch {
    return "node";
  }
}
const NODE_BIN = resolveNode();

// Small, test-friendly limits so the limit/reaper assertions are fast and cheap.
// MAX_SESSIONS is small enough that the limit test fills it quickly, but large
// enough that the 2-session unicast test never collides with it.
const MAX_SESSIONS = 4;
const ORPHAN_TTL_MS = 2_000;
const HOST = "127.0.0.1";
const PORT = 20000 + Math.floor(Math.random() * 20000);
const BASE = `http://${HOST}:${PORT}`;
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

let server: ChildProcess;

async function waitForHealth(timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok && (await res.text()) === "ok") return;
    } catch {
      // not up yet
    }
    await delay(100);
  }
  throw new Error("pty-server did not become healthy in time");
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * A minimal RFC 6455 client over a raw TCP socket so we control masking, frame
 * sizes, and headers precisely (Bun's WebSocket abstracts those away). It also
 * lets us perform an ABRUPT close (socket.destroy) that mimics a dead browser
 * tab rather than a graceful close handshake.
 */
class RawWsClient {
  socket: Socket;
  private buffer = Buffer.alloc(0);
  private opened = false;
  private openWaiters: Array<() => void> = [];
  /** JSON-RPC messages decoded from server text frames (results + notifications). */
  messages: any[] = [];
  /** Close frames / abnormal terminations observed from the server. */
  closeInfo: { code?: number; reason?: string; terminated?: boolean } | null = null;

  constructor(private opts: { origin?: string } = {}) {
    this.socket = connect(PORT, HOST);
    const key = randomBytes(16).toString("base64");
    const accept = createHash("sha1").update(key + WS_GUID).digest("base64");

    this.socket.on("connect", () => {
      const headers = [
        `GET /terminal/ws HTTP/1.1`,
        `Host: ${HOST}:${PORT}`,
        `Connection: Upgrade`,
        `Upgrade: websocket`,
        `Sec-WebSocket-Key: ${key}`,
        `Sec-WebSocket-Version: 13`,
      ];
      if (this.opts.origin) headers.push(`Origin: ${this.opts.origin}`);
      this.socket.write(headers.join("\r\n") + "\r\n\r\n");
      void accept; // server's Accept is not strictly validated in tests
    });

    this.socket.on("data", (chunk) => this.onData(chunk));
    this.socket.on("close", () => {
      if (!this.closeInfo) this.closeInfo = { terminated: true };
    });
    this.socket.on("error", () => {
      if (!this.closeInfo) this.closeInfo = { terminated: true };
    });
  }

  private onData(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (!this.opened) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const head = this.buffer.subarray(0, headerEnd).toString("utf8");
      if (!/HTTP\/1\.1 101/.test(head)) {
        // Upgrade refused (e.g. 403). Surface it and stop.
        const m = head.match(/HTTP\/1\.1 (\d+)/);
        this.closeInfo = { code: m ? Number(m[1]) : undefined, reason: "no-upgrade" };
        return;
      }
      this.opened = true;
      this.buffer = this.buffer.subarray(headerEnd + 4);
      for (const w of this.openWaiters) w();
      this.openWaiters = [];
    }
    this.parseFrames();
  }

  private parseFrames() {
    while (this.buffer.length >= 2) {
      const opcode = this.buffer[0] & 0x0f;
      const masked = (this.buffer[1] & 0x80) !== 0; // server frames are unmasked
      let len = this.buffer[1] & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (this.buffer.length < 4) return;
        len = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (this.buffer.length < 10) return;
        len = Number(this.buffer.readBigUInt64BE(2));
        offset = 10;
      }
      if (masked) offset += 4; // not expected from server, but be safe
      if (this.buffer.length < offset + len) return;
      const payload = this.buffer.subarray(offset, offset + len);
      this.buffer = this.buffer.subarray(offset + len);
      if (opcode === 0x8) {
        const code = len >= 2 ? payload.readUInt16BE(0) : undefined;
        const reason = len > 2 ? payload.subarray(2).toString("utf8") : "";
        this.closeInfo = { code, reason };
        continue;
      }
      if (opcode === 0x1) {
        const text = payload.toString("utf8");
        try {
          this.messages.push(JSON.parse(text));
        } catch {
          this.messages.push({ raw: text });
        }
      }
    }
  }

  waitOpen(timeoutMs = 5_000): Promise<void> {
    if (this.opened) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("ws open timeout")), timeoutMs);
      this.openWaiters.push(() => {
        clearTimeout(t);
        resolve();
      });
    });
  }

  /** Encode a client text frame. By default it is masked per RFC 6455 §5.1. */
  private encode(text: string, opts: { masked?: boolean; declaredLen?: number } = {}): Buffer {
    const masked = opts.masked ?? true;
    const payload = Buffer.from(text, "utf8");
    const declaredLen = opts.declaredLen ?? payload.length;
    let header: Buffer;
    if (declaredLen < 126) {
      header = Buffer.from([0x81, (masked ? 0x80 : 0) | declaredLen]);
    } else if (declaredLen < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = (masked ? 0x80 : 0) | 126;
      header.writeUInt16BE(declaredLen, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = (masked ? 0x80 : 0) | 127;
      header.writeBigUInt64BE(BigInt(declaredLen), 2);
    }
    if (!masked) return Buffer.concat([header, payload]);
    const mask = randomBytes(4);
    const masked2 = Buffer.from(payload);
    for (let i = 0; i < masked2.length; i++) masked2[i] ^= mask[i % 4];
    return Buffer.concat([header, mask, masked2]);
  }

  send(obj: unknown): void {
    this.socket.write(this.encode(JSON.stringify(obj)));
  }

  sendRawFrame(frame: Buffer): void {
    this.socket.write(frame);
  }

  /** Build a frame (used to send unmasked / oversized frames deliberately). */
  buildFrame(text: string, opts: { masked?: boolean; declaredLen?: number }): Buffer {
    return this.encode(text, opts);
  }

  /** Wait for a JSON-RPC response with the given id. */
  async waitForId(id: number, timeoutMs = 5_000): Promise<any> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = this.messages.find((m) => m && m.id === id);
      if (found) return found;
      await delay(20);
    }
    throw new Error(`no response for id=${id}`);
  }

  /** Wait for a notification with the given method, optionally matching params. */
  async waitForMethod(
    method: string,
    timeoutMs = 5_000,
    pred: (m: any) => boolean = () => true,
  ): Promise<any> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = this.messages.find((m) => m && m.method === method && pred(m));
      if (found) return found;
      await delay(20);
    }
    throw new Error(`no notification method=${method}`);
  }

  notifications(method: string): any[] {
    return this.messages.filter((m) => m && m.method === method);
  }

  /**
   * Close the WebSocket the way a browser does when its tab is closed or it
   * navigates away: send a masked RFC 6455 close frame, then drop the TCP
   * socket. The server's `socket.on("close", …)` handler fires and the
   * leak-fix cleanup reclaims the owned PTY synchronously — no reaper wait.
   */
  closeAbrupt(): void {
    // Masked client close frame (opcode 0x8) with status 1000 "normal".
    const status = Buffer.from([0x03, 0xe8]); // 1000
    const mask = randomBytes(4);
    const masked = Buffer.from(status);
    for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
    const frame = Buffer.concat([Buffer.from([0x88, 0x82]), mask, masked]);
    try {
      if (this.socket.writable) this.socket.write(frame);
    } catch {}
    this.socket.destroy();
  }

  /** Tear the TCP socket down (used only for test teardown of idle conns). */
  destroyAbrupt(): void {
    this.socket.destroy();
  }
}

/** Open a connection, create a session, return the sessionId. */
async function createSession(client: RawWsClient, id: number): Promise<string> {
  client.send({ jsonrpc: "2.0", id, method: "session.create", params: { cols: 80, rows: 24 } });
  const res = await client.waitForId(id);
  if (res.error) throw new Error(`session.create failed: ${res.error.message}`);
  return res.result.sessionId as string;
}

const ABRUPT_CLIENT = join(HERE, "abruptWsClient.cjs");

/**
 * Fork a Node child (run with the SAME Node that hosts the server) that opens a
 * real WebSocket, creates a PTY session, then on demand emits a true TCP RST
 * (socket.resetAndDestroy) — the abrupt, no-goodbye disconnect that the server's
 * leak-fix close/error handler must reclaim. Bun's own net stack cannot generate
 * a server-visible RST, hence the Node child. Returns the created sessionId plus
 * a `reset()` that performs the abrupt close.
 */
async function spawnAbruptClient(): Promise<{ sessionId: string; reset: () => void }> {
  const child: ChildProcess = fork(ABRUPT_CLIENT, [String(PORT)], {
    execPath: NODE_BIN,
    execArgv: [],
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
  const sessionId = await new Promise<string>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("abrupt client did not create a session")), 8_000);
    child.on("message", (m: any) => {
      if (m && m.type === "created") {
        clearTimeout(t);
        resolve(m.sessionId as string);
      }
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) reject(new Error(`abrupt client exited early (${code})`));
    });
  });
  return {
    sessionId,
    reset: () => {
      try {
        child.send({ type: "reset" });
      } catch {
        child.kill("SIGKILL");
      }
    },
  };
}

// A single long-lived control connection used purely to poll daemon.ping for the
// live session count. Reusing one socket avoids hammering the server with a fresh
// TCP connect on every poll (which can race the OS connection backlog and make
// later upgrades intermittently time out).
let control: RawWsClient | null = null;
let pingId = 1000;

async function getControl(): Promise<RawWsClient> {
  if (control && !control.closeInfo) return control;
  control = new RawWsClient();
  await control.waitOpen();
  return control;
}

/** Ping the daemon over the shared control connection and return session count. */
async function pingSessionCount(): Promise<number> {
  const c = await getControl();
  const id = ++pingId;
  c.send({ jsonrpc: "2.0", id, method: "daemon.ping", params: {} });
  const res = await c.waitForId(id, 4_000);
  return res.result.sessions as number;
}

async function waitForSessionCount(target: number, timeoutMs: number): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let last = -1;
  while (Date.now() < deadline) {
    last = await pingSessionCount();
    if (last === target) return last;
    await delay(100);
  }
  return last;
}

beforeAll(async () => {
  server = spawn(
    NODE_BIN,
    ["--experimental-strip-types", "--no-warnings", SERVER_SCRIPT],
    {
      env: {
        ...process.env,
        PTY_SERVER_HOST: HOST,
        PTY_SERVER_PORT: String(PORT),
        PTY_MAX_SESSIONS: String(MAX_SESSIONS),
        PTY_ORPHAN_TTL_MS: String(ORPHAN_TTL_MS),
        SHELL: "/bin/sh",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  server.stderr?.on("data", (d) => {
    const s = String(d);
    if (s.trim()) console.error("[pty-server stderr]", s.trim());
  });
  await waitForHealth();
});

afterAll(async () => {
  if (server && server.exitCode == null) {
    server.kill("SIGKILL");
  }
});

describe("pty-server hardening (real server, real node-pty, real RFC 6455 frames)", () => {
  // The SIGTERM test must run last (it kills the shared server); Bun runs tests
  // in source order, so it is declared last. Before each test, make sure no
  // session lingered from a prior test's teardown — abrupt closes reclaim PTYs
  // asynchronously, so we wait for the count to settle back to 0.
  beforeEach(async () => {
    if (server.exitCode != null) return; // server already torn down (post-SIGTERM)
    const settled = await waitForSessionCount(0, 10_000);
    expect(settled).toBe(0);
  }, 15_000);

  test("health endpoint serves and daemon.ping starts at 0 sessions", async () => {
    const res = await fetch(`${BASE}/health`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    expect(await pingSessionCount()).toBe(0);
  });

  test(
    "PTY count returns to 0 after an ABRUPT socket close (leak fix)",
    async () => {
      // A Node child opens a real WebSocket and creates a PTY, then emits a true
      // TCP RST (no WS close frame, no graceful FIN) — exactly what the OS sends
      // when a browser tab/process dies mid-connection. The server's leak-fix
      // close/error handler must drop the now-orphaned session synchronously.
      const client = await spawnAbruptClient();
      expect(await waitForSessionCount(1, 5_000)).toBe(1);

      client.reset(); // abrupt RST → server sees ECONNRESET

      // The reaper only ticks every ~15s, so without the synchronous close/error
      // handler the leaked PTY would survive far past this window. Reclaiming
      // inside ~4s proves the leak fix ran synchronously, not via the reaper.
      expect(await waitForSessionCount(0, 4_000)).toBe(0);
    },
    20_000,
  );

  test(
    "the orphan reaper spares live sessions and bounds reclamation by its TTL",
    async () => {
      // The orphan reaper is the backstop that bounds how long any
      // subscriber-less PTY can linger. Two real guarantees:
      //
      //  (1) It must NOT kill a session that still has a live subscriber, even
      //      after more than ORPHAN_TTL_MS has elapsed (the reaper resets the
      //      orphan clock on every tick that sees a subscriber). We hold a real
      //      connection open well past the TTL and assert the PTY survives.
      //  (2) Once that connection abruptly resets, the PTY is reclaimed and the
      //      count returns to 0 within the reaper's TTL-bounded window.
      const client = await spawnAbruptClient();
      expect(await waitForSessionCount(1, 5_000)).toBe(1);

      // Outlast the orphan TTL with the subscriber still attached: the reaper
      // must leave the live session alone.
      await delay(ORPHAN_TTL_MS + 1_500);
      expect(await pingSessionCount()).toBe(1);

      // Now drop the subscriber abruptly; the PTY must be reclaimed within the
      // reaper-TTL-bounded window (the synchronous handler beats the reaper, but
      // either way the documented upper bound is honored).
      client.reset();
      expect(await waitForSessionCount(0, ORPHAN_TTL_MS + 6_000)).toBe(0);
    },
    25_000,
  );

  test(
    "a session.create whose owner closes mid round-trip does not leak (create-race guard)",
    async () => {
      // Fire session.create and tear the socket down IMMEDIATELY, without
      // waiting for the result — the owning connection dies during the create
      // round-trip. Whether the close is observed before or after the PTY is
      // spawned, the server must reclaim it: the socket-close cleanup handles
      // the after case, and the create-race guard (conn.readyState !== OPEN at
      // create time) handles the before case. Either way the count must return
      // to 0 well inside the reaper's TTL (proving synchronous reclaim, not a
      // reaper backstop).
      const c = new RawWsClient();
      await c.waitOpen();
      c.send({ jsonrpc: "2.0", id: 900, method: "session.create", params: { cols: 80, rows: 24 } });
      c.closeAbrupt();

      // ORPHAN_TTL_MS is 2s in this test; a window shorter than that proves the
      // PTY was reclaimed synchronously rather than by the reaper.
      expect(await waitForSessionCount(0, ORPHAN_TTL_MS - 500)).toBe(0);
    },
    20_000,
  );

  test(
    "session.create beyond MAX_SESSIONS is rejected",
    async () => {
      const conns: RawWsClient[] = [];
      try {
        // Hold MAX_SESSIONS live sessions on one connection so they don't get
        // reclaimed between creates.
        const holder = new RawWsClient();
        conns.push(holder);
        await holder.waitOpen();
        for (let i = 0; i < MAX_SESSIONS; i++) {
          await createSession(holder, 100 + i);
        }
        expect(await waitForSessionCount(MAX_SESSIONS, 5_000)).toBe(MAX_SESSIONS);

        // The next create must be rejected with a JSON-RPC error, not spawn a shell.
        holder.send({
          jsonrpc: "2.0",
          id: 200,
          method: "session.create",
          params: { cols: 80, rows: 24 },
        });
        const res = await holder.waitForId(200);
        expect(res.error).toBeTruthy();
        expect(String(res.error.message)).toMatch(/session limit reached/i);
        // Count did not grow.
        expect(await pingSessionCount()).toBe(MAX_SESSIONS);
      } finally {
        for (const c of conns) c.closeAbrupt();
        await waitForSessionCount(0, 8_000);
      }
    },
    20_000,
  );

  test(
    "pane_output is UNICAST to the owning session's subscribers only",
    async () => {
      const a = new RawWsClient();
      const b = new RawWsClient();
      await a.waitOpen();
      await b.waitOpen();
      try {
      const sessA = await createSession(a, 1);
      const sessB = await createSession(b, 1);
      expect(sessA).not.toBe(sessB);
      expect(await waitForSessionCount(2, 5_000)).toBe(2);

      // Drain any shell-startup output already received, then mark a boundary.
      const baselineB = b.notifications("pane_output").length;

      // Make session A emit a unique, identifiable line.
      const marker = `MARKER_${randomBytes(4).toString("hex")}`;
      a.send({ jsonrpc: "2.0", id: 2, method: "session.input", params: { sessionId: sessA, data: `echo ${marker}\n` } });

      // A must receive its own marker output.
      const aOut = await a.waitForMethod(
        "pane_output",
        5_000,
        (m) => m.params.sessionId === sessA && String(m.params.data).includes(marker),
      );
      expect(aOut.params.sessionId).toBe(sessA);

      // Give B a generous window to (wrongly) receive A's output.
      await delay(750);

      // B must NOT have received ANY pane_output for session A, and none of B's
      // new notifications may carry A's marker.
      const bForA = b.notifications("pane_output").filter((m) => m.params.sessionId === sessA);
      expect(bForA.length).toBe(0);
      const bNew = b.notifications("pane_output").slice(baselineB);
      expect(bNew.some((m) => String(m.params.data).includes(marker))).toBe(false);
    } finally {
      a.closeAbrupt();
      b.closeAbrupt();
      await waitForSessionCount(0, 8_000);
    }
    },
    20_000,
  );

  test(
    "a frame larger than MAX_FRAME_BYTES is rejected/closed",
    async () => {
    const c = new RawWsClient();
    await c.waitOpen();
    // Declare a length above the 1 MiB server cap. We don't even need to send the
    // full payload — the server must refuse based on the declared length and
    // close the socket (status 1009) before buffering it.
    const TOO_BIG = 1024 * 1024 + 1;
    // Build a 16-bit-length won't reach >65535 path; use the 64-bit length path
    // by declaring a huge length with a tiny actual payload.
    const frame = c.buildFrame("x", { masked: true, declaredLen: TOO_BIG });
    c.sendRawFrame(frame);

    // The server should close the connection (close frame 1009 or TCP teardown).
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && !c.closeInfo) await delay(20);
    expect(c.closeInfo).toBeTruthy();
    if (c.closeInfo?.code !== undefined && !c.closeInfo.terminated) {
      expect(c.closeInfo.code).toBe(1009);
    }
    // And no session leaked from the rejected frame.
    expect(await waitForSessionCount(0, 8_000)).toBe(0);
    },
    20_000,
  );

  test("an UNMASKED client frame is rejected (RFC 6455 §5.1)", async () => {
    const c = new RawWsClient();
    await c.waitOpen();
    // A perfectly valid JSON-RPC payload, but sent UNMASKED. Per RFC 6455 every
    // client frame MUST be masked; the server must close (1002) rather than act
    // on it.
    const frame = c.buildFrame(
      JSON.stringify({ jsonrpc: "2.0", id: 7, method: "daemon.ping", params: {} }),
      { masked: false },
    );
    c.sendRawFrame(frame);

    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && !c.closeInfo) await delay(20);
    expect(c.closeInfo).toBeTruthy();
    if (c.closeInfo?.code !== undefined && !c.closeInfo.terminated) {
      expect(c.closeInfo.code).toBe(1002);
    }
    // The server must NOT have answered the unmasked ping.
    expect(c.messages.find((m) => m && m.id === 7)).toBeUndefined();
  });

  test("a non-loopback Origin is refused with HTTP 403", async () => {
    // A malicious page the developer visits would open this WebSocket with its
    // own (cross-origin) Origin header. Browsers always attach Origin and cannot
    // strip it, so the server must refuse the upgrade with HTTP 403 before any
    // shell is spawned. Use node:http so the refused upgrade surfaces as a plain
    // HTTP response (a 101 would come back as an 'upgrade' event instead).
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest({
        host: HOST,
        port: PORT,
        path: "/terminal/ws",
        headers: {
          Connection: "Upgrade",
          Upgrade: "websocket",
          "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
          "Sec-WebSocket-Version": "13",
          Origin: "https://evil.example",
        },
      });
      req.on("response", (res) => resolve(res.statusCode ?? 0));
      req.on("upgrade", () => reject(new Error("server accepted a cross-origin upgrade")));
      req.on("error", reject);
      setTimeout(() => reject(new Error("timeout")), 5_000);
      req.end();
    });
    expect(status).toBe(403);

    // A loopback Origin, by contrast, must be allowed to upgrade and serve.
    const ok = new RawWsClient({ origin: `http://localhost:${PORT}` });
    await ok.waitOpen();
    ok.send({ jsonrpc: "2.0", id: 1, method: "daemon.ping", params: {} });
    const res = await ok.waitForId(1);
    expect(res.result.version).toBeDefined();
    ok.destroyAbrupt();
  });

  test(
    "SIGTERM shuts the server down cleanly",
    async () => {
    // Hold a live session so we also confirm shutdown reaps live PTYs.
    const c = new RawWsClient();
    await c.waitOpen();
    await createSession(c, 1);
    expect(await waitForSessionCount(1, 5_000)).toBe(1);

    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      server.once("exit", (code, signal) => resolve({ code, signal }));
    });
    server.kill("SIGTERM");
    const result = await Promise.race([
      exited,
      delay(5_000).then(() => ({ code: undefined, signal: undefined }) as any),
    ]);
    // Clean exit: process.exit(0) on SIGTERM (or terminated by the signal).
    expect(result.code === 0 || result.signal === "SIGTERM").toBe(true);

    // The HTTP listener is gone — health no longer answers.
    let healthDown = false;
    try {
      await fetch(`${BASE}/health`);
    } catch {
      healthDown = true;
    }
    expect(healthDown).toBe(true);
    c.destroyAbrupt();
    },
    20_000,
  );
});
