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
  accent: "#2E7272", // Slate Teal (brand primary)
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

const COLOR_FN = /^(rgb|rgba|hsl|hsla)\(\s*[-+0-9.,%\s/]*\)$/i;

/**
 * A theme string is used only if it can't make the browser fetch anything or break out of its
 * CSS value: no url()/image-set()/var() (plain rgb()/hsl() colors are fine), no CSS punctuation,
 * quotes or backslashes. Anything else falls back to the default for that key.
 */
function safe(v: string | undefined): string | undefined {
  if (typeof v !== "string" || v.length > 100) return undefined;
  if (/[;:{}<>"'`\\@!]/.test(v)) return undefined;
  if (v.includes("(") || v.includes(")")) return COLOR_FN.test(v.trim()) ? v : undefined;
  return v;
}

/** A finite number kept within [lo, hi], or undefined. */
function bounded(n: number | null | undefined, lo: number, hi: number): number | undefined {
  return typeof n === "number" && Number.isFinite(n) ? Math.min(Math.max(n, lo), hi) : undefined;
}

export function resolveTheme(theme: ProjectTheme | null | undefined): ResolvedTheme {
  const raw = theme ?? {};
  // Same bounds the server applies before sending the theme; real themes sit well inside them.
  const t: ProjectTheme = {
    ...raw,
    accent: safe(raw.accent),
    accentText: safe(raw.accentText),
    surface: safe(raw.surface),
    text: safe(raw.text),
    secondaryText: safe(raw.secondaryText),
    border: safe(raw.border),
    font: safe(raw.font),
    cornerRadius: bounded(raw.cornerRadius, 0, 200),
    controlRadius: bounded(raw.controlRadius, 0, 200),
    controlHeight: bounded(raw.controlHeight, 16, 200),
    spacing: bounded(raw.spacing, 0, 200),
    textScale: bounded(raw.textScale, 0.25, 4),
    titleSize: bounded(raw.titleSize, 6, 120),
    titleLineHeight: bounded(raw.titleLineHeight, 0.5, 5),
    titleLetterSpacing: bounded(raw.titleLetterSpacing, -50, 50),
  };
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
