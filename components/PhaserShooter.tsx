"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Play,
  Zap,
  Trophy,
  Target,
  Sparkles,
  Flame,
  Lock,
  Gift,
  ChevronRight,
  MousePointerClick,
  RotateCcw,
} from "lucide-react";

import { COLORS, FONT_DISPLAY, FONT_MONO } from "@/lib/theme";

type Phase = "menu" | "playing";

interface PhaserShooterProps {
  /** Lifetime kills across all productivity categories — powers the level. */
  lifetimeKills: number;
  onExit: () => void;
}

// ============================================================================
// PERSISTED STATE
// ============================================================================

interface Milestones {
  m50: boolean;
  m75: boolean;
  m100: boolean;
}

interface TapGameState {
  lastPlayDate: string;

  // Daily economy
  balance: number;
  scoreToday: number;

  // Daily upgrades
  tapLevel: number;
  perSecondLevel: number;

  // Lifetime record
  personalBest: number;
  targetBest: number;

  // Daily progression
  milestonesToday: Milestones;

  // Addictive run loop
  combo: number;
  bestCombo: number;
  totalTapsToday: number;
  criticalHitsToday: number;
  challengesCompletedToday: number;

  // Current challenge
  challengeId: number;
  challengeProgress: number;
  challengeTarget: number;
  challengeCompleted: boolean;

  // Mystery progression
  mysteryIndex: number;
}

const STORAGE_KEY = "tapgame_state_v2";

function todayKey(): string {
  return new Date().toDateString();
}

function defaultState(
  carry?: {
    personalBest: number;
    targetBest: number;
  }
): TapGameState {
  return {
    lastPlayDate: todayKey(),

    balance: 0,
    scoreToday: 0,

    tapLevel: 0,
    perSecondLevel: 0,

    personalBest: carry?.personalBest ?? 0,
    targetBest: carry?.targetBest ?? 0,

    milestonesToday: {
      m50: false,
      m75: false,
      m100: false,
    },

    combo: 0,
    bestCombo: 0,
    totalTapsToday: 0,
    criticalHitsToday: 0,
    challengesCompletedToday: 0,

    challengeId: randomChallengeId(),
    challengeProgress: 0,
    challengeTarget: 10,
    challengeCompleted: false,

    mysteryIndex: 0,
  };
}

function loadState(): TapGameState {
  if (typeof window === "undefined") return defaultState();

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return defaultState();
    }

    const parsed = JSON.parse(raw) as Partial<TapGameState>;

    if (parsed.lastPlayDate !== todayKey()) {
      return defaultState({
        personalBest: parsed.personalBest ?? 0,
        targetBest: parsed.personalBest ?? 0,
      });
    }

    return {
      ...defaultState(),
      ...parsed,
      lastPlayDate: todayKey(),
    };
  } catch {
    return defaultState();
  }
}

function saveState(state: TapGameState) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage failures.
  }
}

// ============================================================================
// LEVEL SYSTEM
// ============================================================================
//
// 521 lifetime kills = 1 productivity level.
//
// The important change:
// EACH LEVEL represents roughly TWO DAYS of productivity work.
//
// The benefit is exponential:
//
// Level 1  = 1.00x
// Level 2  = 1.32x
// Level 3  = 1.74x
// Level 4  = 2.29x
// Level 5  = 3.01x
// Level 10 = 18.79x
// Level 20 = 352.70x
//
// This means productivity progress compounds instead of merely adding.
//
// ============================================================================

const KILLS_PER_LEVEL = 521;
const LEVEL_GROWTH = 1.32;

interface LevelInfo {
  level: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
  progressPct: number;
  multiplier: number;
  nextMultiplier: number;
  totalProductivityDays: number;
}

function xpForLevel(_level: number): number {
  return KILLS_PER_LEVEL;
}

function levelFromLifetimeKills(lifetimeKills: number): LevelInfo {
  const safeKills = Math.max(0, Math.floor(lifetimeKills));

  const level = Math.floor(safeKills / KILLS_PER_LEVEL) + 1;
  const xpIntoLevel = safeKills % KILLS_PER_LEVEL;
  const xpForNextLevel = KILLS_PER_LEVEL;

  const multiplier = Math.pow(LEVEL_GROWTH, level - 1);
  const nextMultiplier = Math.pow(LEVEL_GROWTH, level);

  return {
    level,
    xpIntoLevel,
    xpForNextLevel,
    progressPct: xpIntoLevel / xpForNextLevel,
    multiplier,
    nextMultiplier,
    totalProductivityDays: (level - 1) * 2,
  };
}

// ============================================================================
// CHALLENGE SYSTEM
// ============================================================================
//
// This is the "I wonder if I can..." loop.
//
// Instead of only asking the user to tap:
//
// "I wonder if I can get 20 taps."
// "I wonder if I can hit 5 criticals."
// "I wonder if I can build a 15 combo."
//
// Completing one immediately reveals the next challenge.
//
// ============================================================================

interface Challenge {
  id: number;
  title: string;
  subtitle: string;
  icon: "tap" | "combo" | "critical" | "score";
  target: number;
  rewardMultiplier: number;
}

const CHALLENGES: Challenge[] = [
  {
    id: 0,
    title: "One More",
    subtitle: "Can you reach the next 10 taps?",
    icon: "tap",
    target: 10,
    rewardMultiplier: 1.25,
  },
  {
    id: 1,
    title: "Build Momentum",
    subtitle: "Can you reach a 15× combo?",
    icon: "combo",
    target: 15,
    rewardMultiplier: 1.5,
  },
  {
    id: 2,
    title: "Find the Critical",
    subtitle: "Can you land 3 critical hits?",
    icon: "critical",
    target: 3,
    rewardMultiplier: 1.75,
  },
  {
    id: 3,
    title: "Push It",
    subtitle: "Can you earn 100 points this run?",
    icon: "score",
    target: 100,
    rewardMultiplier: 2,
  },
  {
    id: 4,
    title: "Don't Stop",
    subtitle: "Can you reach a 30× combo?",
    icon: "combo",
    target: 30,
    rewardMultiplier: 2.25,
  },
  {
    id: 5,
    title: "Lucky Run",
    subtitle: "Can you land 5 critical hits?",
    icon: "critical",
    target: 5,
    rewardMultiplier: 2.5,
  },
];

function randomChallengeId(previous?: number): number {
  if (CHALLENGES.length <= 1) return 0;

  let next = Math.floor(Math.random() * CHALLENGES.length);

  if (previous !== undefined) {
    while (next === previous) {
      next = Math.floor(Math.random() * CHALLENGES.length);
    }
  }

  return next;
}

function getChallenge(id: number): Challenge {
  return CHALLENGES[id] ?? CHALLENGES[0];
}

