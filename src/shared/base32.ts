export const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const DECODE_MAP: Record<string, number> = (() => {
  const map: Record<string, number> = {};
  for (let i = 0; i < CROCKFORD_ALPHABET.length; i++) {
    map[CROCKFORD_ALPHABET.charAt(i)] = i;
  }
  // Crockford's confusable substitutions.
  map["O"] = 0;
  map["I"] = 1;
  map["L"] = 1;
  return map;
})();

export function encodeBase32(bytes: Uint8Array): string {
  let value = 0;
  let bits = 0;
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i]!;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD_ALPHABET.charAt((value >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += CROCKFORD_ALPHABET.charAt((value << (5 - bits)) & 31);
  }
  return out;
}

export function decodeBase32(text: string, expectedBytes: number): Uint8Array {
  const clean = text.toUpperCase().replace(/[-\s]/g, "");
  const requiredLength = Math.ceil((expectedBytes * 8) / 5);
  if (clean.length !== requiredLength) {
    throw new Error(
      `code has the wrong length: expected ${requiredLength} characters for ${expectedBytes} bytes, got ${clean.length}`,
    );
  }
  const out = new Uint8Array(expectedBytes);
  let value = 0;
  let bits = 0;
  let written = 0;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean.charAt(i);
    const digit = DECODE_MAP[ch];
    if (digit === undefined) {
      throw new Error(`invalid character in code: ${ch}`);
    }
    value = (value << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      out[written++] = (value >>> (bits - 8)) & 0xff;
      bits -= 8;
    }
  }
  return out;
}
