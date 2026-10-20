import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClient } from "../src/client";
import { ApiClient } from "../src/apiClient";
import type { Survey } from "../src/types";

// What the SDK sends to /api/sdk/impressions and /api/sdk/responses: a response
// must point back to the impression of the same showing, and both carry the
// device context (API-CONTRACT "Device context").

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

type Sent = { path: string; body: Record<string, unknown[]> };

let sent: Sent[];

beforeEach(() => {
  sent = [];
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("navigator", { language: "pt-BR" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      sent.push({ path: new URL(url).pathname, body: JSON.parse(init.body as string) });
      return new Response(JSON.stringify({ accepted: 1 }), { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The single item posted to `path` (e.g. the one impression). */
function item(path: string, key: string): Record<string, unknown> {
  const entry = sent.find((s) => s.path === path);
  return (entry?.body[key]?.[0] ?? {}) as Record<string, unknown>;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

const survey: Survey = {
  id: "svy_1",
  name: "Checkout",
  maxPerUserDays: 0,
  samplePercent: 100,
  dismissible: true,
  presentation: null,
  successMessage: null,
  platforms: null,
  audienceMatch: {},
  startsAt: null,
  endsAt: null,
  questions: [],
  triggers: [],
} as unknown as Survey;

describe("ingest payloads", () => {
  it("links the response to its impression and sends the device context", async () => {
    const client = createClient({ apiKey: "ms_test_x", appVersion: "3.2.0", refreshOnForeground: false });
    client.recordInline(
      survey,
      { completed: true, dismissed: false, answers: [{ questionId: "q1", value: { value: 5 } }] },
      new Date(),
    );
    // The first enqueue starts a flush; the second waits for the next one.
    await settle();
    await (client as unknown as { api: ApiClient }).api.flush();

    const impression = item("/api/sdk/impressions", "impressions");
    const response = item("/api/sdk/responses", "responses");
    const context = { platform: "web", appVersion: "3.2.0", locale: "pt-BR" };

    expect(impression.context).toEqual(context);
    expect(response.context).toEqual(context);
    expect(response.impressionId).toBe(impression.clientId);
    // Inline embeds have no trigger, so the key is left out rather than sent as null.
    expect("triggerId" in response).toBe(false);
  });

  it("sends the trigger that fired with the response", async () => {
    const api = new ApiClient("ms_test_x", "https://example.test");
    const impressionId = api.recordImpression({
      surveyId: "svy_1",
      triggerId: "trg_1",
      endUserId: "u1",
      shownAt: new Date(),
      dismissed: false,
      context: { platform: "web" },
    });
    api.recordResponse({
      surveyId: "svy_1",
      endUserId: "u1",
      completed: true,
      submittedAt: new Date(),
      userProps: {},
      impressionId,
      triggerId: "trg_1",
      context: { platform: "web" },
      answers: [],
    });
    await settle();
    await api.flush();

    const response = item("/api/sdk/responses", "responses");
    expect(response.triggerId).toBe("trg_1");
    expect(response.impressionId).toBe(impressionId);
  });
});
