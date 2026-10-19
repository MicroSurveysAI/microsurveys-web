//
// SurveyCard.tsx
//
// The multi-step survey host — renders `.ms-card` with the current question,
// enforces `required`, supports partial submit, a success message, and
// `dismissible:false`. Port of iOS `SurveyViewController`. The caller wraps this
// in the themed `.ms-root` (+ scrim for overlays, plain for inline).
//

import { useMemo, useState } from "react";
import type { AnswerValue, Survey, SurveyAnswer, SurveyResult } from "@microsurveysai/web-core";
import { QuestionInput, isAnswered } from "./questions";

export interface SurveyCardProps {
  survey: Survey;
  /** Called exactly once when the card closes (completed, partial, or dismissed). */
  onClose: (result: SurveyResult) => void;
}

const SUCCESS_MS = 1400;

export function SurveyCard({ survey, onClose }: SurveyCardProps) {
  const questions = useMemo(() => [...survey.questions].sort((a, b) => a.order - b.order), [survey]);
  const dismissible = survey.dismissible !== false;

  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [done, setDone] = useState(false);

  const question = questions[step];
  const isLast = step >= questions.length - 1;

  // Empty survey (misconfigured) — nothing to render; close as dismissed.
  if (!question) {
    return null;
  }

  const current = answers[question.id];
  const canAdvance = !question.required || isAnswered(current);

  function collected(): SurveyAnswer[] {
    return questions.filter((q) => answers[q.id] !== undefined).map((q) => ({ questionId: q.id, value: answers[q.id]! }));
  }

  function setAnswer(value: AnswerValue) {
    setAnswers((prev) => ({ ...prev, [question!.id]: value }));
  }

  function advance() {
    if (!canAdvance) return;
    if (isLast) {
      finish();
    } else {
      setStep((s) => s + 1);
    }
  }

  function finish() {
    const result: SurveyResult = { answers: collected(), completed: true, dismissed: false };
    setDone(true);
    setTimeout(() => onClose(result), SUCCESS_MS);
  }

  function dismiss() {
    onClose({ answers: collected(), completed: false, dismissed: true });
  }

  if (done) {
    return (
      <div className="ms-card" role="dialog" aria-live="polite">
        <div className="ms-success">
          <span className="ms-success-check">✓</span>
          <span>{survey.successMessage ?? "Thanks for your feedback!"}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="ms-card" role="dialog" aria-modal="true" aria-label={survey.name}>
      {dismissible && (
        <button type="button" className="ms-close" aria-label="Close" onClick={dismiss}>
          ✕
        </button>
      )}
      {questions.length > 1 && (
        <p className="ms-progress">
          {step + 1} of {questions.length}
        </p>
      )}
      <h2 className="ms-prompt">{question.prompt}</h2>
      <QuestionInput question={question} value={current} onChange={setAnswer} />
      <div className="ms-footer">
        <button type="button" className="ms-btn" disabled={!canAdvance} onClick={advance}>
          {isLast ? "Submit" : "Next"}
        </button>
      </div>
    </div>
  );
}
