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

// ═══════════════════════════════════════════════════════════════════════════
// REWARDS
// ═══════════════════════════════════════════════════════════════════════════

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
    // Ignore storage errors.
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
      window.localStorage.removeItem(
        REWARD_PROGRESS_KEY
      );
    }
  } catch {
    // Ignore storage errors.
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DAILY TOTALS
// ═══════════════════════════════════════════════════════════════════════════

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
      totals[session.category] +=
        session.kills;
    }
  }

  return totals;
}

// ═══════════════════════════════════════════════════════════════════════════
// LEADERBOARD
// ═══════════════════════════════════════════════════════════════════════════
//
// YOUR IDEAL DAILY WORKLOAD:
//
// 4 × 90-minute deep-work blocks = 360 minutes
// 24 × 15-minute blocks         = 360 minutes
// Total                         = 720 minutes = 12 hours
//
// The leaderboard benchmarks below represent six fixed performance
// ceilings. Their scores grow from 06:00 → 22:00.
//
// IMPORTANT:
//
// Randomness controls the SHAPE of the score curve.
//
// Randomness DOES NOT modify the peak.
//
// Example:
//
//     peak = 91
//
// Possible progression:
//
//     0 → 2 → 2 → 7 → 13 → 11 → 19 → 27 → 25 →
//     35 → 43 → 41 → 52 → 60 → 59 → 69 → 78 → 84 → 91
//
// But NEVER:
//
//     91 → 97
//
// And at 22:00:
//
//     EXACTLY 91
//
// ═══════════════════════════════════════════════════════════════════════════

interface Bot {
  id: string;
  name: string;

  /**
   * Fixed maximum daily score.
   *
   * This number NEVER gets randomized.
   */
  peak: number;

  /**
   * Controls how irregular the increments are.
   *
   * Higher = more bursty.
   * Lower = more stable.
   *
   * It does NOT affect the final peak.
   */
  randomness: number;
}

