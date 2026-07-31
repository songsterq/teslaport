/**
 * A Uint8Array pinned to a non-shared ArrayBuffer. TypeScript 7's typed arrays
 * are generic over their buffer, and only this form satisfies DOM's
 * `BufferSource` — a bare `Uint8Array` is rejected by every crypto.subtle call.
 */
export type Bytes = Uint8Array<ArrayBuffer>;
