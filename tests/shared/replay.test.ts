import { describe, it, expect } from "vitest";
import { createSeenStore } from "../../src/shared/replay";
import { memoryStore } from "../helpers/memory-store";

describe("seen-id store", () => {
  it("reports unseen ids as absent and seen ids as present", () => {
    const seen = createSeenStore(memoryStore());
    expect(seen.has("a")).toBe(false);
    seen.add("a");
    expect(seen.has("a")).toBe(true);
    expect(seen.has("b")).toBe(false);
  });

  it("persists across instances backed by the same storage", () => {
    const storage = memoryStore();
    createSeenStore(storage).add("a");
    expect(createSeenStore(storage).has("a")).toBe(true);
  });

  it("evicts the oldest ids beyond the limit", () => {
    const seen = createSeenStore(memoryStore(), "k", 3);
    seen.add("1"); seen.add("2"); seen.add("3"); seen.add("4");
    expect(seen.has("1")).toBe(false);
    expect(seen.has("2")).toBe(true);
    expect(seen.has("4")).toBe(true);
  });

  it("clear forgets everything", () => {
    const seen = createSeenStore(memoryStore());
    seen.add("a");
    seen.clear();
    expect(seen.has("a")).toBe(false);
  });

  it("survives corrupt stored data by starting empty", () => {
    const storage = memoryStore();
    storage.setItem("teslaport:seen", "{not json");
    const seen = createSeenStore(storage);
    expect(seen.has("a")).toBe(false);
    seen.add("a");
    expect(seen.has("a")).toBe(true);
  });

  it("survives stored data that is valid JSON but not an array", () => {
    const storage = memoryStore();
    storage.setItem("teslaport:seen", JSON.stringify({ not: "an array" }));
    const seen = createSeenStore(storage);
    expect(seen.has("a")).toBe(false);
    seen.add("a");
    expect(seen.has("a")).toBe(true);
  });

  it("de-duplicates ids that are already duplicated in stored data, so the in-memory set and the persisted array cannot drift apart", () => {
    const storage = memoryStore();
    storage.setItem("teslaport:seen", JSON.stringify(["a", "a", "b"]));
    const seen = createSeenStore(storage, undefined, 2);
    expect(seen.has("a")).toBe(true);
    expect(seen.has("b")).toBe(true);
    // Limit is 2 and the store already holds 2 unique ids ("a", "b"); adding a
    // third must evict exactly the oldest one rather than treating the
    // duplicate "a" entry as a phantom slot.
    seen.add("c");
    expect(seen.has("a")).toBe(false);
    expect(seen.has("b")).toBe(true);
    expect(seen.has("c")).toBe(true);
  });

  it("adding the same id twice never grows the persisted array", () => {
    const storage = memoryStore();
    const seen = createSeenStore(storage);
    seen.add("a");
    seen.add("a");
    const raw = storage.getItem("teslaport:seen");
    expect(JSON.parse(raw ?? "[]")).toEqual(["a"]);
  });
});
