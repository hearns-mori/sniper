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

/* ==========================================================================
   REWARDS
   ========================================================================== */

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
      REWARD_CHARS[
        Math.floor(Math.random() * REWARD_CHARS.length)
      ];
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
    // ignore
  }
}

function loadRewardProgress(): RewardProgress | null {
  if (!isBrowser()) return null;

  try {
    const raw =
      window.localStorage.getItem(REWARD_PROGRESS_KEY);

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
      window.localStorage.removeItem(REWARD_PROGRESS_KEY);
    }
  } catch {
    // ignore
  }
}

/* ==========================================================================
   DAILY SCORE
   ========================================================================== */

function isSameLocalDay(
  ts: number,
  referenceNow: number
): boolean {
  const a = new Date(ts);
  const b = new Date(referenceNow);

  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function startOfLocalDay(now: number): number {
  const d = new Date(now);

  d.setHours(0, 0, 0, 0);

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
    if (
      isSameLocalDay(
        session.startTime,
        now
      )
    ) {
      totals[session.category] += session.kills;
    }
  }

  return totals;
}

function getDayKey(ts: number): string {
  const d = new Date(ts);

  return `${d.getFullYear()}-${String(
    d.getMonth() + 1
  ).padStart(2, "0")}-${String(d.getDate()).padStart(
    2,
    "0"
  )}`;
}

interface DailyScore {
  dayKey: string;
  timestamp: number;
  score: number;
}

function buildDailyScores(
  sessions: KillSession[]
): DailyScore[] {
  const map = new Map<string, DailyScore>();

  for (const session of sessions) {
    const dayKey = getDayKey(session.startTime);

    const existing = map.get(dayKey);

    if (existing) {
      existing.score += session.kills;
    } else {
      map.set(dayKey, {
        dayKey,
        timestamp: startOfLocalDay(
          session.startTime
        ),
        score: session.kills,
      });
    }
  }

  return [...map.values()].sort(
    (a, b) => b.timestamp - a.timestamp
  );
}

/* ==========================================================================
   IDEAL SELF
   ==========================================================================

   4 × 90 minutes
   +
   24 × 15 minutes
   =
   360 + 360
   =
   720 minutes
   =
   12 hours
   ========================================================================== */

const IDEAL_LONG_BLOCKS = 4;
const IDEAL_LONG_MINUTES = 90;

const IDEAL_SHORT_BLOCKS = 24;
const IDEAL_SHORT_MINUTES = 15;

const IDEAL_TOTAL_MINUTES =
  IDEAL_LONG_BLOCKS * IDEAL_LONG_MINUTES +
  IDEAL_SHORT_BLOCKS * IDEAL_SHORT_MINUTES;

const IDEAL_SELF_SCORE =
  IDEAL_LONG_BLOCKS *
    calcKills(IDEAL_LONG_MINUTES * 60000) +
  IDEAL_SHORT_BLOCKS *
    calcKills(IDEAL_SHORT_MINUTES * 60000);

/* ==========================================================================
   SIX LEADERBOARD BENCHMARKS
   ========================================================================== */

type BenchmarkId =
  | "personal"
  | "sevenDay"
  | "yesterday"
  | "thirtyDay"
  | "thirtyAverage"
  | "ideal";

interface Benchmark {
  id: BenchmarkId;
  name: string;
  score: number;
  color?: string;
}

/*
 * IMPORTANT:
 *
 * Today's score is NEVER used to calculate:
 *
 * - Personal Best
 * - 7-Day Best
 * - Yesterday
 * - 30-Day Best
 * - 30-Day Average
 *
 * This means you can beat every benchmark TODAY without immediately
 * rewriting your historical records.
 */

