import { describe, it, expect, vi, afterEach } from "vitest";
import { connect, nextDelay } from "../../src/shared/socket";

/** Minimal stand-in for the browser WebSocket, driven by hand from the tests. */
class FakeSocket {
  static readonly OPEN = 1;
  static instances: FakeSocket[] = [];

  readyState = 0;
  binaryType = "";
  closed = false;
  private listeners = new Map<string, Array<(event: unknown) => void>>();

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  addEventListener(type: string, fn: (event: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  emit(type: string, event: unknown = {}): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(event);
  }

  fireOpen(): void {
    this.readyState = FakeSocket.OPEN;
    this.emit("open");
  }

  close(): void {
    this.closed = true;
    this.readyState = 3;
    this.emit("close");
  }

  send(): void {}
}

/** Installs the browser globals `connect` reaches for, and returns a dispatcher. */
function installBrowserEnv(): { dispatch(type: string): void; restore(): void } {
  const windowListeners = new Map<string, Array<() => void>>();
  const target = globalThis as unknown as Record<string, unknown>;
  const saved = {
    WebSocket: target.WebSocket,
    window: target.window,
    document: target.document,
  };

  target.WebSocket = FakeSocket;
  target.window = {
    addEventListener(type: string, fn: () => void): void {
      windowListeners.set(type, [...(windowListeners.get(type) ?? []), fn]);
    },
    removeEventListener(type: string, fn: () => void): void {
      windowListeners.set(type, (windowListeners.get(type) ?? []).filter((f) => f !== fn));
    },
  };
  target.document = {
    visibilityState: "visible",
    addEventListener(): void {},
    removeEventListener(): void {},
  };

  return {
    dispatch(type) {
      for (const fn of [...(windowListeners.get(type) ?? [])]) fn();
    },
    restore() {
      target.WebSocket = saved.WebSocket;
      target.window = saved.window;
      target.document = saved.document;
    },
  };
}

describe("reconnect backoff", () => {
  it("starts around one second and jitters within half the base", () => {
    expect(nextDelay(0, () => 0)).toBe(500);
    expect(nextDelay(0, () => 1)).toBe(1000);
  });

  it("doubles per attempt", () => {
    expect(nextDelay(1, () => 1)).toBe(2000);
    expect(nextDelay(2, () => 1)).toBe(4000);
    expect(nextDelay(3, () => 1)).toBe(8000);
  });

  it("caps at thirty seconds", () => {
    expect(nextDelay(20, () => 1)).toBe(30000);
    expect(nextDelay(20, () => 0)).toBe(15000);
  });

  it("always returns a positive integer", () => {
    for (let attempt = 0; attempt < 25; attempt++) {
      const delay = nextDelay(attempt);
      expect(Number.isInteger(delay)).toBe(true);
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThanOrEqual(30000);
    }
  });
});

// `Array.prototype.at` is ES2022; these tests compile against the project's
// ES2019 lib, same as the code they exercise.
const last = <T>(items: T[]): T => items[items.length - 1]!;

describe("reconnecting socket", () => {
  afterEach(() => {
    FakeSocket.instances = [];
    vi.useRealTimers();
  });

  function start(): { statuses: string[]; env: ReturnType<typeof installBrowserEnv> } {
    const env = installBrowserEnv();
    vi.useFakeTimers();
    const statuses: string[] = [];
    connect("ws://teslaport.test/ws/room?role=receiver", {
      onStatus: (status) => void statuses.push(status),
      onFrame: () => {},
      onControl: () => {},
    });
    return { statuses, env };
  }

  it("connects and reports open", () => {
    const { statuses, env } = start();
    expect(FakeSocket.instances).toHaveLength(1);
    FakeSocket.instances[0]!.fireOpen();
    expect(statuses).toEqual(["connecting", "open"]);
    env.restore();
  });

  // The car's browser is not trusted to fire `online` after `offline`. If the
  // offline event gated retries, a single spurious one would strand the page
  // on a dead socket until someone reloaded it -- on a screen with no devtools.
  it("keeps retrying after offline even when online never fires", () => {
    const { statuses, env } = start();
    FakeSocket.instances[0]!.fireOpen();

    env.dispatch("offline");
    expect(last(statuses)).toBe("closed");
    expect(FakeSocket.instances[0]!.closed).toBe(true);

    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances.length).toBeGreaterThan(1);

    last(FakeSocket.instances).fireOpen();
    expect(last(statuses)).toBe("open");
    env.restore();
  });

  it("reconnects immediately when online does fire", () => {
    const { env } = start();
    FakeSocket.instances[0]!.fireOpen();
    env.dispatch("offline");

    env.dispatch("online");
    expect(FakeSocket.instances).toHaveLength(2);
    env.restore();
  });

  it("stops retrying once closed by the caller", () => {
    const env = installBrowserEnv();
    vi.useFakeTimers();
    const handle = connect("ws://teslaport.test/ws/room?role=receiver", {
      onStatus: () => {},
      onFrame: () => {},
      onControl: () => {},
    });
    FakeSocket.instances[0]!.fireOpen();
    handle.close();
    env.dispatch("offline");
    vi.advanceTimersByTime(120_000);
    expect(FakeSocket.instances).toHaveLength(1);
    env.restore();
  });
});
