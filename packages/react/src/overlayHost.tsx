//
// overlayHost.tsx
//
// Subscribes to the client's `onPresent` and renders one auto-triggered survey
// at a time as a themed overlay (bottom sheet or centered dialog), portalled to
// document.body. Port of iOS `Presenter`.
//

"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { ActiveSurvey, MicroSurveysClient, SurveyResult } from "@microsurveysai/web-core";
import { SurveyCard } from "./SurveyCard";
import { resolveTheme, resolvePosition, ensureGoogleFont } from "./theme";
import { ensureStyles } from "./styles";

export function OverlayHost({ client }: { client: MicroSurveysClient | null }) {
  const [active, setActive] = useState<ActiveSurvey | null>(null);

  useEffect(() => {
    if (!client) return;
    return client.onPresent((a) => setActive(a));
  }, [client]);

  // Escape to dismiss (when dismissible).
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && active.survey.dismissible !== false) close({ answers: [], completed: false, dismissed: true });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  if (!active || !client || typeof document === "undefined") return null;

  ensureStyles();
  const theme = client.getTheme();
  const { vars, googleFont } = resolveTheme(theme);
  ensureGoogleFont(googleFont);
  const position = resolvePosition(active.survey.presentation, theme);

  function close(result: SurveyResult) {
    active!.close(result);
    setActive(null);
  }

  function onScrimClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget && active!.survey.dismissible !== false) {
      close({ answers: [], completed: false, dismissed: true });
    }
  }

  return createPortal(
    <div className="ms-root" style={vars}>
      <div className={`ms-scrim ms-${position}`} onClick={onScrimClick}>
        <SurveyCard survey={active.survey} onClose={close} />
      </div>
    </div>,
    document.body,
  );
}
