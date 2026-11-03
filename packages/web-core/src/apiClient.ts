//
// apiClient.ts
//
// `fetch`-based client for the SDK endpoints plus outbox flush. Every
// impression/response carries a UUID `clientId` so the server upserts and
// retries never duplicate (API-CONTRACT §Idempotency). Port of iOS `APIClient`.
//

import { Outbox } from "./outbox";
import { uuid } from "./storage";
import { parseConfig } from "./types";
import type { SDKConfig, SurveyAnswer, JsonObject, DeviceContext } from "./types";
import type { EventCount } from "./eventCounter";
import type { DebugEntry } from "./debug";

const API_VERSION = "2026-06-30";

export type ConfigFetchResult =
  | { kind: "notModified" }
  | { kind: "config"; rawText: string; config: SDKConfig | null; etag: string | null };

/** A server event waiting in the mailbox (API-CONTRACT §6). */
export interface PendingEvent {
  id: string;
  name: string;
  /** Only the keys triggers match on. */
  properties: Record<string, unknown>;
  /** When it happened (ISO 8601), not when it arrived. */
  occurredAt: string;
}

/** Most events the mailbox returns per call; a full page means call again. */
export const PENDING_PAGE_SIZE = 50;

export class ApiClient {
  private readonly apiKey: string;
  private readonly baseURL: string;
  private readonly outbox = new Outbox();
  private isFlushing = false;

  constructor(apiKey: string, baseURL: string) {
    this.apiKey = apiKey;
    // Normalize: no trailing slash so `${base}${path}` is clean.
    this.baseURL = baseURL.replace(/\/+$/, "");
  }

  // ── Config ─────────────────────────────────────────────────────────────────

