//
// styles.ts
//
// One self-contained stylesheet, injected once, scoped under `.ms-root`. It
// reads the CSS custom properties set by `resolveTheme`, so every visual knob is
// theme-driven. No Tailwind, no external CSS — safe to drop into any host app.
//

const STYLE_ID = "microsurveys-styles";

const CSS = `
.ms-root, .ms-root * { box-sizing: border-box; }
.ms-root {
  font-family: var(--ms-font);
  color: var(--ms-text);
  text-align: var(--ms-align);
  -webkit-font-smoothing: antialiased;
}

/* ── Overlay ─────────────────────────────────────────────── */
.ms-scrim {
  position: fixed; inset: 0; z-index: 2147483000;
  display: flex; padding: var(--ms-spacing);
  background: var(--ms-scrim);
  animation: ms-fade 160ms ease-out;
}
.ms-scrim.ms-sheet { align-items: flex-end; justify-content: center; }
.ms-scrim.ms-dialog { align-items: center; justify-content: center; }

.ms-card {
  position: relative; width: 100%; max-width: 480px;
  background: var(--ms-surface);
  border-radius: var(--ms-card-radius);
  border: 1px solid var(--ms-border);
  box-shadow: 0 12px 40px rgba(9, 9, 11, 0.18);
  padding: calc(var(--ms-spacing) * 1.5);
  animation: ms-rise 200ms cubic-bezier(0.16, 1, 0.3, 1);
}
.ms-inline .ms-card {
  box-shadow: none; animation: none; max-width: none;
}
.ms-inline { display: block; }

@keyframes ms-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes ms-rise { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }

/* ── Header ──────────────────────────────────────────────── */
.ms-prompt {
  margin: 0 0 var(--ms-spacing);
  font-size: var(--ms-title-size);
  font-weight: var(--ms-title-weight);
  line-height: var(--ms-title-line-height);
  letter-spacing: var(--ms-title-letter-spacing);
  color: var(--ms-text);
  padding-right: 28px;
}
.ms-close {
  position: absolute; top: 14px; right: 14px;
  width: 28px; height: 28px; border: none; cursor: pointer;
  background: transparent; color: var(--ms-secondary-text);
  border-radius: 8px; font-size: 18px; line-height: 1;
  display: inline-flex; align-items: center; justify-content: center;
}
.ms-close:hover { background: var(--ms-track); color: var(--ms-text); }

.ms-progress {
  font-size: calc(12px * var(--ms-text-scale));
  color: var(--ms-secondary-text);
  margin: 0 0 8px;
}

/* ── Scale (NPS / CES) ───────────────────────────────────── */
.ms-scale { display: flex; flex-wrap: wrap; gap: 8px; }
.ms-chip {
  flex: 1 1 auto; min-width: var(--ms-control-height);
  height: var(--ms-control-height);
  border: 1px solid var(--ms-border); background: var(--ms-surface);
  color: var(--ms-text); border-radius: var(--ms-control-radius);
  cursor: pointer; font-size: calc(15px * var(--ms-text-scale));
  font-weight: 500; transition: background 120ms, border-color 120ms;
}
.ms-chip:hover { border-color: var(--ms-accent); }
.ms-chip[aria-pressed="true"] {
  background: var(--ms-accent); border-color: var(--ms-accent); color: var(--ms-accent-text);
}
.ms-endlabels {
  display: flex; justify-content: space-between; gap: 12px;
  margin-top: 8px; font-size: calc(12px * var(--ms-text-scale));
  color: var(--ms-secondary-text);
}

/* ── Stars ───────────────────────────────────────────────── */
.ms-stars { display: flex; gap: 6px; }
.ms-star {
  background: none; border: none; cursor: pointer; padding: 2px;
  font-size: calc(30px * var(--ms-text-scale)); line-height: 1;
  color: var(--ms-border); transition: color 100ms;
}
.ms-star.ms-on { color: var(--ms-accent); }

/* ── Emoji ───────────────────────────────────────────────── */
.ms-emoji-row { display: flex; flex-wrap: wrap; gap: 8px; }
.ms-emoji {
  flex: 1 1 auto; display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 10px 6px; border: 1px solid var(--ms-border); background: var(--ms-surface);
  border-radius: var(--ms-control-radius); cursor: pointer;
}
.ms-emoji:hover { border-color: var(--ms-accent); }
.ms-emoji[aria-pressed="true"] { border-color: var(--ms-accent); background: color-mix(in srgb, var(--ms-accent) 10%, var(--ms-surface)); }
.ms-emoji-glyph { font-size: calc(26px * var(--ms-text-scale)); line-height: 1; }
.ms-emoji-label { font-size: calc(12px * var(--ms-text-scale)); color: var(--ms-secondary-text); }

/* ── Thumbs ──────────────────────────────────────────────── */
.ms-thumbs { display: flex; gap: 12px; }
.ms-thumb {
  flex: 1; height: calc(var(--ms-control-height) + 8px);
  border: 1px solid var(--ms-border); background: var(--ms-surface);
  border-radius: var(--ms-control-radius); cursor: pointer;
  font-size: calc(22px * var(--ms-text-scale));
}
.ms-thumb:hover { border-color: var(--ms-accent); }
.ms-thumb[aria-pressed="true"] { border-color: var(--ms-accent); background: color-mix(in srgb, var(--ms-accent) 12%, var(--ms-surface)); }

/* ── Single choice ───────────────────────────────────────── */
.ms-choices { display: flex; flex-direction: column; gap: 8px; }
.ms-choice {
  min-height: var(--ms-control-height); padding: 12px 14px; text-align: left;
  border: 1px solid var(--ms-border); background: var(--ms-surface);
  color: var(--ms-text); border-radius: var(--ms-control-radius);
  cursor: pointer; font-size: calc(15px * var(--ms-text-scale)); font-weight: 500;
}
.ms-choice:hover { border-color: var(--ms-accent); }
.ms-choice[aria-pressed="true"] { border-color: var(--ms-accent); background: color-mix(in srgb, var(--ms-accent) 10%, var(--ms-surface)); }

/* ── Open text ───────────────────────────────────────────── */
.ms-textarea {
  width: 100%; min-height: 96px; resize: vertical; padding: 12px 14px;
  border: 1px solid var(--ms-border); border-radius: var(--ms-control-radius);
  background: var(--ms-surface); color: var(--ms-text);
  font: inherit; font-size: calc(15px * var(--ms-text-scale));
}
.ms-textarea:focus { outline: none; border-color: var(--ms-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ms-accent) 20%, transparent); }
.ms-counter { margin-top: 6px; font-size: calc(12px * var(--ms-text-scale)); color: var(--ms-secondary-text); text-align: right; }

/* ── Footer / button ─────────────────────────────────────── */
.ms-footer { margin-top: calc(var(--ms-spacing) * 1.25); }
.ms-btn {
  width: 100%; height: var(--ms-control-height);
  border: none; border-radius: var(--ms-control-radius);
  background: var(--ms-accent); color: var(--ms-accent-text);
  font-size: calc(15px * var(--ms-text-scale)); font-weight: 600; cursor: pointer;
  transition: opacity 120ms;
}
.ms-btn:hover { opacity: 0.92; }
.ms-btn:disabled { opacity: 0.45; cursor: not-allowed; }

/* ── Success ─────────────────────────────────────────────── */
.ms-success {
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  padding: calc(var(--ms-spacing) * 1.5) var(--ms-spacing);
  text-align: center;
}
.ms-success-check {
  width: 44px; height: 44px; border-radius: 50%;
  background: var(--ms-accent); color: var(--ms-accent-text);
  display: flex; align-items: center; justify-content: center; font-size: 24px;
}
`;

/** Inject the survey stylesheet once. No-op during SSR. */
export function ensureStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}
