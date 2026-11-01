import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClient } from "../src/client";
import { ApiClient } from "../src/apiClient";
import { EventCounter, MAX_KEYS, MAX_NAMES } from "../src/eventCounter";
import { SDK_VERSION } from "../src/version";

// Event signals: when the project turns them on, the SDK uploads how often each
// event fired, with property names but never values.

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, v),
  };
}

let sent: { path: string; body: Record<string, unknown> }[];

function cacheConfig(eventSignals: boolean) {
  const rawConfig = JSON.stringify({ projectId: "p1", surveys: [], eventSignals });
  localStorage.setItem("com.microsurveys.config.cache", JSON.stringify({ rawConfig, etag: null, storedAt: Date.now() }));
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeEach(() => {
  sent = [];
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("navigator", { language: "en-US" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      sent.push({ path: new URL(url).pathname, body: JSON.parse(init.body as string) });
      return new Response("{}", { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("EventCounter", () => {
  it("counts each name and keeps property names, not values", () => {
    const c = new EventCounter();
    c.record("checkout", { cart: 3, coupon: "SAVE10" }, 1000);
    c.record("checkout", { cart: 1, screen: "cart" }, 3000);
    c.record("app_opened", {}, 2000);
    const [checkout, opened] = c.drain();
    expect(checkout).toEqual({
      name: "checkout",
      count: 2,
      firstSeenAt: new Date(1000).toISOString(),
      lastSeenAt: new Date(3000).toISOString(),
      propertyKeys: ["cart", "coupon", "screen"],
    });
    expect(JSON.stringify(checkout)).not.toContain("SAVE10");
    expect(opened?.count).toBe(1);
    expect(c.size).toBe(0);
  });

  it("caps distinct names and property names per window", () => {
    const c = new EventCounter();
    for (let i = 0; i < MAX_NAMES + 5; i++) c.record(`e${i}`);
    expect(c.size).toBe(MAX_NAMES);
    c.record("e0", Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, i])));
    expect(c.drain()[0]?.propertyKeys).toHaveLength(MAX_KEYS);
  });

  it("ignores empty and overlong names", () => {
    const c = new EventCounter();
    c.record("");
    c.record("x".repeat(201));
    expect(c.size).toBe(0);
  });
});

describe("client event signals", () => {
  it("uploads counts with the device context and SDK version when the project has them on", async () => {
    cacheConfig(true);
    const client = createClient({ apiKey: "ms_test_x", appVersion: "3.2.0", refreshOnForeground: false });
    client.track("checkout", { cart: 2 });
    client.track("checkout", { cart: 3 });
    client.flushEventCounts();
    await settle();
    await (client as unknown as { api: ApiClient }).api.flush();

    const upload = sent.find((s) => s.path === "/api/sdk/events");
    expect(upload?.body.context).toEqual({ platform: "web", appVersion: "3.2.0", locale: "en-US", sdkVersion: SDK_VERSION });
    expect(upload?.body.events).toMatchObject([{ name: "checkout", count: 2, propertyKeys: ["cart"] }]);
  });

  it("counts nothing when the project has them off", async () => {
    cacheConfig(false);
    const client = createClient({ apiKey: "ms_test_x", refreshOnForeground: false });
    client.track("checkout", { cart: 2 });
    client.flushEventCounts();
    await settle();
    expect(sent.some((s) => s.path === "/api/sdk/events")).toBe(false);
  });
});