// ============================================================================
// MYSTERY REWARDS
// ============================================================================
//
// The user should not know exactly what comes next.
// The anticipation is intentional.
//
// ============================================================================

const MYSTERY_REWARDS = [
  {
    title: "UNKNOWN CACHE",
    subtitle: "A hidden multiplier was discovered.",
    multiplier: 1.5,
  },
  {
    title: "LUCKY SURGE",
    subtitle: "The next taps are worth more.",
    multiplier: 2,
  },
  {
    title: "OVERDRIVE",
    subtitle: "Momentum has been amplified.",
    multiplier: 2.5,
  },
  {
    title: "SECRET COMBO",
    subtitle: "The system rewarded persistence.",
    multiplier: 3,
  },
  {
    title: "RARE DROP",
    subtitle: "You found something unusually valuable.",
    multiplier: 4,
  },
];

function getMysteryReward(index: number) {
  return MYSTERY_REWARDS[index % MYSTERY_REWARDS.length];
}

// ============================================================================
// ECONOMY
// ============================================================================

const TAP_BASE_COST = 20;
const TAP_COST_GROWTH = 1.32;

const DPS_BASE_COST = 40;
const DPS_COST_GROWTH = 1.38;

function tapUpgradeCost(level: number): number {
  return Math.max(
    1,
    Math.round(TAP_BASE_COST * Math.pow(TAP_COST_GROWTH, level))
  );
}

function dpsUpgradeCost(level: number): number {
  return Math.max(
    1,
    Math.round(DPS_BASE_COST * Math.pow(DPS_COST_GROWTH, level))
  );
}

function computeTapValue(
  tapLevel: number,
  levelMultiplier: number,
  combo: number,
  mysteryMultiplier: number
): number {
  const base = 1 + tapLevel;

  const comboMultiplier =
    combo >= 30
      ? 2
      : combo >= 20
        ? 1.6
        : combo >= 10
          ? 1.3
          : 1;

  return Math.max(
    1,
    Math.round(
      base *
        levelMultiplier *
        comboMultiplier *
        mysteryMultiplier
    )
  );
}

function computePerSecondValue(
  perSecondLevel: number,
  levelMultiplier: number
): number {
  return Math.max(
    0,
    Math.round(perSecondLevel * levelMultiplier)
  );
}

// ============================================================================
// POINT APPLICATION
// ============================================================================

function applyPoints(
  prev: TapGameState,
  amount: number
): TapGameState {
  if (amount <= 0) return prev;

  const scoreToday = prev.scoreToday + amount;
  const balance = prev.balance + amount;

  const personalBest =
    scoreToday > prev.personalBest
      ? scoreToday
      : prev.personalBest;

  let milestonesToday = prev.milestonesToday;

  if (prev.targetBest > 0) {
    const m50 =
      milestonesToday.m50 ||
      scoreToday >= prev.targetBest * 0.5;

    const m75 =
      milestonesToday.m75 ||
      scoreToday >= prev.targetBest * 0.75;

    const m100 =
      milestonesToday.m100 ||
      scoreToday >= prev.targetBest;

    milestonesToday = {
      m50,
      m75,
      m100,
    };
  }

  return {
    ...prev,
    balance,
    scoreToday,
    personalBest,
    milestonesToday,
  };
}

// ============================================================================
// FORMATTING
// ============================================================================

function formatPoints(n: number): string {
  const rounded = Math.round(n);

  if (rounded < 1000) {
    return rounded.toString();
  }

  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(rounded);
}

function formatMultiplier(n: number): string {
  if (n < 10) {
    return `${n.toFixed(2)}×`;
  }

  if (n < 100) {
    return `${n.toFixed(1)}×`;
  }

  return `${formatPoints(n)}×`;
}