function getHistoricalBenchmarks(
  sessions: KillSession[],
  now: number
): Benchmark[] {
  const allDays = buildDailyScores(sessions);

  const todayKey = getDayKey(now);

  const completedDays = allDays.filter(
    (day) => day.dayKey !== todayKey
  );

  const personalBest =
    completedDays.length > 0
      ? Math.max(
          ...completedDays.map((d) => d.score)
        )
      : 0;

  const sevenDayStart = startOfLocalDay(
    now - 6 * 24 * 60 * 60 * 1000
  );

  const sevenDayDays = completedDays.filter(
    (day) => day.timestamp >= sevenDayStart
  );

  const sevenDayBest =
    sevenDayDays.length > 0
      ? Math.max(
          ...sevenDayDays.map((d) => d.score)
        )
      : 0;

  const yesterdayDate = new Date(now);
  yesterdayDate.setDate(
    yesterdayDate.getDate() - 1
  );

  const yesterdayKey = getDayKey(
    yesterdayDate.getTime()
  );

  const yesterday =
    completedDays.find(
      (d) => d.dayKey === yesterdayKey
    )?.score ?? 0;

  const thirtyDayStart = startOfLocalDay(
    now - 29 * 24 * 60 * 60 * 1000
  );

  const thirtyDayDays = completedDays.filter(
    (day) =>
      day.timestamp >= thirtyDayStart
  );

  const thirtyDayBest =
    thirtyDayDays.length > 0
      ? Math.max(
          ...thirtyDayDays.map(
            (d) => d.score
          )
        )
      : 0;

  const thirtyDayAverage =
    thirtyDayDays.length > 0
      ? Math.round(
          thirtyDayDays.reduce(
            (sum, d) => sum + d.score,
            0
          ) / thirtyDayDays.length
        )
      : 0;

  return [
    {
      id: "personal",
      name: "PERSONAL BEST",
      score: personalBest,
      color: COLORS.chrome,
    },
    {
      id: "sevenDay",
      name: "7-DAY BEST",
      score: sevenDayBest,
      color: "#c7d0c6",
    },
    {
      id: "yesterday",
      name: "YESTERDAY",
      score: yesterday,
      color: "#b98a52",
    },
    {
      id: "thirtyDay",
      name: "30-DAY BEST",
      score: thirtyDayBest,
      color: "#d4d4d4",
    },
    {
      id: "thirtyAverage",
      name: "30-DAY AVG",
      score: thirtyDayAverage,
      color: "#9ca89d",
    },
    {
      id: "ideal",
      name: "IDEAL SELF",
      score: IDEAL_SELF_SCORE,
      color: "#b9f2ff",
    },
  ];
}

/* ==========================================================================
   RANDOMIZED 6AM → 10PM SCORE PROGRESSION
   ========================================================================== */

const LEADERBOARD_START_HOUR = 6;
const LEADERBOARD_END_HOUR = 22;

/*
 * Deterministic pseudo-random number.
 *
 * Same benchmark + same day = same progression.
 *
 * This gives randomized-looking movement without making the leaderboard
 * jump randomly backward and forward.
 */
function hash01(str: string): number {
  let h = 2166136261;

  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }

  return (
    (h >>> 0) / 4294967295
  );
}

/*
 * Creates a smooth but randomized monotonic curve.
 *
 * The curve is built from multiple random weighted segments.
 * Therefore:
 *
 * 06:00 → near 0
 * 22:00 → 100%
 *
 * but the increase is NOT linear.
 */
function randomizedProgress(
  fraction: number,
  seed: string
): number {
  const clamped = Math.max(
    0,
    Math.min(1, fraction)
  );

  if (clamped <= 0) return 0;
  if (clamped >= 1) return 1;

  const SEGMENTS = 32;

  const weights: number[] = [];

  for (let i = 0; i < SEGMENTS; i++) {
    const random =
      hash01(`${seed}:segment:${i}`);

    /*
     * Prevent extremely tiny segments while still
     * producing strong variation.
     */
    weights.push(
      0.35 + random * 1.65
    );
  }

  const total = weights.reduce(
    (a, b) => a + b,
    0
  );

  let target = clamped * total;
  let accumulated = 0;

  for (let i = 0; i < SEGMENTS; i++) {
    const weight = weights[i];

    if (
      accumulated + weight >=
      target
    ) {
      const local =
        (target - accumulated) /
        weight;

      const segmentStart =
        i / SEGMENTS;

      const segmentEnd =
        (i + 1) / SEGMENTS;

      const raw =
        segmentStart +
        local *
          (segmentEnd -
            segmentStart);

      /*
       * Mild easing keeps it natural while
       * retaining the randomized shape.
       */
      return (
        raw * raw *
        (3 - 2 * raw)
      );
    }

    accumulated += weight;
  }

  return 1;
}

