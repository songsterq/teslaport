import {
  MAX_FRAME_BYTES,
  RATE_LIMIT_PER_MINUTE,
  type ControlMessage,
} from "../shared/protocol";

type Role = "sender" | "receiver";

interface Budget {
  windowStart: number;
  count: number;
}

export class Room implements DurableObject {
  /** In-memory only. Resets if the DO is evicted; the spec accepts this. */
  private budgets = new Map<WebSocket, Budget>();

  constructor(
    private ctx: DurableObjectState,
    private env: unknown,
  ) {}

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
    const targets = this.ctx.getWebSockets(role === "sender" ? "receiver" : "sender");
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
    this.budgets.delete(ws);
    if (!wasReceiver) return;
    // During close the socket may still appear in getWebSockets(); subtract it.
    const listed = this.ctx.getWebSockets("receiver");
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

  private countOf(role: Role): number {
    return this.ctx.getWebSockets(role).length;
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
    const budget = this.budgets.get(ws);
    if (!budget || now - budget.windowStart >= 60_000) {
      this.budgets.set(ws, { windowStart: now, count: 1 });
      return true;
    }
    budget.count += 1;
    return budget.count <= RATE_LIMIT_PER_MINUTE;
  }
}