function formatCountdown(ms: number): string {
  const totalMinutes = Math.max(
    0,
    Math.floor(ms / 60000)
  );

  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;

  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

let tapBurstId = 0;

export default function PhaserShooter({
  lifetimeKills,
  onExit,
}: PhaserShooterProps) {
  const [phase, setPhase] =
    useState<Phase>("menu");

  const [state, setState] =
    useState<TapGameState>(() => defaultState());

  const [hydrated, setHydrated] =
    useState(false);

  const [now, setNow] =
    useState(() => Date.now());

  const [toast, setToast] =
    useState<string | null>(null);

  const [tapBursts, setTapBursts] =
    useState<
      {
        id: number;
        x: number;
        y: number;
        value: number;
        critical: boolean;
      }[]
    >([]);

  const [mysteryMultiplier, setMysteryMultiplier] =
    useState(1);

  const [showMystery, setShowMystery] =
    useState(false);

  const [lastCritical, setLastCritical] =
    useState(false);

  const tapButtonRef =
    useRef<HTMLButtonElement>(null);

  const prevMilestonesRef =
    useRef<Milestones>(state.milestonesToday);

  // ==========================================================================
  // LEVEL
  // ==========================================================================

  const levelInfo = useMemo(
    () =>
      levelFromLifetimeKills(
        lifetimeKills
      ),
    [lifetimeKills]
  );

  const challenge = useMemo(
    () =>
      getChallenge(
        state.challengeId
      ),
    [state.challengeId]
  );

  const tapValue = useMemo(
    () =>
      computeTapValue(
        state.tapLevel,
        levelInfo.multiplier,
        state.combo,
        mysteryMultiplier
      ),
    [
      state.tapLevel,
      state.combo,
      levelInfo.multiplier,
      mysteryMultiplier,
    ]
  );

  const perSecondValue = useMemo(
    () =>
      computePerSecondValue(
        state.perSecondLevel,
        levelInfo.multiplier
      ),
    [
      state.perSecondLevel,
      levelInfo.multiplier,
    ]
  );

  // ==========================================================================
  // LOAD
  // ==========================================================================

  useEffect(() => {
    setState(loadState());
    setHydrated(true);
  }, []);

  // ==========================================================================
  // SAVE
  // ==========================================================================

  useEffect(() => {
    if (!hydrated) return;

    saveState(state);
  }, [state, hydrated]);

  // ==========================================================================
  // CLOCK
  // ==========================================================================

  useEffect(() => {
    const id = setInterval(
      () => setNow(Date.now()),
      30_000
    );

    return () => clearInterval(id);
  }, []);

  // ==========================================================================
  // DAILY RESET
  // ==========================================================================

  useEffect(() => {
    setState((prev) => {
      if (
        prev.lastPlayDate ===
        todayKey()
      ) {
        return prev;
      }

      return defaultState({
        personalBest:
          prev.personalBest,
        targetBest:
          prev.personalBest,
      });
    });
  }, [now]);

  const msUntilReset = useMemo(() => {
    const next = new Date();

    next.setHours(
      24,
      0,
      0,
      0
    );

    return (
      next.getTime() - now
    );
  }, [now]);

  // ==========================================================================
  // PASSIVE INCOME
  // ==========================================================================

  useEffect(() => {
    if (phase !== "playing") return;
    if (perSecondValue <= 0) return;

    const id = setInterval(() => {
      setState((prev) =>
        applyPoints(
          prev,
          perSecondValue
        )
      );
    }, 1000);

    return () => clearInterval(id);
  }, [
    phase,
    perSecondValue,
  ]);

  // ==========================================================================
  // MILESTONES
  // ==========================================================================

  useEffect(() => {
    const prev =
      prevMilestonesRef.current;

    const curr =
      state.milestonesToday;

    if (
      !prev.m100 &&
      curr.m100
    ) {
      setToast(
        "🏆 NEW PERSONAL BEST"
      );
    } else if (
      !prev.m75 &&
      curr.m75
    ) {
      setToast(
        "75% — CAN YOU BEAT IT?"
      );
    } else if (
      !prev.m50 &&
      curr.m50
    ) {
      setToast(
        "HALFWAY — KEEP GOING"
      );
    }

    prevMilestonesRef.current =
      curr;
  }, [
    state.milestonesToday,
  ]);

  // ==========================================================================
  // TOAST
  // ==========================================================================

  useEffect(() => {
    if (!toast) return;

    const id = setTimeout(
      () => setToast(null),
      2200
    );

    return () =>
      clearTimeout(id);
  }, [toast]);

  // ==========================================================================
  // RESET COMBO WHEN USER STAYS INACTIVE
  // ==========================================================================

  const comboTimeoutRef =
    useRef<ReturnType<
      typeof setTimeout
    > | null>(null);

  const scheduleComboReset =
    useCallback(() => {
      if (
        comboTimeoutRef.current
      ) {
        clearTimeout(
          comboTimeoutRef.current
        );
      }

      comboTimeoutRef.current =
        setTimeout(() => {
          setState((prev) => ({
            ...prev,
            combo: 0,
          }));
        }, 1800);
    }, []);

  useEffect(() => {
    return () => {
      if (
        comboTimeoutRef.current
      ) {
        clearTimeout(
          comboTimeoutRef.current
        );
      }
    };
  }, []);

  // ==========================================================================
  // CHALLENGE PROGRESS
  // ==========================================================================

  const updateChallenge =
    useCallback(
      (
        prev: TapGameState,
        event:
          | "tap"
          | "critical"
          | "combo"
          | "score",
        newScore: number,
        newCombo: number
      ): TapGameState => {
        if (
          prev.challengeCompleted
        ) {
          return prev;
        }

        const current =
          getChallenge(
            prev.challengeId
          );

        let progress =
          prev.challengeProgress;

        if (
          current.icon === "tap" &&
          event === "tap"
        ) {
          progress += 1;
        }

        if (
          current.icon ===
            "critical" &&
          event === "critical"
        ) {
          progress += 1;
        }

        if (
          current.icon ===
            "combo" &&
          event === "combo"
        ) {
          progress =
            Math.max(
              progress,
              newCombo
            );
        }

        if (
          current.icon ===
            "score" &&
          event === "score"
        ) {
          progress =
            Math.max(
              progress,
              newScore
            );
        }

        const completed =
          progress >=
          current.target;

        if (!completed) {
          return {
            ...prev,
            challengeProgress:
              progress,
          };
        }

        return {
          ...prev,
          challengeProgress:
            current.target,
          challengeCompleted:
            true,
          challengesCompletedToday:
            prev.challengesCompletedToday +
            1,
          mysteryIndex:
            prev.mysteryIndex + 1,
        };
      },
      []
    );

  // ==========================================================================
  // TAP
  // ==========================================================================

  const handleTap =
    useCallback(
      (
        clientX: number,
        clientY: number
      ) => {
        const critical =
          Math.random() <
          Math.min(
            0.08 +
              state.combo *
                0.003,
            0.25
          );

        const combo =
          state.combo + 1;

        const comboMultiplier =
          combo >= 30
            ? 2
            : combo >= 20
              ? 1.6
              : combo >= 10
                ? 1.3
                : 1;

        const baseValue =
          computeTapValue(
            state.tapLevel,
            levelInfo.multiplier,
            combo,
            mysteryMultiplier
          );

        const value =
          critical
            ? Math.round(
                baseValue * 3
              )
            : baseValue;

        setState((prev) => {
          const afterPoints =
            applyPoints(
              prev,
              value
            );

          const nextCombo =
            prev.combo + 1;

          let next =
            {
              ...afterPoints,
              combo:
                nextCombo,
              bestCombo:
                Math.max(
                  prev.bestCombo,
                  nextCombo
                ),
              totalTapsToday:
                prev.totalTapsToday +
                1,
              criticalHitsToday:
                prev.criticalHitsToday +
                (critical ? 1 : 0),
            };

          next =
            updateChallenge(
              next,
              critical
                ? "critical"
                : "tap",
              next.scoreToday,
              nextCombo
            );

          if (
            nextCombo >=
              challenge.target &&
            challenge.icon ===
              "combo"
          ) {
            next =
              updateChallenge(
                next,
                "combo",
                next.scoreToday,
                nextCombo
              );
          }

          next =
            updateChallenge(
              next,
              "score",
              next.scoreToday,
              nextCombo
            );

          return next;
        });

        setLastCritical(
          critical
        );

        if (critical) {
          setToast(
            `CRITICAL ×3 — ${formatPoints(
              value
            )}`
          );
        } else if (
          combo === 10 ||
          combo === 20 ||
          combo === 30
        ) {
          setToast(
            `${combo}× COMBO`
          );
        }

        scheduleComboReset();

        const rect =
          tapButtonRef.current?.getBoundingClientRect();

        const id =
          tapBurstId++;

        setTapBursts(
          (prev) => [
            ...prev,
            {
              id,
              x: rect
                ? clientX -
                  rect.left
                : 0,
              y: rect
                ? clientY -
                  rect.top
                : 0,
              value,
              critical,
            },
          ]
        );

        setTimeout(() => {
          setTapBursts(
            (prev) =>
              prev.filter(
                (b) =>
                  b.id !== id
              )
          );
        }, 700);

        // If a challenge was completed, reveal the mystery reward.
        setTimeout(() => {
          setState((current) => {
            if (
              !current.challengeCompleted
            ) {
              return current;
            }

            return current;
          });
        }, 50);
      },
      [
        state.tapLevel,
        state.combo,
        levelInfo.multiplier,
        mysteryMultiplier,
        challenge,
        updateChallenge,
        scheduleComboReset,
      ]
    );

  // ==========================================================================
  // MYSTERY CLAIM
  // ==========================================================================

  const claimMystery =
    useCallback(() => {
      const reward =
        getMysteryReward(
          state.mysteryIndex
        );

      setMysteryMultiplier(
        reward.multiplier
      );

      setState((prev) => ({
        ...prev,
        challengeId:
          randomChallengeId(
            prev.challengeId
          ),
        challengeProgress: 0,
        challengeTarget:
          getChallenge(
            randomChallengeId(
              prev.challengeId
            )
          ).target,
        challengeCompleted:
          false,
      }));

      setShowMystery(false);

      setToast(
        `${reward.title} — ${formatMultiplier(
          reward.multiplier
        )}`
      );
    }, [
      state.mysteryIndex,
      state.challengeId,
    ]);

  // ==========================================================================
  // SHOP
  // ==========================================================================

  const buyTapUpgrade =
    useCallback(() => {
      setState((prev) => {
        const cost =
          tapUpgradeCost(
            prev.tapLevel
          );

        if (
          prev.balance <
          cost
        ) {
          return prev;
        }

        return {
          ...prev,
          balance:
            prev.balance -
            cost,
          tapLevel:
            prev.tapLevel + 1,
        };
      });
    }, []);

  const buyDpsUpgrade =
    useCallback(() => {
      setState((prev) => {
        const cost =
          dpsUpgradeCost(
            prev.perSecondLevel
          );

        if (
          prev.balance <
          cost
        ) {
          return prev;
        }

        return {
          ...prev,
          balance:
            prev.balance -
            cost,
          perSecondLevel:
            prev.perSecondLevel +
            1,
        };
      });
    }, []);

  // ==========================================================================
  // NAVIGATION
  // ==========================================================================

  const startPlaying =
    useCallback(
      () => setPhase("playing"),
      []
    );

  const backToMenu =
    useCallback(
      () => setPhase("menu"),
      []
    );

  // ==========================================================================
  // DERIVED UI
  // ==========================================================================

  const tapUpgradeCostNow =
    tapUpgradeCost(
      state.tapLevel
    );

  const dpsUpgradeCostNow =
    dpsUpgradeCost(
      state.perSecondLevel
    );

  const nextTapValue =
    computeTapValue(
      state.tapLevel + 1,
      levelInfo.multiplier,
      state.combo,
      mysteryMultiplier
    );

  const nextPerSecondValue =
    computePerSecondValue(
      state.perSecondLevel + 1,
      levelInfo.multiplier
    );

  const progressPct =
    state.targetBest > 0
      ? Math.min(
          1,
          state.scoreToday /
            state.targetBest
        )
      : 0;

  const challengePct =
    challenge.target > 0
      ? Math.min(
          1,
          state.challengeProgress /
            challenge.target
        )
      : 0;

  const currentMystery =
    getMysteryReward(
      state.mysteryIndex
    );

  // Detect challenge completion and show mystery screen.
  useEffect(() => {
    if (
      state.challengeCompleted &&
      !showMystery
    ) {
      setShowMystery(true);
    }
  }, [
    state.challengeCompleted,
    showMystery,
  ]);

  // ==========================================================================
  // RENDER
  // ==========================================================================

  return (
    <div
      style={{
        position: "relative",
      }}
    >
      <AnimatePresence mode="wait">
        {phase === "menu" && (
          <motion.div
            key="game-menu"
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
            <MenuScreen
              levelInfo={levelInfo}
              state={state}
              hydrated={hydrated}
              onStart={
                startPlaying
              }
            />
          </motion.div>
        )}

        {phase === "playing" && (
          <motion.div
            key="game-playing"
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
            {/* ================================================================
                HEADER
            ================================================================= */}

            <div
              style={{
                display: "flex",
                alignItems:
                  "center",
                justifyContent:
                  "space-between",
                marginBottom: 10,
                padding:
                  "0 2px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems:
                    "center",
                  gap: 6,
                }}
              >
                <Zap
                  size={13}
                  color={
                    COLORS.chrome
                  }
                />

                <span
                  style={{
                    fontFamily:
                      FONT_MONO,
                    fontSize: 11,
                    color:
                      COLORS.textMuted,
                  }}
                >
                  LV{" "}
                  {
                    levelInfo.level
                  }
                </span>

                <span
                  style={{
                    fontFamily:
                      FONT_MONO,
                    fontSize: 9,
                    color:
                      COLORS.chrome,
                  }}
                >
                  {
                    formatMultiplier(
                      levelInfo.multiplier
                    )
                  }
                </span>
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
                    0.6,
                }}
              >
                {
                  formatCountdown(
                    msUntilReset
                  )
                }
              </div>

              <button
                onClick={
                  backToMenu
                }
                aria-label="Back to menu"
                style={{
                  width: 30,
                  height: 30,
                  display:
                    "flex",
                  alignItems:
                    "center",
                  justifyContent:
                    "center",
                  borderRadius: 4,
                  border: `1px solid ${COLORS.panelLine}`,
                  background:
                    COLORS.panel,
                  color:
                    COLORS.text,
                  cursor:
                    "pointer",
                }}
              >
                <X size={14} />
              </button>
            </div>

            {/* ================================================================
                SCORE
            ================================================================= */}

            <div
              style={{
                padding:
                  "18px 16px",
                borderRadius: 6,
                background:
                  COLORS.panel,
                border: `1px solid ${COLORS.panelLine}`,
                textAlign:
                  "center",
              }}
            >
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
                    1.5,
                }}
              >
                Today
              </div>

              <motion.div
                key={Math.floor(
                  state.scoreToday /
                    10
                )}
                initial={{
                  scale: 1.04,
                }}
                animate={{
                  scale: 1,
                }}
                style={{
                  fontFamily:
                    FONT_MONO,
                  fontSize: 42,
                  fontWeight: 700,
                  color:
                    COLORS.text,
                  marginTop: 4,
                }}
              >
                {formatPoints(
                  state.scoreToday
                )}
              </motion.div>

              <div
                style={{
                  display:
                    "flex",
                  justifyContent:
                    "center",
                  gap: 18,
                  marginTop: 8,
                  fontFamily:
                    FONT_MONO,
                  fontSize: 10.5,
                  color:
                    COLORS.textMuted,
                }}
              >
                <span>
                  {formatPoints(
                    state.balance
                  )}{" "}
                  banked
                </span>

                {perSecondValue >
                  0 && (
                  <span>
                    +
                    {formatPoints(
                      perSecondValue
                    )}
                    /sec
                  </span>
                )}
              </div>

              {/* COMBO */}

              <AnimatePresence>
                {state.combo >
                  1 && (
                  <motion.div
                    initial={{
                      opacity: 0,
                      scale: 0.8,
                    }}
                    animate={{
                      opacity: 1,
                      scale: 1,
                    }}
                    style={{
                      marginTop: 10,
                      fontFamily:
                        FONT_DISPLAY,
                      fontWeight: 800,
                      fontSize:
                        14,
                      color:
                        COLORS.chrome,
                    }}
                  >
                    <Flame
                      size={14}
                      style={{
                        verticalAlign:
                          "middle",
                        marginRight:
                          4,
                      }}
                    />
                    {
                      state.combo
                    }
                    × MOMENTUM
                  </motion.div>
                )}
              </AnimatePresence>

              <MilestoneBar
                progressPct={
                  progressPct
                }
                targetBest={
                  state.targetBest
                }
                milestones={
                  state.milestonesToday
                }
              />
            </div>

            {/* ================================================================
                MYSTERY CHALLENGE
            ================================================================= */}

            <motion.div
              animate={
                state.challengeCompleted
                  ? {
                      scale: [
                        1,
                        1.02,
                        1,
                      ],
                    }
                  : {}
              }
              transition={{
                duration: 0.5,
              }}
              style={{
                marginTop: 12,
                padding:
                  "13px 14px",
                borderRadius: 6,
                background:
                  COLORS.panel,
                border: `1px solid ${COLORS.chrome}44`,
              }}
            >
              <div
                style={{
                  display:
                    "flex",
                  alignItems:
                    "center",
                  gap: 8,
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 6,
                    display:
                      "flex",
                    alignItems:
                      "center",
                    justifyContent:
                      "center",
                    background: `${COLORS.chrome}18`,
                    flexShrink: 0,
                  }}
                >
                  <Target
                    size={16}
                    color={
                      COLORS.chrome
                    }
                  />
                </div>

                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  <div
                    style={{
                      display:
                        "flex",
                      alignItems:
                        "center",
                      gap: 7,
                      fontFamily:
                        FONT_DISPLAY,
                      fontWeight: 700,
                      fontSize:
                        12,
                      color:
                        COLORS.text,
                    }}
                  >
                    I WONDER IF I CAN...
                  </div>

                  <div
                    style={{
                      fontFamily:
                        FONT_MONO,
                      fontSize:
                        10,
                      color:
                        COLORS.textMuted,
                      marginTop: 2,
                    }}
                  >
                    {
                      challenge.subtitle
                    }
                  </div>
                </div>

                <div
                  style={{
                    fontFamily:
                      FONT_MONO,
                    fontSize: 10,
                    color:
                      COLORS.chrome,
                    fontWeight: 700,
                  }}
                >
                  {
                    state.challengeProgress
                  }
                  /
                  {
                    challenge.target
                  }
                </div>
              </div>

              <div
                style={{
                  height: 5,
                  borderRadius: 3,
                  background:
                    COLORS.void,
                  marginTop: 10,
                  overflow:
                    "hidden",
                }}
              >
                <motion.div
                  animate={{
                    width: `${
                      challengePct *
                      100
                    }%`,
                  }}
                  style={{
                    height:
                      "100%",
                    background:
                      COLORS.chrome,
                  }}
                />
              </div>

              <div
                style={{
                  display:
                    "flex",
                  justifyContent:
                    "space-between",
                  marginTop: 7,
                  fontFamily:
                    FONT_MONO,
                  fontSize: 8.5,
                  color:
                    COLORS.textMuted,
                }}
              >
                <span>
                  REWARD
                </span>

                <span
                  style={{
                    color:
                      COLORS.chrome,
                  }}
                >
                  +
                  {formatMultiplier(
                    challenge.rewardMultiplier
                  )}
                </span>
              </div>
            </motion.div>

            {/* ================================================================
                TAP BUTTON
            ================================================================= */}

            <div
              style={{
                position:
                  "relative",
                display:
                  "flex",
                justifyContent:
                  "center",
                margin:
                  "22px 0 20px",
              }}
            >
              <motion.button
                ref={
                  tapButtonRef
                }
                onClick={(e) =>
                  handleTap(
                    e.clientX,
                    e.clientY
                  )
                }
                whileTap={{
                  scale: 0.91,
                }}
                animate={
                  state.combo >=
                  10
                    ? {
                        boxShadow: [
                          `0 0 0 6px ${COLORS.panel}, 0 0 20px ${COLORS.chrome}44`,
                          `0 0 0 6px ${COLORS.panel}, 0 0 42px ${COLORS.chrome}99`,
                          `0 0 0 6px ${COLORS.panel}, 0 0 20px ${COLORS.chrome}44`,
                        ],
                      }
                    : {}
                }
                transition={{
                  duration: 1.2,
                  repeat:
                    Infinity,
                }}
                style={{
                  width: 164,
                  height: 164,
                  borderRadius:
                    "50%",
                  border: "none",
                  background:
                    COLORS.chrome,
                  color:
                    COLORS.void,
                  display:
                    "flex",
                  flexDirection:
                    "column",
                  alignItems:
                    "center",
                  justifyContent:
                    "center",
                  gap: 4,
                  cursor:
                    "pointer",
                  boxShadow: `0 0 0 6px ${COLORS.panel}, 0 0 24px ${COLORS.chrome}55`,
                  position:
                    "relative",
                  overflow:
                    "visible",
                }}
              >
                <motion.div
                  animate={
                    state.combo >=
                    10
                      ? {
                          rotate: [
                            0,
                            -5,
                            5,
                            0,
                          ],
                        }
                      : {}
                  }
                  transition={{
                    duration:
                      0.4,
                    repeat:
                      Infinity,
                  }}
                >
                  <MousePointerClick
                    size={34}
                  />
                </motion.div>

                <span
                  style={{
                    fontFamily:
                      FONT_DISPLAY,
                    fontWeight: 800,
                    fontSize: 15,
                    letterSpacing:
                      1,
                    textTransform:
                      "uppercase",
                  }}
                >
                  Keep Going
                </span>

                <span
                  style={{
                    fontFamily:
                      FONT_MONO,
                    fontSize: 11,
                    opacity:
                      0.75,
                  }}
                >
                  +
                  {formatPoints(
                    tapValue
                  )}
                </span>

                {state.combo >=
                  10 && (
                  <span
                    style={{
                      position:
                        "absolute",
                      bottom: -23,
                      fontFamily:
                        FONT_MONO,
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing:
                        1,
                    }}
                  >
                    MOMENTUM
                    ACTIVE
                  </span>
                )}
              </motion.button>

              <AnimatePresence>
                {tapBursts.map(
                  (b) => (
                    <motion.div
                      key={
                        b.id
                      }
                      initial={{
                        opacity: 1,
                        y: 0,
                        scale: b.critical
                          ? 1.5
                          : 1,
                      }}
                      animate={{
                        opacity: 0,
                        y: -58,
                        scale: 1,
                      }}
                      exit={{
                        opacity: 0,
                      }}
                      transition={{
                        duration:
                          0.65,
                        ease: "easeOut",
                      }}
                      style={{
                        position:
                          "absolute",
                        left: b.x,
                        top: b.y,
                        pointerEvents:
                          "none",
                        fontFamily:
                          FONT_MONO,
                        fontWeight: 800,
                        fontSize:
                          b.critical
                            ? 18
                            : 15,
                        color:
                          COLORS.chrome,
                        whiteSpace:
                          "nowrap",
                      }}
                    >
                      {b.critical
                        ? "CRIT! "
                        : "+"}
                      {formatPoints(
                        b.value
                      )}
                    </motion.div>
                  )
                )}
              </AnimatePresence>
            </div>

            {/* ================================================================
                SHOP
            ================================================================= */}

            <div
              style={{
                display:
                  "flex",
                alignItems:
                  "center",
                justifyContent:
                  "space-between",
                marginBottom:
                  10,
              }}
            >
              <span
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
                Upgrade
              </span>

              <span
                style={{
                  fontFamily:
                    FONT_MONO,
                  fontSize: 9,
                  color:
                    COLORS.textMuted,
                }}
              >
                BUILD YOUR RUN
              </span>
            </div>

            <div
              style={{
                display:
                  "flex",
                flexDirection:
                  "column",
                gap: 10,
              }}
            >
              <ShopCard
                icon={
                  <MousePointerClick
                    size={18}
                    color={
                      COLORS.chrome
                    }
                  />
                }
                title="Tap power"
                level={
                  state.tapLevel
                }
                description={`Next tap becomes +${formatPoints(
                  nextTapValue -
                    tapValue
                )}`}
                currentLabel={`+${formatPoints(
                  tapValue
                )} / tap`}
                cost={
                  tapUpgradeCostNow
                }
                canAfford={
                  state.balance >=
                  tapUpgradeCostNow
                }
                accent={
                  COLORS.chrome
                }
                onBuy={
                  buyTapUpgrade
                }
              />

              <ShopCard
                icon={
                  <Zap
                    size={18}
                    color="#7fd48a"
                  />
                }
                title="Auto-collect"
                level={
                  state.perSecondLevel
                }
                description={`Passive income +${formatPoints(
                  nextPerSecondValue -
                    perSecondValue
                )}/sec`}
                currentLabel={`+${formatPoints(
                  perSecondValue
                )} / sec`}
                cost={
                  dpsUpgradeCostNow
                }
                canAfford={
                  state.balance >=
                  dpsUpgradeCostNow
                }
                accent="#7fd48a"
                onBuy={
                  buyDpsUpgrade
                }
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ======================================================================
          MYSTERY REWARD OVERLAY
      ======================================================================= */}

      <AnimatePresence>
        {showMystery && (
          <motion.div
            initial={{
              opacity: 0,
            }}
            animate={{
              opacity: 1,
            }}
            exit={{
              opacity: 0,
            }}
            style={{
              position:
                "absolute",
              inset: 0,
              zIndex: 50,
              display:
                "flex",
              alignItems:
                "center",
              justifyContent:
                "center",
              padding: 10,
              background:
                "rgba(0,0,0,0.72)",
              backdropFilter:
                "blur(5px)",
              borderRadius: 8,
            }}
          >
            <motion.div
              initial={{
                scale: 0.8,
                y: 20,
              }}
              animate={{
                scale: 1,
                y: 0,
              }}
              style={{
                width: "100%",
                padding:
                  "24px 18px",
                borderRadius: 8,
                background:
                  COLORS.panel,
                border: `1px solid ${COLORS.chrome}66`,
                textAlign:
                  "center",
                boxShadow: `0 0 50px ${COLORS.chrome}22`,
              }}
            >
              <motion.div
                animate={{
                  rotate: [
                    -8,
                    8,
                    -8,
                  ],
                }}
                transition={{
                  duration:
                    1.2,
                  repeat:
                    Infinity,
                }}
                style={{
                  width: 52,
                  height: 52,
                  borderRadius:
                    "50%",
                  margin:
                    "0 auto 14px",
                  display:
                    "flex",
                  alignItems:
                    "center",
                  justifyContent:
                    "center",
                  background: `${COLORS.chrome}18`,
                }}
              >
                <Gift
                  size={25}
                  color={
                    COLORS.chrome
                  }
                />
              </motion.div>

              <div
                style={{
                  fontFamily:
                    FONT_MONO,
                  fontSize: 9,
                  letterSpacing:
                    2,
                  color:
                    COLORS.textMuted,
                }}
              >
                CHALLENGE COMPLETE
              </div>

              <div
                style={{
                  fontFamily:
                    FONT_DISPLAY,
                  fontSize: 21,
                  fontWeight: 800,
                  color:
                    COLORS.text,
                  marginTop: 5,
                }}
              >
                WHAT&apos;S NEXT?
              </div>

              <div
                style={{
                  fontFamily:
                    FONT_MONO,
                  fontSize: 10,
                  color:
                    COLORS.textMuted,
                  marginTop: 7,
                  lineHeight:
                    1.5,
                }}
              >
                You did it.
                <br />
                But there&apos;s
                another one.
              </div>

              <div
                style={{
                  marginTop: 18,
                  padding:
                    "13px 10px",
                  borderRadius: 6,
                  background:
                    COLORS.void,
                  border: `1px solid ${COLORS.panelLine}`,
                }}
              >
                <div
                  style={{
                    fontFamily:
                      FONT_MONO,
                    fontSize: 9,
                    color:
                      COLORS.textMuted,
                  }}
                >
                  MYSTERY REWARD
                </div>

                <div
                  style={{
                    fontFamily:
                      FONT_DISPLAY,
                    fontSize: 16,
                    fontWeight: 800,
                    color:
                      COLORS.chrome,
                    marginTop: 4,
                  }}
                >
                  ???
                </div>
              </div>

              <button
                onClick={
                  claimMystery
                }
                style={{
                  width: "100%",
                  marginTop: 14,
                  padding:
                    "13px 0",
                  borderRadius: 4,
                  border: "none",
                  background:
                    COLORS.chrome,
                  color:
                    COLORS.void,
                  fontFamily:
                    FONT_DISPLAY,
                  fontWeight: 800,
                  fontSize: 12,
                  letterSpacing:
                    0.8,
                  cursor:
                    "pointer",
                  display:
                    "flex",
                  alignItems:
                    "center",
                  justifyContent:
                    "center",
                  gap: 6,
                }}
              >
                FIND OUT
                <ChevronRight
                  size={14}
                />
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ======================================================================
          TOAST
      ======================================================================= */}

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{
              opacity: 0,
              y: -8,
              x: "-50%",
            }}
            animate={{
              opacity: 1,
              y: 0,
              x: "-50%",
            }}
            exit={{
              opacity: 0,
              y: -8,
              x: "-50%",
            }}
            style={{
              position:
                "absolute",
              top: -6,
              left: "50%",
              padding:
                "8px 14px",
              borderRadius: 20,
              background:
                COLORS.chrome,
              color:
                COLORS.void,
              fontFamily:
                FONT_MONO,
              fontSize: 11,
              fontWeight: 800,
              whiteSpace:
                "nowrap",
              zIndex: 100,
            }}
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ======================================================================
          EXIT
      ======================================================================= */}

      {phase ===
        "menu" && (
        <button
          onClick={
            onExit
          }
          style={{
            display:
              "flex",
            alignItems:
              "center",
            gap: 6,
            margin:
              "18px auto 0",
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
          <X size={12} />
          Exit
        </button>
      )}
    </div>
  );
}

