import { describe, it, expect } from "vitest";
import { nextDelay } from "../../src/shared/socket";

describe("reconnect backoff", () => {
  it("starts around one second and jitters within half the base", () => {
    expect(nextDelay(0, () => 0)).toBe(500);
    expect(nextDelay(0, () => 1)).toBe(1000);
  });

  it("doubles per attempt", () => {
    expect(nextDelay(1, () => 1)).toBe(2000);
    expect(nextDelay(2, () => 1)).toBe(4000);
    expect(nextDelay(3, () => 1)).toBe(8000);
  });

  it("caps at thirty seconds", () => {
    expect(nextDelay(20, () => 1)).toBe(30000);
    expect(nextDelay(20, () => 0)).toBe(15000);
  });

  it("always returns a positive integer", () => {
    for (let attempt = 0; attempt < 25; attempt++) {
      const delay = nextDelay(attempt);
      expect(Number.isInteger(delay)).toBe(true);
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThanOrEqual(30000);
    }
  });
});
