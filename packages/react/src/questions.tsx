//
// questions.tsx
//
// One renderer per question type, ported from the iOS UI/*View.swift files. Each
// takes the question, the current answer value, and an `onChange`, and emits the
// exact `AnswerValue` JSON shape the backend expects (API-CONTRACT §Answer value
// shapes). Styling is entirely via the `.ms-*` classes + theme CSS variables.
//

import type { AnswerValue, Question } from "@microsurveysai/web-core";

export interface QuestionInputProps {
  question: Question;
  value: AnswerValue | undefined;
  onChange: (value: AnswerValue) => void;
}

export function QuestionInput({ question, value, onChange }: QuestionInputProps) {
  const cfg = question.config;
  switch (cfg.kind) {
    case "scale":
      return <ScaleInput min={cfg.min} max={cfg.max} minLabel={cfg.minLabel} maxLabel={cfg.maxLabel} value={numValue(value)} onPick={(n) => onChange({ value: n })} />;
    case "stars":
      return <StarsInput count={cfg.count} value={numValue(value)} onPick={(n) => onChange({ value: n })} />;
    case "emoji":
      return <EmojiInput options={cfg.options} value={strValue(value)} onPick={(v) => onChange({ value: v })} />;
    case "thumbs":
      return <ThumbsInput value={strValue(value)} onPick={(v) => onChange({ value: v as "up" | "down" })} />;
    case "singleChoice":
      return <ChoiceInput options={cfg.options} value={value && "choice" in value ? value.choice : undefined} onPick={(v) => onChange({ choice: v })} />;
    case "openText":
      return <OpenTextInput placeholder={cfg.placeholder} maxLength={cfg.maxLength} value={value && "text" in value ? value.text : ""} onInput={(t) => onChange({ text: t })} />;
  }
}

/** True when an answer value counts as "provided" (for required-gating). */
export function isAnswered(value: AnswerValue | undefined): boolean {
  if (!value) return false;
  if ("text" in value) return value.text.trim().length > 0;
  return true;
}

// ── helpers to read the current value regardless of union branch ──────────────
function numValue(v: AnswerValue | undefined): number | undefined {
  return v && "value" in v && typeof v.value === "number" ? v.value : undefined;
}
function strValue(v: AnswerValue | undefined): string | undefined {
  return v && "value" in v && typeof v.value === "string" ? v.value : undefined;
}

// ── Scale (NPS / CES) ─────────────────────────────────────────────────────────
function ScaleInput({ min, max, minLabel, maxLabel, value, onPick }: { min: number; max: number; minLabel?: string; maxLabel?: string; value: number | undefined; onPick: (n: number) => void }) {
  const points: number[] = [];
  for (let i = min; i <= max; i++) points.push(i);
  return (
    <div>
      <div className="ms-scale" role="group">
        {points.map((n) => (
          <button key={n} type="button" className="ms-chip" aria-pressed={value === n} onClick={() => onPick(n)}>
            {n}
          </button>
        ))}
      </div>
      {(minLabel || maxLabel) && (
        <div className="ms-endlabels">
          <span>{minLabel}</span>
          <span>{maxLabel}</span>
        </div>
      )}
    </div>
  );
}

// ── Stars ─────────────────────────────────────────────────────────────────────
function StarsInput({ count, value, onPick }: { count: number; value: number | undefined; onPick: (n: number) => void }) {
  const stars: number[] = [];
  for (let i = 1; i <= count; i++) stars.push(i);
  return (
    <div className="ms-stars" role="group">
      {stars.map((n) => (
        <button key={n} type="button" className={`ms-star${value !== undefined && n <= value ? " ms-on" : ""}`} aria-label={`${n} star${n > 1 ? "s" : ""}`} aria-pressed={value === n} onClick={() => onPick(n)}>
          ★
        </button>
      ))}
    </div>
  );
}

// ── Emoji ─────────────────────────────────────────────────────────────────────
function EmojiInput({ options, value, onPick }: { options: { value: string; emoji: string; label?: string }[]; value: string | undefined; onPick: (v: string) => void }) {
  return (
    <div className="ms-emoji-row" role="group">
      {options.map((o) => (
        <button key={o.value} type="button" className="ms-emoji" aria-pressed={value === o.value} onClick={() => onPick(o.value)}>
          <span className="ms-emoji-glyph">{o.emoji}</span>
          {o.label && <span className="ms-emoji-label">{o.label}</span>}
        </button>
      ))}
    </div>
  );
}

// ── Thumbs ────────────────────────────────────────────────────────────────────
function ThumbsInput({ value, onPick }: { value: string | undefined; onPick: (v: string) => void }) {
  return (
    <div className="ms-thumbs" role="group">
      <button type="button" className="ms-thumb" aria-label="Thumbs up" aria-pressed={value === "up"} onClick={() => onPick("up")}>
        👍
      </button>
      <button type="button" className="ms-thumb" aria-label="Thumbs down" aria-pressed={value === "down"} onClick={() => onPick("down")}>
        👎
      </button>
    </div>
  );
}

// ── Single choice ─────────────────────────────────────────────────────────────
function ChoiceInput({ options, value, onPick }: { options: { value: string; label: string }[]; value: string | undefined; onPick: (v: string) => void }) {
  return (
    <div className="ms-choices" role="group">
      {options.map((o) => (
        <button key={o.value} type="button" className="ms-choice" aria-pressed={value === o.value} onClick={() => onPick(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Open text ─────────────────────────────────────────────────────────────────
function OpenTextInput({ placeholder, maxLength, value, onInput }: { placeholder?: string; maxLength?: number; value: string; onInput: (t: string) => void }) {
  return (
    <div>
      <textarea className="ms-textarea" placeholder={placeholder} maxLength={maxLength} value={value} onChange={(e) => onInput(e.target.value)} />
      {maxLength !== undefined && (
        <div className="ms-counter">
          {value.length} / {maxLength}
        </div>
      )}
    </div>
  );
}
