/**
 * An in-memory stand-in for `window.localStorage`, used across the store test
 * suites. Re-exported from the production implementation so the tests exercise
 * the same stand-in the app falls back to when storage is blocked.
 */
export { memoryStore } from "../../src/client/storage";
