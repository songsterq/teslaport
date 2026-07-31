import { derivePairing, generateSeed, base64url } from "../shared/pairing";
import { seal, openEnvelope, newMessageId } from "../shared/envelope";
import { loadHistory } from "./history";
import { loadDropCounts, readClockDelta, loadErrors, installErrorCapture } from "../shared/diagnostics";
import { resolveSeed } from "./session";

installErrorCapture(window.localStorage);

const rows: Array<[string, string]> = [];

function add(label: string, value: string): void {
  rows.push([label, value]);
}

function render(): void {
  const list = document.getElementById("report")!;
  list.textContent = "";
  for (const [label, value] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    dd.style.marginBottom = "12px";
    list.appendChild(dt);
    list.appendChild(dd);
  }
  // Errors are read from storage, so failures on /r are visible here.
  const errors = loadErrors(window.localStorage);
  document.getElementById("log")!.textContent = errors.length ? errors.join("\n") : "none";
}

/**
 * Opens a real socket to a throwaway room, sends a byte, and waits for the
 * server's `no-receiver` control reply. That proves the upgrade, the frame
 * path, and the return path — everything the app depends on.
 *
 * The reply must be `no-receiver` specifically. The server pushes `presence`
 * the instant it accepts a sender socket, before this page has sent anything,
 * so resolving on the first control message would report `ok` while proving
 * only that the upgrade succeeded — the outbound frame path, the one most
 * likely to be broken by a proxy, would go untested.
 */
async function probeWebSocket(): Promise<string> {
  if (typeof WebSocket !== "function") return "MISSING: no WebSocket constructor";
  const probeRoom = base64url(crypto.getRandomValues(new Uint8Array(16)));
  const url = `${location.origin.replace(/^http/, "ws")}/ws/${probeRoom}?role=sender`;
  return new Promise<string>((resolve) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (error) {
      resolve(`FAILED to construct: ${String(error)}`);
      return;
    }
    const started = Date.now();
    const finish = (result: string): void => {
      try { ws.close(); } catch { /* already closing */ }
      resolve(result);
    };
    const timer = setTimeout(() => finish("FAILED: no reply within 5s"), 5000);
    ws.addEventListener("open", () => ws.send(new Uint8Array([0])));
    ws.addEventListener("message", (event) => {
      const data = (event as MessageEvent).data;
      if (typeof data !== "string") return;
      let control: { t?: unknown };
      try {
        control = JSON.parse(data) as { t?: unknown };
      } catch {
        return;
      }
      if (control.t !== "no-receiver") return;
      clearTimeout(timer);
      finish(`ok (${Date.now() - started} ms)`);
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      finish("FAILED: connection error");
    });
  });
}

async function run(): Promise<void> {
  add("User agent", navigator.userAgent);
  add("Secure context", String(window.isSecureContext));
  add("Local time", new Date().toISOString());

  // Live round-trip checks, not feature sniffing.
  try {
    window.localStorage.setItem("teslaport:probe", "1");
    const ok = window.localStorage.getItem("teslaport:probe") === "1";
    window.localStorage.removeItem("teslaport:probe");
    add("localStorage round-trip", ok ? "ok" : "FAILED");
  } catch (error) {
    add("localStorage round-trip", `FAILED: ${String(error)}`);
  }

  add("crypto.subtle", typeof crypto !== "undefined" && !!crypto.subtle ? "present" : "MISSING");

  // A live round trip, not a constructor check: proxies, TLS interception and
  // captive portals all leave `WebSocket` defined while breaking the connection.
  add("WebSocket round-trip", await probeWebSocket());

  try {
    const pairing = await derivePairing(generateSeed());
    const id = newMessageId();
    const frame = await seal(pairing, { t: "url", id, url: "https://example.com/", ts: Date.now() });
    const result = await openEnvelope(pairing, frame, Date.now());
    add("Crypto round-trip", result.ok && result.payload.t === "url" ? "ok" : "FAILED");
  } catch (error) {
    add("Crypto round-trip", `FAILED: ${String(error)}`);
  }

  const resolved = resolveSeed("", window.localStorage, "require");
  add("Stored seed", resolved ? `present (${resolved.source})` : "none — this device is not paired");
  if (resolved) {
    const pairing = await derivePairing(resolved.seed);
    add("Room ID", pairing.roomId);
  }

  add("History entries", String(loadHistory(window.localStorage).length));

  const drops = loadDropCounts(window.localStorage);
  add(
    "Rejected messages",
    `decrypt ${drops.decrypt}, malformed ${drops.malformed}, bad scheme ${drops.scheme}, `
      + `stale ${drops.stale}, replay ${drops.replay}`,
  );

  const delta = readClockDelta(window.localStorage);
  add(
    "Clock delta vs last sender (ms)",
    delta === null
      ? "no message received yet"
      : `${delta}${Math.abs(delta) > 300000 ? " — OVER THE 5 MINUTE WINDOW, messages will be rejected" : ""}`,
  );

  render();
}

void run();
