import { describe, it, expect } from "vitest";
import { loadHistory, pushHistory, clearHistory } from "../../src/client/history";
import { memoryStore } from "../helpers/memory-store";

describe("history store", () => {
  it("starts empty", () => {
    expect(loadHistory(memoryStore())).toEqual([]);
  });

  it("puts the newest entry first", () => {
    const storage = memoryStore();
    pushHistory(storage, { id: "1", url: "https://a.example/", ts: 1 });
    const list = pushHistory(storage, { id: "2", url: "https://b.example/", ts: 2 });
    expect(list.map((e) => e.id)).toEqual(["2", "1"]);
    expect(loadHistory(storage).map((e) => e.id)).toEqual(["2", "1"]);
  });

  it("caps at 20 entries", () => {
    const storage = memoryStore();
    for (let i = 0; i < 25; i++) pushHistory(storage, { id: String(i), url: "https://a.example/", ts: i });
    const list = loadHistory(storage);
    expect(list).toHaveLength(20);
    expect(list[0]!.id).toBe("24");
    expect(list[19]!.id).toBe("5");
  });

  it("clears", () => {
    const storage = memoryStore();
    pushHistory(storage, { id: "1", url: "https://a.example/", ts: 1 });
    clearHistory(storage);
    expect(loadHistory(storage)).toEqual([]);
  });

  it("survives corrupt stored data by starting empty", () => {
    const storage = memoryStore();
    storage.setItem("teslaport:history", "nonsense");
    expect(loadHistory(storage)).toEqual([]);
  });

  it("ignores stored history that is valid JSON but the wrong shape (object instead of array)", () => {
    const storage = memoryStore();
    storage.setItem("teslaport:history", JSON.stringify({ not: "an array" }));
    expect(loadHistory(storage)).toEqual([]);
  });

  it("filters out malformed entries within an otherwise valid array", () => {
    const storage = memoryStore();
    storage.setItem(
      "teslaport:history",
      JSON.stringify([
        { id: "1", url: "https://a.example/", ts: 1 },
        { id: "2" },
        "nonsense",
        42,
      ]),
    );
    expect(loadHistory(storage)).toEqual([{ id: "1", url: "https://a.example/", ts: 1 }]);
  });
});
