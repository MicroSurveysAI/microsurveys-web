import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TriggerEngine } from "../src/triggerEngine";
import type { Decision } from "../src/triggerEngine";
import { TriggerStateStore } from "../src/persistence";
import { createClient } from "../src/client";
import type { ApiClient } from "../src/apiClient";
import { debugKey, debugProperties } from "../src/debug";
import type { Survey, TriggerStep } from "../src/types";

// The live debugger: why the engine did or didn't schedule each survey for an
// event, reported only from test devices the dashboard picked.

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

function survey(over: Partial<Survey> = {}, steps: TriggerStep[] = [{ order: 0, event: "checkout", match: {} }]): Survey {
  return {
    id: "svy_1",
    name: "Test",
    questions: [],
    samplePercent: 100,
    maxPerUserDays: 0,
    platforms: [],
    triggers: [{ id: "t", type: steps.length > 1 ? "SEQUENCE" : "SINGLE", delaySeconds: 2, sequenceWindowSeconds: null, fireEvery: 1, warmupCount: 0, steps }],
    ...over,
  } as Survey;
}

function decide(s: Survey, events: [string, Record<string, unknown>][], userProperties = {}): Decision[] {
  const decisions: Decision[] = [];
  const engine = new TriggerEngine({
    store: new TriggerStateStore(),
    surveysProvider: () => [s],
    identityProvider: () => ({ anonymousId: "u1", userProperties }),
    onPresent: () => {},
    platform: "web",
    now: () => 1_000,
    onDecision: (d) => decisions.push(d),
  });
  for (const [name, props] of events) engine.process(name, props);
  engine.stop();
  return decisions;
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("engine decisions", () => {
  it("reports eligible with the delay", () => {
    expect(decide(survey(), [["checkout", {}]])).toEqual([{ surveyId: "svy_1", triggerId: "t", reason: "eligible", delaySeconds: 2 }]);
  });

  it("stays quiet about surveys whose trigger doesn't name the event", () => {
    expect(decide(survey(), [["app_opened", {}]])).toEqual([]);
  });

  it("explains a property mismatch", () => {
    const s = survey({}, [{ order: 0, event: "checkout", match: { screen: "cart" } }]);
    expect(decide(s, [["checkout", { screen: "home" }]]).map((d) => d.reason)).toEqual(["property_mismatch"]);
  });

  it("explains a sequence that isn't complete yet", () => {
    const s = survey({}, [
      { order: 0, event: "search", match: {} },
      { order: 1, event: "checkout", match: {} },
    ]);
    expect(decide(s, [["search", {}]]).map((d) => d.reason)).toEqual(["sequence_in_progress"]);
  });

  it("names the eligibility rule that blocked the survey", () => {
    expect(decide(survey({ platforms: ["ios"] }), [["checkout", {}]]).map((d) => d.reason)).toEqual(["platform"]);
    expect(decide(survey({ audienceMatch: { plan: "pro" } }), [["checkout", {}]], { plan: "free" }).map((d) => d.reason)).toEqual([
      "audience",
    ]);
    expect(decide(survey({ samplePercent: 0 }), [["checkout", {}]]).map((d) => d.reason)).toEqual(["sampled_out"]);
    expect(decide(survey({ endsAt: "1970-01-01T00:00:01Z" }), [["checkout", {}]]).map((d) => d.reason)).toEqual(["ended"]);
  });
});

describe("debugKey", () => {
  it("is the same FNV-1a hash every SDK computes", () => {
    // Shared vector: iOS and React Native assert the same value.
    expect(debugKey("p1", "u1")).toBe("309cd11f");
  });
});

describe("debugProperties", () => {
  it("keeps scalars and summarises the rest", () => {
    expect(debugProperties({ a: "x".repeat(250), b: 2, c: [1, 2], d: { e: 1 }, f: null })).toEqual({
      a: `${"x".repeat(200)}…`,
      b: 2,
      c: "[2 items]",
      d: "{…}",
      f: null,
    });
  });
});

describe("client debugger", () => {
  let sent: { path: string; body: Record<string, unknown> }[];

  beforeEach(() => {
    sent = [];
    vi.stubGlobal("navigator", { language: "en-US" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        sent.push({ path: new URL(url).pathname, body: JSON.parse(init.body as string) });
        return new Response("{}", { status: 200 });
      }),
    );
  });

  function client(debugUsers: string[]) {
    const rawConfig = JSON.stringify({ projectId: "p1", surveys: [survey()], debugUsers });
    localStorage.setItem("com.microsurveys.config.cache", JSON.stringify({ rawConfig, etag: null, storedAt: Date.now() }));
    const c = createClient({ apiKey: "ms_test_x", refreshOnForeground: false });
    c.identify("u1");
    return c;
  }

  async function settle(c: ReturnType<typeof createClient>) {
    for (let i = 0; i < 10; i++) await Promise.resolve();
    await (c as unknown as { api: ApiClient }).api.flush();
  }

  it("sends each event with its decisions from a test device", async () => {
    const c = client([debugKey("p1", "u1")]);
    c.track("checkout", { cart: 2 });
    await settle(c);
    c.stop();
    const upload = sent.find((s) => s.path === "/api/sdk/debug");
    expect(upload?.body.endUserId).toBe("u1");
    expect(upload?.body.entries).toMatchObject([
      { event: "checkout", properties: { cart: 2 }, decisions: [{ surveyId: "svy_1", reason: "eligible" }] },
    ]);
  });

  it("sends nothing from any other device", async () => {
    const c = client([debugKey("p1", "someone_else")]);
    c.track("checkout", {});
    await settle(c);
    c.stop();
    expect(sent.some((s) => s.path === "/api/sdk/debug")).toBe(false);
  });
});
