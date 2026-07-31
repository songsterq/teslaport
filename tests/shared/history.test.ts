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

  /**
   * The receiver assigns these straight to `anchor.href` on every page load,
   * so storage — which outlives the socket that was scheme-checked — is a
   * trust boundary of its own, not a cache of already-trusted data.
   */
  it("drops stored entries whose url is not http or https", () => {
    const storage = memoryStore();
    storage.setItem(
      "teslaport:history",
      JSON.stringify([
        { id: "1", url: "https://good.example/", ts: 1 },
        { id: "2", url: "javascript:alert(1)", ts: 2 },
        { id: "3", url: "data:text/html,<script>alert(1)</script>", ts: 3 },
        { id: "4", url: "file:///etc/passwd", ts: 4 },
        { id: "5", url: "not a url at all", ts: 5 },
        { id: "6", url: "http://also-good.example/", ts: 6 },
      ]),
    );
    expect(loadHistory(storage).map((e) => e.id)).toEqual(["1", "6"]);
  });

  it("refuses to store or return an entry with a disallowed scheme", () => {
    const storage = memoryStore();
    const rendered = pushHistory(storage, { id: "x", url: "javascript:alert(1)", ts: 1 });
    // pushHistory's return value is rendered directly, so it must be clean too.
    expect(rendered).toEqual([]);
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
