//
// client.ts
//
// `MicroSurveysClient` — the public facade, mirroring iOS `MicroSurveysSDK`. It
// owns the config cache, identity store, trigger-state store, API client, and
// trigger engine, and turns engine "present" signals into a single active
// survey at a time (the React overlay host renders it). Framework-agnostic:
// no React, no DOM UI.
//

import { ApiClient } from "./apiClient";
import type { PendingEvent } from "./apiClient";
import { ConfigStore, TriggerStateStore } from "./persistence";
import { IdentityStore } from "./identity";
import { TriggerEngine } from "./triggerEngine";
import { EventCounter, MAX_NAMES } from "./eventCounter";
import { debugKey, debugProperties } from "./debug";
import type { Decision } from "./triggerEngine";
import { SDK_VERSION } from "./version";
import { endUserIdOf } from "./types";
import type { DeviceContext, Identity, ProjectTheme, Survey, SurveyResult, Trigger } from "./types";

/** Default API base. Override via `apiBaseURL` for self-hosted deployments. */
const DEFAULT_BASE_URL = "https://console.microsurveys.ai";
/** How long a cached config is treated as fresh for foreground refresh. */
const DEFAULT_CONFIG_TTL_MS = 30 * 60 * 1000;
/** How often counted events are uploaded while event signals are on. */
const EVENT_COUNTS_INTERVAL_MS = 60 * 1000;
/** Extra mailbox checks after each start or return to the tab. Amplitude
 *  streams within about 60 s, so these catch an event from just before. */
const PENDING_FOLLOW_UPS_MS = [30 * 1000, 90 * 1000];
/** Mailbox check interval while the tab is visible. */
const PENDING_INTERVAL_MS = 5 * 60 * 1000;
/** Faster interval while a sequence waits on a server event as its next step. */
const PENDING_WAITING_INTERVAL_MS = 60 * 1000;
/** How long after a sequence started it still counts as waiting (seconds). */
const PENDING_WAITING_MAX_S = 3 * 60 * 60;

export interface CreateClientOptions {
  apiKey: string;
  /** Override for self-hosted deployments. Defaults to https://console.microsurveys.ai. */
  apiBaseURL?: string;
  /** Foreground-refresh freshness window in ms. Defaults to 30 min. */
  configTTLms?: number;
  /** Auto-refresh config on tab foreground (visibilitychange). Default true. */
  refreshOnForeground?: boolean;
  /** This SDK's platform for survey targeting. Defaults to "web". */
  platform?: string;
  /** Your app's version (e.g. "3.2.0"), sent with responses so results can be
   *  compared across releases. Optional. */
  appVersion?: string;
}

/** An auto-triggered survey the host should present. Call `close` exactly once
 *  when the UI dismisses (completed, partial, or dismissed). */
export interface ActiveSurvey {
  survey: Survey;
  trigger: Trigger | null;
  close(result: SurveyResult): void;
}

type PresentListener = (active: ActiveSurvey) => void;
type ConfigListener = () => void;

interface Presentation {
  survey: Survey;
  trigger: Trigger | null;
  identity: Identity;
  shownAt: Date;
  closed: boolean;
}

export class MicroSurveysClient {
  private readonly api: ApiClient;
  private readonly configStore = new ConfigStore();
  private readonly identityStore = new IdentityStore();
  private readonly triggerStateStore = new TriggerStateStore();
  private readonly engine: TriggerEngine;
  private readonly eventCounter = new EventCounter();
  private eventCountsTimer: ReturnType<typeof setInterval> | null = null;
  /** Server-event mailbox timers, cleared while the tab is hidden. */
  private pendingTimeouts: ReturnType<typeof setTimeout>[] = [];
  private pendingIntervals: ReturnType<typeof setInterval>[] = [];
  private pendingInFlight = false;
  /** Decisions collected while one event is processed, for the live debugger. */
  private collecting: Decision[] | null = null;
  private readonly configTTLms: number;
  private readonly refreshOnForeground: boolean;
  private readonly platform: string;
  private readonly appVersion: string | undefined;

  private readonly presentListeners = new Set<PresentListener>();
  private readonly configListeners = new Set<ConfigListener>();
  private active: Presentation | null = null;
  private started = false;
  private foregroundHandler: (() => void) | null = null;

