import { derivePairing, parseSeedCode, type Pairing } from "../shared/pairing";
import { encodeBase32 } from "../shared/base32";
import type { Bytes } from "../shared/bytes";
import { seal, openEnvelope, newMessageId } from "../shared/envelope";
import { connect, type SocketHandle, type ConnectionStatus } from "../shared/socket";
import { installErrorCapture } from "../shared/diagnostics";
import { resolveSeed, storeSeed } from "./session";
import { ACK_TIMEOUT_MS } from "../shared/protocol";

export function normaliseInputUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (!parsed.hostname) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function bootstrap(): void {
  const storage = window.localStorage;
  installErrorCapture(storage);
  const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

  let pairing: Pairing;
  let socket: SocketHandle | null = null;
  let receivers = 0;
  let connection: ConnectionStatus = "connecting";
  let pending: { id: string; timer: number } | null = null;

  function message(text: string, tone: "ok" | "warn" | "bad" | ""): void {
    const node = el("msg");
    node.textContent = text;
    node.dataset.tone = tone;
  }

  function paint(): void {
    const dot = el("dot");
    const status = el("status");
    if (connection === "open") {
      dot.dataset.state = "open";
      status.textContent = receivers > 0 ? "Car connected" : "Car not connected";
    } else if (connection === "connecting") {
      dot.dataset.state = "connecting";
      status.textContent = "Connecting…";
    } else {
      dot.dataset.state = "closed";
      status.textContent = "Reconnecting…";
    }
    (el("send") as HTMLButtonElement).disabled =
      !(connection === "open" && receivers > 0 && pending === null);
  }

  function clearPending(): void {
    if (pending) window.clearTimeout(pending.timer);
    pending = null;
    paint();
  }

  async function send(): Promise<void> {
    if (pending !== null) return;
    const input = el<HTMLInputElement>("url");
    const url = normaliseInputUrl(input.value);
    if (!url) {
      message("That doesn't look like a web link.", "bad");
      return;
    }

    const id = newMessageId();
    pending = { id, timer: 0 };
    paint();
    message("Sending…", "");

    let frame: Bytes;
    try {
      frame = await seal(pairing, { t: "url", id, url, ts: Date.now() });
    } catch (error) {
      clearPending();
      const text = error instanceof Error ? error.message : String(error);
      message(
        /too large/i.test(text) ? "That link is too long." : "Could not prepare that link.",
        "bad",
      );
      return;
    }
    if (pending === null || pending.id !== id) return;

    if (socket === null || !socket.send(frame)) {
      clearPending();
      message("Not connected — the link was not sent. Try again in a moment.", "bad");
      return;
    }

    pending.timer = window.setTimeout(() => {
      clearPending();
      message(
        "No confirmation from the car. The link may not have arrived — open /debug on the car screen.",
        "bad",
      );
    }, ACK_TIMEOUT_MS);
  }

  async function handleFrame(frame: Bytes): Promise<void> {
    const result = await openEnvelope(pairing, frame, Date.now());
    if (!result.ok || result.payload.t !== "ack") return;
    if (!pending || pending.id !== result.payload.id) return;
    clearPending();
    el<HTMLInputElement>("url").value = "";
    message("Sent ✓", "ok");
  }

  async function start(seed: Bytes): Promise<void> {
    pairing = await derivePairing(seed);
    el("unpaired").hidden = true;
    el("paired").hidden = false;

    socket?.close();
    socket = connect(`${location.origin.replace(/^http/, "ws")}/ws/${pairing.roomId}?role=sender`, {
      onStatus(status) {
        connection = status;
        if (status !== "open") receivers = 0;
        paint();
      },
      onFrame(frame) {
        void handleFrame(frame);
      },
      onControl(control) {
        if (control.t === "presence") {
          receivers = control.receivers;
          paint();
        } else if (control.t === "no-receiver") {
          clearPending();
          message("Car not connected — open TeslaPort on the car screen.", "bad");
        } else if (control.t === "error") {
          clearPending();
          message(
            control.code === "too_large" ? "That link is too long." : "Slow down — too many sends.",
            "bad",
          );
        }
      },
    });
  }

  el("send").addEventListener("click", () => void send());
  el<HTMLInputElement>("url").addEventListener("keydown", (event) => {
    if ((event as KeyboardEvent).key === "Enter" && !(el("send") as HTMLButtonElement).disabled) {
      void send();
    }
  });

  el("pair").addEventListener("click", () => {
    const raw = el<HTMLInputElement>("manual").value;
    try {
      const seed = parseSeedCode(raw);
      storeSeed(storage, seed);
      history.replaceState(null, "", `/s#${encodeBase32(seed)}`);
      void start(seed);
    } catch {
      const node = el("pairmsg");
      node.textContent = "That code isn't valid. Check it against the car screen.";
      node.dataset.tone = "bad";
    }
  });

  const resolved = resolveSeed(location.hash, storage, "require");
  if (resolved) void start(resolved.seed);
}

if (typeof document !== "undefined") bootstrap();
