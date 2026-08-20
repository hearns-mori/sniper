// ── Leverage layer ─────────────────────────────────────────────────────────
// One-time investment: every read/write of persisted data goes through here,
// once. Nothing else in the app touches localStorage directly, so the
// storage format can change without rediscovering call sites all over the UI.

import type { Category } from "./gameLogic";

export interface KillSession {
  id: string;
  category: Category;
  startTime: number;
  endTime: number;
  durationMs: number;
  kills: number;
  rate: number;
}

/** An in-progress session. Only startTime is authoritative — elapsed time is
 *  always Date.now() - startTime, so it stays accurate across reloads,
 *  backgrounding, or the browser being closed entirely. */
export interface ActiveSession {
  category: Category;
  startTime: number;
}

export interface GameState {
  totals: Record<Category, number>;
  sessions: KillSession[];
}

const STATE_KEY = "sniper_kpi_state_v1";
const ACTIVE_KEY = "sniper_kpi_active_v1";
const MAX_HISTORY = 100;

const emptyState: GameState = {
  totals: { architect: 0, commander: 0, army: 0 },
  sessions: [],
};

function isBrowser() {
  return typeof window !== "undefined";
}

export function loadState(): GameState {
  if (!isBrowser()) return emptyState;
  try {
    const raw = window.localStorage.getItem(STATE_KEY);
    if (!raw) return emptyState;
    const parsed = JSON.parse(raw);
    return {
      totals: { ...emptyState.totals, ...parsed.totals },
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
    };
  } catch {
    return emptyState;
  }
}

export function saveState(state: GameState) {
  if (!isBrowser()) return;
  try {
    const trimmed: GameState = { ...state, sessions: state.sessions.slice(0, MAX_HISTORY) };
    window.localStorage.setItem(STATE_KEY, JSON.stringify(trimmed));
  } catch {
    // Storage full or unavailable — game keeps working in-memory for this tab.
  }
}

export function loadActiveSession(): ActiveSession | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(ACTIVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.category || !parsed.startTime) return null;
    return parsed as ActiveSession;
  } catch {
    return null;
  }
}

export function saveActiveSession(session: ActiveSession | null) {
  if (!isBrowser()) return;
  try {
    if (session) {
      window.localStorage.setItem(ACTIVE_KEY, JSON.stringify(session));
    } else {
      window.localStorage.removeItem(ACTIVE_KEY);
    }
  } catch {
    // ignore
  }
}

export function resetAll() {
  if (!isBrowser()) return;
  window.localStorage.removeItem(STATE_KEY);
  window.localStorage.removeItem(ACTIVE_KEY);
}