  constructor(opts: CreateClientOptions) {
    this.api = new ApiClient(opts.apiKey, opts.apiBaseURL ?? DEFAULT_BASE_URL);
    this.configTTLms = opts.configTTLms ?? DEFAULT_CONFIG_TTL_MS;
    this.refreshOnForeground = opts.refreshOnForeground ?? true;
    this.platform = opts.platform ?? "web";
    this.appVersion = opts.appVersion;
    this.engine = new TriggerEngine({
      store: this.triggerStateStore,
      surveysProvider: () => this.configStore.surveys,
      identityProvider: () => this.identityStore.snapshot(),
      onPresent: (survey, trigger, identity) => this.handlePresent(survey, trigger, identity),
      platform: this.platform,
      onDecision: (d) => this.handleDecision(d),
    });
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  /** Flush any queued ingest, refresh config, and (optionally) wire the
   *  foreground refresh. Safe to call once early. */
  start(): void {
    if (this.started) return;
    this.started = true;
    void this.api.flush();
    void this.refreshConfig().then(() => {
      // The refresh may already have started the checks (a config that turned them on).
      if (this.started && this.pendingTimeouts.length === 0 && this.pendingIntervals.length === 0) {
        this.startPendingChecks();
      }
    });
    if (typeof document !== "undefined") {
      this.foregroundHandler = () => {
        if (document.visibilityState === "visible") {
          if (this.refreshOnForeground) this.refreshConfigIfStale();
          // Not tied to the config TTL: server events can arrive at any time.
          this.startPendingChecks();
        } else {
          // The tab may not come back: send what was counted while it was open.
          this.flushEventCounts();
          this.stopPendingChecks();
        }
      };
      document.addEventListener("visibilitychange", this.foregroundHandler);
    }
    this.eventCountsTimer = setInterval(() => this.flushEventCounts(), EVENT_COUNTS_INTERVAL_MS);
  }

  /** Tear down listeners + pending timers. */
  stop(): void {
    this.engine.stop();
    this.stopPendingChecks();
    this.flushEventCounts();
    if (this.eventCountsTimer) clearInterval(this.eventCountsTimer);
    this.eventCountsTimer = null;
    if (this.foregroundHandler && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.foregroundHandler);
      this.foregroundHandler = null;
    }
    this.started = false;
  }

  /** Force an ETag-aware config refresh; keeps the cache on failure. */
  async refreshConfig(): Promise<void> {
    try {
      const result = await this.api.fetchConfig(this.configStore.etag);
      if (result.kind === "config") {
        this.configStore.save(result.rawText, result.etag);
        this.syncPendingChecks();
        this.configListeners.forEach((l) => l());
      }
    } catch {
      // Keep the cached config; the SDK still works offline.
    }
  }

  /** Refresh only when the cache is missing or older than the TTL. */
  refreshConfigIfStale(): void {
    const storedAt = this.configStore.storedAt;
    if (storedAt !== null && Date.now() - storedAt < this.configTTLms) return;
    void this.refreshConfig();
  }

  // ── Identity + events ────────────────────────────────────────────────────────

  identify(userId: string | null | undefined, properties?: Record<string, unknown>): void {
    const previous = this.identityStore.snapshot().hostUserId;
    this.identityStore.setUser(userId, properties);
    // The user id often arrives after start: check this user's mailbox now.
    if (this.started && userId && userId !== previous) void this.checkPending();
  }

  track(name: string, properties: Record<string, unknown> = {}): void {
    if (this.configStore.eventSignals) {
      this.eventCounter.record(name, properties);
      if (this.eventCounter.size >= MAX_NAMES) this.flushEventCounts();
    }
    this.processEvent(name, properties);
  }

  /** Runs one event through the engine, reporting to the live debugger on a test
   *  device. `occurredAt` (ms epoch) is set for a replayed server event. */
  private processEvent(name: string, properties: Record<string, unknown>, occurredAt?: number): void {
    const eventTime = occurredAt === undefined ? undefined : occurredAt / 1000;
    if (!this.isDebugDevice()) {
      this.engine.process(name, properties, eventTime);
      return;
    }
    this.collecting = [];
    try {
      this.engine.process(name, properties, eventTime);
    } finally {
      const decisions = this.collecting;
      this.collecting = null;
      this.sendDebug(name, debugProperties(properties), decisions, occurredAt);
    }
  }

  // ── Server events (API-CONTRACT §6) ──────────────────────────────────────────

