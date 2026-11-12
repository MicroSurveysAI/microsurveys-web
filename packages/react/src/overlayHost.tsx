//
// overlayHost.tsx
//
// Subscribes to the client's `onPresent` and renders one auto-triggered survey
// at a time, portalled to document.body. Where it sits comes from the survey's
// (else the project theme's) web placement:
//
//   - "bottom-right" | "bottom-left" | "top-right" | "top-left": a card floating
//     in that corner. The page stays visible and usable behind it.
//   - "bottom" | "center": the modal bottom sheet or centered dialog, over a
//     dimmed page (the iOS `Presenter` look).
//
// A survey can also start minimized: a small launcher pill showing the first
// question, which opens the survey on click. An open survey with a launcher can
// be minimized again. Answers are kept while it's minimized. Opening and minimizing "unfurl": the
// card grows out of the launcher's corner and folds back into it (see motion.ts).
//

"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ActiveSurvey, MicroSurveysClient, SurveyResult } from "@microsurveysai/web-core";
import { SurveyCard } from "./SurveyCard";
import { resolveTheme, resolvePlacement, resolveLauncher, isModalPlacement, ensureGoogleFont } from "./theme";
import { ensureStyles } from "./styles";
import { cardIn, cardOut, launcherIn, launcherOut, scrimIn, scrimOut, stopMotion, unfurlOrigin } from "./motion";

