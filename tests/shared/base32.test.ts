import { describe, it, expect } from "vitest";
import { encodeBase32, decodeBase32, CROCKFORD_ALPHABET } from "../../src/shared/base32";

const SEED_BYTES = 15;

describe("crockford base32", () => {
  it("uses the Crockford alphabet, excluding I L O U", () => {
    expect(CROCKFORD_ALPHABET).toBe("0123456789ABCDEFGHJKMNPQRSTVWXYZ");
    for (const ch of "ILOU") expect(CROCKFORD_ALPHABET).not.toContain(ch);
  });

  it("encodes 15 bytes to exactly 24 characters", () => {
    const bytes = new Uint8Array(SEED_BYTES).fill(0xab);
    expect(encodeBase32(bytes)).toHaveLength(24);
  });

  it("encodes all-zero and all-one seeds to known vectors", () => {
    expect(encodeBase32(new Uint8Array(15))).toBe("0".repeat(24));
    expect(encodeBase32(new Uint8Array(15).fill(0xff))).toBe("Z".repeat(24));
  });

  it("round-trips random seeds", () => {
    for (let i = 0; i < 200; i++) {
      const bytes = crypto.getRandomValues(new Uint8Array(SEED_BYTES));
      expect(decodeBase32(encodeBase32(bytes), SEED_BYTES)).toEqual(bytes);
    }
  });

  it("decodes case-insensitively and ignores dashes and spaces", () => {
    const bytes = crypto.getRandomValues(new Uint8Array(SEED_BYTES));
    const code = encodeBase32(bytes);
    const grouped = code.match(/.{1,6}/g)!.join("-");
    expect(decodeBase32(code.toLowerCase(), SEED_BYTES)).toEqual(bytes);
    expect(decodeBase32(grouped, SEED_BYTES)).toEqual(bytes);
    expect(decodeBase32(" " + grouped + " ", SEED_BYTES)).toEqual(bytes);
  });

  it("maps the confusable letters O to 0 and I/L to 1", () => {
    const canonical = "0".repeat(23) + "1";
    const confused = "O".repeat(23) + "I";
    const confused2 = "o".repeat(23) + "l";
    expect(decodeBase32(confused, SEED_BYTES)).toEqual(decodeBase32(canonical, SEED_BYTES));
    expect(decodeBase32(confused2, SEED_BYTES)).toEqual(decodeBase32(canonical, SEED_BYTES));
  });

  it("rejects U, other invalid characters, and wrong lengths", () => {
    expect(() => decodeBase32("U".repeat(24), SEED_BYTES)).toThrow(/invalid character/i);
    expect(() => decodeBase32("!".repeat(24), SEED_BYTES)).toThrow(/invalid character/i);
    expect(() => decodeBase32("0".repeat(23), SEED_BYTES)).toThrow(/length/i);
    expect(() => decodeBase32("0".repeat(25), SEED_BYTES)).toThrow(/length/i);
  });
});