  /** `GET /api/sdk/config` with optional `If-None-Match`. Resolves `notModified`
   *  on 304 so the caller keeps its cache. Throws on network/5xx errors. */
  async fetchConfig(etag: string | null): Promise<ConfigFetchResult> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "MS-Api-Version": API_VERSION,
    };
    if (etag) headers["If-None-Match"] = etag;

    const res = await fetch(this.endpoint("/api/sdk/config"), { method: "GET", headers });
    if (res.status === 304) return { kind: "notModified" };
    if (!res.ok) throw new Error(`config fetch failed: ${res.status}`);

    const rawText = await res.text();
    return { kind: "config", rawText, config: parseConfig(rawText), etag: res.headers.get("ETag") };
  }

  // ── Server events ───────────────────────────────────────────────────────────

  /** `POST /api/sdk/pending`: takes this user's waiting server events, oldest
   *  first. Each is returned once and then deleted, so this is never queued in
   *  the outbox. `full` means a whole page came back and more may be waiting.
   *  Throws on network/HTTP errors; drops malformed entries. */
  async fetchPending(ids: {
    userId?: string | null;
    deviceId?: string | null;
  }): Promise<{ events: PendingEvent[]; full: boolean }> {
    const body: Record<string, string> = {};
    if (ids.userId) body.userId = ids.userId;
    if (ids.deviceId) body.deviceId = ids.deviceId;
    const res = await fetch(this.endpoint("/api/sdk/pending"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "MS-Api-Version": API_VERSION,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`pending fetch failed: ${res.status}`);
    const root = (await res.json()) as { events?: unknown };
    if (!Array.isArray(root?.events)) return { events: [], full: false };
    const events: PendingEvent[] = [];
    for (const raw of root.events as Record<string, unknown>[]) {
      if (!raw || typeof raw !== "object") continue;
      const { id, name, properties, occurredAt } = raw;
      if (typeof name !== "string" || !name || typeof occurredAt !== "string") continue;
      if (Number.isNaN(Date.parse(occurredAt))) continue;
      events.push({
        id: typeof id === "string" ? id : "",
        name,
        properties: properties && typeof properties === "object" && !Array.isArray(properties) ? (properties as Record<string, unknown>) : {},
        occurredAt,
      });
    }
    return { events, full: root.events.length >= PENDING_PAGE_SIZE };
  }

  // ── Impressions / responses ─────────────────────────────────────────────────

  /** Queues the impression and returns its `clientId`, so the response from the
   *  same showing can point back to it. */
  recordImpression(input: {
    surveyId: string;
    triggerId: string | null;
    endUserId: string;
    shownAt: Date;
    dismissed: boolean;
    context: DeviceContext;
  }): string {
    const clientId = uuid();
    const payload = {
      clientId,
      surveyId: input.surveyId,
      triggerId: input.triggerId ?? undefined,
      endUserId: input.endUserId,
      shownAt: input.shownAt.toISOString(),
      dismissed: input.dismissed,
      context: input.context,
    };
    this.enqueue("/api/sdk/impressions", { impressions: [payload] });
    return clientId;
  }

  recordResponse(input: {
    surveyId: string;
    endUserId: string;
    completed: boolean;
    submittedAt: Date;
    userProps: JsonObject;
    impressionId: string;
    triggerId: string | null;
    context: DeviceContext;
    answers: SurveyAnswer[];
  }): void {
    const payload = {
      clientId: uuid(),
      surveyId: input.surveyId,
      endUserId: input.endUserId,
      completed: input.completed,
      submittedAt: input.submittedAt.toISOString(),
      userProps: input.userProps,
      impressionId: input.impressionId,
      triggerId: input.triggerId ?? undefined,
      context: input.context,
      answers: input.answers,
    };
    this.enqueue("/api/sdk/responses", { responses: [payload] });
  }

  // ── Event signals ─────────────────────────────────────────────────────────

  /** Queues one upload window of event counts. No clientId: a re-sent batch
   *  can count twice, which is fine for "last seen" and trend lines. */
  recordEventCounts(events: EventCount[], context: DeviceContext & { sdkVersion: string }): void {
    if (events.length === 0) return;
    this.enqueue("/api/sdk/events", { events, context });
  }

  // ── Live debugger ─────────────────────────────────────────────────────────

  /** Sends one debugger entry from a test device. */
  recordDebug(entry: DebugEntry, endUserId: string, context: DeviceContext & { sdkVersion: string }): void {
    this.enqueue("/api/sdk/debug", { entries: [entry], endUserId, context });
  }

  private enqueue(path: string, value: unknown): void {
    this.outbox.enqueue(path, JSON.stringify(value));
    void this.flush();
  }

  // ── Flush ────────────────────────────────────────────────────────────────────

  /** POSTs queued entries in order. Stops at the first retryable failure (likely
   *  offline) and leaves the rest for next time. Entries queued while a flush is
   *  running are sent by the same flush, so nothing waits for the next event.
   *  Idempotency keys make re-sends safe. Never throws. */
  async flush(): Promise<void> {
    if (this.isFlushing) return;
    this.isFlushing = true;
    try {
      // Guards against re-sending an entry whose removal didn't persist (storage full).
      const sent = new Set<string>();
      for (;;) {
        const pending = this.outbox.snapshot().filter((e) => !sent.has(e.id));
        if (pending.length === 0) break;
        let failed = false;
        for (const entry of pending) {
          try {
            await this.post(entry.path, entry.body);
            this.outbox.remove(entry.id);
            sent.add(entry.id);
          } catch {
            failed = true; // network/server problem — retry on the next flush
            break;
          }
        }
        if (failed) break;
      }
    } finally {
      this.isFlushing = false;
    }
  }

  private async post(path: string, body: string): Promise<void> {
    const res = await fetch(this.endpoint(path), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "MS-Api-Version": API_VERSION,
        "Content-Type": "application/json; charset=utf-8",
      },
      body,
    });
    // 429/5xx → throw to retry later. Other 4xx are permanent for this body;
    // treat as done so we don't wedge the queue (matches iOS retry rules).
    if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
      throw new Error(`retryable ${res.status}`);
    }
  }

  private endpoint(path: string): string {
    return this.baseURL + path;
  }
}