// Layout effect in the browser (the transition must start before paint), plain effect during SSR.
const useBrowserLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function OverlayHost({ client }: { client: MicroSurveysClient | null }) {
  const [active, setActive] = useState<ActiveSurvey | null>(null);
  // Whether this survey has a launcher at all, and whether it's minimized to it right now.
  const [launcher, setLauncher] = useState(false);
  const [minimized, setMinimized] = useState(false);
  // The launcher outlives `minimized` on both sides: it appears as the card starts folding away,
  // and leaves only once its own exit has played.
  const [showLauncher, setShowLauncher] = useState(false);
  // After the first open or minimize the CSS entrance animations are switched off, so they don't
  // replay each time the card is shown again; the unfurl transition takes over.
  const [moved, setMoved] = useState(false);
  const [motionSeq, setMotionSeq] = useState(0);
  const pendingMotion = useRef<"open" | "minimize" | null>(null);
  const minimizing = useRef(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const launcherWrapRef = useRef<HTMLDivElement | null>(null);
  // Only move focus after the visitor opens or minimizes; never steal it when a survey first appears.
  const toggled = useRef(false);

  useEffect(() => {
    if (!client) return;
    return client.onPresent((a) => {
      const withLauncher = resolveLauncher(a.survey, client.getTheme());
      toggled.current = false;
      pendingMotion.current = null;
      minimizing.current = false;
      setLauncher(withLauncher);
      setMinimized(withLauncher);
      setShowLauncher(withLauncher);
      setMoved(false);
      setActive(a);
    });
  }, [client]);

  const placement = active && client ? resolvePlacement(active.survey, client.getTheme()) : "bottom";
  const modal = isModalPlacement(placement);
  const origin = unfurlOrigin(placement);

  // Plays the transition requested by open()/minimize() once React has rendered both ends of it.
  useBrowserLayoutEffect(() => {
    const kind = pendingMotion.current;
    if (!kind) return;
    pendingMotion.current = null;
    const card = panelRef.current?.querySelector(".ms-card");
    const scrim = modal ? panelRef.current : null;
    const wrap = launcherWrapRef.current;
    stopMotion(card, scrim, wrap);
    const ignoreStop = () => {};
    if (kind === "open") {
      minimizing.current = false;
      void cardIn(card, origin).catch(ignoreStop);
      void scrimIn(scrim).catch(ignoreStop);
      launcherOut(wrap, origin).then(() => setShowLauncher(false), ignoreStop);
    } else {
      void launcherIn(wrap, origin).catch(ignoreStop);
      Promise.all([cardOut(card, origin), scrimOut(scrim)]).then(() => {
        minimizing.current = false;
        setMinimized(true);
      }, ignoreStop);
    }
  }, [motionSeq, modal, origin]);

  // Escape: a modal survey listens page-wide (it holds focus); a floating card only reacts while
  // focus is inside it (see onKeyDown below), so it never swallows the host app's Escape.
  useEffect(() => {
    if (!active || !modal || minimized) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") escape();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, modal, minimized, launcher]);

  // After opening, move focus into the card; after minimizing, back to the launcher.
  useEffect(() => {
    if (!active || !toggled.current) return;
    if (minimized) launcherRef.current?.focus();
    else panelRef.current?.querySelector<HTMLElement>(".ms-card")?.focus();
  }, [active, minimized]);

  if (!active || !client || typeof document === "undefined") return null;

  ensureStyles();
  const theme = client.getTheme();
  const { vars, googleFont } = resolveTheme(theme);
  ensureGoogleFont(googleFont);
  const dismissible = active.survey.dismissible !== false;
  const firstPrompt = [...active.survey.questions].sort((a, b) => a.order - b.order)[0]?.prompt ?? active.survey.name;

  function close(result: SurveyResult) {
    active!.close(result);
    setActive(null);
  }

  function dismiss() {
    close({ answers: [], completed: false, dismissed: true });
  }

  // The card stays visible while it folds away; `minimized` flips once that has played.
  function minimize() {
    if (minimized || minimizing.current) return;
    minimizing.current = true;
    toggled.current = true;
    pendingMotion.current = "minimize";
    setMoved(true);
    setShowLauncher(true);
    setMotionSeq((n) => n + 1);
  }

  function open() {
    toggled.current = true;
    pendingMotion.current = "open";
    setMoved(true);
    setMinimized(false);
    setMotionSeq((n) => n + 1);
  }

  // Escape or a scrim click: back to the launcher when there is one, else dismiss (if allowed).
  function escape() {
    if (launcher) minimize();
    else if (dismissible) dismiss();
  }

  function onScrimClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) escape();
  }

  function onFloatKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      escape();
    }
  }

  // The card stays mounted while minimized (hidden), so answers survive minimize → open.
  const card = (
    <SurveyCard survey={active.survey} onClose={close} modal={modal} onMinimize={launcher ? minimize : undefined} />
  );

  return createPortal(
    <div className={moved ? "ms-root ms-moved" : "ms-root"} style={vars}>
      {modal ? (
        <div
          ref={panelRef}
          className={`ms-scrim ${placement === "center" ? "ms-dialog" : "ms-sheet"}`}
          onClick={onScrimClick}
          hidden={minimized}
        >
          {card}
        </div>
      ) : (
        <div ref={panelRef} className={`ms-float ms-at-${placement}`} onKeyDown={onFloatKey} hidden={minimized}>
          {card}
        </div>
      )}
      {showLauncher && (
        // Modal placements dock their launcher bottom-center; corners keep their corner.
        <div ref={launcherWrapRef} className={`ms-launcher-wrap ms-at-${modal ? "bottom" : placement}`}>
          <button
            ref={launcherRef}
            type="button"
            className="ms-launcher"
            onClick={open}
            aria-label={`Open survey: ${firstPrompt}`}
            aria-haspopup="dialog"
          >
            <svg className="ms-launcher-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                fill="currentColor"
                d="M12 3C6.48 3 2 6.92 2 11.75c0 2.47 1.17 4.7 3.06 6.29L4.3 21.3a.5.5 0 0 0 .7.56l3.9-1.86c.98.27 2.02.4 3.1.4 5.52 0 10-3.92 10-8.75S17.52 3 12 3Z"
              />
            </svg>
            <span className="ms-launcher-label">{firstPrompt}</span>
          </button>
          {dismissible && (
            <button type="button" className="ms-launcher-close" aria-label="Dismiss survey" onClick={dismiss}>
              ✕
            </button>
          )}
        </div>
      )}
    </div>,
    document.body,
  );
}
