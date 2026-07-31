import type { Bytes } from "./bytes";
import type { ControlMessage } from "./protocol";

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
  let closed = false;
  let online = typeof navigator === "undefined" || navigator.onLine;

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
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

  function onVisibilityChange(): void {
    if (document.visibilityState === "visible" && !closed && ws === null) {
      clearTimer();
      attempt = 0;
      open();
    }
  }

  function onOffline(): void {
    if (closed) return;
    online = false;
    clearTimer();
    const socket = ws;
    ws = null;
    socket?.close();
    handlers.onStatus("closed");
  }

  function onOnline(): void {
    if (closed || ws !== null) return;
    online = true;
    clearTimer();
    attempt = 0;
    open();
  }

  function open(): void {
    if (closed) return;
    if (!online) {
      handlers.onStatus("closed");
      return;
    }
    handlers.onStatus("connecting");
    const socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";
    ws = socket;

    socket.addEventListener("open", () => {
      // Ignore late open after close() or after a newer socket replaced this one.
      if (closed || ws !== socket) return;
      attempt = 0;
      handlers.onStatus("open");
    });

    socket.addEventListener("message", (event) => {
      if (closed || ws !== socket) return;
      const data = (event as MessageEvent).data;
      if (typeof data === "string") {
        try {
          handlers.onControl(JSON.parse(data) as ControlMessage);
        } catch {
          // Ignore unparseable control frames.
        }
        return;
      }
      handlers.onFrame(new Uint8Array(data as ArrayBuffer));
    });

    const drop = (): void => {
      if (ws !== socket) return;
      ws = null;
      if (closed) return;
      handlers.onStatus("closed");
      if (online) scheduleReconnect();
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
