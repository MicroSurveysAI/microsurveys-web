import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClient } from "../src/client";
import { ApiClient, PENDING_PAGE_SIZE } from "../src/apiClient";
import type { PendingEvent } from "../src/apiClient";
import { advance } from "../src/triggerSequencer";
import { TriggerEngine } from "../src/triggerEngine";
import type { Decision } from "../src/triggerEngine";
import { TriggerStateStore } from "../src/persistence";
import { debugKey } from "../src/debug";
import { parseConfig, newTriggerRecord } from "../src/types";
import type { Survey, Trigger } from "../src/types";

// Server events: events the app's backend sends, waiting in a mailbox
// (`POST /api/sdk/pending`). The SDK checks on start, on return to the tab and
// on short timers, and replays each event at the time it happened.

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

const T = Date.parse("2026-11-02T08:00:00.000Z");
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

function rideTrigger(window: number | null = 2 * 60 * 60): Trigger {
  return {
    id: "t_ride",
    type: "SEQUENCE",
    delaySeconds: 0,
    sequenceWindowSeconds: window,
    fireEvery: 1,
    warmupCount: 0,
    steps: [
      { order: 0, event: "book_click", match: {} },
      { order: 1, event: "journey_completed", match: {} },
    ],
  };
}

function rideSurvey(trigger: Trigger = rideTrigger()): Survey {
  return {
    id: "svy_ride",
    name: "Ride",
    questions: [],
    samplePercent: 100,
    maxPerUserDays: 0,
    platforms: [],
    triggers: [trigger],
  } as unknown as Survey;
}

function pending(name: string, at: number, properties: Record<string, unknown> = {}): PendingEvent {
  return { id: `pe_${name}_${at}`, name, properties, occurredAt: new Date(at).toISOString() };
}

describe("config parsing", () => {
  it("reads pendingEvents and serverEvents", () => {
    const c = parseConfig(
      JSON.stringify({ projectId: "p1", surveys: [], pendingEvents: true, serverEvents: ["journey_completed", 3] }),
    );
    expect(c?.pendingEvents).toBe(true);
    expect(c?.serverEvents).toEqual(["journey_completed"]);
  });

  it("treats missing keys as off", () => {
    const c = parseConfig(JSON.stringify({ projectId: "p1", surveys: [] }));
    expect(c?.pendingEvents).toBe(false);
    expect(c?.serverEvents).toEqual([]);
  });
});

describe("sequencer: events from before the sequence started", () => {
  it("ignores a later step that happened before step 0, without resetting", () => {
    const t = rideTrigger(null);
    const started = advance(t, newTriggerRecord(), "book_click", {}, 1_000).record;
    const early = advance(t, started, "journey_completed", {}, 900);
    expect(early.satisfied).toBe(false);
    expect(early.record).toEqual(started);
  });

  it("doesn't restart the sequence on an earlier step 0", () => {
    const t = rideTrigger(null);
    const started = advance(t, newTriggerRecord(), "book_click", {}, 1_000).record;
    expect(advance(t, started, "book_click", {}, 900).record.startedAt).toBe(1_000);
  });

  it("advances on a step at or after the start", () => {
    const t = rideTrigger(null);
    const started = advance(t, newTriggerRecord(), "book_click", {}, 1_000).record;
    expect(advance(t, started, "journey_completed", {}, 1_000).satisfied).toBe(true);
  });
});

describe("engine event time", () => {
  function engineAt(nowS: number, decisions: Decision[]) {
    return new TriggerEngine({
      store: new TriggerStateStore(),
      surveysProvider: () => [rideSurvey()],
      identityProvider: () => ({ anonymousId: "u1", userProperties: {} }),
      onPresent: () => {},
      platform: "web",
      now: () => nowS,
      onDecision: (d) => decisions.push(d),
    });
  }

  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("measures the sequence window by when events happened", () => {
    const decisions: Decision[] = [];
    // Step 0 at T; step 1 happened 40 minutes later but is replayed 20 hours on.
    engineAt(T / 1000, decisions).process("book_click", {});
    const engine = engineAt((T + 20 * HOUR) / 1000, decisions);
    engine.process("journey_completed", {}, (T + 40 * MIN) / 1000);
    engine.stop();
    expect(decisions.at(-1)).toMatchObject({ surveyId: "svy_ride", reason: "eligible" });
  });

  it("without an event time, the same late step misses the window", () => {
    const decisions: Decision[] = [];
    engineAt(T / 1000, decisions).process("book_click", {});
    const engine = engineAt((T + 20 * HOUR) / 1000, decisions);
    engine.process("journey_completed", {});
    engine.stop();
    expect(decisions.some((d) => d.reason === "eligible")).toBe(false);
  });

  it("still checks the survey window against now", () => {
    const decisions: Decision[] = [];
    const ended = { ...rideSurvey(), endsAt: new Date(T + 10 * HOUR).toISOString() } as Survey;
    const make = (nowS: number) =>
      new TriggerEngine({
        store: new TriggerStateStore(),
        surveysProvider: () => [ended],
        identityProvider: () => ({ anonymousId: "u1", userProperties: {} }),
        onPresent: () => {},
        platform: "web",
        now: () => nowS,
        onDecision: (d) => decisions.push(d),
      });
    make(T / 1000).process("book_click", {});
    make((T + 20 * HOUR) / 1000).process("journey_completed", {}, (T + 40 * MIN) / 1000);
    expect(decisions.at(-1)?.reason).toBe("ended");
  });
});

