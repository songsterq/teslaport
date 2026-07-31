import { describe, it, expect } from "vitest";
import { redirectTarget, CHOOSE_PARAM } from "../../src/client/home";

describe("redirectTarget", () => {
  it("maps receiver to /r and sender to /s", () => {
    expect(redirectTarget("receiver", "")).toBe("/r");
    expect(redirectTarget("sender", "")).toBe("/s");
  });

  it("returns null when no role is stored", () => {
    expect(redirectTarget(null, "")).toBeNull();
  });

  /**
   * The escape hatch. Without it a browser that has opened /r or /s even once
   * can never reach the chooser again — the only way back would be clearing
   * site data, which on the car also destroys the pairing seed.
   */
  it("stays on the chooser when the choose flag is present", () => {
    expect(redirectTarget("receiver", `?${CHOOSE_PARAM}`)).toBeNull();
    expect(redirectTarget("sender", `?${CHOOSE_PARAM}`)).toBeNull();
  });

  it("accepts the flag with a value or alongside other params", () => {
    expect(redirectTarget("receiver", `?${CHOOSE_PARAM}=1`)).toBeNull();
    expect(redirectTarget("receiver", `?a=1&${CHOOSE_PARAM}`)).toBeNull();
  });

  it("still redirects for unrelated query strings", () => {
    expect(redirectTarget("receiver", "?utm_source=x")).toBe("/r");
    expect(redirectTarget("sender", "?choosey=1")).toBe("/s");
  });
});
