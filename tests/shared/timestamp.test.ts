import { describe, it, expect } from "vitest";
import { formatReceivedAt } from "../../src/client/timestamp";

/** Local-time constructor, so the same-day comparisons match what a car shows. */
const at = (y: number, m: number, d: number, h: number, min: number): number =>
  new Date(y, m, d, h, min).getTime();

describe("formatReceivedAt", () => {
  it("says 'Just now' for a link that has only just landed", () => {
    const now = at(2026, 6, 31, 14, 34);
    expect(formatReceivedAt(now - 5_000, now, "en-US")).toBe("Just now");
  });

  it("counts whole minutes within the hour", () => {
    const now = at(2026, 6, 31, 14, 34);
    expect(formatReceivedAt(now - 12 * 60_000, now, "en-US")).toBe("12 min ago");
  });

  it("never rounds down to '0 min ago'", () => {
    const now = at(2026, 6, 31, 14, 34);
    expect(formatReceivedAt(now - 50_000, now, "en-US")).toBe("1 min ago");
  });

  it("never rounds up to '60 min ago'", () => {
    const now = at(2026, 6, 31, 14, 34);
    expect(formatReceivedAt(now - 59.7 * 60_000, now, "en-US")).toBe("59 min ago");
  });

  it("switches to the clock time once the hour has passed", () => {
    const now = at(2026, 6, 31, 20, 0);
    expect(formatReceivedAt(at(2026, 6, 31, 14, 34), now, "en-US")).toBe("2:34 PM");
  });

  it("names yesterday rather than showing a bare time", () => {
    const now = at(2026, 6, 31, 9, 0);
    expect(formatReceivedAt(at(2026, 6, 30, 22, 15), now, "en-US")).toBe("Yesterday 10:15 PM");
  });

  it("adds the date for anything older", () => {
    const now = at(2026, 6, 31, 9, 0);
    expect(formatReceivedAt(at(2026, 6, 28, 8, 5), now, "en-US")).toBe("Jul 28, 8:05 AM");
  });

  /**
   * The phone stamps `ts` from its own clock and the car renders it from
   * another; the app already measures that skew on /debug. A phone running a
   * minute fast must not produce a link dated in the future.
   */
  it("treats a timestamp from a fast phone clock as just now", () => {
    const now = at(2026, 6, 31, 14, 34);
    expect(formatReceivedAt(now + 90_000, now, "en-US")).toBe("Just now");
  });

  /**
   * Newer ICU puts U+202F before AM/PM. The car screen and these assertions
   * should both see an ordinary space.
   */
  it("uses ordinary spaces, whatever ICU emits", () => {
    const now = at(2026, 6, 31, 20, 0);
    expect(formatReceivedAt(at(2026, 6, 31, 14, 34), now, "en-US")).not.toMatch(/ | /);
  });
});
