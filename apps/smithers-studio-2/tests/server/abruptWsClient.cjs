"use strict";
/**
 * A tiny Node-hosted WebSocket client used ONLY by tests/server/pty-server.test.ts
 * to produce a TRUE abrupt connection reset against the real PTY server.
 *
 * Why a separate Node child?  The PTY server runs under Node (node-pty does not
 * deliver PTY data under Bun), and the leak-fix cleanup we want to exercise fires
 * on the server socket's `error` event (an ECONNRESET from the peer). Node's
 * `socket.resetAndDestroy()` emits a real TCP RST that the server sees as
 * ECONNRESET; Bun's `net.Socket` does NOT propagate an equivalent reset, so the
 * Bun test process cannot generate it directly. This child, run with the same
 * Node that hosts the server, can — and the parent test drives it over the Node
 * IPC channel:
 *
 *   parent ──fork()──▶ child:  connects to ws://127.0.0.1:<port>/terminal/ws,
 *                              sends session.create, then on `{type:"reset"}`
 *                              calls socket.resetAndDestroy() (abrupt RST).
 *   child ──IPC──▶ parent:     { type:"created", sessionId } once the PTY exists.
 *
 * No mocking: this is a real RFC 6455 client speaking to the real server.
 */
const { connect } = require("node:net");
const { randomBytes } = require("node:crypto");

const port = Number(process.argv[2]);
if (!Number.isFinite(port)) {
  console.error("abruptWsClient: missing/invalid port arg");
  process.exit(2);
}

const socket = connect(port, "127.0.0.1");
socket.on("error", () => {
  /* the parent intentionally resets us; ignore */
});

const key = randomBytes(16).toString("base64");
let upgraded = false;
let buffer = Buffer.alloc(0);

socket.on("connect", () => {
  socket.write(
    "GET /terminal/ws HTTP/1.1\r\n" +
      "Host: 127.0.0.1\r\n" +
      "Connection: Upgrade\r\n" +
      "Upgrade: websocket\r\n" +
      `Sec-WebSocket-Key: ${key}\r\n` +
      "Sec-WebSocket-Version: 13\r\n\r\n",
  );
});

function sendMaskedText(obj) {
  const payload = Buffer.from(JSON.stringify(obj), "utf8");
  const mask = randomBytes(4);
  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x81, 0x80 | payload.length]);
  } else {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
  }
  socket.write(Buffer.concat([header, mask, masked]));
}

socket.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  if (!upgraded) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;
    upgraded = true;
    buffer = buffer.subarray(headerEnd + 4);
    sendMaskedText({ jsonrpc: "2.0", id: 1, method: "session.create", params: { cols: 80, rows: 24 } });
  }
  // Parse server text frames (unmasked) looking for the create result.
  while (buffer.length >= 2) {
    const opcode = buffer[0] & 0x0f;
    let len = buffer[1] & 0x7f;
    let offset = 2;
    if (len === 126) {
      if (buffer.length < 4) return;
      len = buffer.readUInt16BE(2);
      offset = 4;
    } else if (len === 127) {
      if (buffer.length < 10) return;
      len = Number(buffer.readBigUInt64BE(2));
      offset = 10;
    }
    if (buffer.length < offset + len) return;
    const payload = buffer.subarray(offset, offset + len);
    buffer = buffer.subarray(offset + len);
    if (opcode === 0x1) {
      try {
        const msg = JSON.parse(payload.toString("utf8"));
        if (msg.id === 1 && msg.result && process.send) {
          process.send({ type: "created", sessionId: msg.result.sessionId });
        }
      } catch {
        /* ignore non-JSON frames */
      }
    }
  }
});

process.on("message", (msg) => {
  if (msg && msg.type === "reset") {
    // Abrupt: emit a TCP RST the server sees as ECONNRESET — no WS close frame,
    // no graceful FIN. This is the dead-tab / crashed-client scenario the
    // leak-fix close handler must reclaim synchronously.
    if (typeof socket.resetAndDestroy === "function") socket.resetAndDestroy();
    else socket.destroy();
    process.exit(0);
  }
});

// Keep the event loop alive until the parent tells us to reset.
setInterval(() => {}, 1 << 30);
