import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClient } from "../src/client";
import { ApiClient, INGEST_TIMEOUT_MS, RETRY_BASE_MS, RETRY_MAX_MS } from "../src/apiClient";
import type { ActiveSurvey } from "../src/client";
import type { Survey, SurveyResult } from "../src/types";

// When impressions are sent (as the survey appears, again on dismissal) and how
// queued ingest is retried (backoff timer, return to the tab, back online).

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

type Sent = { path: string; body: Record<string, Record<string, unknown>[]> };

let sent: Sent[];
/** Ingest outcome per call, in order; once empty, every call succeeds. */
let outcomes: ("ok" | "offline" | "hang" | number)[];
let doc: EventTarget & { visibilityState: string };
let win: EventTarget;

const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  sent = [];
  outcomes = [];
  doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  win = new EventTarget();
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", win);
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("navigator", { language: "en-US" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const path = new URL(url).pathname;
      if (path === "/api/sdk/config") return new Response(null, { status: 304 });
      const outcome = outcomes.shift() ?? "ok";
      if (outcome === "offline") throw new TypeError("Failed to fetch");
      if (outcome === "hang") {
        // Never answers; only the abort signal ends it.
        return new Promise<Response>((_, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        });
      }
      if (outcome !== "ok") return new Response("{}", { status: outcome });
      sent.push({ path, body: JSON.parse(init.body as string) });
      return new Response("{}", { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const survey = {
  id: "svy_1",
  name: "Checkout",
  questions: [{ id: "q1", order: 0, type: "THUMBS", prompt: "?", config: {} }],
  samplePercent: 100,
  maxPerUserDays: 0,
  platforms: [],
  triggers: [
    {
      id: "trg_1",
      type: "SINGLE",
      delaySeconds: 0,
      sequenceWindowSeconds: null,
      fireEvery: 1,
      warmupCount: 0,
      steps: [{ order: 0, event: "checkout_completed", match: {} }],
    },
  ],
} as unknown as Survey;

function cacheConfig() {
  const rawConfig = JSON.stringify({ projectId: "p1", surveys: [survey] });
  localStorage.setItem("com.microsurveys.config.cache", JSON.stringify({ rawConfig, etag: "e1", storedAt: Date.now() }));
}

const impressions = () => sent.filter((s) => s.path === "/api/sdk/impressions").map((s) => s.body.impressions![0]!);
const responses = () => sent.filter((s) => s.path === "/api/sdk/responses").map((s) => s.body.responses![0]!);

/** A started client with the survey cached, presented and handed back. */
async function presented() {
  cacheConfig();
  const client = createClient({ apiKey: "ms_test_x", refreshOnForeground: false });
  client.start();
  let active: ActiveSurvey | null = null;
  client.onPresent((a) => (active = a));
  client.track("checkout_completed");
  await settle();
  if (!active) throw new Error("survey was not presented");
  return { client, active: active as ActiveSurvey };
}

const dismissed: SurveyResult = { answers: [], completed: false, dismissed: true };
const completed: SurveyResult = { answers: [{ questionId: "q1", value: { value: "up" } }], completed: true, dismissed: false };

describe("impression timing", () => {
  it("queues the impression when the survey is shown, before it closes", async () => {
    const { client, active } = await presented();
    expect(impressions()).toHaveLength(0);

    active.shown();
    active.shown(); // idempotent
    await settle();

    expect(impressions()).toHaveLength(1);
    expect(impressions()[0]).toMatchObject({ surveyId: "svy_1", triggerId: "trg_1", dismissed: false });
    expect(responses()).toHaveLength(0);
    client.stop();
  });

  it("re-sends the same impression with dismissed=true on a dismissal", async () => {
    const { client, active } = await presented();
    active.shown();
    await settle();
    vi.advanceTimersByTime(5_000);
    active.close(dismissed);
    await settle();

    const [shown, closed] = impressions();
    expect(impressions()).toHaveLength(2);
    expect(closed).toEqual({ ...shown, dismissed: true });
    // A pure dismissal is not a response.
    expect(responses()).toHaveLength(0);
    client.stop();
  });

  it("doesn't re-send on completion; the response points at the impression", async () => {
    const { client, active } = await presented();
    active.shown();
    active.close(completed);
    await settle();

    expect(impressions()).toHaveLength(1);
    expect(impressions()[0]!.dismissed).toBe(false);
    expect(responses()).toHaveLength(1);
    expect(responses()[0]!.impressionId).toBe(impressions()[0]!.clientId);
    client.stop();
  });

  it("sends one impression at close when the host never reported it shown", async () => {
    const { client, active } = await presented();
    active.close(dismissed);
    await settle();
    expect(impressions()).toHaveLength(1);
    expect(impressions()[0]!.dismissed).toBe(true);
    client.stop();
  });

  it("a close without a result sends nothing more and frees the slot", async () => {
    const { client, active } = await presented();
    active.shown();
    active.close();
    active.close(dismissed); // already closed: ignored
    await settle();
    expect(impressions()).toHaveLength(1);
    expect(impressions()[0]!.dismissed).toBe(false);

    // The next eligible survey can present.
    let next: ActiveSurvey | null = null;
    client.onPresent((a) => (next = a));
    client.track("checkout_completed");
    await settle();
    expect(next).not.toBeNull();
    client.stop();
  });

  it("inline surveys send the impression when shown too", async () => {
    const client = createClient({ apiKey: "ms_test_x", refreshOnForeground: false });
    const inline = client.presentInline(survey);
    inline.shown();
    await settle();
    expect(impressions()).toHaveLength(1);
    expect("triggerId" in impressions()[0]!).toBe(false);
    inline.close(dismissed);
    await settle();
    expect(impressions()[1]).toEqual({ ...impressions()[0], dismissed: true });
  });
});

describe("ingest retry", () => {
  const record = (api: ApiClient) =>
    api.recordImpression({ surveyId: "s", triggerId: null, endUserId: "u", shownAt: new Date(), dismissed: false, context: {} });

  it("retries a failed send on its own, without a new enqueue", async () => {
    const api = new ApiClient("ms_test_x", "https://example.test");
    outcomes = ["offline"];
    record(api);
    await settle();
    expect(sent).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(RETRY_BASE_MS);
    expect(sent).toHaveLength(1);
    // Delivered: no timer left behind.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("backs off 2 s, 4 s, 8 s … up to 30 s, and resets after a success", async () => {
    const api = new ApiClient("ms_test_x", "https://example.test");
    outcomes = [503, 429, "offline", 503, 503, 503];
    record(api);
    await settle(); // fails (1)
    const fetchMock = vi.mocked(fetch);
    const calls = () => fetchMock.mock.calls.length;

    await vi.advanceTimersByTimeAsync(RETRY_BASE_MS - 1);
    expect(calls()).toBe(1);
    await vi.advanceTimersByTimeAsync(1); // 2 s → fails (2)
    expect(calls()).toBe(2);
    await vi.advanceTimersByTimeAsync(4_000); // → fails (3)
    expect(calls()).toBe(3);
    await vi.advanceTimersByTimeAsync(8_000); // → fails (4)
    expect(calls()).toBe(4);
    await vi.advanceTimersByTimeAsync(16_000); // → fails (5)
    expect(calls()).toBe(5);
    await vi.advanceTimersByTimeAsync(RETRY_MAX_MS - 1); // capped, not 32 s
    expect(calls()).toBe(5);
    await vi.advanceTimersByTimeAsync(1); // → fails (6)
    expect(calls()).toBe(6);
    await vi.advanceTimersByTimeAsync(RETRY_MAX_MS); // → succeeds
    expect(sent).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);

    // A new failure starts again at 2 s.
    outcomes = ["offline"];
    record(api);
    await settle();
    await vi.advanceTimersByTimeAsync(RETRY_BASE_MS);
    expect(sent).toHaveLength(2);
  });

  it("drops an entry the server rejects with a 4xx, and keeps order", async () => {
    const api = new ApiClient("ms_test_x", "https://example.test");
    outcomes = [400];
    const first = record(api);
    const second = record(api);
    await settle();
    expect(sent.map((s) => s.body.impressions![0]!.clientId)).toEqual([second]);
    expect(first).not.toBe(second);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts a stalled request and retries it", async () => {
    const api = new ApiClient("ms_test_x", "https://example.test");
    outcomes = ["hang"];
    record(api);
    await settle();
    expect(sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(INGEST_TIMEOUT_MS);
    // Aborted; the retry is scheduled, and the queue isn't held by a stuck flush.
    await vi.advanceTimersByTimeAsync(RETRY_BASE_MS);
    expect(sent).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a flush asked for during a flush is joined, and sends what was queued", async () => {
    const api = new ApiClient("ms_test_x", "https://example.test");
    record(api);
    const joined = api.flush(); // first flush is still awaiting its POST
    record(api);
    await joined;
    await settle();
    expect(sent).toHaveLength(2);
  });

  it("stop() clears the retry timer", async () => {
    cacheConfig();
    const client = createClient({ apiKey: "ms_test_x", refreshOnForeground: false });
    client.start();
    await settle();
    outcomes = ["offline", "offline"];
    client.presentInline(survey).shown();
    await settle();
    expect(sent).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(2); // event-count upload interval + the retry
    client.stop();
    await settle();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("flush on foreground and online", () => {
  async function failedOnce() {
    const client = createClient({ apiKey: "ms_test_x", refreshOnForeground: false });
    client.start();
    await settle();
    outcomes = ["offline"];
    client.presentInline(survey).shown();
    await settle();
    expect(impressions()).toHaveLength(0);
    return client;
  }

  it("flushes when the browser comes back online", async () => {
    const client = await failedOnce();
    win.dispatchEvent(new Event("online"));
    await settle();
    expect(impressions()).toHaveLength(1);
    client.stop();
  });

  it("flushes when the tab becomes visible", async () => {
    const client = await failedOnce();
    doc.visibilityState = "hidden";
    doc.dispatchEvent(new Event("visibilitychange"));
    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(impressions()).toHaveLength(1);
    client.stop();
  });

  it("stops listening for online after stop()", async () => {
    const client = await failedOnce();
    client.stop();
    win.dispatchEvent(new Event("online"));
    await settle();
    expect(impressions()).toHaveLength(0);
  });
});
