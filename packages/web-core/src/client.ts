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
    void this.refreshConfig();
    if (typeof document !== "undefined") {
      this.foregroundHandler = () => {
        if (document.visibilityState === "visible") {
          if (this.refreshOnForeground) this.refreshConfigIfStale();
        } else {
          // The tab may not come back: send what was counted while it was open.
          this.flushEventCounts();
        }
      };
      document.addEventListener("visibilitychange", this.foregroundHandler);
    }
    this.eventCountsTimer = setInterval(() => this.flushEventCounts(), EVENT_COUNTS_INTERVAL_MS);
  }

  /** Tear down listeners + pending timers. */
  stop(): void {
    this.engine.stop();
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
    this.identityStore.setUser(userId, properties);
  }

  track(name: string, properties: Record<string, unknown> = {}): void {
    if (this.configStore.eventSignals) {
      this.eventCounter.record(name, properties);
      if (this.eventCounter.size >= MAX_NAMES) this.flushEventCounts();
    }
    if (!this.isDebugDevice()) {
      this.engine.process(name, properties);
      return;
    }
    this.collecting = [];
    try {
      this.engine.process(name, properties);
    } finally {
      const decisions = this.collecting;
      this.collecting = null;
      this.sendDebug(name, debugProperties(properties), decisions);
    }
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

  private sendDebug(event: string | null, properties: Record<string, unknown>, decisions: Decision[]): void {
    const endUserId = endUserIdOf(this.identityStore.snapshot());
    this.api.recordDebug(
      { at: new Date().toISOString(), event, properties, decisions },
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

/** Creates and returns a `MicroSurveysClient`. Call `start()` to begin. */
export function createClient(opts: CreateClientOptions): MicroSurveysClient {
  return new MicroSurveysClient(opts);
}
