// ============================================================================
// SHOOTER STORAGE
//
// Deliberately isolated from lib/storage.ts (GameState / KillSession). The
// shooter mini-game reads lifetime kill totals from the productivity data
// (to compute level) but never writes back into it — a shooter match is
// not a logged work session, and the two histories must not merge.
// ============================================================================

export type MatchMode = "casual" | "ranked";

export interface ShooterMatchResult {
  id: string;
  playedAt: number;
  mode: MatchMode;
  kills: number;
  shotsFired: number;
  shotsHit: number;
  accuracy: number;
  score: number;
  survived: boolean; // false if the player died before the timer ran out
  durationMs: number;
  levelAtPlay: number;
}

export interface ShooterHighScores {
  casual: ShooterMatchResult | null;
  ranked: ShooterMatchResult | null;
  recentMatches: ShooterMatchResult[]; // capped, most recent first
}

const SHOOTER_KEY = "sniper_kpi_shooter_v1";
const MAX_RECENT = 10;

function isBrowser() {
  return typeof window !== "undefined";
}

function emptyHighScores(): ShooterHighScores {
  return { casual: null, ranked: null, recentMatches: [] };
}

export function loadShooterHighScores(): ShooterHighScores {
  if (!isBrowser()) return emptyHighScores();

  try {
    const raw = window.localStorage.getItem(SHOOTER_KEY);
    if (!raw) return emptyHighScores();

    const parsed = JSON.parse(raw);

    return {
      casual: parsed?.casual ?? null,
      ranked: parsed?.ranked ?? null,
      recentMatches: Array.isArray(parsed?.recentMatches)
        ? parsed.recentMatches
        : [],
    };
  } catch {
    return emptyHighScores();
  }
}

function saveShooterHighScores(data: ShooterHighScores) {
  if (!isBrowser()) return;

  try {
    window.localStorage.setItem(SHOOTER_KEY, JSON.stringify(data));
  } catch {
    // Ignore storage errors — losing a high score write is not fatal.
  }
}

/**
 * Records a completed match. Updates the per-mode high score only if the
 * new score beats the existing one. Returns the updated store plus whether
 * this run was a new personal best, so the UI can celebrate it.
 */
export function recordShooterMatch(result: ShooterMatchResult): {
  data: ShooterHighScores;
  isNewHighScore: boolean;
} {
  const current = loadShooterHighScores();
  const existingBest = current[result.mode];
  const isNewHighScore = !existingBest || result.score > existingBest.score;

  const next: ShooterHighScores = {
    ...current,
    [result.mode]: isNewHighScore ? result : existingBest,
    recentMatches: [result, ...current.recentMatches].slice(0, MAX_RECENT),
  };

  saveShooterHighScores(next);

  return { data: next, isNewHighScore };
}

export function resetShooterData() {
  if (!isBrowser()) return;

  try {
    window.localStorage.removeItem(SHOOTER_KEY);
  } catch {
    // Ignore.
  }
}