function leaderboardDayFraction(
  now: number
): number {
  const d = new Date(now);

  const start = new Date(d);
  start.setHours(
    LEADERBOARD_START_HOUR,
    0,
    0,
    0
  );

  const end = new Date(d);
  end.setHours(
    LEADERBOARD_END_HOUR,
    0,
    0,
    0
  );

  const total =
    end.getTime() -
    start.getTime();

  const elapsed =
    now - start.getTime();

  if (elapsed <= 0) return 0;
  if (elapsed >= total) return 1;

  return elapsed / total;
}

/*
 * The six benchmark scores progress toward their historical/reference
 * values from 06:00 to 22:00.
 *
 * This does NOT modify the underlying historical records.
 */
function getLiveBenchmarkScore(
  benchmark: Benchmark,
  now: number
): number {
  if (benchmark.score <= 0) {
    return 0;
  }

  const dayKey = getDayKey(now);

  const fraction =
    leaderboardDayFraction(now);

  const progress =
    randomizedProgress(
      fraction,
      `${dayKey}:${benchmark.id}`
    );

  return Math.round(
    benchmark.score * progress
  );
}

/* ==========================================================================
   LEADERBOARD TYPES
   ========================================================================== */

interface LeaderboardEntry {
  id: string;
  name: string;
  kills: number;
  isYou: boolean;
  benchmark?: BenchmarkId;
  color?: string;
}

/* ==========================================================================
   TABS
   ========================================================================== */

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

function rankColor(rank: number): string {
  if (rank === 1) return COLORS.chrome;
  if (rank === 2) return "#c7d0c6";
  if (rank === 3) return "#b98a52";

  return COLORS.textMuted;
}

