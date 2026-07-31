import {
  MAX_FRAME_BYTES,
  RATE_LIMIT_PER_MINUTE,
  HEARTBEAT_TIMEOUT_MS,
  PING_FRAME,
  PONG_FRAME,
  type ControlMessage,
} from "../shared/protocol";

type Role = "sender" | "receiver";

interface SocketState {
  /** Rate-limit window. */
  windowStart: number;
  count: number;
  /** Last time this object saw traffic from the socket, for liveness. */
  seenAt: number;
}

export class Room implements DurableObject {
  /**
   * Per-socket rate-limit and liveness state, in memory only.
   *
   * Keyed by socket identity, so it does not survive hibernation: waking this
   * object rebuilds the map and hands `webSocketMessage` fresh `WebSocket`
   * wrappers, which resets every budget. The cap is therefore "30 per minute
   * per socket per wake", not a global guarantee — a client that stays quiet
   * long enough for the object to hibernate starts a fresh window.
   *
   * That is deliberate, not an oversight. Surviving hibernation means writing
   * the counters somewhere the runtime restores, and both routes available
   * (`storage` and `serializeAttachment`) are server-side persistence, which
   * the spec forbids outright. A sustained flood keeps the object awake and
   * stays limited, so the gap only helps a slow trickle — which the cap was
   * never the defense against. The liveness reset is safe in the same way: an
   * unknown socket reads as freshly seen, which can briefly over-count a
   * receiver but never hides a live car from its phone.
   */
  private sockets = new Map<WebSocket, SocketState>();

  constructor(
    private ctx: DurableObjectState,
    // The runtime passes bindings here; this object uses none, and holding an
    // unread reference to them is the sort of thing that grows into use later.
    _env: unknown,
  ) {
    // Handled by the runtime: a ping never wakes this object, never reaches
    // webSocketMessage, and never spends rate limit.
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(PING_FRAME, PONG_FRAME),
    );
  }

  async fetch(request: Request): Promise<Response> {
    const role = new URL(request.url).searchParams.get("role");
    if (role !== "sender" && role !== "receiver") {
      return new Response("role must be sender or receiver", { status: 400 });
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("expected a websocket upgrade", { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server, [role]);

    if (role === "sender") {
      this.send(server, { t: "presence", receivers: this.countOf("receiver") });
    } else {
      this.broadcastPresence();
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): void {
    if (!this.allow(ws)) {
      this.send(ws, { t: "error", code: "rate_limited" });
      return;
    }
    if (typeof message === "string") {
      this.send(ws, { t: "error", code: "unsupported" });
      return;
    }
    if (message.byteLength > MAX_FRAME_BYTES) {
      this.send(ws, { t: "error", code: "too_large" });
      return;
    }

    const role = this.roleOf(ws);
    if (!role) return;
    this.stateOf(ws).seenAt = Date.now();
    const targets = this.liveSockets(role === "sender" ? "receiver" : "sender");
    if (targets.length === 0) {
      if (role === "sender") this.send(ws, { t: "no-receiver" });
      return;
    }
    for (const target of targets) {
      try {
        target.send(message);
      } catch {
        // A racing close; the close handler will tidy up.
      }
    }
  }

  webSocketClose(ws: WebSocket): void {
    // Capture role before the runtime drops tags for this socket.
    const wasReceiver = this.ctx.getTags(ws).indexOf("receiver") !== -1;
    this.sockets.delete(ws);
    this.pruneClosedSockets();
    if (!wasReceiver) return;
    // During close the socket may still appear in getWebSockets(); subtract it.
    const listed = this.liveSockets("receiver");
    const receivers = listed.includes(ws) ? listed.length - 1 : listed.length;
    const message: ControlMessage = { t: "presence", receivers };
    for (const sender of this.ctx.getWebSockets("sender")) {
      this.send(sender, message);
    }
  }

  webSocketError(ws: WebSocket): void {
    this.webSocketClose(ws);
  }

  private roleOf(ws: WebSocket): Role | null {
    const tags = this.ctx.getTags(ws);
    if (tags.indexOf("sender") !== -1) return "sender";
    if (tags.indexOf("receiver") !== -1) return "receiver";
    return null;
  }

  /**
   * Drops state for sockets the runtime no longer lists. `webSocketClose` is
   * not guaranteed to fire for every socket, and without this the map would be
   * the one thing in this object that grows without bound.
   */
  private pruneClosedSockets(): void {
    if (this.sockets.size === 0) return;
    const open = new Set<WebSocket>(this.ctx.getWebSockets());
    for (const ws of [...this.sockets.keys()]) {
      if (!open.has(ws)) this.sockets.delete(ws);
    }
  }

  private stateOf(ws: WebSocket): SocketState {
    let state = this.sockets.get(ws);
    if (!state) {
      state = { windowStart: 0, count: 0, seenAt: Date.now() };
      this.sockets.set(ws, state);
    }
    return state;
  }

  /**
   * Sockets that have shown a sign of life within the heartbeat window.
   *
   * A car that loses power or signal without a TCP close stays in
   * `getWebSockets()` until the runtime notices, and counting it would leave
   * the phone showing a green "Car connected" for a car that is gone. The
   * runtime stamps every auto-responded ping, so liveness needs no timer and
   * no stored state. A socket that has not pinged yet is graded from when this
   * object first saw it, which keeps a freshly accepted socket live.
   */
  private liveSockets(role: Role): WebSocket[] {
    const now = Date.now();
    return this.ctx.getWebSockets(role).filter((ws) => {
      const stamp = this.ctx.getWebSocketAutoResponseTimestamp(ws);
      const seenAt = Math.max(this.stateOf(ws).seenAt, stamp === null ? 0 : stamp.getTime());
      return now - seenAt <= HEARTBEAT_TIMEOUT_MS;
    });
  }

  private countOf(role: Role): number {
    return this.liveSockets(role).length;
  }

  private broadcastPresence(): void {
    const message: ControlMessage = {
      t: "presence",
      receivers: this.countOf("receiver"),
    };
    for (const sender of this.ctx.getWebSockets("sender")) {
      this.send(sender, message);
    }
  }

  private send(ws: WebSocket, message: ControlMessage): void {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // Socket already gone.
    }
  }

  private allow(ws: WebSocket): boolean {
    const now = Date.now();
    const state = this.stateOf(ws);
    if (now - state.windowStart >= 60_000) {
      state.windowStart = now;
      state.count = 1;
      return true;
    }
    state.count += 1;
    return state.count <= RATE_LIMIT_PER_MINUTE;
  }
}
