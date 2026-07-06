//
// theme.ts
//
// Maps a project `ProjectTheme` (from /api/sdk/config) onto CSS custom
// properties consumed by the survey stylesheet, applying the same clean,
// neutral defaults as the iOS `SurveyTheme.default` (indigo accent, zinc grays).
// Also injects a Google Fonts <link> when the theme names a curated font.
//
// Dark-mode-aware palettes are a follow-up; for now the defaults are the
// light-mode values and any theme key overrides them.
//

import type { CSSProperties } from "react";
import type { ProjectTheme } from "@microsurveysai/web-core";

/** iOS `SurveyTheme.default` light-mode palette + metrics. */
const DEFAULTS = {
  scrim: "rgba(9, 9, 11, 0.45)",
  surface: "#FFFFFF",
  text: "#18181B",
  secondaryText: "#71717A",
  accent: "#6366F1", // indigo-500
  accentText: "#FFFFFF",
  border: "#E4E4E7",
  track: "#F4F4F5",
  cardRadius: 16,
  controlRadius: 12,
  controlHeight: 48,
  spacing: 16,
  textScale: 1,
  titleSize: 20,
  titleWeight: "semibold",
  titleLineHeight: 1.1,
  titleLetterSpacing: 0,
};

const WEIGHTS: Record<string, number> = { regular: 400, medium: 500, semibold: 600, bold: 700 };

const CURATED_FONTS = new Set(["Inter", "Roboto", "Open Sans", "Noto Sans", "Lato", "Montserrat", "Poppins"]);

export interface ResolvedTheme {
  /** CSS custom properties to spread onto the survey root's `style`. */
  vars: CSSProperties;
  /** A curated Google font family to lazy-load, or null for the system font. */
  googleFont: string | null;
}

function px(n: number): string {
  return `${n}px`;
}

export function resolveTheme(theme: ProjectTheme | null | undefined): ResolvedTheme {
  const t = theme ?? {};
  const controlHeight = t.controlHeight ?? DEFAULTS.controlHeight;
  const controlRadius = t.controlPill ? controlHeight / 2 : (t.controlRadius ?? DEFAULTS.controlRadius);
  const cardRadius = t.cornerRadius ?? DEFAULTS.cardRadius;
  const titleWeight = WEIGHTS[t.titleWeight ?? DEFAULTS.titleWeight] ?? 600;

  const font = t.font && t.font !== "system" && t.font.length > 0 ? t.font : null;
  const googleFont = font && CURATED_FONTS.has(font) ? font : null;
  const fontFamily = font
    ? `'${font}', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`
    : "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

  // CSS custom properties. Cast through a record since `--x` keys aren't in CSSProperties.
  const vars = {
    "--ms-scrim": DEFAULTS.scrim,
    "--ms-surface": t.surface ?? DEFAULTS.surface,
    "--ms-text": t.text ?? DEFAULTS.text,
    "--ms-secondary-text": t.secondaryText ?? DEFAULTS.secondaryText,
    "--ms-accent": t.accent ?? DEFAULTS.accent,
    "--ms-accent-text": t.accentText ?? DEFAULTS.accentText,
    "--ms-border": t.border ?? DEFAULTS.border,
    "--ms-track": DEFAULTS.track,
    "--ms-card-radius": px(cardRadius),
    "--ms-control-radius": px(controlRadius),
    "--ms-control-height": px(controlHeight),
    "--ms-spacing": px(t.spacing ?? DEFAULTS.spacing),
    "--ms-text-scale": String(t.textScale ?? DEFAULTS.textScale),
    "--ms-title-size": px(t.titleSize ?? DEFAULTS.titleSize),
    "--ms-title-weight": String(titleWeight),
    "--ms-title-line-height": String(t.titleLineHeight ?? DEFAULTS.titleLineHeight),
    "--ms-title-letter-spacing": px(t.titleLetterSpacing ?? DEFAULTS.titleLetterSpacing),
    "--ms-font": fontFamily,
    "--ms-align": t.alignment === "center" ? "center" : "left",
  } as CSSProperties;

  return { vars, googleFont };
}

/** Where the card sits — per-survey `presentation`, else the theme `position`. */
export function resolvePosition(presentation: string | null | undefined, theme: ProjectTheme | null | undefined): "sheet" | "dialog" {
  const p = presentation ?? null;
  if (p === "sheet") return "sheet";
  if (p === "dialog") return "dialog";
  // Inherit from the project theme position ("center" ⇒ dialog, else sheet).
  return theme?.position === "center" ? "dialog" : "sheet";
}

/** Lazily inject a Google Fonts stylesheet for a curated family (once). */
export function ensureGoogleFont(family: string | null): void {
  if (!family || typeof document === "undefined") return;
  const id = `ms-font-${family.replace(/\s+/g, "-").toLowerCase()}`;
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@400;500;600;700&display=swap`;
  document.head.appendChild(link);
}