/* ==========================================================================
   COMPONENT
   ========================================================================== */

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
    useState<ResultData | null>(null);

  const [rewards, setRewards] =
    useState<RewardItem[]>([]);

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

  /* ------------------------------------------------------------------------
     REWARD MINUTES
     ------------------------------------------------------------------------ */

  const grantMinuteRewards =
    useCallback(
      (
        elapsed: number,
        category: Category
      ) => {
        const progress =
          rewardProgressRef.current;

        if (!progress) return;

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
            code:
              generateRewardCode(),
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

  /* ------------------------------------------------------------------------
     LOAD
     ------------------------------------------------------------------------ */

  useEffect(() => {
    setGameState(loadState());
    setRewards(loadRewards());

    const activeSession =
      loadActiveSession();

    if (activeSession) {
      setActive(activeSession);

      const elapsed =
        Date.now() -
        activeSession.startTime;

      setElapsedMs(elapsed);
      setScreen("active");

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

  /* ------------------------------------------------------------------------
     ACTIVE TIMER
     ------------------------------------------------------------------------ */

  useEffect(() => {
    if (
      screen !== "active" ||
      !active
    ) {
      if (intervalRef.current) {
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

      setElapsedMs(elapsed);

      grantMinuteRewards(
        elapsed,
        active.category
      );
    };

    tick();

    intervalRef.current =
      setInterval(tick, 1000);

    const onVisible = () => {
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
      if (intervalRef.current) {
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

  /* ------------------------------------------------------------------------
     LEADERBOARD REFRESH
     ------------------------------------------------------------------------ */

  useEffect(() => {
    const id = setInterval(() => {
      setHeartbeat(
        (h) => h + 1
      );
    }, 30000);

    return () =>
      clearInterval(id);
  }, []);

  /* ------------------------------------------------------------------------
     START
     ------------------------------------------------------------------------ */

  const startSession =
    useCallback(
      (category: Category) => {
        const session: ActiveSession =
          {
            category,
            startTime: Date.now(),
          };

        saveActiveSession(
          session
        );

        setActive(session);
        setElapsedMs(0);

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

        setScreen("active");
      },
      []
    );

  /* ------------------------------------------------------------------------
     END
     ------------------------------------------------------------------------ */

  const endSession =
    useCallback(() => {
      if (!active) return;

      const finalElapsed =
        Date.now() -
        active.startTime;

      grantMinuteRewards(
        finalElapsed,
        active.category
      );

      const kills =
        calcKills(finalElapsed);

      const rate =
        calcRate(finalElapsed);

      const record: KillSession =
        {
          id: `${active.startTime}-${Date.now()}`,
          category:
            active.category,
          startTime:
            active.startTime,
          endTime: Date.now(),
          durationMs:
            finalElapsed,
          kills,
          rate,
        };

      setGameState((prev) => {
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

        saveState(next);

        return next;
      });

      saveActiveSession(null);

      rewardProgressRef.current =
        null;

      saveRewardProgress(null);

      setActive(null);

      setResult({
        category:
          active.category,
        kills,
        rate,
        durationMs:
          finalElapsed,
      });

      setScreen("result");
    }, [
      active,
      grantMinuteRewards,
    ]);

  /* ------------------------------------------------------------------------
     ABORT
     ------------------------------------------------------------------------ */

  const abortSession =
    useCallback(() => {
      if (active) {
        grantMinuteRewards(
          Date.now() -
            active.startTime,
          active.category
        );
      }

      saveActiveSession(null);

      rewardProgressRef.current =
        null;

      saveRewardProgress(null);

      setActive(null);

      setScreen("home");
    }, [
      active,
      grantMinuteRewards,
    ]);

  /* ------------------------------------------------------------------------
     RESULT
     ------------------------------------------------------------------------ */

  const closeResult =
    useCallback(() => {
      setResult(null);
      setScreen("home");
    }, []);

  /* ------------------------------------------------------------------------
     DELETE REWARD
     ------------------------------------------------------------------------ */

  const deleteReward =
    useCallback(
      (id: string) => {
        setRewards((prev) => {
          const next =
            prev.filter(
              (r) => r.id !== id
            );

          saveRewards(next);

          return next;
        });
      },
      []
    );

  /* ------------------------------------------------------------------------
     RESET
     ------------------------------------------------------------------------ */

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

      saveRewards([]);

      saveRewardProgress(null);

      setGameState({
        totals: {
          architect: 0,
          commander: 0,
          army: 0,
        },
        sessions: [],
      });

      setRewards([]);

      rewardProgressRef.current =
        null;

      setActive(null);

      setSubScreen("base");

      setScreen("home");
    }, []);

  /* ==========================================================================
     DERIVED DATA
     ========================================================================== */

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
      (s) =>
        isSameLocalDay(
          s.startTime,
          now
        )
    );

  /*
   * SIX BENCHMARKS
   *
   * These are calculated BEFORE today's score.
   *
   * Therefore YOU can beat them today without rewriting
   * historical records immediately.
   */
  const benchmarks =
    useMemo(
      () =>
        getHistoricalBenchmarks(
          gameState.sessions,
          now
        ),
      [gameState.sessions, now, heartbeat]
    );

  /*
   * LIVE LEADERBOARD
   *
   * Six benchmark scores progress from 06:00 → 22:00.
   * YOU uses the actual current score.
   */
  const leaderboard =
    useMemo(() => {
      const benchmarkEntries: LeaderboardEntry[] =
        benchmarks.map(
          (benchmark) => ({
            id: benchmark.id,
            name: benchmark.name,
            kills:
              getLiveBenchmarkScore(
                benchmark,
                now
              ),
            isYou: false,
            benchmark:
              benchmark.id,
            color:
              benchmark.color,
          })
        );

      const entries: LeaderboardEntry[] =
        [
          {
            id: "you",
            name: "YOU",
            kills: todaySum,
            isYou: true,
            color:
              COLORS.chrome,
          },
          ...benchmarkEntries,
        ];

      /*
       * HIGHEST → LOWEST
       *
       * YOU is NOT forced to a specific position.
       *
       * If today's score is the highest,
       * YOU becomes rank #1 immediately.
       */
      return entries.sort(
        (a, b) => {
          if (
            b.kills !== a.kills
          ) {
            return (
              b.kills - a.kills
            );
          }

          /*
           * If scores tie, YOU wins the
           * current-day tie.
           */
          if (
            a.isYou &&
            !b.isYou
          ) {
            return -1;
          }

          if (
            !a.isYou &&
            b.isYou
          ) {
            return 1;
          }

          return 0;
        }
      );
    }, [
      benchmarks,
      todaySum,
      now,
      heartbeat,
    ]);

  const sortedRewards =
    useMemo(
      () =>
        [...rewards].sort(
          (a, b) =>
            rewardValue(b.code) -
            rewardValue(a.code)
        ),
      [rewards]
    );

  /* ==========================================================================
     LOADING
     ========================================================================== */

  if (!ready) {
    return (
      <div
        className="app-shell"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background:
            COLORS.void,
        }}
      >
        <Crosshair
          size={26}
          color={COLORS.chrome}
        />
      </div>
    );
  }

  /* ==========================================================================
     UI
     ========================================================================== */

  return (
    <div
      style={{
        background:
          "radial-gradient(ellipse at center, #10130f 0%, #0b0d0c 72%)",
        color: COLORS.text,
        maxWidth: 480,
        margin: "0 auto",
        position: "relative",
        overflowX: "hidden",
      }}
    >
      {/* HUD CORNERS */}

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
      ].map((c, i) => (
        <div
          key={i}
          style={{
            position: "fixed",
            top: c.top,
            bottom: c.bottom,
            left: c.left,
            right: c.right,
            width: 16,
            height: 16,
            borderTop: c.borderTop
              ? `1.5px solid ${COLORS.chrome}45`
              : undefined,
            borderBottom:
              c.borderBottom
                ? `1.5px solid ${COLORS.chrome}45`
                : undefined,
            borderLeft:
              c.borderLeft
                ? `1.5px solid ${COLORS.chrome}45`
                : undefined,
            borderRight:
              c.borderRight
                ? `1.5px solid ${COLORS.chrome}45`
                : undefined,
            pointerEvents:
              "none",
            zIndex: 50,
          }}
        />
      ))}

      <AnimatePresence mode="wait">
        {/* =================================================================
            HOME
            ================================================================= */}

        {screen === "home" && (
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
                textAlign: "center",
                marginBottom: 24,
              }}
            >
              <div
                style={{
                  display: "flex",
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
                  strokeWidth={1.75}
                />

                <span
                  style={{
                    fontFamily:
                      FONT_MONO,
                    fontSize: 12,
                    letterSpacing: 3.5,
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
                  letterSpacing: 1.2,
                }}
              >
                kills today
              </div>
            </div>

            {/* TABS */}

            <div
              style={{
                display: "flex",
                gap: 4,
                marginBottom: 22,
                padding: 4,
                background:
                  COLORS.panel,
                borderRadius: 4,
                border: `1px solid ${COLORS.panelLine}`,
              }}
            >
              {TABS.map(
                (tab) => {
                  const isActive =
                    subScreen ===
                    tab.id;

                  return (
                    <button
                      key={tab.id}
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
                        borderRadius: 3,
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
                        fontWeight: 600,
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

                      {tab.label}
                    </button>
                  );
                }
              )}
            </div>

            <AnimatePresence mode="wait">
              {/* ===========================================================
                  BASE
                  =========================================================== */}

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
                      (cat) => (
                        <CategoryCard
                          key={cat}
                          category={
                            cat
                          }
                          total={
                            todayTotals[
                              cat
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
                          fontSize: 10.5,
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
                              s
                            ) => {
                              const meta =
                                CATEGORY_META[
                                  s.category
                                ];

                              return (
                                <div
                                  key={
                                    s.id
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
                                    borderRadius: 4,
                                    borderLeft: `2px solid ${meta.color}`,
                                    background:
                                      COLORS.panel,
                                    fontFamily:
                                      FONT_MONO,
                                    fontSize: 12.5,
                                  }}
                                >
                                  <span
                                    style={{
                                      color:
                                        meta.color,
                                      fontWeight: 600,
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
                                      s.durationMs /
                                        60000
                                    )}
                                    m
                                  </span>

                                  <span
                                    style={{
                                      fontWeight: 700,
                                    }}
                                  >
                                    {
                                      s.kills
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

              {/* ===========================================================
                  LEADERBOARD
                  =========================================================== */}

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
                  {/* TITLE */}

                  <div
                    style={{
                      marginBottom: 16,
                    }}
                  >
                    <div
                      style={{
                        fontFamily:
                          FONT_MONO,
                        fontSize: 10.5,
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
                        fontSize: 13.5,
                        color:
                          COLORS.textMuted,
                        marginTop: 4,
                        lineHeight: 1.45,
                      }}
                    >
                      Six benchmarks
                      rise from{" "}
                      <strong>
                        06:00
                      </strong>{" "}
                      to{" "}
                      <strong>
                        22:00
                      </strong>{" "}
                      using randomized
                      progression.
                      YOU uses your
                      actual score.
                    </div>

                    <div
                      style={{
                        fontFamily:
                          FONT_MONO,
                        fontSize: 10,
                        color:
                          COLORS.textMuted,
                        marginTop: 8,
                        opacity: 0.75,
                      }}
                    >
                      4 × 90m + 24 ×
                      15m ={" "}
                      {
                        IDEAL_TOTAL_MINUTES
                      }
                      m / 12h ideal
                    </div>
                  </div>

                  {/* LEADERBOARD */}

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
                        i
                      ) => {
                        const rank =
                          i + 1;

                        return (
                          <motion.div
                            layout
                            key={
                              entry.id
                            }
                            style={{
                              display:
                                "flex",
                              alignItems:
                                "center",
                              gap: 12,
                              padding:
                                "11px 14px",
                              borderRadius: 4,
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
                                flexShrink: 0,
                                display:
                                  "flex",
                                alignItems:
                                  "center",
                                justifyContent:
                                  "center",
                                fontFamily:
                                  FONT_MONO,
                                fontSize: 13,
                                fontWeight: 700,
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
                                fontFamily:
                                  FONT_DISPLAY,
                                fontWeight:
                                  entry.isYou
                                    ? 700
                                    : 600,
                                fontSize: 14,
                                color:
                                  entry.isYou
                                    ? COLORS.chrome
                                    : entry.color ??
                                      COLORS.text,
                                letterSpacing:
                                  0.3,
                              }}
                            >
                              {entry.name}

                              {entry.isYou && (
                                <div
                                  style={{
                                    fontFamily:
                                      FONT_MONO,
                                    fontSize: 8.5,
                                    color:
                                      COLORS.textMuted,
                                    marginTop: 2,
                                    textTransform:
                                      "uppercase",
                                    letterSpacing:
                                      0.8,
                                  }}
                                >
                                  current
                                </div>
                              )}
                            </div>

                            {/* SCORE */}

                            <div
                              style={{
                                fontFamily:
                                  FONT_MONO,
                                fontSize: 15,
                                fontWeight: 700,
                                color:
                                  entry.isYou
                                    ? COLORS.chrome
                                    : COLORS.textMuted,
                              }}
                            >
                              {entry.kills}
                            </div>
                          </motion.div>
                        );
                      }
                    )}
                  </div>

                  {/* HISTORICAL RULE */}

                  <div
                    style={{
                      marginTop: 18,
                      padding:
                        "11px 13px",
                      borderRadius: 4,
                      border: `1px solid ${COLORS.panelLine}`,
                      background:
                        `${COLORS.panel}88`,
                    }}
                  >
                    <div
                      style={{
                        fontFamily:
                          FONT_MONO,
                        fontSize: 9.5,
                        color:
                          COLORS.textMuted,
                        textTransform:
                          "uppercase",
                        letterSpacing:
                          1,
                        lineHeight: 1.5,
                      }}
                    >
                      Historical
                      protection
                    </div>

                    <div
                      style={{
                        fontFamily:
                          FONT_DISPLAY,
                        fontSize: 11.5,
                        color:
                          COLORS.textMuted,
                        marginTop: 3,
                        lineHeight: 1.45,
                      }}
                    >
                      Today&apos;s score
                      can take rank #1
                      immediately, but
                      it does not overwrite
                      Personal Best,
                      7-Day Best, or
                      30-Day Best until
                      today becomes a
                      completed historical
                      day.
                    </div>
                  </div>
                </motion.div>
              )}

              {/* ===========================================================
                  REWARDS
                  =========================================================== */}

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
                        fontSize: 10.5,
                        color:
                          COLORS.textMuted,
                        textTransform:
                          "uppercase",
                        letterSpacing:
                          1.5,
                      }}
                    >
                      Collected codes |{" "}
                      {
                        sortedRewards.length
                      }{" "}
                      | 238 328
                    </div>

                    <div
                      style={{
                        fontFamily:
                          FONT_DISPLAY,
                        fontSize: 13.5,
                        color:
                          COLORS.textMuted,
                        marginTop: 4,
                        lineHeight: 1.4,
                      }}
                    >
                      Sorted highest
                      value first —
                      uppercase outranks
                      lowercase outranks
                      digits, so ZZZ is as
                      good as it gets.
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
                        borderRadius: 4,
                        border: `1px dashed ${COLORS.panelLine}`,
                        color:
                          COLORS.textMuted,
                        fontFamily:
                          FONT_DISPLAY,
                        fontSize: 14,
                      }}
                    >
                      No rewards logged
                      yet. Every minute
                      in the field earns
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
                        initial={false}
                      >
                        {sortedRewards.map(
                          (r) => {
                            const tier =
                              rewardTier(
                                r.code
                              );

                            const catColor =
                              CATEGORY_META[
                                r.category
                              ].color;

                            return (
                              <motion.div
                                key={
                                  r.id
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
                                  borderRadius: 4,
                                  background:
                                    COLORS.panel,
                                  borderLeft: `3px solid ${TIER_COLOR[tier]}`,
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
                                    flexShrink: 0,
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
                                      fontSize: 19,
                                      fontWeight: 700,
                                      color:
                                        TIER_COLOR[
                                          tier
                                        ],
                                      letterSpacing:
                                        1,
                                    }}
                                  >
                                    {
                                      r.code
                                    }
                                  </div>

                                  <div
                                    style={{
                                      fontFamily:
                                        FONT_MONO,
                                      fontSize: 10,
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
                                      r.earnedAt
                                    ).toLocaleTimeString(
                                      [],
                                      {
                                        hour: "2-digit",
                                        minute:
                                          "2-digit",
                                      }
                                    )}
                                  </div>
                                </div>

                                <button
                                  onClick={() =>
                                    deleteReward(
                                      r.id
                                    )
                                  }
                                  aria-label="Delete reward"
                                  style={{
                                    flexShrink: 0,
                                    width: 32,
                                    height: 32,
                                    display:
                                      "flex",
                                    alignItems:
                                      "center",
                                    justifyContent:
                                      "center",
                                    borderRadius: 4,
                                    border: `1px solid ${COLORS.panelLine}`,
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
                display: "flex",
                alignItems:
                  "center",
                gap: 6,
                margin:
                  "30px auto 0",
                padding:
                  "8px 4px",
                background:
                  "transparent",
                border: "none",
                color:
                  COLORS.textMuted,
                fontFamily:
                  FONT_MONO,
                fontSize: 10.5,
                textTransform:
                  "uppercase",
                letterSpacing: 1,
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

        {/* =================================================================
            ACTIVE
            ================================================================= */}

        {screen === "active" &&
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

        {/* =================================================================
            RESULT
            ================================================================= */}

        {screen === "result" &&
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
