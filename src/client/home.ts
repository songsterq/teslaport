import { loadRole, type Role } from "./session";

export function pathForRole(role: Role | null): "/r" | "/s" | null {
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
  const path = pathForRole(role);
  if (path) location.replace(path);
}

if (typeof document !== "undefined") bootstrap();