describe("ApiClient.fetchPending", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the user id, omits missing ids, and parses the events", async () => {
    vi.stubGlobal("localStorage", memoryStorage());
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return Response.json({ events: [pending("journey_completed", T, { flow: "airport" }), { name: 7 }] });
      }),
    );
    const api = new ApiClient("ms_test_x", "https://api.example.com/");
    const { events, full } = await api.fetchPending({ userId: "u1", deviceId: null });
    expect(calls[0]?.url).toBe("https://api.example.com/api/sdk/pending");
    expect(calls[0]?.init.method).toBe("POST");
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({ userId: "u1" });
    expect(events).toEqual([pending("journey_completed", T, { flow: "airport" })]);
    expect(full).toBe(false);
  });

  it("throws on a server error", async () => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    await expect(new ApiClient("k", "https://api.example.com").fetchPending({ userId: "u1" })).rejects.toThrow();
  });
});

describe("client mailbox", () => {
  let doc: EventTarget & { visibilityState: string };
  let pendingCalls: Record<string, unknown>[];
  let sent: { path: string; body: Record<string, unknown> }[];
  /** Responses for the next mailbox calls; empty means no events. */
  let mailbox: (PendingEvent[] | Promise<PendingEvent[]>)[];

  function cacheConfig(over: Record<string, unknown> = {}) {
    const rawConfig = JSON.stringify({
      projectId: "p1",
      surveys: [rideSurvey()],
      pendingEvents: true,
      serverEvents: ["journey_completed"],
      ...over,
    });
    localStorage.setItem("com.microsurveys.config.cache", JSON.stringify({ rawConfig, etag: "e1", storedAt: Date.now() }));
  }

  function setVisibility(state: "visible" | "hidden") {
    doc.visibilityState = state;
    doc.dispatchEvent(new Event("visibilitychange"));
  }

  const settle = () => vi.advanceTimersByTimeAsync(0);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T);
    pendingCalls = [];
    sent = [];
    mailbox = [];
    doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
    vi.stubGlobal("document", doc);
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("navigator", { language: "en-US" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        const path = new URL(url).pathname;
        if (path === "/api/sdk/config") return new Response(null, { status: 304 });
        const body = JSON.parse(init.body as string) as Record<string, unknown>;
        if (path === "/api/sdk/pending") {
          pendingCalls.push(body);
          return Response.json({ events: await (mailbox.shift() ?? []) });
        }
        sent.push({ path, body });
        return new Response("{}", { status: 200 });
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function startedClient(opts: { identify?: boolean } = {}) {
    const client = createClient({ apiKey: "ms_test_x", refreshOnForeground: false });
    if (opts.identify !== false) client.identify("u1");
    client.start();
    return client;
  }

  it("checks once config is loaded, then 30 s, 90 s and every 5 minutes", async () => {
    cacheConfig();
    const client = startedClient();
    await settle();
    expect(pendingCalls).toEqual([{ userId: "u1" }]);
    await vi.advanceTimersByTimeAsync(30 * 1000);
    expect(pendingCalls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(pendingCalls).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(210 * 1000); // 5 minutes after start
    expect(pendingCalls).toHaveLength(4);
    client.stop();
    await vi.advanceTimersByTimeAsync(30 * MIN);
    expect(pendingCalls).toHaveLength(4);
  });

  it("never checks when the project has no server events", async () => {
    cacheConfig({ pendingEvents: false });
    const client = startedClient();
    await vi.advanceTimersByTimeAsync(10 * MIN);
    setVisibility("visible");
    await settle();
    expect(pendingCalls).toHaveLength(0);
    client.stop();
  });

  it("stops while hidden and checks again on return, even with a fresh config", async () => {
    cacheConfig();
    const client = startedClient();
    await settle();
    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(20 * MIN);
    expect(pendingCalls).toHaveLength(1);

    setVisibility("visible");
    await settle();
    expect(pendingCalls).toHaveLength(2);
    // Config was within its TTL (and foreground refresh is off): no config fetch.
    const fetchMock = vi.mocked(fetch);
    expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith("/api/sdk/config"))).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(30 * 1000);
    expect(pendingCalls).toHaveLength(3);
    client.stop();
  });

  it("keeps one request in flight", async () => {
    cacheConfig();
    let release: (events: PendingEvent[]) => void = () => {};
    mailbox.push(new Promise<PendingEvent[]>((r) => (release = r)));
    const client = startedClient();
    await settle();
    await vi.advanceTimersByTimeAsync(30 * 1000); // follow-up while the first is still open
    setVisibility("hidden");
    setVisibility("visible");
    await settle();
    expect(pendingCalls).toHaveLength(1);
    release([]);
    await settle();
    setVisibility("visible");
    await settle();
    expect(pendingCalls).toHaveLength(2);
    client.stop();
  });

  it("waits for a user id, and checks as soon as identify() sets one", async () => {
    cacheConfig();
    const client = startedClient({ identify: false });
    await settle();
    expect(pendingCalls).toHaveLength(0);
    client.identify("u1");
    await settle();
    expect(pendingCalls).toEqual([{ userId: "u1" }]);
    client.identify("u1", { plan: "pro" }); // same user: no extra check
    await settle();
    expect(pendingCalls).toHaveLength(1);
    client.stop();
  });

  it("calls again once when a full page comes back", async () => {
    cacheConfig();
    const page = Array.from({ length: PENDING_PAGE_SIZE }, (_, i) => pending("other_event", T - i * 1000));
    mailbox.push(page, page, page);
    const client = startedClient();
    await settle();
    expect(pendingCalls).toHaveLength(2);
    client.stop();
  });

  it("checks every minute while a sequence waits on a server event, for up to 3 hours", async () => {
    cacheConfig();
    const client = startedClient();
    await settle();
    client.track("book_click");
    await vi.advanceTimersByTimeAsync(120 * 1000);
    // start, 30 s, 60 s (waiting), 90 s, 120 s (waiting)
    expect(pendingCalls).toHaveLength(5);

    await vi.advanceTimersByTimeAsync(3 * HOUR - 120 * 1000 + MIN); // 3 h 1 min after the step
    const before = pendingCalls.length;
    await vi.advanceTimersByTimeAsync(3 * MIN); // no 5-minute check falls in here
    expect(pendingCalls).toHaveLength(before);
    client.stop();
  });

  it("replays at the event's time: a ride finished 40 min after booking, opened the next day", async () => {
    cacheConfig();
    const booking = createClient({ apiKey: "ms_test_x", refreshOnForeground: false });
    booking.identify("u1");
    booking.track("book_click");
    booking.stop();

    vi.setSystemTime(T + 20 * HOUR);
    mailbox.push([pending("journey_completed", T + 40 * MIN)]);
    const client = startedClient();
    const shown: string[] = [];
    client.onPresent(({ survey }) => shown.push(survey.id));
    await settle();
    await settle();
    expect(shown).toEqual(["svy_ride"]);
    client.stop();
  });

  it("replays in the order events happened", async () => {
    cacheConfig();
    mailbox.push([pending("journey_completed", T - 20 * MIN), pending("book_click", T - 50 * MIN)]);
    const client = startedClient();
    const shown: string[] = [];
    client.onPresent(({ survey }) => shown.push(survey.id));
    await settle();
    await settle();
    expect(shown).toEqual(["svy_ride"]);
    client.stop();
  });

  it("doesn't count replayed events in event signals", async () => {
    cacheConfig({ eventSignals: true });
    mailbox.push([pending("journey_completed", T - MIN)]);
    const client = startedClient();
    await settle();
    client.track("book_click");
    client.flushEventCounts();
    await settle();
    const upload = sent.find((s) => s.path === "/api/sdk/events");
    expect((upload?.body.events as { name: string }[]).map((e) => e.name)).toEqual(["book_click"]);
    client.stop();
  });

  it("sends debugger entries at the event's time", async () => {
    cacheConfig({ debugUsers: [debugKey("p1", "u1")] });
    mailbox.push([pending("journey_completed", T - 5 * MIN, { flow: "airport" })]);
    const client = startedClient();
    await settle();
    await settle();
    const entry = sent.find((s) => s.path === "/api/sdk/debug")?.body.entries as { at: string; event: string }[];
    expect(entry).toMatchObject([{ at: new Date(T - 5 * MIN).toISOString(), event: "journey_completed", properties: { flow: "airport" } }]);
    client.stop();
  });
});
