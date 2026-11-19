//
// MicroSurvey.tsx
//
// `<MicroSurvey surveyId>` — renders a specific survey **inline** in the page
// flow (no overlay), e.g. embedded in a settings screen or a landing section.
// Pulls the survey from the cached config; sends an impression when it renders
// and a response when it closes. Has no equivalent in the iOS SDK (mobile is
// overlay-only).
//

"use client";

import { useEffect, useRef, useState } from "react";
import type { ActiveSurvey, Survey, SurveyResult } from "@microsurveysai/web-core";
import { useMicroSurveysClient } from "./provider";
import { SurveyCard } from "./SurveyCard";
import { resolveTheme, ensureGoogleFont } from "./theme";
import { ensureStyles } from "./styles";

export interface MicroSurveyProps {
  surveyId: string;
  /** Called with the outcome when the inline survey closes. */
  onComplete?: (result: SurveyResult) => void;
}

export function MicroSurvey({ surveyId, onComplete }: MicroSurveyProps) {
  const client = useMicroSurveysClient();
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [closed, setClosed] = useState(false);
  // One showing per mounted survey: its impression is sent once, when it renders.
  const showing = useRef<ActiveSurvey | null>(null);

  useEffect(() => {
    if (!client) return;
    setSurvey(client.getSurvey(surveyId) ?? null);
    // Re-check when a config refresh lands (survey may not have been cached yet).
    return client.onConfigChange(() => setSurvey(client.getSurvey(surveyId) ?? null));
  }, [client, surveyId]);

  const visible = !!client && !!survey && !closed;
  if (visible && (!showing.current || showing.current.survey.id !== survey.id)) {
    showing.current = client.presentInline(survey);
  }

  useEffect(() => {
    if (visible) showing.current?.shown();
  }, [visible, survey]);

  if (!client || !survey || closed) return null;

  ensureStyles();
  const { vars, googleFont } = resolveTheme(client.getTheme());
  ensureGoogleFont(googleFont);

  function close(result: SurveyResult) {
    showing.current?.close(result);
    setClosed(true);
    onComplete?.(result);
  }

  return (
    <div className="ms-root ms-inline" style={vars}>
      <SurveyCard survey={survey} onClose={close} />
    </div>
  );
}