  /** (Re)starts the mailbox checks for a start or a return to the tab: one now,
   *  follow-ups at 30 s and 90 s, then every 5 minutes, and every minute while
   *  a sequence waits on a server event. Only while config has `pendingEvents`
   *  and the tab is visible. */
  private startPendingChecks(): void {
    this.stopPendingChecks();
    if (!this.started || !this.configStore.pendingEvents || !tabVisible()) return;
    void this.checkPending();
    for (const ms of PENDING_FOLLOW_UPS_MS) {
      this.pendingTimeouts.push(setTimeout(() => void this.checkPending(), ms));
    }
    this.pendingIntervals.push(setInterval(() => void this.checkPending(), PENDING_INTERVAL_MS));
    this.pendingIntervals.push(
      setInterval(() => {
        if (this.isWaitingOnServerEvent()) void this.checkPending();
      }, PENDING_WAITING_INTERVAL_MS),
    );
  }

  private stopPendingChecks(): void {
    for (const t of this.pendingTimeouts) clearTimeout(t);
    for (const t of this.pendingIntervals) clearInterval(t);
    this.pendingTimeouts = [];
    this.pendingIntervals = [];
  }

  /** After a config refresh: stop the checks if the project turned them off, or
   *  start them if it turned them on. */
  private syncPendingChecks(): void {
    const running = this.pendingTimeouts.length > 0 || this.pendingIntervals.length > 0;
    if (!this.configStore.pendingEvents) this.stopPendingChecks();
    else if (this.started && !running) this.startPendingChecks();
  }

  /** True when a SEQUENCE for the current user has started and its next step is
   *  an event that arrives by stream, within 3 hours of the sequence starting. */
  private isWaitingOnServerEvent(): boolean {
    const serverEvents = this.configStore.serverEvents;
    if (serverEvents.length === 0) return false;
    const state = this.triggerStateStore.load(endUserIdOf(this.identityStore.snapshot()));
    const nowS = Date.now() / 1000;
    for (const survey of this.configStore.surveys) {
      for (const trigger of survey.triggers ?? []) {
        if (trigger.type !== "SEQUENCE") continue;
        const record = state.triggers[trigger.id];
        if (!record || record.stepIndex <= 0 || record.startedAt === null) continue;
        if (nowS - record.startedAt > PENDING_WAITING_MAX_S) continue;
        const steps = [...trigger.steps].sort((a, b) => a.order - b.order);
        const next = steps[Math.min(record.stepIndex, steps.length - 1)];
        if (next && serverEvents.includes(next.event)) return true;
      }
    }
    return false;
  }

  /** Takes this user's waiting server events and replays them. One request at a
   *  time; a full page is followed by one more call. Failures are silent: the
   *  next scheduled check retries. Web sends only the `identify()` user id (the
   *  anonymous id is not an Amplitude device id), so nothing runs before it. */
  private async checkPending(): Promise<void> {
    if (this.pendingInFlight || !this.configStore.pendingEvents) return;
    const userId = this.identityStore.snapshot().hostUserId;
    if (!userId) return;
    this.pendingInFlight = true;
    try {
      for (let call = 0; call < 2; call++) {
        const { events, full } = await this.api.fetchPending({ userId });
        // Stopped, or another user signed in while this was in flight: don't
        // replay one user's events into another's trigger state.
        if (!this.started || this.identityStore.snapshot().hostUserId !== userId) return;
        this.replayPending(events);
        if (!full) break;
      }
    } catch {
      // Offline or server error: the next check retries.
    } finally {
      this.pendingInFlight = false;
    }
  }

  /** Feeds server events through the `track()` path in the order they happened,
   *  at their own time, without counting them in event signals. */
  private replayPending(events: PendingEvent[]): void {
    const timed = events.map((e) => ({ e, at: Date.parse(e.occurredAt) })).sort((a, b) => a.at - b.at);
    for (const { e, at } of timed) this.processEvent(e.name, e.properties, at);
  }

  // ── Live debugger ────────────────────────────────────────────────────────────

  /** True when the dashboard picked the current user as a test device. */
  private isDebugDevice(): boolean {
    const users = this.configStore.debugUsers;
    const projectId = this.configStore.projectId;
    if (users.length === 0 || !projectId) return false;
    return users.includes(debugKey(projectId, endUserIdOf(this.identityStore.snapshot())));
  }

  private handleDecision(d: Decision): void {
    if (this.collecting) this.collecting.push(d);
    // Made outside an event (a delayed survey's cap check at fire time): report on its own.
    else if (this.isDebugDevice()) this.sendDebug(null, {}, [d]);
  }

