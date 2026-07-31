import {
  derivePairing,
  formatSeedCode,
  buildSenderUrl,
  buildReceiverUrl,
  type Pairing,
} from "../shared/pairing";
import { encodeBase32 } from "../shared/base32";
import type { Bytes } from "../shared/bytes";
import { openEnvelope, seal } from "../shared/envelope";
import { createSeenStore, type SeenStore } from "../shared/replay";
import { bumpDropCount, recordClockDelta, installErrorCapture } from "../shared/diagnostics";
import { loadHistory, pushHistory, clearHistory, type HistoryEntry } from "./history";
import { connect, type SocketHandle } from "../shared/socket";
import { resolveSeed, storeSeed, clearSeed } from "./session";
import { renderQr } from "./qr";

const storage = window.localStorage;
const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

let pairing: Pairing;
let seen: SeenStore;
let socket: SocketHandle | null = null;

function renderLinks(entries: HistoryEntry[]): void {
  const list = el<HTMLUListElement>("links");
  list.textContent = "";
  for (const entry of entries) {
    const item = document.createElement("li");
    const anchor = document.createElement("a");
    anchor.href = entry.url;
    // Same tab, deliberately: Tesla's browser handles target="_blank"
    // unreliably, and a link that does nothing when tapped is the worst
    // failure mode on a screen with no developer tools.
    anchor.rel = "noopener noreferrer";
    anchor.textContent = entry.url;
    item.appendChild(anchor);
    list.appendChild(item);
  }
  el("empty").hidden = entries.length > 0;
}

function setStatus(state: string, label: string): void {
  el("dot").dataset.state = state;
  el("status").textContent = label;
}

async function handleFrame(frame: Bytes): Promise<void> {
  const result = await openEnvelope(pairing, frame, Date.now());
  if (!result.ok) {
    bumpDropCount(storage, result.reason);
    return;
  }
  if (result.payload.t !== "url") return;

  recordClockDelta(storage, Date.now() - result.payload.ts);
  if (seen.has(result.payload.id)) {
    bumpDropCount(storage, "replay");
    return;
  }
  seen.add(result.payload.id);
  renderLinks(pushHistory(storage, {
    id: result.payload.id,
    url: result.payload.url,
    ts: result.payload.ts,
  }));

  // Acknowledge only after acceptance and render.
  const ack = await seal(pairing, { t: "ack", id: result.payload.id });
  socket?.send(ack);
}

async function start(seed: Bytes): Promise<void> {
  pairing = await derivePairing(seed);
  seen = createSeenStore(storage);

  const code = encodeBase32(seed);
  renderQr(el("qr"), buildSenderUrl(location.origin, code));
  el("code").textContent = formatSeedCode(code);
  el("hint").textContent = "Scan with your phone, or type this code at " + location.host + "/s";
  renderLinks(loadHistory(storage));

  // Keep the bookmarkable, seed-carrying URL in the address bar so that
  // bookmarking this page survives a localStorage wipe.
  history.replaceState(null, "", buildReceiverUrl(location.origin, code));

  // The car's browser storage gets cleared by software updates. The bookmark is
  // the only thing that survives, so ask for it explicitly rather than hoping.
  el("bookmark").textContent =
    "Bookmark this page now — the address bar holds your code. If the car clears "
    + "its browser data, opening the bookmark restores this same pairing.";

  socket?.close();
  socket = connect(`${location.origin.replace(/^http/, "ws")}/ws/${pairing.roomId}?role=receiver`, {
    onStatus(status) {
      if (status === "open") setStatus("open", "Ready to receive");
      else if (status === "connecting") setStatus("connecting", "Connecting…");
      else setStatus("closed", "Disconnected — retrying");
    },
    onFrame(frame) {
      void handleFrame(frame);
    },
    onControl() {
      // The car ignores control messages.
    },
  });
}

el("burn").addEventListener("click", () => {
  if (!confirm("Burn this code? Paired phones will stop working.")) return;
  clearSeed(storage);
  clearHistory(storage);
  seen.clear();
  const resolved = resolveSeed("", storage, "generate")!;
  void start(resolved.seed);
});

el("clear").addEventListener("click", () => {
  clearHistory(storage);
  renderLinks([]);
});

installErrorCapture(storage);
const resolved = resolveSeed(location.hash, storage, "generate")!;
storeSeed(storage, resolved.seed);
void start(resolved.seed);