// ============================================================================
// MILESTONE BAR
// ============================================================================

function MilestoneBar({
  progressPct,
  targetBest,
  milestones,
}: {
  progressPct: number;
  targetBest: number;
  milestones: Milestones;
}) {
  if (targetBest <= 0) {
    return (
      <div
        style={{
          fontFamily:
            FONT_MONO,
          fontSize: 9.5,
          color:
            COLORS.textMuted,
          marginTop: 14,
        }}
      >
        Today&apos;s run becomes
        tomorrow&apos;s target.
      </div>
    );
  }

  return (
    <div
      style={{
        marginTop: 14,
      }}
    >
      <div
        style={{
          position:
            "relative",
          height: 7,
          borderRadius: 4,
          background:
            COLORS.void,
          border: `1px solid ${COLORS.panelLine}`,
          overflow:
            "hidden",
        }}
      >
        <motion.div
          animate={{
            width: `${
              progressPct *
              100
            }%`,
          }}
          style={{
            height:
              "100%",
            background:
              milestones.m100
                ? "#7fd48a"
                : COLORS.chrome,
          }}
        />
      </div>

      <div
        style={{
          display:
            "flex",
          justifyContent:
            "space-between",
          marginTop: 5,
          fontFamily:
            FONT_MONO,
          fontSize: 8.5,
          color:
            COLORS.textMuted,
        }}
      >
        <span
          style={{
            color:
              milestones.m50
                ? COLORS.chrome
                : COLORS.textMuted,
          }}
        >
          50%
        </span>

        <span
          style={{
            color:
              milestones.m75
                ? COLORS.chrome
                : COLORS.textMuted,
          }}
        >
          75%
        </span>

        <span
          style={{
            color:
              milestones.m100
                ? "#7fd48a"
                : COLORS.textMuted,
          }}
        >
          100%
        </span>
      </div>
    </div>
  );
}

