import { loadRole } from "./session";
import type { Role } from "../shared/protocol";

/**
 * Query flag that suppresses the redirect. The "Start over" link on `/r` and
 * `/s` points here.
 *
 * Without an explicit escape, a browser that has opened either page even once
 * could never reach the chooser again: `/` would always redirect, and the only
 * way back would be clearing site data — which on the car also destroys the
 * pairing seed and silently breaks every paired phone.
 */
export const CHOOSE_PARAM = "choose";

export function redirectTarget(role: Role | null, search: string): "/r" | "/s" | null {
  if (new URLSearchParams(search).has(CHOOSE_PARAM)) return null;
  if (role === "receiver") return "/r";
  if (role === "sender") return "/s";
  return null;
}

function bootstrap(): void {
  let role: Role | null = null;
  try {
    role = loadRole(window.localStorage);
  } catch {
    // localStorage unavailable — leave the chooser visible.
    return;
  }
  const path = redirectTarget(role, location.search);
  if (path) location.replace(path);
}

if (typeof document !== "undefined") bootstrap();
