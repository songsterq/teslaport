import { describe, it, expect } from "vitest";
import {
  loadDropCounts, bumpDropCount, recordClockDelta, readClockDelta, appendError, loadErrors,
} from "../../src/shared/diagnostics";
import { memoryStore } from "../helpers/memory-store";

describe("diagnostics counters", () => {
  it("starts every reason at zero", () => {
    expect(loadDropCounts(memoryStore())).toEqual({
      decrypt: 0, malformed: 0, scheme: 0, stale: 0, replay: 0,
    });
  });

  it("increments and persists across reads", () => {
    const storage = memoryStore();
    bumpDropCount(storage, "stale");
    bumpDropCount(storage, "stale");
    bumpDropCount(storage, "replay");
    const counts = loadDropCounts(storage);
    expect(counts.stale).toBe(2);
    expect(counts.replay).toBe(1);
    expect(counts.decrypt).toBe(0);
  });

  it("records and reads the clock delta", () => {
    const storage = memoryStore();
    expect(readClockDelta(storage)).toBeNull();
    recordClockDelta(storage, -1234);
    expect(readClockDelta(storage)).toBe(-1234);
  });

  it("survives corrupt stored data", () => {
    const storage = memoryStore();
    storage.setItem("teslaport:drops", "{{{");
    storage.setItem("teslaport:clockdelta", "not a number");
    expect(loadDropCounts(storage).decrypt).toBe(0);
    expect(readClockDelta(storage)).toBeNull();
  });

  it("ignores stored drop counts that are valid JSON but the wrong shape (array instead of object)", () => {
    const storage = memoryStore();
    storage.setItem("teslaport:drops", JSON.stringify([1, 2, 3]));
    expect(loadDropCounts(storage)).toEqual({
      decrypt: 0, malformed: 0, scheme: 0, stale: 0, replay: 0,
    });
  });

  it("ignores a stored drop-count object whose values are the wrong type", () => {
    const storage = memoryStore();
    storage.setItem(
      "teslaport:drops",
      JSON.stringify({ decrypt: "many", malformed: null, scheme: 3, stale: 0, replay: 0 }),
    );
    const counts = loadDropCounts(storage);
    expect(counts.decrypt).toBe(0);
    expect(counts.scheme).toBe(3);
  });
});

describe("persisted error log", () => {
  it("starts empty and appends newest last", () => {
    const storage = memoryStore();
    expect(loadErrors(storage)).toEqual([]);
    appendError(storage, "first");
    appendError(storage, "second");
    const errors = loadErrors(storage);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain("first");
    expect(errors[1]).toContain("second");
  });

  it("timestamps each entry", () => {
    const storage = memoryStore();
    appendError(storage, "boom");
    expect(loadErrors(storage)[0]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("keeps only the most recent 20", () => {
    const storage = memoryStore();
    for (let i = 0; i < 25; i++) appendError(storage, `e${i}`);
    const errors = loadErrors(storage);
    expect(errors).toHaveLength(20);
    expect(errors[19]).toContain("e24");
    expect(errors.join()).not.toContain("e4,");
  });

  it("survives corrupt stored data", () => {
    const storage = memoryStore();
    storage.setItem("teslaport:errors", "]]]");
    expect(loadErrors(storage)).toEqual([]);
  });

  it("ignores stored errors that are valid JSON but the wrong shape (object instead of array)", () => {
    const storage = memoryStore();
    storage.setItem("teslaport:errors", JSON.stringify({ not: "an array" }));
    expect(loadErrors(storage)).toEqual([]);
  });

  it("filters out non-string entries within an otherwise valid array", () => {
    const storage = memoryStore();
    storage.setItem("teslaport:errors", JSON.stringify(["real error", 42, null, { oops: true }]));
    expect(loadErrors(storage)).toEqual(["real error"]);
  });
});
