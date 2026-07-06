//
// @microsurveys/react
//
// React SDK for MicroSurveys. Wrap your app in <MicroSurveysProvider>, fire
// events with useMicroSurveys().track(), and auto-triggered surveys present
// themselves. Embed a specific survey with <MicroSurvey surveyId>.
//
//   <MicroSurveysProvider apiKey="ms_live_…">
//     <App />
//   </MicroSurveysProvider>
//
//   const { track, identify } = useMicroSurveys();
//   track("checkout_completed", { plan: "pro" });
//

export { MicroSurveysProvider, useMicroSurveys, useMicroSurveysClient } from "./provider";
export type { MicroSurveysProviderProps } from "./provider";
export { MicroSurvey } from "./MicroSurvey";
export type { MicroSurveyProps } from "./MicroSurvey";

// Re-export the common wire types so consumers don't need a second import.
export type { Survey, Question, SurveyResult, SurveyAnswer, AnswerValue, ProjectTheme } from "@microsurveys/web-core";
