import { describe, it, expect } from "vitest";
import { pathForRole } from "../../src/client/home";

describe("pathForRole", () => {
  it("maps receiver to /r and sender to /s", () => {
    expect(pathForRole("receiver")).toBe("/r");
    expect(pathForRole("sender")).toBe("/s");
  });

  it("returns null when no role", () => {
    expect(pathForRole(null)).toBeNull();
  });
});