// ============================================================================
// SHOP CARD
// ============================================================================

function ShopCard({
  icon,
  title,
  level,
  description,
  currentLabel,
  cost,
  canAfford,
  accent,
  onBuy,
}: {
  icon: ReactNode;
  title: string;
  level: number;
  description: string;
  currentLabel: string;
  cost: number;
  canAfford: boolean;
  accent: string;
  onBuy: () => void;
}) {
  return (
    <motion.button
      whileTap={
        canAfford
          ? {
              scale: 0.98,
            }
          : {}
      }
      onClick={onBuy}
      disabled={!canAfford}
      style={{
        display:
          "flex",
        alignItems:
          "center",
        gap: 12,
        padding:
          "14px",
        borderRadius: 6,
        border: `1px solid ${accent}44`,
        background:
          COLORS.panel,
        textAlign:
          "left",
        cursor:
          canAfford
            ? "pointer"
            : "not-allowed",
        opacity:
          canAfford
            ? 1
            : 0.5,
        width:
          "100%",
      }}
    >
      <div
        style={{
          width: 38,
          height: 38,
          borderRadius: 6,
          display:
            "flex",
          alignItems:
            "center",
          justifyContent:
            "center",
          background: `${accent}18`,
          flexShrink: 0,
        }}
      >
        {icon}
      </div>

      <div
        style={{
          flex: 1,
          minWidth: 0,
        }}
      >
        <div
          style={{
            display:
              "flex",
            alignItems:
              "center",
            gap: 8,
            fontFamily:
              FONT_DISPLAY,
            fontWeight: 700,
            fontSize: 14,
            color:
              COLORS.text,
          }}
        >
          {title}

          <span
            style={{
              fontFamily:
                FONT_MONO,
              fontSize: 9,
              color:
                COLORS.textMuted,
              fontWeight: 400,
            }}
          >
            Lv {level}
          </span>
        </div>

        <div
          style={{
            fontFamily:
              FONT_MONO,
            fontSize: 10,
            color:
              COLORS.textMuted,
            marginTop: 2,
            lineHeight:
              1.4,
          }}
        >
          {description}
        </div>

        <div
          style={{
            fontFamily:
              FONT_MONO,
            fontSize: 9.5,
            color: accent,
            marginTop: 4,
          }}
        >
          {currentLabel}
        </div>
      </div>

      <div
        style={{
          textAlign:
            "right",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            fontFamily:
              FONT_MONO,
            fontSize: 14,
            fontWeight: 700,
            color:
              canAfford
                ? accent
                : COLORS.textMuted,
          }}
        >
          {formatPoints(
            cost
          )}
        </div>

        <div
          style={{
            fontFamily:
              FONT_MONO,
            fontSize: 8,
            color:
              COLORS.textMuted,
            textTransform:
              "uppercase",
          }}
        >
          cost
        </div>
      </div>
    </motion.button>
  );
}

