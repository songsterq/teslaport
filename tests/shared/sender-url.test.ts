import { describe, it, expect } from "vitest";
import { normaliseInputUrl } from "../../src/client/sender";

describe("sender input normalisation", () => {
  it("accepts full http(s) urls unchanged", () => {
    expect(normaliseInputUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(normaliseInputUrl("http://example.com/")).toBe("http://example.com/");
  });

  it("prepends https to a bare host", () => {
    expect(normaliseInputUrl("example.com")).toBe("https://example.com/");
    expect(normaliseInputUrl("example.com/path")).toBe("https://example.com/path");
  });

  it("trims surrounding whitespace", () => {
    expect(normaliseInputUrl("  https://example.com/  ")).toBe("https://example.com/");
  });

  it("rejects non-http schemes", () => {
    expect(normaliseInputUrl("javascript:alert(1)")).toBeNull();
    expect(normaliseInputUrl("data:text/html,x")).toBeNull();
    expect(normaliseInputUrl("file:///etc/passwd")).toBeNull();
  });

  it("rejects empty and unparseable input", () => {
    expect(normaliseInputUrl("")).toBeNull();
    expect(normaliseInputUrl("   ")).toBeNull();
    expect(normaliseInputUrl("http://")).toBeNull();
  });
});
