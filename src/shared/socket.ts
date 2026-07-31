import type { Bytes } from "./bytes";
import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  PING_FRAME,
  type ControlMessage,
} from "./protocol";

export type ConnectionStatus = "connecting" | "open" | "closed";

export interface SocketHandlers {
  onStatus(status: ConnectionStatus): void;
  onFrame(frame: Bytes): void;
  onControl(message: ControlMessage): void;
}

export interface SocketHandle {
  /** Returns false if the socket was not open and the frame was dropped. */
  send(frame: Bytes): boolean;
  close(): void;
}

const MAX_DELAY_MS = 30000;

export function nextDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(MAX_DELAY_MS, 1000 * Math.pow(2, attempt));
  return Math.round(base * (0.5 + 0.5 * random()));
}

export function connect(url: string, handlers: SocketHandlers): SocketHandle {
  let ws: WebSocket | null = null;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let lastSeenAt = 0;
  let closed = false;

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function stopHeartbeat(): void {
    if (heartbeat !== null) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  }

  /**
   * Detaches the current socket, paints "closed" and queues a retry.
   *
   * Painting immediately matters because close events are not synchronous — and
   * for a half-open socket they may never arrive at all.
   */
  function dropAndReconnect(): void {
    if (closed) return;
    stopHeartbeat();
    clearTimer();
    const socket = ws;
    ws = null;
    if (socket !== null) {
      try {
        socket.close();
      } catch {
        // Already closing.
      }
    }
    handlers.onStatus("closed");
    scheduleReconnect();
  }

  /**
   * A socket whose network died without a TCP close stays `readyState === OPEN`
   * forever: the car keeps showing "Ready to receive", the room keeps counting
   * it, and the phone keeps showing a green light for a car that is gone.
   * Nothing surfaces it but traffic, so send some and watch for the answer.
   * The server auto-responds without waking the Durable Object.
   */
  function startHeartbeat(): void {
    stopHeartbeat();
    lastSeenAt = Date.now();
    heartbeat = setInterval(() => {
      if (closed || ws === null) return;
      if (Date.now() - lastSeenAt > HEARTBEAT_TIMEOUT_MS) {
        dropAndReconnect();
        return;
      }
      try {
        ws.send(PING_FRAME);
      } catch {
        dropAndReconnect();
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  function scheduleReconnect(): void {
    if (closed || timer !== null) return;
    const delay = nextDelay(attempt);
    attempt += 1;
    timer = setTimeout(() => {
      timer = null;
      open();
    }, delay);
  }

  /** Immediate reconnect when the tab wakes or the network returns (like visibility). */
  function reconnectNow(): void {
    if (closed || ws !== null) return;
    clearTimer();
    attempt = 0;
    open();
  }

  function onVisibilityChange(): void {
    if (document.visibilityState === "visible") reconnectNow();
  }

  /**
   * `offline` is a hint that lets us paint "closed" at once instead of waiting
   * out a socket timeout — never a gate on reconnecting. Some browsers fire
   * `offline` without a matching `online`, and suspending retries until that
   * pair completes strands the page on a dead socket until someone reloads it.
   * Retrying into a genuinely down network just fails and backs off, which is
   * far cheaper than the failure it avoids.
   */
  function onOffline(): void {
    dropAndReconnect();
  }

  function onOnline(): void {
    reconnectNow();
  }

  function open(): void {
    if (closed) return;
    handlers.onStatus("connecting");
    const socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";
    ws = socket;

    socket.addEventListener("open", () => {
      // Ignore late open after close() or after a newer socket replaced this one.
      if (closed || ws !== socket) return;
      attempt = 0;
      handlers.onStatus("open");
      startHeartbeat();
    });

    socket.addEventListener("message", (event) => {
      if (closed || ws !== socket) return;
      // Any inbound traffic proves the socket is alive, not just a pong.
      lastSeenAt = Date.now();
      const data = (event as MessageEvent).data;
      if (typeof data === "string") {
        let control: ControlMessage;
        try {
          control = JSON.parse(data) as ControlMessage;
        } catch {
          return; // Ignore unparseable control frames.
        }
        // The heartbeat reply is consumed here; callers never see it.
        if (control.t === "pong") return;
        handlers.onControl(control);
        return;
      }
      handlers.onFrame(new Uint8Array(data as ArrayBuffer));
    });

    const drop = (): void => {
      if (ws !== socket) return;
      ws = null;
      stopHeartbeat();
      if (closed) return;
      handlers.onStatus("closed");
      scheduleReconnect();
    };
    socket.addEventListener("close", drop);
    socket.addEventListener("error", drop);
  }

  // Reconnect immediately when the screen wakes rather than waiting out a backoff.
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibilityChange);
  }
  if (typeof window !== "undefined") {
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
  }

  open();

  return {
    send(frame) {
      if (ws === null || ws.readyState !== WebSocket.OPEN) return false;
      try {
        ws.send(frame);
        return true;
      } catch {
        return false;
      }
    },
    close() {
      closed = true;
      clearTimer();
      stopHeartbeat();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("offline", onOffline);
        window.removeEventListener("online", onOnline);
      }
      if (ws !== null) ws.close();
      ws = null;
    },
  };
}