const BOTS: Bot[] = [
  {
    id: "einstein",
    name: "EINSTEIN",
    peak: 91,
    randomness: 1.0,
  },
  {
    id: "musk",
    name: "MUSK",
    peak: 88,
    randomness: 1.15,
  },
  {
    id: "curie",
    name: "CURIE",
    peak: 84,
    randomness: 0.95,
  },
  {
    id: "davinci",
    name: "DA VINCI",
    peak: 79,
    randomness: 1.2,
  },
  {
    id: "tesla",
    name: "TESLA",
    peak: 74,
    randomness: 1.3,
  },
  {
    id: "darwin",
    name: "DARWIN",
    peak: 68,
    randomness: 0.9,
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// DETERMINISTIC RANDOMNESS
// ═══════════════════════════════════════════════════════════════════════════
//
// Same seed → same random number.
//
// This is important because refreshing the browser must NOT reroll today's
// leaderboard.
//
// The seed contains:
//
//     date
//     bot
//     increment number
//
// Therefore every bot has a unique but stable daily progression.
//

function hash01(str: string): number {
  let h = 2166136261;

  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }

  return (h >>> 0) / 4294967295;
}

// ═══════════════════════════════════════════════════════════════════════════
// LEADERBOARD TIME WINDOW
// ═══════════════════════════════════════════════════════════════════════════

function startOfLocalDay(now: number): number {
  const d = new Date(now);

  d.setHours(
    0,
    0,
    0,
    0
  );

  return d.getTime();
}

function getLeaderboardWindow(
  now: number
) {
  const dayStart =
    startOfLocalDay(now);

  const start = new Date(dayStart);

  start.setHours(
    6,
    0,
    0,
    0
  );

  const end = new Date(dayStart);

  end.setHours(
    22,
    0,
    0,
    0
  );

  return {
    start: start.getTime(),
    end: end.getTime(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// BOT SCORE GENERATOR
// ═══════════════════════════════════════════════════════════════════════════

function botKillsNow(
  bot: Bot,
  now: number
): number {
  const {
    start,
    end,
  } = getLeaderboardWindow(now);

  // Before 06:00 → zero.
  if (now <= start) {
    return 0;
  }

  // At / after 22:00 → EXACT fixed peak.
  if (now >= end) {
    return bot.peak;
  }

  const totalWindow =
    end - start;

  /**
   * 96 checkpoints across 16 hours.
   *
   * 16 hours × 6 checkpoints/hour
   * = one checkpoint approximately every 10 minutes.
   */
  const STEPS = 96;

  const elapsed =
    now - start;

  const progress =
    elapsed / totalWindow;

  const exactStep =
    progress * STEPS;

  const currentStep =
    Math.floor(exactStep);

  // Before first checkpoint.
  if (currentStep <= 0) {
    return 0;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // RANDOM INCREMENTS
  // ═══════════════════════════════════════════════════════════════════════
  //
  // We first generate random WEIGHTS.
  //
  // These are NOT scores.
  //
  // Example:
  //
  //     0.4
  //     1.7
  //     0.6
  //     2.1
  //     ...
  //
  // Then we normalize them so their total = 1.
  //
  // Therefore the final cumulative score is always exactly bot.peak.
  //

  const dayKey =
    new Date(now).toDateString();

  const weights: number[] = [];

  for (
    let i = 0;
    i < STEPS;
    i++
  ) {
    const random =
      hash01(
        `${dayKey}:${bot.id}:increment:${i}`
      );

    // Convert 0..1 into -0.5..+0.5.
    const centered =
      random - 0.5;

    // Randomized increment weight.
    const weight =
      1 +
      centered *
        2 *
        bot.randomness;

    weights.push(
      Math.max(
        0.05,
        weight
      )
    );
  }

  // Total of all random weights.
  const totalWeight =
    weights.reduce(
      (sum, value) =>
        sum + value,
      0
    );

  // Normalize:
  //
  // sum(normalized) = 1
  //
  const normalized =
    weights.map(
      (weight) =>
        weight /
        totalWeight
    );

  // ═══════════════════════════════════════════════════════════════════════
  // BUILD SCORE FROM RANDOM INCREMENTS
  // ═══════════════════════════════════════════════════════════════════════

  let score = 0;

  for (
    let i = 0;
    i < currentStep;
    i++
  ) {
    score +=
      normalized[i] *
      bot.peak;
  }

  // Partial progress through the current interval.
  const stepProgress =
    exactStep -
    currentStep;

  if (
    currentStep <
    STEPS
  ) {
    score +=
      normalized[currentStep] *
      bot.peak *
      stepProgress;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // RANDOM PAUSES
  // ═══════════════════════════════════════════════════════════════════════
  //
  // This makes the curve feel less mechanically smooth.
  //
  // It is deliberately small.
  //
  // The final 22:00 condition above ALWAYS returns the exact peak.
  //

  const pauseRoll =
    hash01(
      `${dayKey}:${bot.id}:pause:${currentStep}`
    );

  if (pauseRoll < 0.18) {
    score *= 0.96;
  }

  // HARD CAP.
  //
  // This guarantees the randomized system can never exceed the fixed peak.
  score =
    Math.min(
      bot.peak,
      score
    );

  return Math.max(
    0,
    Math.round(score)
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// RANK COLORS
// ═══════════════════════════════════════════════════════════════════════════

function rankColor(
  rank: number
): string {
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

// ═══════════════════════════════════════════════════════════════════════════
// TABS
// ═══════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

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

  // ═══════════════════════════════════════════════════════════════════════
  // REWARD PAYOUT
  // ═══════════════════════════════════════════════════════════════════════

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
          let minute =
            progress.lastMinute + 1;
          minute <=
          currentMinute;
          minute++
        ) {
          minted.push({
            id: `${progress.startTime}-${minute}`,
            code:
              generateRewardCode(),
            category,
            earnedAt:
              progress.startTime +
              minute * 60000,
          });
        }

        setRewards(
          (previous) => {
            const next = [
              ...minted,
              ...previous,
            ];

            saveRewards(next);

            return next;
          }
        );

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

  // ═══════════════════════════════════════════════════════════════════════
  // LOAD STATE
  // ═══════════════════════════════════════════════════════════════════════

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

  // ═══════════════════════════════════════════════════════════════════════
  // ACTIVE TIMER
  // ═══════════════════════════════════════════════════════════════════════

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

  // ═══════════════════════════════════════════════════════════════════════
  // LEADERBOARD HEARTBEAT
  // ═══════════════════════════════════════════════════════════════════════
  //
  // Recalculates bot scores every 30 seconds.
  //
  // This also makes the 06:00 / 22:00 boundary update automatically.
  //

  useEffect(() => {
    const id =
      setInterval(
        () =>
          setHeartbeat(
            (value) =>
              value + 1
          ),
        30000
      );

    return () =>
      clearInterval(id);
  }, []);

  // ═══════════════════════════════════════════════════════════════════════
  // START SESSION
  // ═══════════════════════════════════════════════════════════════════════

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

  // ═══════════════════════════════════════════════════════════════════════
  // END SESSION
  // ═══════════════════════════════════════════════════════════════════════

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
        (previous) => {
          const next: GameState =
            {
              totals: {
                ...previous.totals,
                [active.category]:
                  previous.totals[
                    active.category
                  ] + kills,
              },

              sessions: [
                record,
                ...previous.sessions,
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

  // ═══════════════════════════════════════════════════════════════════════
  // ABORT SESSION
  // ═══════════════════════════════════════════════════════════════════════

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

  // ═══════════════════════════════════════════════════════════════════════
  // CLOSE RESULT
  // ═══════════════════════════════════════════════════════════════════════

  const closeResult =
    useCallback(() => {
      setResult(
        null
      );

      setScreen(
        "home"
      );
    }, []);

  // ═══════════════════════════════════════════════════════════════════════
  // DELETE REWARD
  // ═══════════════════════════════════════════════════════════════════════

  const deleteReward =
    useCallback(
      (id: string) => {
        setRewards(
          (previous) => {
            const next =
              previous.filter(
                (reward) =>
                  reward.id !== id
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

  // ═══════════════════════════════════════════════════════════════════════
  // RESET
  // ═══════════════════════════════════════════════════════════════════════

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

  // ═══════════════════════════════════════════════════════════════════════
  // TODAY'S DATA
  // ═══════════════════════════════════════════════════════════════════════

  const now =
    Date.now();

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

  // ═══════════════════════════════════════════════════════════════════════
  // LEADERBOARD
  // ═══════════════════════════════════════════════════════════════════════
  //
  // YOU is always calculated from the real session history.
  //
  // No "best record" logic is performed here.
  //
  // Therefore:
  //
  //     YOU = today's actual score
  //
  // If YOU > every benchmark:
  //
  //     YOU becomes rank #1 immediately.
  //
  // Historical records are completely independent.
  //

  const leaderboard =
    useMemo(() => {
      const entries = [
        {
          id: "you",
          name: "YOU",
          kills: todaySum,
          isYou: true,
        },

        ...BOTS.map(
          (bot) => ({
            id: bot.id,
            name: bot.name,
            kills:
              botKillsNow(
                bot,
                now
              ),
            isYou: false,
          })
        ),
      ];

      return entries.sort(
        (a, b) => {
          // Highest score first.
          if (
            b.kills !==
            a.kills
          ) {
            return (
              b.kills -
              a.kills
            );
          }

          // YOU wins ties.
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

          return a.name.localeCompare(
            b.name
          );
        }
      );

      // now advances through heartbeat and active-session renders.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      todaySum,
      heartbeat,
      elapsedMs,
    ]);

  // ═══════════════════════════════════════════════════════════════════════
  // SORT REWARDS
  // ═══════════════════════════════════════════════════════════════════════

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

  // ═══════════════════════════════════════════════════════════════════════
  // LOADING
  // ═══════════════════════════════════════════════════════════════════════

  if (!ready) {
    return (
      <div
        className="app-shell"
        style={{
          display: "flex",
          alignItems:
            "center",
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

  // ═══════════════════════════════════════════════════════════════════════
  // UI
  // ═══════════════════════════════════════════════════════════════════════

  return (
    <div
      style={{
        background:
          "radial-gradient(ellipse at center, #10130f 0%, #0b0d0c 72%)",
        color:
          COLORS.text,
        maxWidth: 480,
        margin:
          "0 auto",
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
        (
          corner,
          index
        ) => (
          <div
            key={index}
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
        {/* ════════════════════════════════════════════════════════════════ */}
        {/* HOME                                                           */}
        {/* ════════════════════════════════════════════════════════════════ */}

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
                  fontWeight:
                    700,
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
                (
                  tab
                ) => {
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
              {/* ═════════════════════════════════════════════════════════ */}
              {/* BASE                                                       */}
              {/* ═════════════════════════════════════════════════════════ */}

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

                  {/* TODAY'S SESSIONS */}

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
                          marginBottom:
                            10,
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
                                  session.category
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

              {/* ═════════════════════════════════════════════════════════ */}
              {/* LEADERBOARD                                               */}
              {/* ═════════════════════════════════════════════════════════ */}

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
                      Six fixed benchmarks
                      rise from 06:00 to
                      22:00 through
                      randomized
                      increments. Their
                      peaks never change.
                      Your real score can
                      overtake them
                      immediately.
                    </div>

                    {/* TIME WINDOW */}

                    <div
                      style={{
                        display:
                          "flex",
                        justifyContent:
                          "space-between",
                        marginTop: 12,
                        padding:
                          "8px 10px",
                        borderRadius: 4,
                        background:
                          COLORS.panel,
                        border:
                          `1px solid ${COLORS.panelLine}`,
                        fontFamily:
                          FONT_MONO,
                        fontSize: 10,
                        color:
                          COLORS.textMuted,
                      }}
                    >
                      <span>
                        06:00
                      </span>

                      <span
                        style={{
                          color:
                            COLORS.chrome,
                        }}
                      >
                        RANDOMIZED
                        DAILY
                        PROGRESSION
                      </span>

                      <span>
                        22:00
                      </span>
                    </div>

                    {/* IDEAL */}

                    <div
                      style={{
                        marginTop: 8,
                        fontFamily:
                          FONT_MONO,
                        fontSize: 9.5,
                        color:
                          COLORS.textMuted,
                        letterSpacing:
                          0.5,
                      }}
                    >
                      IDEAL: 4 × 90m +
                      24 × 15m = 12h
                    </div>
                  </div>

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
                          <div
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
                              borderRadius:
                                4,
                              background:
                                entry.isYou
                                  ? `${COLORS.chrome}14`
                                  : COLORS.panel,
                              border:
                                entry.isYou
                                  ? `1px solid ${COLORS.chrome}66`
                                  : "1px solid transparent",
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
                                fontFamily:
                                  FONT_DISPLAY,
                                fontWeight:
                                  entry.isYou
                                    ? 700
                                    : 600,
                                fontSize:
                                  15,
                                color:
                                  entry.isYou
                                    ? COLORS.chrome
                                    : COLORS.text,
                                letterSpacing:
                                  0.3,
                              }}
                            >
                              {
                                entry.name
                              }
                            </div>

                            {/* SCORE */}

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
                          </div>
                        );
                      }
                    )}
                  </div>
                </motion.div>
              )}

              {/* ═════════════════════════════════════════════════════════ */}
              {/* REWARDS                                                    */}
              {/* ═════════════════════════════════════════════════════════ */}

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
                      Collected
                      codes |{" "}
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

                            const categoryColor =
                              CATEGORY_META[
                                reward.category
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
                                      categoryColor,
                                    flexShrink:
                                      0,
                                  }}
                                  aria-hidden
                                />

                                <div
                                  style={{
                                    flex: 1,
                                    minWidth:
                                      0,
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

        {/* ═════════════════════════════════════════════════════════════════ */}
        {/* ACTIVE SESSION                                                   */}
        {/* ═════════════════════════════════════════════════════════════════ */}

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

        {/* ═════════════════════════════════════════════════════════════════ */}
        {/* RESULT                                                           */}
        {/* ═════════════════════════════════════════════════════════════════ */}

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