  private sendDebug(
    event: string | null,
    properties: Record<string, unknown>,
    decisions: Decision[],
    at: number = Date.now(),
  ): void {
    const endUserId = endUserIdOf(this.identityStore.snapshot());
    this.api.recordDebug(
      { at: new Date(at).toISOString(), event, properties, decisions },
      endUserId,
      { ...this.deviceContext(), sdkVersion: SDK_VERSION },
    );
  }

  /** Uploads the events counted since the last upload (no-op when there are none). */
  flushEventCounts(): void {
    if (this.eventCounter.size === 0) return;
    this.api.recordEventCounts(this.eventCounter.drain(), { ...this.deviceContext(), sdkVersion: SDK_VERSION });
  }

  // ── Config accessors (for inline rendering) ──────────────────────────────────

  getTheme(): ProjectTheme | null {
    return this.configStore.theme;
  }

  getSurvey(surveyId: string): Survey | undefined {
    return this.configStore.surveys.find((s) => s.id === surveyId);
  }

  /** Subscribe to config refreshes (e.g. to render an inline survey that wasn't
   *  cached yet). Returns an unsubscribe function. */
  onConfigChange(cb: ConfigListener): () => void {
    this.configListeners.add(cb);
    return () => this.configListeners.delete(cb);
  }

  // ── Presentation ─────────────────────────────────────────────────────────────

  /** Subscribe to auto-triggered surveys. Returns an unsubscribe function. If a
   *  survey is already active, the new subscriber is notified immediately. */
  onPresent(cb: PresentListener): () => void {
    this.presentListeners.add(cb);
    if (this.active && !this.active.closed) cb(this.toActiveSurvey(this.active));
    return () => this.presentListeners.delete(cb);
  }

  private handlePresent(survey: Survey, trigger: Trigger, identity: Identity): void {
    // One survey on screen at a time — drop while one is active.
    if (this.active && !this.active.closed) {
      this.handleDecision({ surveyId: survey.id, triggerId: trigger.id, reason: "another_survey_showing" });
      return;
    }
    this.handleDecision({ surveyId: survey.id, triggerId: trigger.id, reason: "shown" });
    const p: Presentation = { survey, trigger, identity, shownAt: new Date(), closed: false };
    this.active = p;
    const active = this.toActiveSurvey(p);
    this.presentListeners.forEach((l) => l(active));
  }

  private toActiveSurvey(p: Presentation): ActiveSurvey {
    return {
      survey: p.survey,
      trigger: p.trigger,
      close: (result: SurveyResult) => {
        if (p.closed) return;
        p.closed = true;
        this.recordOutcome(p.survey.id, p.trigger?.id ?? null, p.identity, p.shownAt, result);
        if (this.active === p) this.active = null;
      },
    };
  }

  /** Records the outcome of an **inline** `<MicroSurvey>` (no trigger/gate). */
  recordInline(survey: Survey, result: SurveyResult, shownAt: Date): void {
    const identity = this.identityStore.snapshot();
    this.recordOutcome(survey.id, null, identity, shownAt, result);
  }

  private recordOutcome(
    surveyId: string,
    triggerId: string | null,
    identity: Identity,
    shownAt: Date,
    result: SurveyResult,
  ): void {
    const endUserId = endUserIdOf(identity);
    const context = this.deviceContext();
    // Impression is finalized at close, so `dismissed` is authoritative.
    const impressionId = this.api.recordImpression({
      surveyId,
      triggerId,
      endUserId,
      shownAt,
      dismissed: result.dismissed,
      context,
    });
    // A pure dismissal (no answers) is an impression, NOT a response — don't
    // inflate the response count. Partial multi-step answers still count.
    if (result.completed || result.answers.length > 0) {
      this.api.recordResponse({
        surveyId,
        endUserId,
        completed: result.completed,
        submittedAt: new Date(),
        userProps: identity.userProperties,
        impressionId,
        triggerId,
        context,
        answers: result.answers,
      });
    }
  }

  /** Where this showing happened. Read at record time: the browser language can change. */
  private deviceContext(): DeviceContext {
    const locale = typeof navigator !== "undefined" ? navigator.language : undefined;
    return { platform: this.platform, appVersion: this.appVersion, locale: locale || undefined };
  }
}

/** True unless the page is hidden (or there's no document, e.g. tests). */
function tabVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

/** Creates and returns a `MicroSurveysClient`. Call `start()` to begin. */
export function createClient(opts: CreateClientOptions): MicroSurveysClient {
  return new MicroSurveysClient(opts);
}
