// ── Abstraction layer ──────────────────────────────────────────────────────
// Pure math only. Nothing in this file knows about colors, components, or
// storage — that's the point. The rest of the app hits this module through
// a handful of small functions and never needs to know how the number
// actually gets computed.

export type Category = "architect" | "commander" | "army";

/** The sweet-spot session length, in minutes. A session at exactly this
 *  length gets the best possible rate (1.0). */
export const OPTIMAL_MINUTES = 90;

/** Spread of the rate curve. Larger = more forgiving away from 90m. */
const SIGMA_MINUTES = 45;

/** Cap used only for the visual ruler (see RangeRuler) — the math itself
 *  is unbounded. */
export const RULER_MAX_MINUTES = OPTIMAL_MINUTES * 2;

/**
 * Rate is a 0..1 score for how close a session lands to the 90-minute
 * optimum. It's a bell curve centered on OPTIMAL_MINUTES: short sessions
 * score low (you never got into it), a 90-minute session scores 1.0, and
 * very long sessions taper back down (diminishing returns / fatigue).
 */
export function calcRate(elapsedMs: number): number {
  const minutes = elapsedMs / 60000;
  const diff = minutes - OPTIMAL_MINUTES;
  const rate = Math.exp(-(diff * diff) / (2 * SIGMA_MINUTES * SIGMA_MINUTES));
  return Math.min(1, Math.max(0, rate));
}

/**
 * Final kill count for a session: minutes spent, weighted by how close the
 * session landed to the 90-minute zero. This is the one fixed formula used
 * everywhere — live preview during the session and the final tally are the
 * exact same calculation, just called at different times.
 */
export function calcKills(elapsedMs: number): number {
  const minutes = elapsedMs / 60000;
  if (minutes <= 0) return 0;
  return Math.max(0, Math.round(minutes * calcRate(elapsedMs)));
}

export type RankId = "dead-zero" | "tight-group" | "on-target" | "off-zero" | "no-zero";

/** Maps a rate to a shooting-range rank. Presentation (label/color) for each
 *  rank id lives in the theme layer, not here. */
export function calcRank(rate: number): RankId {
  if (rate >= 0.9) return "dead-zero";
  if (rate >= 0.7) return "tight-group";
  if (rate >= 0.4) return "on-target";
  if (rate >= 0.15) return "off-zero";
  return "no-zero";
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
