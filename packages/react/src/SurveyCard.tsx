//
// SurveyCard.tsx
//
// The multi-step survey host — renders `.ms-card` with the current question,
// enforces `required`, supports partial submit, a success message, and
// `dismissible:false`. Port of iOS `SurveyViewController`. The caller wraps this
// in the themed `.ms-root` (+ scrim for overlays, plain for inline).
//

import { useEffect, useMemo, useRef, useState } from "react";
import { thanksDurationMs, thanksMessage } from "@microsurveysai/web-core";
import type { AnswerValue, Survey, SurveyAnswer, SurveyResult } from "@microsurveysai/web-core";
import { QuestionInput, isAnswered } from "./questions";

export interface SurveyCardProps {
  survey: Survey;
  /** Called exactly once when the card closes (completed, partial, or dismissed). */
  onClose: (result: SurveyResult) => void;
  /** Whether the card is a modal dialog over a dimmed page (default) or floats beside the page. */
  modal?: boolean;
  /** When set, the card shows a minimize button that calls it (back to the launcher). */
  onMinimize?: () => void;
}

export function SurveyCard({ survey, onClose, modal = true, onMinimize }: SurveyCardProps) {
  const questions = useMemo(() => [...survey.questions].sort((a, b) => a.order - b.order), [survey]);
  const dismissible = survey.dismissible !== false;

  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [done, setDone] = useState(false);

  // The thank-you closes after a delay sized to its text (see thanksDurationMs),
  // pauses while hovered, and closes at once on click. `closed` guards against
  // closing twice (timer firing after a click, or the reverse).
  const thanksTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const thanksRemaining = useRef(0);
  const thanksStartedAt = useRef(0);
  const thanksResult = useRef<SurveyResult | null>(null);
  const closed = useRef(false);

  useEffect(() => () => {
    if (thanksTimer.current) clearTimeout(thanksTimer.current);
  }, []);

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
    thanksResult.current = { answers: collected(), completed: true, dismissed: false };
    thanksRemaining.current = thanksDurationMs(survey.successMessage, survey.successPace);
    setDone(true);
    startThanksTimer();
  }

  function startThanksTimer() {
    if (closed.current || thanksTimer.current) return;
    thanksStartedAt.current = Date.now();
    thanksTimer.current = setTimeout(closeThanks, Math.max(0, thanksRemaining.current));
  }

  function pauseThanksTimer() {
    if (!thanksTimer.current) return;
    clearTimeout(thanksTimer.current);
    thanksTimer.current = null;
    thanksRemaining.current -= Date.now() - thanksStartedAt.current;
  }

  function closeThanks() {
    if (closed.current || !thanksResult.current) return;
    closed.current = true;
    if (thanksTimer.current) clearTimeout(thanksTimer.current);
    thanksTimer.current = null;
    onClose(thanksResult.current);
  }

  function dismiss() {
    onClose({ answers: collected(), completed: false, dismissed: true });
  }

  if (done) {
    return (
      <div
        className="ms-card ms-thanks"
        role="dialog"
        aria-live="polite"
        onClick={closeThanks}
        onMouseEnter={pauseThanksTimer}
        onMouseLeave={startThanksTimer}
      >
        <div className="ms-success">
          <span className="ms-success-check">✓</span>
          <span className="ms-success-text">{thanksMessage(survey.successMessage)}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={onMinimize ? "ms-card ms-has-min" : "ms-card"}
      role="dialog"
      aria-modal={modal ? "true" : "false"}
      aria-label={survey.name}
      tabIndex={-1}
    >
      {onMinimize && (
        <button
          type="button"
          className={dismissible ? "ms-close ms-minimize" : "ms-close"}
          aria-label="Minimize"
          onClick={onMinimize}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        </button>
      )}
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
