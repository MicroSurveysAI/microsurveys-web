//
// @microsurveys/web-core
//
// Framework-agnostic browser runtime for MicroSurveys. Feed it events + identity
// and it decides, on-device, when a survey is eligible and emits it for a UI
// layer (e.g. @microsurveys/react) to render. A faithful port of the iOS SDK
// runtime; the wire contract is docs/API-CONTRACT.md.
//

export { createClient, MicroSurveysClient } from "./client";
export type { CreateClientOptions, ActiveSurvey } from "./client";

// Pure helpers exposed for testing + advanced use.
export { fnv1a32, inSample, matches, audienceMatches, eventMatchesStep, stringify } from "./sampling";
export { advance, windowExpired } from "./triggerSequencer";
export { TriggerEngine, passesFrequency } from "./triggerEngine";
export type { TriggerEngineOptions } from "./triggerEngine";
export { ConfigStore, TriggerStateStore } from "./persistence";
export { IdentityStore } from "./identity";
export { parseConfig, endUserIdOf, newTriggerRecord, newUserTriggerState } from "./types";

export type {
  Json,
  JsonObject,
  QuestionType,
  QuestionConfig,
  EmojiOption,
  ChoiceOption,
  Question,
  TriggerType,
  TriggerStep,
  Trigger,
  Survey,
  SDKConfig,
  ProjectTheme,
  Identity,
  AnswerValue,
  SurveyAnswer,
  SurveyResult,
  TriggerRecord,
  SurveyRecord,
  UserTriggerState,
} from "./types";