// ============================================================================
// MENU
// ============================================================================

function MenuScreen({
  levelInfo,
  state,
  hydrated,
  onStart,
}: {
  levelInfo: LevelInfo;
  state: TapGameState;
  hydrated: boolean;
  onStart: () => void;
}) {
  const hasProgressToday =
    state.scoreToday > 0;

  const nextLevelKills =
    levelInfo.xpForNextLevel -
    levelInfo.xpIntoLevel;

  return (
    <div>
      {/* ================================================================
          LEVEL
      ================================================================= */}

      <div
        style={{
          padding:
            "18px 16px",
          borderRadius: 6,
          background:
            COLORS.panel,
          border: `1px solid ${COLORS.panelLine}`,
          marginBottom: 12,
        }}
      >
        <div
          style={{
            display:
              "flex",
            alignItems:
              "center",
            justifyContent:
              "space-between",
          }}
        >
          <div
            style={{
              display:
                "flex",
              alignItems:
                "center",
              gap: 8,
            }}
          >
            <Zap
              size={17}
              color={
                COLORS.chrome
              }
            />

            <span
              style={{
                fontFamily:
                  FONT_DISPLAY,
                fontWeight: 800,
                fontSize: 16,
                color:
                  COLORS.text,
              }}
            >
              LEVEL{" "}
              {
                levelInfo.level
              }
            </span>
          </div>

          <span
            style={{
              fontFamily:
                FONT_MONO,
              fontSize: 10,
              color:
                COLORS.chrome,
              fontWeight: 700,
            }}
          >
            {
              formatMultiplier(
                levelInfo.multiplier
              )
            }
          </span>
        </div>

        <div
          style={{
            height: 7,
            borderRadius: 4,
            background:
              COLORS.void,
            marginTop: 10,
            overflow:
              "hidden",
          }}
        >
          <motion.div
            animate={{
              width: `${
                levelInfo.progressPct *
                100
              }%`,
            }}
            style={{
              height:
                "100%",
              background:
                COLORS.chrome,
            }}
          />
        </div>

        <div
          style={{
            display:
              "flex",
            justifyContent:
              "space-between",
            marginTop: 6,
            fontFamily:
              FONT_MONO,
            fontSize: 9,
            color:
              COLORS.textMuted,
          }}
        >
          <span>
            {
              levelInfo.xpIntoLevel
            }{" "}
            /{" "}
            {
              levelInfo.xpForNextLevel
            } kills
          </span>

          <span>
            {
              nextLevelKills
            } to next
          </span>
        </div>

        <div
          style={{
            marginTop: 14,
            padding:
              "10px 11px",
            borderRadius: 5,
            background:
              COLORS.void,
            fontFamily:
              FONT_MONO,
            fontSize: 9.5,
            lineHeight:
              1.5,
            color:
              COLORS.textMuted,
          }}
        >
          <span
            style={{
              color:
                COLORS.chrome,
              fontWeight: 700,
            }}
          >
            +2 DAYS
          </span>{" "}
          productivity represented
          by every level.
          <br />
          Next level:
          {" "}
          <span
            style={{
              color:
                COLORS.text,
            }}
          >
            {
              formatMultiplier(
                levelInfo.nextMultiplier
              )}
          </span>{" "}
          power.
        </div>
      </div>

      {/* ================================================================
          THE HOOK
      ================================================================= */}

      <div
        style={{
          padding:
            "15px 16px",
          borderRadius: 6,
          background:
            COLORS.panel,
          border: `1px solid ${COLORS.panelLine}`,
          marginBottom: 12,
        }}
      >
        <div
          style={{
            display:
              "flex",
            alignItems:
              "center",
            gap: 8,
          }}
        >
          <Sparkles
            size={16}
            color={
              COLORS.chrome
            }
          />

          <span
            style={{
              fontFamily:
                FONT_DISPLAY,
              fontSize: 14,
              fontWeight: 800,
              color:
                COLORS.text,
            }}
          >
            WHAT&apos;S NEXT?
          </span>
        </div>

        <div
          style={{
            fontFamily:
              FONT_MONO,
            fontSize: 10,
            lineHeight:
              1.6,
            color:
              COLORS.textMuted,
            marginTop: 7,
          }}
        >
          Every challenge reveals
          another.
          <br />
          You never know exactly
          what the next run contains.
        </div>

        <div
          style={{
            display:
              "flex",
            alignItems:
              "center",
            gap: 7,
            marginTop: 10,
            fontFamily:
              FONT_MONO,
            fontSize: 9.5,
            color:
              COLORS.chrome,
          }}
        >
          <Target size={12} />
          I WONDER IF I CAN...
        </div>
      </div>

      {/* ================================================================
          STATS
      ================================================================= */}

      <div
        style={{
          display:
            "grid",
          gridTemplateColumns:
            "1fr 1fr",
          gap: 10,
          marginBottom:
            12,
        }}
      >
        <StatCard
          icon={
            <Trophy
              size={17}
              color={
                COLORS.chrome
              }
            />
          }
          value={
            state.personalBest >
            0
              ? formatPoints(
                  state.personalBest
                )
              : "—"
          }
          label="PERSONAL BEST"
        />

        <StatCard
          icon={
            <Flame
              size={17}
              color={
                COLORS.chrome
              }
            />
          }
          value={
            state.bestCombo
              ? `${state.bestCombo}×`
              : "—"
          }
          label="BEST COMBO"
        />
      </div>

      {/* ================================================================
          DAILY PROGRESS
      ================================================================= */}

      {hasProgressToday && (
        <div
          style={{
            display:
              "flex",
            justifyContent:
              "space-between",
            padding:
              "10px 12px",
            marginBottom:
              10,
            borderRadius: 5,
            background:
              COLORS.panel,
            border: `1px solid ${COLORS.panelLine}`,
            fontFamily:
              FONT_MONO,
            fontSize: 9.5,
            color:
              COLORS.textMuted,
          }}
        >
          <span>
            TODAY
          </span>

          <span
            style={{
              color:
                COLORS.text,
            }}
          >
            {formatPoints(
              state.scoreToday
            )}{" "}
            points
          </span>

          <span
            style={{
              color:
                COLORS.chrome,
            }}
          >
            {
              state.challengesCompletedToday
            }{" "}
            challenges
          </span>
        </div>
      )}

      {/* ================================================================
          START
      ================================================================= */}

      <button
        onClick={
          onStart
        }
        disabled={!hydrated}
        style={{
          display:
            "flex",
          alignItems:
            "center",
          justifyContent:
            "center",
          gap: 8,
          width:
            "100%",
          padding:
            "14px 0",
          borderRadius: 4,
          border: "none",
          background:
            COLORS.chrome,
          color:
            COLORS.void,
          fontFamily:
            FONT_DISPLAY,
          fontWeight: 800,
          fontSize: 13,
          letterSpacing:
            0.8,
          textTransform:
            "uppercase",
          cursor:
            hydrated
              ? "pointer"
              : "default",
          opacity:
            hydrated
              ? 1
              : 0.6,
        }}
      >
        <Play
          size={14}
        />

        {hasProgressToday
          ? "Continue Run"
          : "Start Run"}
      </button>

      <div
        style={{
          textAlign:
            "center",
          fontFamily:
            FONT_MONO,
          fontSize: 8.5,
          color:
            COLORS.textMuted,
          marginTop: 9,
        }}
      >
        There&apos;s always
        another one.
      </div>
    </div>
  );
}

// ============================================================================
// STAT CARD
// ============================================================================

function StatCard({
  icon,
  value,
  label,
}: {
  icon: ReactNode;
  value: string;
  label: string;
}) {
  return (
    <div
      style={{
        padding:
          "12px",
        borderRadius: 6,
        background:
          COLORS.panel,
        border: `1px solid ${COLORS.panelLine}`,
      }}
    >
      <div
        style={{
          display:
            "flex",
          alignItems:
            "center",
          gap: 7,
        }}
      >
        {icon}

        <span
          style={{
            fontFamily:
              FONT_MONO,
            fontSize: 8,
            color:
              COLORS.textMuted,
            letterSpacing:
              0.7,
          }}
        >
          {label}
        </span>
      </div>

      <div
        style={{
          fontFamily:
            FONT_MONO,
          fontSize: 17,
          fontWeight: 800,
          color:
            COLORS.text,
          marginTop: 7,
        }}
      >
        {value}
      </div>
    </div>
  );
}
