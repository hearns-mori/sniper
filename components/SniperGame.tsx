"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Crosshair,
  Gem,
  ListOrdered,
  RotateCcw,
  Trash2,
  Trophy,
} from "lucide-react";

import {
  calcKills,
  calcRate,
  OPTIMAL_MINUTES,
  type Category,
} from "@/lib/gameLogic";

import {
  type ActiveSession,
  type GameState,
  type KillSession,
  loadActiveSession,
  loadState,
  resetAll,
  saveActiveSession,
  saveState,
} from "@/lib/storage";

import {
  CATEGORY_META,
  COLORS,
  FONT_DISPLAY,
  FONT_MONO,
} from "@/lib/theme";

import CategoryCard from "./CategoryCard";
import ScopeOverlay from "./ScopeOverlay";
import ResultCard from "./ResultCard";

type Screen = "home" | "active" | "result";
type SubScreen = "base" | "leaderboard" | "rewards";

interface ResultData {
  category: Category;
  kills: number;
  rate: number;
  durationMs: number;
}

const CATEGORY_ORDER: Category[] = [
  "architect",
  "commander",
  "army",
];

// ============================================================================
// REWARDS
// ============================================================================

const REWARD_CHARS =
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

const REWARDS_KEY = "sniper_kpi_rewards_v1";
const REWARD_PROGRESS_KEY = "sniper_kpi_reward_progress_v1";

interface RewardItem {
  id: string;
  code: string;
  category: Category;
  earnedAt: number;
}

interface RewardProgress {
  startTime: number;
  lastMinute: number;
}

function generateRewardCode(): string {
  let code = "";

  for (let i = 0; i < 3; i++) {
    code +=
      REWARD_CHARS[Math.floor(Math.random() * REWARD_CHARS.length)];
  }

  return code;
}

function charRank(ch: string): number {
  const code = ch.charCodeAt(0);

  if (code >= 48 && code <= 57) {
    return code - 48;
  }

  if (code >= 97 && code <= 122) {
    return 10 + (code - 97);
  }

  if (code >= 65 && code <= 90) {
    return 36 + (code - 65);
  }

  return -1;
}

function rewardValue(code: string): number {
  return (
    charRank(code[0]) * 62 * 62 +
    charRank(code[1]) * 62 +
    charRank(code[2])
  );
}

function rewardTier(
  code: string
):
  | "diamond"
  | "rhodium"
  | "platinum"
  | "gold"
  | "silver"
  | "bronze" {
  const c = code[0];
  const b = code[1];
  const a = code[2];

  if (c === "Z" && b === "Z" && a === "Z") {
    return "diamond";
  }

  if (c === "Z" && b === "Z" && a !== "Z") {
    return "rhodium";
  }

  if (c === "Z" && b !== "Z") {
    return "platinum";
  }

  if (c >= "A" && c < "Z") {
    return "gold";
  }

  if (c >= "a" && c <= "z") {
    return "silver";
  }

  return "bronze";
}

const TIER_COLOR: Record<
  "diamond" | "rhodium" | "platinum" | "gold" | "silver" | "bronze",
  string
> = {
  diamond: "#b9f2ff",
  rhodium: "#e2e8f0",
  platinum: "#e5e4e2",
  gold: COLORS.chrome,
  silver: "#c7d0c6",
  bronze: "#b98a52",
};

function isBrowser() {
  return typeof window !== "undefined";
}

