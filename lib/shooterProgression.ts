// ============================================================================
// SHOOTER PROGRESSION
//
// Level and XP are derived from the SAME lifetime kill total that already
// powers the productivity tracker (GameState.totals). There is no separate
// XP currency to manage or desync — every kill logged anywhere in the app
// counts toward shooter level.
//
// The curve is intentionally front-loaded: the first couple of levels come
// within days, so a new player feels the reward loop almost immediately.
// Later levels stretch out over months, which is what keeps the bonus
// feeling earned rather than trivial at high totals.
// ============================================================================

/** XP required to go from `level` to `level + 1`. */
export function xpForLevel(level: number): number {
  return Math.round(50 * Math.pow(level, 1.5));
}

export interface LevelInfo {
  level: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
  totalXP: number;
}

/** Derives level purely from cumulative lifetime kills. Never stored directly. */
export function levelFromTotalKills(totalKills: number): LevelInfo {
  let level = 1;
  let remaining = Math.max(0, Math.floor(totalKills));

  while (remaining >= xpForLevel(level)) {
    remaining -= xpForLevel(level);
    level += 1;
  }

  return {
    level,
    xpIntoLevel: remaining,
    xpForNextLevel: xpForLevel(level),
    totalXP: totalKills,
  };
}

/**
 * Casual-mode combat bonuses derived from level.
 *
 * All three bonuses cap at level 20 so the advantage stays bounded — a
 * level 60 player is not dramatically stronger than a level 20 player,
 * just further along a curve that flattens out.
 */
const BONUS_CAP_LEVEL = 20;

export interface CombatStats {
  maxHp: number;
  fireRateMultiplier: number; // multiplies cooldown; <1 = faster
  reloadMultiplier: number; // multiplies reload-adjacent delays; <1 = faster
}

const BASE_HP = 100;
const HP_PER_LEVEL = 4; // up to +80 HP at level 20 (180 total)
const FIRE_RATE_REDUCTION_PER_LEVEL = 0.0125; // up to -25% at level 20
const RELOAD_REDUCTION_PER_LEVEL = 0.01; // up to -20% at level 20

export function getCombatStats(
  level: number,
  mode: "casual" | "ranked"
): CombatStats {
  if (mode === "ranked") {
    // Ranked normalizes everyone to level-1 baseline so the run measures
    // aim/movement/decision-making rather than accumulated productivity XP.
    return {
      maxHp: BASE_HP,
      fireRateMultiplier: 1,
      reloadMultiplier: 1,
    };
  }

  const cappedLevel = Math.min(level, BONUS_CAP_LEVEL);

  return {
    maxHp: BASE_HP + cappedLevel * HP_PER_LEVEL,
    fireRateMultiplier: 1 - cappedLevel * FIRE_RATE_REDUCTION_PER_LEVEL,
    reloadMultiplier: 1 - cappedLevel * RELOAD_REDUCTION_PER_LEVEL,
  };
}

// ============================================================================
// MATCH / DIFFICULTY
// ============================================================================

export const MATCH_DURATION_MS = 5 * 60 * 1000;

/** 0 at match start, 1 at match end. */
export function difficultyProgress(elapsedMs: number): number {
  return Math.min(1, Math.max(0, elapsedMs / MATCH_DURATION_MS));
}

export interface DifficultyParams {
  spawnIntervalMs: number;
  botSpeed: number;
  botHp: number;
  maxConcurrentBots: number;
}

/** Continuous ramp across the 5-minute match — no discrete "waves". */
export function getDifficultyParams(elapsedMs: number): DifficultyParams {
  const t = difficultyProgress(elapsedMs);

  return {
    spawnIntervalMs: lerp(1600, 550, t),
    botSpeed: lerp(55, 125, t),
    botHp: Math.round(lerp(1, 3, t)),
    maxConcurrentBots: Math.round(lerp(3, 9, t)),
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ============================================================================
// SCORING
// ============================================================================

export interface ScoreInput {
  kills: number;
  shotsFired: number;
  shotsHit: number;
}

export function computeAccuracy(shotsFired: number, shotsHit: number): number {
  if (shotsFired <= 0) return 0;
  return Math.min(1, shotsHit / shotsFired);
}

/**
 * Blended score: kills dominate (this is a shooter, volume matters) but
 * accuracy scales the result so spraying isn't strictly optimal.
 * Weighting: 70% raw kills, 30% accuracy-scaled kills.
 */
export function computeScore({ kills, shotsFired, shotsHit }: ScoreInput): number {
  const accuracy = computeAccuracy(shotsFired, shotsHit);
  const raw = kills * 10;
  const accuracyBonus = kills * 10 * accuracy;

  return Math.round(raw * 0.7 + accuracyBonus * 0.3);
}

