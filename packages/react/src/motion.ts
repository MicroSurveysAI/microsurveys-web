//
// motion.ts
//
// The "unfurl" transition between a minimized survey's launcher pill and its card: the card
// scales up out of the launcher's corner with a soft spring, and scales back into it when
// minimized. Built on the Web Animations API, so there are no dependencies. Where it's missing
// (old browsers, test DOMs) every helper resolves at once and the change is instant.
//
// Visitors who ask for reduced motion get a short crossfade instead.
//

import type { WebPlacement } from "@microsurveysai/web-core";

/** A damped spring as a CSS `linear()` easing; a cubic-bezier with a little overshoot where unsupported. */
const SPRING = (() => {
  const points: number[] = [];
  for (let i = 0; i <= 48; i++) {
    const t = i / 48;
    points.push(i === 48 ? 1 : +(1 - Math.exp(-8 * t) * Math.cos(8 * t)).toFixed(4));
  }
  const spring = `linear(${points.join(", ")})`;
  try {
    if (typeof CSS !== "undefined" && CSS.supports?.("transition-timing-function", spring)) return spring;
  } catch {
    // CSS.supports can throw on odd hosts; fall through.
  }
  return "cubic-bezier(0.3, 1.3, 0.4, 1)";
})();
const EASE_IN = "cubic-bezier(0.4, 0, 1, 1)";

/** Where the card grows from: the corner the launcher sits in. Modal placements dock the launcher bottom-center. */
export function unfurlOrigin(placement: WebPlacement): string {
  switch (placement) {
    case "top-right": return "top right";
    case "top-left": return "top left";
    case "bottom-right": return "bottom right";
    case "bottom-left": return "bottom left";
    default: return "bottom center";
  }
}

function reducedMotion(): boolean {
  try {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Stops any running transition on these elements. Their pending promises reject. */
export function stopMotion(...els: (Element | null | undefined)[]): void {
  for (const el of els) el?.getAnimations?.().forEach((a) => a.cancel());
}

/**
 * Runs one animation. Entrances end at the element's natural style, so they're dropped once done;
 * exits hold their last frame until the caller hides the element (and the next transition stops them).
 * Rejects if stopped part-way.
 */
function play(
  el: Element | null | undefined,
  keyframes: Keyframe[],
  opts: { duration: number; delay?: number; easing?: string; origin?: string; exit?: boolean },
): Promise<void> {
  const target = el as HTMLElement | null | undefined;
  if (!target || typeof target.animate !== "function") return Promise.resolve();
  if (opts.origin) target.style.transformOrigin = opts.origin;
  const anim = target.animate(keyframes, {
    duration: opts.duration,
    delay: opts.delay ?? 0,
    easing: opts.easing ?? "ease",
    fill: opts.exit ? "forwards" : "backwards",
  });
  return anim.finished.then(() => undefined);
}

/** The card opens out of the launcher's corner. */
export function cardIn(card: Element | null | undefined, origin: string): Promise<void> {
  if (reducedMotion()) return play(card, [{ opacity: 0 }, { opacity: 1 }], { duration: 150 });
  return play(
    card,
    [
      { opacity: 0, transform: "scale(0.35)" },
      { opacity: 1, transform: "scale(0.7)", offset: 0.25 },
      { opacity: 1, transform: "scale(1)" },
    ],
    { duration: 460, easing: SPRING, origin },
  );
}

/** The card folds back into the launcher's corner. Holds its last frame; hide the card when it resolves. */
export function cardOut(card: Element | null | undefined, origin: string): Promise<void> {
  if (reducedMotion()) return play(card, [{ opacity: 1 }, { opacity: 0 }], { duration: 150, exit: true });
  return play(
    card,
    [{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(0.35)" }],
    { duration: 240, easing: EASE_IN, origin, exit: true },
  );
}

/** The launcher pops back in once the card is mostly folded away. */
export function launcherIn(launcher: Element | null | undefined, origin: string): Promise<void> {
  if (reducedMotion()) return play(launcher, [{ opacity: 0 }, { opacity: 1 }], { duration: 150, delay: 100 });
  return play(
    launcher,
    [{ opacity: 0, transform: "scale(0.9)" }, { opacity: 1, transform: "scale(1)" }],
    { duration: 300, delay: 150, easing: SPRING, origin },
  );
}

/** The launcher shrinks away as the card opens. Holds its last frame; remove the launcher when it resolves. */
export function launcherOut(launcher: Element | null | undefined, origin: string): Promise<void> {
  if (reducedMotion()) return play(launcher, [{ opacity: 1 }, { opacity: 0 }], { duration: 120, exit: true });
  return play(
    launcher,
    [{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(0.9)" }],
    { duration: 140, easing: EASE_IN, origin, exit: true },
  );
}

/** The dimmed backdrop of a modal placement, fading with the card. Only its color animates, so the card
 *  inside keeps its own opacity. One keyframe: the other end is the scrim's own color. */
export function scrimIn(scrim: Element | null | undefined): Promise<void> {
  return play(scrim, [{ backgroundColor: "transparent", offset: 0 }], { duration: 200 });
}

export function scrimOut(scrim: Element | null | undefined): Promise<void> {
  return play(scrim, [{ backgroundColor: "transparent", offset: 1 }], { duration: 200, exit: true });
}