function loadRewards(): RewardItem[] {
  if (!isBrowser()) return [];

  try {
    const raw = window.localStorage.getItem(REWARDS_KEY);

    if (!raw) return [];

    const parsed = JSON.parse(raw);

    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRewards(rewards: RewardItem[]) {
  if (!isBrowser()) return;

  try {
    window.localStorage.setItem(
      REWARDS_KEY,
      JSON.stringify(rewards)
    );
  } catch {
    // Ignore storage errors.
  }
}

function loadRewardProgress(): RewardProgress | null {
  if (!isBrowser()) return null;

  try {
    const raw = window.localStorage.getItem(
      REWARD_PROGRESS_KEY
    );

    if (!raw) return null;

    return JSON.parse(raw) as RewardProgress;
  } catch {
    return null;
  }
}

function saveRewardProgress(
  progress: RewardProgress | null
) {
  if (!isBrowser()) return;

  try {
    if (progress) {
      window.localStorage.setItem(
        REWARD_PROGRESS_KEY,
        JSON.stringify(progress)
      );
    } else {
      window.localStorage.removeItem(
        REWARD_PROGRESS_KEY
      );
    }
  } catch {
    // Ignore storage errors.
  }
}

// ============================================================================
// DATE / DAILY SCORE HELPERS
// ============================================================================

function startOfLocalDay(timestamp: number): number {
  const d = new Date(timestamp);

  d.setHours(0, 0, 0, 0);

  return d.getTime();
}

function endOfLocalDay(timestamp: number): number {
  const d = new Date(timestamp);

  d.setHours(23, 59, 59, 999);

  return d.getTime();
}

function isSameLocalDay(
  timestamp: number,
  referenceNow: number
): boolean {
  const a = new Date(timestamp);
  const b = new Date(referenceNow);

  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function daysAgo(
  timestamp: number,
  days: number
): number {
  const d = new Date(timestamp);

  d.setDate(d.getDate() - days);

  return d.getTime();
}

function computeTodayTotals(
  sessions: KillSession[],
  now: number
): Record<Category, number> {
  const totals: Record<Category, number> = {
    architect: 0,
    commander: 0,
    army: 0,
  };

  for (const session of sessions) {
    if (isSameLocalDay(session.startTime, now)) {
      totals[session.category] += session.kills;
    }
  }

  return totals;
}

function getDailyTotals(
  sessions: KillSession[],
  fromTimestamp: number,
  toTimestamp: number
): Map<string, number> {
  const daily = new Map<string, number>();

  for (const session of sessions) {
    if (
      session.startTime < fromTimestamp ||
      session.startTime > toTimestamp
    ) {
      continue;
    }

    const key = new Date(
      session.startTime
    ).toLocaleDateString();

    daily.set(
      key,
      (daily.get(key) ?? 0) + session.kills
    );
  }

  return daily;
}

function bestDailyScore(
  sessions: KillSession[],
  fromTimestamp: number,
  toTimestamp: number
): number {
  const daily = getDailyTotals(
    sessions,
    fromTimestamp,
    toTimestamp
  );

  let best = 0;

  for (const value of daily.values()) {
    best = Math.max(best, value);
  }

  return best;
}

function getYesterdayBest(
  sessions: KillSession[],
  now: number
): number {
  const yesterday = new Date(now);

  yesterday.setDate(
    yesterday.getDate() - 1
  );

  const start = startOfLocalDay(
    yesterday.getTime()
  );

  const end = endOfLocalDay(
    yesterday.getTime()
  );

  return bestDailyScore(
    sessions,
    start,
    end
  );
}

function getSevenDayBest(
  sessions: KillSession[],
  now: number
): number {
  const start = startOfLocalDay(
    daysAgo(now, 6)
  );

  const end = endOfLocalDay(now);

  return bestDailyScore(
    sessions,
    start,
    end
  );
}

function getThirtyDayBest(
  sessions: KillSession[],
  now: number
): number {
  const start = startOfLocalDay(
    daysAgo(now, 29)
  );

  const end = endOfLocalDay(now);

  return bestDailyScore(
    sessions,
    start,
    end
  );
}

function getPersonalBest(
  sessions: KillSession[]
): number {
  if (sessions.length === 0) {
    return 0;
  }

  const daily = new Map<string, number>();

  for (const session of sessions) {
    const key = new Date(
      session.startTime
    ).toLocaleDateString();

    daily.set(
      key,
      (daily.get(key) ?? 0) + session.kills
    );
  }

  let best = 0;

  for (const value of daily.values()) {
    best = Math.max(best, value);
  }

  return best;
}

function getMonthAverage(
  sessions: KillSession[],
  now: number
): number {
  const current = new Date(now);

  const year = current.getFullYear();
  const month = current.getMonth();

  const firstDay = new Date(
    year,
    month,
    1,
    0,
    0,
    0,
    0
  );

  const todayDay = current.getDate();

  const daily = new Map<string, number>();

  for (const session of sessions) {
    const d = new Date(session.startTime);

    if (
      d.getFullYear() !== year ||
      d.getMonth() !== month ||
      d.getDate() > todayDay
    ) {
      continue;
    }

    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

    daily.set(
      key,
      (daily.get(key) ?? 0) + session.kills
    );
  }

  let total = 0;

  for (const value of daily.values()) {
    total += value;
  }

  /*
   * Average across every calendar day elapsed this month.
   *
   * This prevents a single high-production day from looking like
   * the monthly average.
   */
  return todayDay > 0
    ? Math.round(total / todayDay)
    : 0;
}

// ============================================================================
// IDEAL
// ============================================================================

/*
 * YOUR IDEAL:
 *
 * 4 × 90 minutes
 * +
 * 24 × 15 minutes
 * =
 * 360 + 360
 * =
 * 720 minutes
 * =
 * 12 hours
 */

const IDEAL_BLOCKS_90 = 4;
const IDEAL_BLOCKS_15 = 24;

const IDEAL_MINUTES =
  IDEAL_BLOCKS_90 * 90 +
  IDEAL_BLOCKS_15 * 15;

const IDEAL_KILLS =
  calcKills(IDEAL_MINUTES * 60000);

// ============================================================================
// RANDOMIZED LEADERBOARD CURVE
// ============================================================================

/*
 * Important:
 *
 * The randomization NEVER changes the peak.
 *
 * Example:
 *
 * MONTH AVERAGE peak = 91
 *
 * The curve may show:
 *
 * 0 → 2 → 3 → 8 → 11 → 10 → 18 → 17 → 25 → ...
 *
 * but it can NEVER end at 87, 94, etc.
 *
 * At 10 PM it MUST be exactly 91.
 *
 * The randomness only controls WHEN/how quickly the
 * score climbs toward that fixed peak.
 */

function hash01(seed: string): number {
  let h = 2166136261;

  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);

    h = Math.imul(
      h,
      16777619
    );
  }

  return (
    (h >>> 0) /
    4294967295
  );
}

function seededRandom(
  seed: string
): number {
  return hash01(seed);
}

function smoothstep(t: number): number {
  const x = Math.min(
    1,
    Math.max(0, t)
  );

  return x * x * (3 - 2 * x);
}

/*
 * Generates a deterministic but irregular progression.
 *
 * It is intentionally NOT linear.
 *
 * The returned value is always between 0 and 1.
 */
function randomizedProgress(
  id: string,
  now: number
): number {
  const dateKey =
    new Date(now).toDateString();

  const hour =
    new Date(now).getHours();

  const minute =
    new Date(now).getMinutes();

  const second =
    new Date(now).getSeconds();

  const dayFrac =
    (
      hour * 60 +
      minute +
      second / 60
    ) /
    (24 * 60);

  /*
   * Leaderboard starts at 06:00.
   */
  const START_HOUR = 6;

  /*
   * Leaderboard ends at 22:00.
   */
  const END_HOUR = 22;

  const start =
    START_HOUR / 24;

  const end =
    END_HOUR / 24;

  if (dayFrac <= start) {
    return 0;
  }

  if (dayFrac >= end) {
    return 1;
  }

  const normalized =
    (dayFrac - start) /
    (end - start);

  /*
   * Multiple deterministic waves.
   *
   * This produces a curve that:
   *
   * - accelerates
   * - slows down
   * - accelerates again
   * - has plateaus
   *
   * while still always ending exactly at 1.
   */

  const r1 = seededRandom(
    `${dateKey}:${id}:wave1`
  );

  const r2 = seededRandom(
    `${dateKey}:${id}:wave2`
  );

  const r3 = seededRandom(
    `${dateKey}:${id}:wave3`
  );

  const power =
    0.65 +
    r1 * 1.4;

  let progress = Math.pow(
    normalized,
    power
  );

  const wave1 =
    Math.sin(
      normalized *
        Math.PI *
        (2 + Math.floor(r2 * 4)) +
        r2 * Math.PI
    );

  const wave2 =
    Math.sin(
      normalized *
        Math.PI *
        (5 + Math.floor(r3 * 5)) +
        r3 * Math.PI
    );

  /*
   * Small deterministic perturbation.
   */
  progress +=
    wave1 * 0.08 * normalized;

  progress +=
    wave2 * 0.035 * normalized;

  /*
   * Keep it valid.
   */
  progress = Math.min(
    1,
    Math.max(0, progress)
  );

  /*
   * Smooth the result.
   */
  progress = smoothstep(progress);

  /*
   * IMPORTANT:
   *
   * This forces exact endpoints.
   *
   * 06:00 = 0
   * 22:00 = 1
   */
  if (normalized <= 0) {
    return 0;
  }

  if (normalized >= 1) {
    return 1;
  }

  return progress;
}

function getDisplayedBenchmarkScore(
  peak: number,
  id: string,
  now: number
): number {
  if (peak <= 0) {
    return 0;
  }

  const progress =
    randomizedProgress(
      id,
      now
    );

  /*
   * Floor means the benchmark never exceeds its fixed peak.
   */
  return Math.min(
    peak,
    Math.floor(
      peak * progress
    )
  );
}

// ============================================================================
// LEADERBOARD
// ============================================================================

interface LeaderboardEntry {
  id: string;
  name: string;
  peak: number;
  kills: number;
  isYou: boolean;
  description: string;
}

function rankColor(rank: number): string {
  if (rank === 1) {
    return COLORS.chrome;
  }

  if (rank === 2) {
    return "#c7d0c6";
  }

  if (rank === 3) {
    return "#b98a52";
  }

  return COLORS.textMuted;
}

const TABS: {
  id: SubScreen;
  label: string;
  Icon: typeof Crosshair;
}[] = [
  {
    id: "base",
    label: "Base",
    Icon: Crosshair,
  },
  {
    id: "leaderboard",
    label: "Ranks",
    Icon: ListOrdered,
  },
  {
    id: "rewards",
    label: "Vault",
    Icon: Gem,
  },
];

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function SniperGame() {
  const [ready, setReady] =
    useState(false);

  const [screen, setScreen] =
    useState<Screen>("home");

  const [subScreen, setSubScreen] =
    useState<SubScreen>("base");

  const [gameState, setGameState] =
    useState<GameState>({
      totals: {
        architect: 0,
        commander: 0,
        army: 0,
      },
      sessions: [],
    });

  const [active, setActive] =
    useState<ActiveSession | null>(
      null
    );

  const [elapsedMs, setElapsedMs] =
    useState(0);

  const [result, setResult] =
    useState<ResultData | null>(
      null
    );

  const [rewards, setRewards] =
    useState<RewardItem[]>([]);

  /*
   * Used to force leaderboard recalculation
   * every 30 seconds.
   */
  const [heartbeat, setHeartbeat] =
    useState(0);

  const intervalRef =
    useRef<ReturnType<
      typeof setInterval
    > | null>(null);

  const rewardProgressRef =
    useRef<RewardProgress | null>(
      null
    );

  // ========================================================================
  // REWARD PAYOUT
  // ========================================================================

  const grantMinuteRewards =
    useCallback(
      (
        elapsed: number,
        category: Category
      ) => {
        const progress =
          rewardProgressRef.current;

        if (!progress) {
          return;
        }

        const currentMinute =
          Math.floor(
            elapsed / 60000
          );

        if (
          currentMinute <=
          progress.lastMinute
        ) {
          return;
        }

        const minted: RewardItem[] =
          [];

        for (
          let m =
            progress.lastMinute + 1;
          m <= currentMinute;
          m++
        ) {
          minted.push({
            id: `${progress.startTime}-${m}`,
            code: generateRewardCode(),
            category,
            earnedAt:
              progress.startTime +
              m * 60000,
          });
        }

        setRewards((prev) => {
          const next = [
            ...minted,
            ...prev,
          ];

          saveRewards(next);

          return next;
        });

        const updated: RewardProgress =
          {
            startTime:
              progress.startTime,
            lastMinute:
              currentMinute,
          };

        rewardProgressRef.current =
          updated;

        saveRewardProgress(
          updated
        );
      },
      []
    );

  // ========================================================================
  // LOAD
  // ========================================================================

  useEffect(() => {
    setGameState(
      loadState()
    );

    setRewards(
      loadRewards()
    );

    const activeSession =
      loadActiveSession();

    if (activeSession) {
      setActive(
        activeSession
      );

      const elapsed =
        Date.now() -
        activeSession.startTime;

      setElapsedMs(
        elapsed
      );

      setScreen(
        "active"
      );

      const storedProgress =
        loadRewardProgress();

      const progress =
        storedProgress &&
        storedProgress.startTime ===
          activeSession.startTime
          ? storedProgress
          : {
              startTime:
                activeSession.startTime,
              lastMinute: 0,
            };

      rewardProgressRef.current =
        progress;

      saveRewardProgress(
        progress
      );

      grantMinuteRewards(
        elapsed,
        activeSession.category
      );
    }

    setReady(true);
  }, [
    grantMinuteRewards,
  ]);

  // ========================================================================
  // ACTIVE SESSION TIMER
  // ========================================================================

  useEffect(() => {
    if (
      screen !== "active" ||
      !active
    ) {
      if (
        intervalRef.current
      ) {
        clearInterval(
          intervalRef.current
        );
      }

      return;
    }

    const tick = () => {
      const elapsed =
        Date.now() -
        active.startTime;

      setElapsedMs(
        elapsed
      );

      grantMinuteRewards(
        elapsed,
        active.category
      );
    };

    tick();

    intervalRef.current =
      setInterval(
        tick,
        1000
      );

    const onVisible =
      () => {
        if (
          document.visibilityState ===
          "visible"
        ) {
          tick();
        }
      };

    document.addEventListener(
      "visibilitychange",
      onVisible
    );

    window.addEventListener(
      "focus",
      tick
    );

    return () => {
      if (
        intervalRef.current
      ) {
        clearInterval(
          intervalRef.current
        );
      }

      document.removeEventListener(
        "visibilitychange",
        onVisible
      );

      window.removeEventListener(
        "focus",
        tick
      );
    };
  }, [
    screen,
    active,
    grantMinuteRewards,
  ]);

  // ========================================================================
  // LEADERBOARD HEARTBEAT
  // ========================================================================

  useEffect(() => {
    const id =
      setInterval(
        () =>
          setHeartbeat(
            (h) => h + 1
          ),
        30000
      );

    return () =>
      clearInterval(id);
  }, []);

  // ========================================================================
  // START SESSION
  // ========================================================================

  const startSession =
    useCallback(
      (category: Category) => {
        const session: ActiveSession =
          {
            category,
            startTime:
              Date.now(),
          };

        saveActiveSession(
          session
        );

        setActive(
          session
        );

        setElapsedMs(
          0
        );

        const progress: RewardProgress =
          {
            startTime:
              session.startTime,
            lastMinute: 0,
          };

        rewardProgressRef.current =
          progress;

        saveRewardProgress(
          progress
        );

        setScreen(
          "active"
        );
      },
      []
    );

  // ========================================================================
  // END SESSION
  // ========================================================================

  const endSession =
    useCallback(() => {
      if (!active) {
        return;
      }

      const finalElapsed =
        Date.now() -
        active.startTime;

      grantMinuteRewards(
        finalElapsed,
        active.category
      );

      const kills =
        calcKills(
          finalElapsed
        );

      const rate =
        calcRate(
          finalElapsed
        );

      const record: KillSession =
        {
          id: `${active.startTime}-${Date.now()}`,
          category:
            active.category,
          startTime:
            active.startTime,
          endTime:
            Date.now(),
          durationMs:
            finalElapsed,
          kills,
          rate,
        };

      setGameState(
        (prev) => {
          const next: GameState =
            {
              totals: {
                ...prev.totals,
                [active.category]:
                  prev.totals[
                    active.category
                  ] + kills,
              },
              sessions: [
                record,
                ...prev.sessions,
              ],
            };

          saveState(
            next
          );

          return next;
        }
      );

      saveActiveSession(
        null
      );

      rewardProgressRef.current =
        null;

      saveRewardProgress(
        null
      );

      setActive(
        null
      );

      setResult({
        category:
          active.category,
        kills,
        rate,
        durationMs:
          finalElapsed,
      });

      setScreen(
        "result"
      );
    }, [
      active,
      grantMinuteRewards,
    ]);

  // ========================================================================
  // ABORT
  // ========================================================================

  const abortSession =
    useCallback(() => {
      if (active) {
        grantMinuteRewards(
          Date.now() -
            active.startTime,
          active.category
        );
      }

      saveActiveSession(
        null
      );

      rewardProgressRef.current =
        null;

      saveRewardProgress(
        null
      );

      setActive(
        null
      );

      setScreen(
        "home"
      );
    }, [
      active,
      grantMinuteRewards,
    ]);

  // ========================================================================
  // RESULT
  // ========================================================================

  const closeResult =
    useCallback(() => {
      setResult(
        null
      );

      setScreen(
        "home"
      );
    }, []);

  // ========================================================================
  // DELETE REWARD
  // ========================================================================

  const deleteReward =
    useCallback(
      (id: string) => {
        setRewards(
          (prev) => {
            const next =
              prev.filter(
                (r) =>
                  r.id !== id
              );

            saveRewards(
              next
            );

            return next;
          }
        );
      },
      []
    );

  // ========================================================================
  // RESET
  // ========================================================================

  const handleReset =
    useCallback(() => {
      if (
        typeof window !==
          "undefined" &&
        !window.confirm(
          "Clear all kill history and rewards? This can't be undone."
        )
      ) {
        return;
      }

      resetAll();

      saveRewards(
        []
      );

      saveRewardProgress(
        null
      );

      setGameState({
        totals: {
          architect: 0,
          commander: 0,
          army: 0,
        },
        sessions: [],
      });

      setRewards(
        []
      );

      rewardProgressRef.current =
        null;

      setActive(
        null
      );

      setSubScreen(
        "base"
      );

      setScreen(
        "home"
      );
    }, []);

  // ========================================================================
  // CURRENT TIME / DAILY DATA
  // ========================================================================

  const now = Date.now();

  const todayTotals =
    computeTodayTotals(
      gameState.sessions,
      now
    );

  const todaySum =
    todayTotals.architect +
    todayTotals.commander +
    todayTotals.army;

  const todaySessions =
    gameState.sessions.filter(
      (session) =>
        isSameLocalDay(
          session.startTime,
          now
        )
    );

  // ========================================================================
  // LEADERBOARD
  // ========================================================================

  const leaderboard =
    useMemo(() => {
      /*
       * Calculate the fixed historical peaks.
       */

      const yesterdayBest =
        getYesterdayBest(
          gameState.sessions,
          now
        );

      const sevenDayBest =
        getSevenDayBest(
          gameState.sessions,
          now
        );

      const thirtyDayBest =
        getThirtyDayBest(
          gameState.sessions,
          now
        );

      const personalBest =
        getPersonalBest(
          gameState.sessions
        );

      const monthAverage =
        getMonthAverage(
          gameState.sessions,
          now
        );

      /*
       * IMPORTANT:
       *
       * These are the PEAKS.
       *
       * They are NOT randomized.
       *
       * Randomness is applied later only to
       * the current displayed score.
       */

      const benchmarks: Omit<
        LeaderboardEntry,
        "kills"
      >[] = [
        {
          id: "you",
          name: "YOU",
          peak: todaySum,
          isYou: true,
          description:
            "Your actual score today",
        },

        {
          id: "yesterday",
          name: "YESTERDAY BEST",
          peak: yesterdayBest,
          isYou: false,
          description:
            "Best daily score yesterday",
        },

        {
          id: "7day",
          name: "7-DAY BEST",
          peak: sevenDayBest,
          isYou: false,
          description:
            "Best daily score in the last 7 days",
        },

        {
          id: "30day",
          name: "30-DAY BEST",
          peak: thirtyDayBest,
          isYou: false,
          description:
            "Best daily score in the last 30 days",
        },

        {
          id: "personal",
          name: "PERSONAL BEST",
          peak: personalBest,
          isYou: false,
          description:
            "Your all-time best day",
        },

        {
          id: "monthly-average",
          name: "MONTH AVERAGE",
          peak: monthAverage,
          isYou: false,
          description:
            "Average daily score this month",
        },

        {
          id: "ideal",
          name: "IDEAL",
          peak: IDEAL_KILLS,
          isYou: false,
          description:
            "4 × 90m + 24 × 15m = 12 hours",
        },
      ];

      /*
       * YOU is always real.
       *
       * The six benchmark entries get their current
       * display value from the randomized 06:00–22:00
       * progression.
       */
      const entries: LeaderboardEntry[] =
        benchmarks.map(
          (entry) => ({
            ...entry,

            kills:
              entry.isYou
                ? todaySum
                : getDisplayedBenchmarkScore(
                    entry.peak,
                    entry.id,
                    now
                  ),
          })
        );

      /*
       * Rank from highest → lowest.
       *
       * Therefore if YOU gets the highest actual
       * score today, YOU immediately becomes rank #1.
       */
      return entries.sort(
        (a, b) => {
          if (
            b.kills !==
            a.kills
          ) {
            return (
              b.kills -
              a.kills
            );
          }

          /*
           * Tie-breaking:
           *
           * YOU wins a tie because it represents
           * actual current performance.
           */
          if (
            a.isYou !==
            b.isYou
          ) {
            return a.isYou
              ? -1
              : 1;
          }

          /*
           * Stable secondary sort:
           * larger fixed peak wins.
           */
          return (
            b.peak -
            a.peak
          );
        }
      );
    }, [
      gameState.sessions,
      todaySum,
      heartbeat,
      now,
    ]);

  // ========================================================================
  // REWARDS SORTING
  // ========================================================================

  const sortedRewards =
    useMemo(
      () =>
        [...rewards].sort(
          (a, b) =>
            rewardValue(
              b.code
            ) -
            rewardValue(
              a.code
            )
        ),
      [rewards]
    );

  // ========================================================================
  // LOADING
  // ========================================================================

  if (!ready) {
    return (
      <div
        className="app-shell"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent:
            "center",
          background:
            COLORS.void,
        }}
      >
        <Crosshair
          size={26}
          color={
            COLORS.chrome
          }
        />
      </div>
    );
  }

  // ========================================================================
  // RENDER
  // ========================================================================

  return (
    <div
      style={{
        background:
          "radial-gradient(ellipse at center, #10130f 0%, #0b0d0c 72%)",
        color:
          COLORS.text,
        maxWidth: 480,
        margin: "0 auto",
        position:
          "relative",
        overflowX:
          "hidden",
      }}
    >
      {/* HUD CORNER BRACKETS */}

      {[
        {
          top: 10,
          left: 10,
          borderTop: true,
          borderLeft: true,
        },
        {
          top: 10,
          right: 10,
          borderTop: true,
          borderRight: true,
        },
        {
          bottom: 10,
          left: 10,
          borderBottom: true,
          borderLeft: true,
        },
        {
          bottom: 10,
          right: 10,
          borderBottom: true,
          borderRight: true,
        },
      ].map(
        (corner, i) => (
          <div
            key={i}
            style={{
              position:
                "fixed",
              top:
                corner.top,
              bottom:
                corner.bottom,
              left:
                corner.left,
              right:
                corner.right,
              width: 16,
              height: 16,

              borderTop:
                corner.borderTop
                  ? `1.5px solid ${COLORS.chrome}45`
                  : undefined,

              borderBottom:
                corner.borderBottom
                  ? `1.5px solid ${COLORS.chrome}45`
                  : undefined,

              borderLeft:
                corner.borderLeft
                  ? `1.5px solid ${COLORS.chrome}45`
                  : undefined,

              borderRight:
                corner.borderRight
                  ? `1.5px solid ${COLORS.chrome}45`
                  : undefined,

              pointerEvents:
                "none",

              zIndex: 50,
            }}
          />
        )
      )}

      <AnimatePresence mode="wait">

        {/* ================================================================ */}
        {/* HOME                                                            */}
        {/* ================================================================ */}

        {screen ===
          "home" && (
          <motion.div
            key="home"
            initial={{
              opacity: 0,
            }}
            animate={{
              opacity: 1,
            }}
            exit={{
              opacity: 0,
            }}
            className="app-shell"
            style={{
              padding:
                "30px 20px calc(28px + env(safe-area-inset-bottom))",
            }}
          >
            {/* HEADER */}

            <div
              style={{
                textAlign:
                  "center",
                marginBottom: 24,
              }}
            >
              <div
                style={{
                  display:
                    "flex",
                  alignItems:
                    "center",
                  justifyContent:
                    "center",
                  gap: 8,
                }}
              >
                <Crosshair
                  size={18}
                  color={
                    COLORS.chrome
                  }
                  strokeWidth={
                    1.75
                  }
                />

                <span
                  style={{
                    fontFamily:
                      FONT_MONO,
                    fontSize: 12,
                    letterSpacing:
                      3.5,
                    color:
                      COLORS.textMuted,
                    textTransform:
                      "uppercase",
                  }}
                >
                  Range Log
                </span>
              </div>

              <div
                style={{
                  fontFamily:
                    FONT_MONO,
                  fontSize:
                    "clamp(36px, 10vw, 44px)",
                  fontWeight: 700,
                  marginTop: 10,
                }}
              >
                {todaySum}
              </div>

              <div
                style={{
                  fontFamily:
                    FONT_MONO,
                  fontSize: 11,
                  color:
                    COLORS.textMuted,
                  textTransform:
                    "uppercase",
                  letterSpacing:
                    1.2,
                }}
              >
                kills today
              </div>
            </div>

            {/* TAB BAR */}

            <div
              style={{
                display:
                  "flex",
                gap: 4,
                marginBottom: 22,
                padding: 4,
                background:
                  COLORS.panel,
                borderRadius: 4,
                border:
                  `1px solid ${COLORS.panelLine}`,
              }}
            >
              {TABS.map(
                (tab) => {
                  const isActive =
                    subScreen ===
                    tab.id;

                  return (
                    <button
                      key={
                        tab.id
                      }
                      onClick={() =>
                        setSubScreen(
                          tab.id
                        )
                      }
                      style={{
                        flex: 1,
                        display:
                          "flex",
                        alignItems:
                          "center",
                        justifyContent:
                          "center",
                        gap: 6,
                        padding:
                          "9px 6px",
                        borderRadius:
                          3,
                        border:
                          "none",
                        background:
                          isActive
                            ? COLORS.chrome
                            : "transparent",
                        color:
                          isActive
                            ? COLORS.void
                            : COLORS.textMuted,
                        fontFamily:
                          FONT_DISPLAY,
                        fontWeight:
                          600,
                        fontSize: 13,
                        letterSpacing:
                          0.3,
                        cursor:
                          "pointer",
                      }}
                    >
                      <tab.Icon
                        size={14}
                      />

                      {
                        tab.label
                      }
                    </button>
                  );
                }
              )}
            </div>

            <AnimatePresence mode="wait">

              {/* ========================================================== */}
              {/* BASE                                                        */}
              {/* ========================================================== */}

              {subScreen ===
                "base" && (
                <motion.div
                  key="base"
                  initial={{
                    opacity: 0,
                  }}
                  animate={{
                    opacity: 1,
                  }}
                  exit={{
                    opacity: 0,
                  }}
                >
                  <div
                    style={{
                      display:
                        "flex",
                      flexDirection:
                        "column",
                      gap: 12,
                    }}
                  >
                    {CATEGORY_ORDER.map(
                      (
                        category
                      ) => (
                        <CategoryCard
                          key={
                            category
                          }
                          category={
                            category
                          }
                          total={
                            todayTotals[
                              category
                            ]
                          }
                          onSelect={
                            startSession
                          }
                        />
                      )
                    )}
                  </div>

                  {todaySessions.length >
                    0 && (
                    <div
                      style={{
                        marginTop: 34,
                      }}
                    >
                      <div
                        style={{
                          fontFamily:
                            FONT_MONO,
                          fontSize:
                            10.5,
                          color:
                            COLORS.textMuted,
                          textTransform:
                            "uppercase",
                          letterSpacing:
                            1.5,
                          marginBottom: 10,
                        }}
                      >
                        Today&apos;s
                        sessions
                      </div>

                      <div
                        style={{
                          display:
                            "flex",
                          flexDirection:
                            "column",
                          gap: 7,
                        }}
                      >
                        {todaySessions
                          .slice(
                            0,
                            6
                          )
                          .map(
                            (
                              session
                            ) => {
                              const meta =
                                CATEGORY_META[
                                  session
                                    .category
                                ];

                              return (
                                <div
                                  key={
                                    session.id
                                  }
                                  style={{
                                    display:
                                      "flex",
                                    justifyContent:
                                      "space-between",
                                    alignItems:
                                      "center",
                                    padding:
                                      "10px 14px",
                                    borderRadius:
                                      4,
                                    borderLeft:
                                      `2px solid ${meta.color}`,
                                    background:
                                      COLORS.panel,
                                    fontFamily:
                                      FONT_MONO,
                                    fontSize:
                                      12.5,
                                  }}
                                >
                                  <span
                                    style={{
                                      color:
                                        meta.color,
                                      fontWeight:
                                        600,
                                    }}
                                  >
                                    {
                                      meta.label
                                    }
                                  </span>

                                  <span
                                    style={{
                                      color:
                                        COLORS.textMuted,
                                    }}
                                  >
                                    {Math.round(
                                      session.durationMs /
                                        60000
                                    )}
                                    m
                                  </span>

                                  <span
                                    style={{
                                      fontWeight:
                                        700,
                                    }}
                                  >
                                    {
                                      session.kills
                                    }{" "}
                                    kills
                                  </span>
                                </div>
                              );
                            }
                          )}
                      </div>
                    </div>
                  )}
                </motion.div>
              )}

              {/* ========================================================== */}
              {/* LEADERBOARD                                                */}
              {/* ========================================================== */}

              {subScreen ===
                "leaderboard" && (
                <motion.div
                  key="leaderboard"
                  initial={{
                    opacity: 0,
                  }}
                  animate={{
                    opacity: 1,
                  }}
                  exit={{
                    opacity: 0,
                  }}
                >
                  <div
                    style={{
                      marginBottom: 16,
                    }}
                  >
                    <div
                      style={{
                        fontFamily:
                          FONT_MONO,
                        fontSize:
                          10.5,
                        color:
                          COLORS.textMuted,
                        textTransform:
                          "uppercase",
                        letterSpacing:
                          1.5,
                      }}
                    >
                      Today&apos;s
                      standings
                    </div>

                    <div
                      style={{
                        fontFamily:
                          FONT_DISPLAY,
                        fontSize:
                          13.5,
                        color:
                          COLORS.textMuted,
                        marginTop: 4,
                        lineHeight:
                          1.4,
                      }}
                    >
                      Seven benchmarks.
                      Fixed peaks.
                      Randomized
                      progression
                      from 06:00 to
                      22:00.
                    </div>
                  </div>

                  {/* IDEAL SUMMARY */}

                  <div
                    style={{
                      marginBottom: 14,
                      padding:
                        "10px 12px",
                      borderRadius: 4,
                      background:
                        `${COLORS.chrome}0c`,
                      border:
                        `1px solid ${COLORS.chrome}22`,
                      fontFamily:
                        FONT_MONO,
                      fontSize: 10.5,
                      color:
                        COLORS.textMuted,
                    }}
                  >
                    IDEAL:{" "}
                    {IDEAL_BLOCKS_90}
                    × 90m +{" "}
                    {IDEAL_BLOCKS_15}
                    × 15m ={" "}
                    {IDEAL_MINUTES /
                      60}
                    h
                  </div>

                  {/* RANKINGS */}

                  <div
                    style={{
                      display:
                        "flex",
                      flexDirection:
                        "column",
                      gap: 6,
                    }}
                  >
                    {leaderboard.map(
                      (
                        entry,
                        index
                      ) => {
                        const rank =
                          index +
                          1;

                        return (
                          <motion.div
                            key={
                              entry.id
                            }
                            layout
                            style={{
                              display:
                                "flex",
                              alignItems:
                                "center",
                              gap: 10,
                              padding:
                                "11px 12px",
                              borderRadius:
                                4,
                              background:
                                entry.isYou
                                  ? `${COLORS.chrome}14`
                                  : COLORS.panel,
                              border:
                                entry.isYou
                                  ? `1px solid ${COLORS.chrome}66`
                                  : `1px solid transparent`,
                            }}
                          >
                            {/* RANK */}

                            <div
                              style={{
                                width: 22,
                                flexShrink:
                                  0,
                                display:
                                  "flex",
                                alignItems:
                                  "center",
                                justifyContent:
                                  "center",
                                fontFamily:
                                  FONT_MONO,
                                fontSize:
                                  13,
                                fontWeight:
                                  700,
                                color:
                                  rankColor(
                                    rank
                                  ),
                              }}
                            >
                              {rank ===
                              1 ? (
                                <Trophy
                                  size={
                                    15
                                  }
                                  color={rankColor(
                                    rank
                                  )}
                                />
                              ) : (
                                rank
                              )}
                            </div>

                            {/* NAME */}

                            <div
                              style={{
                                flex: 1,
                                minWidth: 0,
                              }}
                            >
                              <div
                                style={{
                                  fontFamily:
                                    FONT_DISPLAY,
                                  fontWeight:
                                    entry.isYou
                                      ? 700
                                      : 600,
                                  fontSize:
                                    13.5,
                                  color:
                                    entry.isYou
                                      ? COLORS.chrome
                                      : COLORS.text,
                                  letterSpacing:
                                    0.2,
                                  whiteSpace:
                                    "nowrap",
                                  overflow:
                                    "hidden",
                                  textOverflow:
                                    "ellipsis",
                                }}
                              >
                                {
                                  entry.name
                                }
                              </div>

                              <div
                                style={{
                                  fontFamily:
                                    FONT_MONO,
                                  fontSize:
                                    8.5,
                                  color:
                                    COLORS.textMuted,
                                  marginTop: 2,
                                  whiteSpace:
                                    "nowrap",
                                  overflow:
                                    "hidden",
                                  textOverflow:
                                    "ellipsis",
                                }}
                              >
                                {
                                  entry.description
                                }
                              </div>
                            </div>

                            {/* SCORE */}

                            <div
                              style={{
                                textAlign:
                                  "right",
                                flexShrink:
                                  0,
                              }}
                            >
                              <div
                                style={{
                                  fontFamily:
                                    FONT_MONO,
                                  fontSize:
                                    15,
                                  fontWeight:
                                    700,
                                  color:
                                    entry.isYou
                                      ? COLORS.chrome
                                      : COLORS.textMuted,
                                }}
                              >
                                {
                                  entry.kills
                                }
                              </div>

                              {!entry.isYou && (
                                <div
                                  style={{
                                    fontFamily:
                                      FONT_MONO,
                                    fontSize:
                                      8,
                                    color:
                                      COLORS.textMuted,
                                    opacity:
                                      0.65,
                                  }}
                                >
                                  /{" "}
                                  {
                                    entry.peak
                                  }
                                </div>
                              )}
                            </div>
                          </motion.div>
                        );
                      }
                    )}
                  </div>
                </motion.div>
              )}

              {/* ========================================================== */}
              {/* REWARDS                                                     */}
              {/* ========================================================== */}

              {subScreen ===
                "rewards" && (
                <motion.div
                  key="rewards"
                  initial={{
                    opacity: 0,
                  }}
                  animate={{
                    opacity: 1,
                  }}
                  exit={{
                    opacity: 0,
                  }}
                >
                  <div
                    style={{
                      marginBottom: 16,
                    }}
                  >
                    <div
                      style={{
                        fontFamily:
                          FONT_MONO,
                        fontSize:
                          10.5,
                        color:
                          COLORS.textMuted,
                        textTransform:
                          "uppercase",
                        letterSpacing:
                          1.5,
                      }}
                    >
                      Collected codes
                      {" | "}
                      {
                        sortedRewards.length
                      }{" "}
                      | 238 328
                    </div>

                    <div
                      style={{
                        fontFamily:
                          FONT_DISPLAY,
                        fontSize:
                          13.5,
                        color:
                          COLORS.textMuted,
                        marginTop: 4,
                        lineHeight:
                          1.4,
                      }}
                    >
                      Sorted highest
                      value first —
                      uppercase
                      outranks
                      lowercase
                      outranks
                      digits, so ZZZ
                      is as good as
                      it gets.
                    </div>
                  </div>

                  {sortedRewards.length ===
                  0 ? (
                    <div
                      style={{
                        padding:
                          "28px 18px",
                        textAlign:
                          "center",
                        borderRadius:
                          4,
                        border:
                          `1px dashed ${COLORS.panelLine}`,
                        color:
                          COLORS.textMuted,
                        fontFamily:
                          FONT_DISPLAY,
                        fontSize:
                          14,
                      }}
                    >
                      No rewards logged
                      yet. Every
                      minute in the
                      field earns
                      one.
                    </div>
                  ) : (
                    <div
                      style={{
                        display:
                          "flex",
                        flexDirection:
                          "column",
                        gap: 7,
                      }}
                    >
                      <AnimatePresence
                        initial={
                          false
                        }
                      >
                        {sortedRewards.map(
                          (
                            reward
                          ) => {
                            const tier =
                              rewardTier(
                                reward.code
                              );

                            const catColor =
                              CATEGORY_META[
                                reward
                                  .category
                              ].color;

                            return (
                              <motion.div
                                key={
                                  reward.id
                                }
                                layout
                                initial={{
                                  opacity: 0,
                                  y: -6,
                                }}
                                animate={{
                                  opacity: 1,
                                  y: 0,
                                }}
                                exit={{
                                  opacity: 0,
                                  height: 0,
                                  marginBottom: 0,
                                  paddingTop: 0,
                                  paddingBottom: 0,
                                }}
                                style={{
                                  display:
                                    "flex",
                                  alignItems:
                                    "center",
                                  gap: 12,
                                  padding:
                                    "10px 12px",
                                  borderRadius:
                                    4,
                                  background:
                                    COLORS.panel,
                                  borderLeft:
                                    `3px solid ${TIER_COLOR[tier]}`,
                                  overflow:
                                    "hidden",
                                }}
                              >
                                <div
                                  style={{
                                    width: 7,
                                    height: 7,
                                    borderRadius:
                                      "50%",
                                    background:
                                      catColor,
                                    flexShrink:
                                      0,
                                  }}
                                  aria-hidden
                                />

                                <div
                                  style={{
                                    flex: 1,
                                    minWidth: 0,
                                  }}
                                >
                                  <div
                                    style={{
                                      fontFamily:
                                        FONT_MONO,
                                      fontSize:
                                        19,
                                      fontWeight:
                                        700,
                                      color:
                                        TIER_COLOR[
                                          tier
                                        ],
                                      letterSpacing:
                                        1,
                                    }}
                                  >
                                    {
                                      reward.code
                                    }
                                  </div>

                                  <div
                                    style={{
                                      fontFamily:
                                        FONT_MONO,
                                      fontSize:
                                        10,
                                      color:
                                        COLORS.textMuted,
                                      textTransform:
                                        "uppercase",
                                      letterSpacing:
                                        0.8,
                                    }}
                                  >
                                    {
                                      tier
                                    }{" "}
                                    ·{" "}
                                    {new Date(
                                      reward.earnedAt
                                    ).toLocaleTimeString(
                                      [],
                                      {
                                        hour: "2-digit",
                                        minute: "2-digit",
                                      }
                                    )}
                                  </div>
                                </div>

                                <button
                                  onClick={() =>
                                    deleteReward(
                                      reward.id
                                    )
                                  }
                                  aria-label="Delete reward"
                                  style={{
                                    flexShrink:
                                      0,
                                    width: 32,
                                    height: 32,
                                    display:
                                      "flex",
                                    alignItems:
                                      "center",
                                    justifyContent:
                                      "center",
                                    borderRadius:
                                      4,
                                    border:
                                      `1px solid ${COLORS.panelLine}`,
                                    background:
                                      "transparent",
                                    color:
                                      COLORS.textMuted,
                                    cursor:
                                      "pointer",
                                  }}
                                >
                                  <Trash2
                                    size={
                                      14
                                    }
                                  />
                                </button>
                              </motion.div>
                            );
                          }
                        )}
                      </AnimatePresence>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* RESET */}

            <button
              onClick={
                handleReset
              }
              style={{
                display:
                  "flex",
                alignItems:
                  "center",
                gap: 6,
                margin:
                  "30px auto 0",
                padding:
                  "8px 4px",
                background:
                  "transparent",
                border:
                  "none",
                color:
                  COLORS.textMuted,
                fontFamily:
                  FONT_MONO,
                fontSize:
                  10.5,
                textTransform:
                  "uppercase",
                letterSpacing:
                  1,
                cursor:
                  "pointer",
              }}
            >
              <RotateCcw
                size={12}
              />

              Reset log
            </button>
          </motion.div>
        )}

        {/* ================================================================ */}
        {/* ACTIVE                                                           */}
        {/* ================================================================ */}

        {screen ===
          "active" &&
          active && (
            <ScopeOverlay
              category={
                active.category
              }
              elapsedMs={
                elapsedMs
              }
              rate={calcRate(
                elapsedMs
              )}
              liveKills={calcKills(
                elapsedMs
              )}
              onDone={
                endSession
              }
              onAbort={
                abortSession
              }
            />
          )}

        {/* ================================================================ */}
        {/* RESULT                                                           */}
        {/* ================================================================ */}

        {screen ===
          "result" &&
          result && (
            <ResultCard
              category={
                result.category
              }
              kills={
                result.kills
              }
              rate={
                result.rate
              }
              durationMs={
                result.durationMs
              }
              onClose={
                closeResult
              }
            />
          )}
      </AnimatePresence>
    </div>
  );
}
