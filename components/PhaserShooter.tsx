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
  Sparkles,
  HelpCircle,
  FlaskConical,
  Lock,
  Eye,
  RotateCcw,
  ArrowRight,
  Star,
  Shuffle,
  Search,
} from "lucide-react";

import { COLORS, FONT_DISPLAY, FONT_MONO } from "@/lib/theme";

type Phase = "menu" | "playing";

interface PhaserShooterProps {
  lifetimeKills: number;
  onExit: () => void;
}

// ============================================================================
// LEVEL
// ============================================================================
//
// 521 lifetime kills = 1 level.
// 1 level = 2 days of productivity.
//
// The level does NOT dictate the exact answer.
// It increases the size of the possibility space.
//
// More productivity = more powerful experiments.
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
}

function levelFromLifetimeKills(
  lifetimeKills: number
): LevelInfo {
  const kills = Math.max(
    0,
    Math.floor(lifetimeKills)
  );

  const level =
    Math.floor(
      kills / KILLS_PER_LEVEL
    ) + 1;

  const xpIntoLevel =
    kills % KILLS_PER_LEVEL;

  const multiplier = Math.pow(
    LEVEL_GROWTH,
    level - 1
  );

  return {
    level,
    xpIntoLevel,
    xpForNextLevel:
      KILLS_PER_LEVEL,
    progressPct:
      xpIntoLevel /
      KILLS_PER_LEVEL,
    multiplier,
  };
}

// ============================================================================
// TYPES
// ============================================================================

type ActionId =
  | "inspect"
  | "touch"
  | "wait"
  | "combine"
  | "reverse"
  | "remove"
  | "repeat"
  | "follow";

interface Action {
  id: ActionId;
  label: string;
  description: string;
  icon: ReactNode;
}

interface Experiment {
  id: string;
  title: string;
  question: string;
  object: string;
  atmosphere: string;
  actions: Action[];
}

interface Result {
  title: string;
  text: string;
  rarity: "common" | "rare" | "strange" | "unknown";
  points: number;
  discovered: boolean;
  clue?: string;
}

interface GameState {
  lastPlayDate: string;

  points: number;
  discoveries: number;

  experimentsToday: number;
  bestExperimentScore: number;

  currentExperimentId: string;
  history: string[];

  discoveredResults: string[];

  personalBest: number;
  targetBest: number;
}

// ============================================================================
// EXPERIMENTS
// ============================================================================
//
// The important part:
//
// There is NO single obvious optimal button.
//
// The player is encouraged to ask:
//
// "What happens if I inspect it first?"
// "What if I wait?"
// "What if I reverse what I just did?"
// "What if I combine them?"
// "What happens if I do the weird thing?"
//
// ============================================================================

const EXPERIMENTS: Experiment[] = [
  {
    id: "red-box",
    title: "THE RED BOX",
    question:
      "What happens if you don't open it immediately?",
    object:
      "A small red box is sitting in the middle of an empty room.",
    atmosphere:
      "It is warm. You don't remember putting it there.",
    actions: [
      {
        id: "inspect",
        label: "Inspect",
        description:
          "Look closely before touching it.",
        icon: <Eye size={15} />,
      },
      {
        id: "touch",
        label: "Touch",
        description:
          "Put your hand on the box.",
        icon: <Search size={15} />,
      },
      {
        id: "wait",
        label: "Wait",
        description:
          "Do absolutely nothing.",
        icon: <Sparkles size={15} />,
      },
      {
        id: "reverse",
        label: "Walk away",
        description:
          "Leave the box alone.",
        icon: <ArrowRight size={15} />,
      },
    ],
  },

  {
    id: "three-switches",
    title: "THREE SWITCHES",
    question:
      "Only one combination does something. Which?",
    object:
      "Three switches sit beneath a completely dark screen.",
    atmosphere:
      "There are no instructions.",
    actions: [
      {
        id: "inspect",
        label: "Inspect",
        description:
          "Look for a clue.",
        icon: <Eye size={15} />,
      },
      {
        id: "touch",
        label: "Switch 1",
        description:
          "Flip the first switch.",
        icon: <Zap size={15} />,
      },
      {
        id: "combine",
        label: "Switch 2 + 3",
        description:
          "Try two at once.",
        icon: <Shuffle size={15} />,
      },
      {
        id: "wait",
        label: "Wait",
        description:
          "See whether something happens.",
        icon: <Sparkles size={15} />,
      },
    ],
  },

  {
    id: "glass-orb",
    title: "THE GLASS ORB",
    question:
      "Why does it react differently every time?",
    object:
      "A transparent orb floats a few centimeters above the floor.",
    atmosphere:
      "It changes color when you approach.",
    actions: [
      {
        id: "touch",
        label: "Touch",
        description:
          "Touch the surface.",
        icon: <Search size={15} />,
      },
      {
        id: "inspect",
        label: "Observe",
        description:
          "Watch it carefully.",
        icon: <Eye size={15} />,
      },
      {
        id: "wait",
        label: "Wait",
        description:
          "Give it time.",
        icon: <Sparkles size={15} />,
      },
      {
        id: "reverse",
        label: "Back away",
        description:
          "Move away from it.",
        icon: <ArrowRight size={15} />,
      },
    ],
  },

  {
    id: "locked-door",
    title: "THE LOCKED DOOR",
    question:
      "There is no key. So what opens it?",
    object:
      "A completely ordinary door has no handle and no visible lock.",
    atmosphere:
      "Something is moving behind it.",
    actions: [
      {
        id: "inspect",
        label: "Inspect",
        description:
          "Study the door.",
        icon: <Eye size={15} />,
      },
      {
        id: "touch",
        label: "Knock",
        description:
          "Knock three times.",
        icon: <Search size={15} />,
      },
      {
        id: "wait",
        label: "Listen",
        description:
          "Stand completely still.",
        icon: <Sparkles size={15} />,
      },
      {
        id: "remove",
        label: "Remove",
        description:
          "Try something unexpected.",
        icon: <FlaskConical size={15} />,
      },
    ],
  },

  {
    id: "machine",
    title: "THE MACHINE",
    question:
      "It has one button. But what does the button do?",
    object:
      "A strange machine hums quietly.",
    atmosphere:
      "The display reads: 'ARE YOU SURE?'",
    actions: [
      {
        id: "touch",
        label: "Press",
        description:
          "Press the button.",
        icon: <Zap size={15} />,
      },
      {
        id: "inspect",
        label: "Inspect",
        description:
          "Search the machine.",
        icon: <Eye size={15} />,
      },
      {
        id: "wait",
        label: "Wait",
        description:
          "Don't press anything.",
        icon: <Sparkles size={15} />,
      },
      {
        id: "reverse",
        label: "Unplug",
        description:
          "Try the opposite.",
        icon: <ArrowRight size={15} />,
      },
    ],
  },

  {
    id: "black-hole",
    title: "THE BLACK DOT",
    question:
      "What happens if you get closer?",
    object:
      "A perfectly black dot floats in the air.",
    atmosphere:
      "It appears to be much deeper than the room.",
    actions: [
      {
        id: "inspect",
        label: "Study",
        description:
          "Try to understand it.",
        icon: <Eye size={15} />,
      },
      {
        id: "touch",
        label: "Touch",
        description:
          "Reach toward it.",
        icon: <Search size={15} />,
      },
      {
        id: "wait",
        label: "Wait",
        description:
          "Let it change.",
        icon: <Sparkles size={15} />,
      },
      {
        id: "follow",
        label: "Enter",
        description:
          "Stop being cautious.",
        icon: <ArrowRight size={15} />,
      },
    ],
  },
];

// ============================================================================
// RESULT ENGINE
// ============================================================================
//
// Results are intentionally partly deterministic and partly surprising.
//
// Same experiment + same action can produce different outcomes.
//
// But previous actions also influence the hidden result.
//
// That creates:
//
// "I got THIS last time..."
// "What if I do something different?"
//
// ============================================================================

const RESULT_TITLES = [
  "Nothing happened.",
  "Something moved.",
  "You found a hidden mechanism.",
  "That wasn't supposed to happen.",
  "It reacted to you.",
  "You discovered a pattern.",
  "The room changed.",
  "You found something behind it.",
  "It remembered your last move.",
  "You discovered a secret.",
];

function hashString(value: string): number {
  let hash = 0;

  for (
    let i = 0;
    i < value.length;
    i++
  ) {
    hash =
      (hash << 5) -
      hash +
      value.charCodeAt(i);

    hash |= 0;
  }

  return Math.abs(hash);
}

function generateResult(
  experiment: Experiment,
  action: ActionId,
  history: string[],
  levelInfo: LevelInfo
): Result {
  const previous =
    history.length > 0
      ? history[
          history.length - 1
        ]
      : "none";

  const seed =
    hashString(
      `${experiment.id}:${action}:${previous}:${history.length}:${Math.floor(
        Math.random() * 7
      )}`
    );

  const roll =
    seed % 100;

  let rarity:
    | "common"
    | "rare"
    | "strange"
    | "unknown";

  if (roll < 50) {
    rarity = "common";
  } else if (roll < 78) {
    rarity = "rare";
  } else if (roll < 94) {
    rarity = "strange";
  } else {
    rarity = "unknown";
  }

  const actionResults: Record<
    ActionId,
    string[]
  > = {
    inspect: [
      "You notice a tiny detail that wasn't obvious before.",
      "There is a pattern hidden in the surface.",
      "You realize the object has been reacting to you.",
      "Something changes when you stop looking directly at it.",
    ],

    touch: [
      "The object becomes slightly warmer.",
      "You feel a tiny vibration.",
      "Something responds from the other side.",
      "The object changes state.",
    ],

    wait: [
      "Nothing happens... for now.",
      "After a few seconds, something moves.",
      "The silence itself seems to be part of the experiment.",
      "You notice something you would have missed by acting.",
    ],

    combine: [
      "The two actions interact unexpectedly.",
      "The machine enters a new state.",
      "Something that was invisible becomes visible.",
      "You accidentally discovered a combination.",
    ],

    reverse: [
      "The object reacts to you leaving.",
      "Going backward reveals something new.",
      "The system seems to prefer the opposite action.",
      "You discover that retreat was actually progress.",
    ],

    remove: [
      "You find something hidden underneath.",
      "Removing one thing changes everything else.",
      "The object was hiding a second mechanism.",
      "You found the simplest solution.",
    ],

    repeat: [
      "It behaves differently the second time.",
      "The result changes.",
      "It seems to remember what you did.",
      "Repeating the experiment reveals a new state.",
    ],

    follow: [
      "You follow the strange signal.",
      "The path changes as you move.",
      "You discover something completely unexpected.",
      "There was another room all along.",
    ],
  };

  const options =
    actionResults[action];

  const text =
    options[
      seed % options.length
    ];

  const title =
    rarity === "unknown"
      ? "???"
      : RESULT_TITLES[
          seed %
            RESULT_TITLES.length
        ];

  const basePoints =
    rarity === "common"
      ? 10
      : rarity === "rare"
        ? 30
        : rarity === "strange"
          ? 75
          : 200;

  const points = Math.max(
    1,
    Math.round(
      basePoints *
        levelInfo.multiplier
    )
  );

  const discovered =
    rarity !== "common" ||
    roll > 35;

  const clue =
    rarity === "unknown"
      ? "There is more here than you can currently see."
      : rarity === "strange"
        ? "Try a different action next time."
        : undefined;

  return {
    title,
    text,
    rarity,
    points,
    discovered,
    clue,
  };
}

// ============================================================================
// STORAGE
// ============================================================================

const STORAGE_KEY =
  "curiosity_game_state_v1";

function todayKey(): string {
  return new Date().toDateString();
}

function defaultState(
  carry?: {
    personalBest: number;
    targetBest: number;
  }
): GameState {
  const experiment =
    EXPERIMENTS[
      Math.floor(
        Math.random() *
          EXPERIMENTS.length
      )
    ];

  return {
    lastPlayDate:
      todayKey(),

    points: 0,
    discoveries: 0,

    experimentsToday: 0,
    bestExperimentScore: 0,

    currentExperimentId:
      experiment.id,

    history: [],

    discoveredResults: [],

    personalBest:
      carry?.personalBest ??
      0,

    targetBest:
      carry?.targetBest ??
      0,
  };
}

function loadState(): GameState {
  if (
    typeof window ===
    "undefined"
  ) {
    return defaultState();
  }

  try {
    const raw =
      window.localStorage.getItem(
        STORAGE_KEY
      );

    if (!raw) {
      return defaultState();
    }

    const parsed =
      JSON.parse(raw) as Partial<GameState>;

    if (
      parsed.lastPlayDate !==
      todayKey()
    ) {
      return defaultState({
        personalBest:
          parsed.personalBest ??
          0,
        targetBest:
          parsed.personalBest ??
          0,
      });
    }

    return {
      ...defaultState(),
      ...parsed,
      lastPlayDate:
        todayKey(),
    };
  } catch {
    return defaultState();
  }
}

function saveState(
  state: GameState
) {
  if (
    typeof window ===
    "undefined"
  ) {
    return;
  }

  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(state)
    );
  } catch {
    // Ignore storage failures.
  }
}

// ============================================================================
// FORMATTING
// ============================================================================

function formatPoints(
  n: number
): string {
  if (n < 1000) {
    return Math.round(n).toString();
  }

  return new Intl.NumberFormat(
    "en-US",
    {
      notation: "compact",
      maximumFractionDigits: 2,
    }
  ).format(Math.round(n));
}

function formatCountdown(
  ms: number
): string {
  const totalMinutes =
    Math.max(
      0,
      Math.floor(
        ms / 60000
      )
    );

  const h =
    Math.floor(
      totalMinutes / 60
    );

  const m =
    totalMinutes % 60;

  return `${h}h ${m
    .toString()
    .padStart(2, "0")}m`;
}

function getExperiment(
  id: string
): Experiment {
  return (
    EXPERIMENTS.find(
      (experiment) =>
        experiment.id === id
    ) ??
    EXPERIMENTS[0]
  );
}

// ============================================================================
// MAIN
// ============================================================================

export default function PhaserShooter({
  lifetimeKills,
  onExit,
}: PhaserShooterProps) {
  const [phase, setPhase] =
    useState<Phase>("menu");

  const [state, setState] =
    useState<GameState>(() =>
      defaultState()
    );

  const [hydrated, setHydrated] =
    useState(false);

  const [now, setNow] =
    useState(() =>
      Date.now()
    );

  const [result, setResult] =
    useState<Result | null>(
      null
    );

  const [thinking, setThinking] =
    useState(false);

  const [revealed, setRevealed] =
    useState(false);

  const resultTimer =
    useRef<
      ReturnType<
        typeof setTimeout
      > | null
    >(null);

  const levelInfo =
    useMemo(
      () =>
        levelFromLifetimeKills(
          lifetimeKills
        ),
      [lifetimeKills]
    );

  const experiment =
    useMemo(
      () =>
        getExperiment(
          state.currentExperimentId
        ),
      [state.currentExperimentId]
    );

  // ========================================================================
  // LOAD
  // ========================================================================

  useEffect(() => {
    setState(loadState());
    setHydrated(true);
  }, []);

  // ========================================================================
  // SAVE
  // ========================================================================

  useEffect(() => {
    if (!hydrated) return;

    saveState(state);
  }, [
    state,
    hydrated,
  ]);

  // ========================================================================
  // CLOCK
  // ========================================================================

  useEffect(() => {
    const id =
      setInterval(
        () =>
          setNow(
            Date.now()
          ),
        30_000
      );

    return () =>
      clearInterval(id);
  }, []);

  // ========================================================================
  // DAILY RESET
  // ========================================================================

  useEffect(() => {
    setState(
      (previous) => {
        if (
          previous.lastPlayDate ===
          todayKey()
        ) {
          return previous;
        }

        return defaultState({
          personalBest:
            previous.personalBest,
          targetBest:
            previous.personalBest,
        });
      }
    );
  }, [now]);

  // ========================================================================
  // CLEANUP
  // ========================================================================

  useEffect(() => {
    return () => {
      if (
        resultTimer.current
      ) {
        clearTimeout(
          resultTimer.current
        );
      }
    };
  }, []);

  // ========================================================================
  // RESET EXPERIMENT
  // ========================================================================

  const nextExperiment =
    useCallback(() => {
      const available =
        EXPERIMENTS.filter(
          (item) =>
            item.id !==
            state.currentExperimentId
        );

      const next =
        available[
          Math.floor(
            Math.random() *
              available.length
          )
        ];

      setResult(null);
      setRevealed(false);

      setState(
        (previous) => ({
          ...previous,
          currentExperimentId:
            next.id,
          history: [],
        })
      );
    }, [
      state.currentExperimentId,
    ]);

  // ========================================================================
  // TRY ACTION
  // ========================================================================

  const tryAction =
    useCallback(
      (actionId: ActionId) => {
        if (
          thinking ||
          revealed
        ) {
          return;
        }

        setThinking(true);

        const generated =
          generateResult(
            experiment,
            actionId,
            state.history,
            levelInfo
          );

        const historyKey =
          `${experiment.id}:${actionId}:${generated.title}`;

        setState(
          (previous) => {
            const newPoints =
              previous.points +
              generated.points;

            const personalBest =
              Math.max(
                previous.personalBest,
                newPoints
              );

            return {
              ...previous,

              points:
                newPoints,

              personalBest,

              experimentsToday:
                previous.experimentsToday +
                1,

              bestExperimentScore:
                Math.max(
                  previous.bestExperimentScore,
                  generated.points
                ),

              discoveries:
                previous.discoveries +
                (generated.discovered
                  ? 1
                  : 0),

              history: [
                ...previous.history,
                historyKey,
              ],

              discoveredResults:
                generated.discovered
                  ? [
                      ...previous.discoveredResults,
                      historyKey,
                    ]
                  : previous.discoveredResults,
            };
          }
        );

        resultTimer.current =
          setTimeout(
            () => {
              setResult(
                generated
              );
              setThinking(false);
              setRevealed(true);
            },
            450 +
              Math.random() *
                700
          );
      },
      [
        thinking,
        revealed,
        experiment,
        state.history,
        levelInfo,
      ]
    );

  // ========================================================================
  // RESET CURRENT EXPERIMENT
  // ========================================================================

  const restartExperiment =
    useCallback(() => {
      setResult(null);
      setRevealed(false);
      setThinking(false);

      setState(
        (previous) => ({
          ...previous,
          history: [],
        })
      );
    }, []);

  // ========================================================================
  // EXIT
  // ========================================================================

  const start =
    useCallback(
      () =>
        setPhase(
          "playing"
        ),
      []
    );

  const back =
    useCallback(
      () =>
        setPhase("menu"),
      []
    );

  // ========================================================================
  // RESET TIMER
  // ========================================================================

  const msUntilReset =
    useMemo(() => {
      const next =
        new Date();

      next.setHours(
        24,
        0,
        0,
        0
      );

      return (
        next.getTime() -
        now
      );
    }, [now]);

  // ========================================================================
  // RENDER
  // ========================================================================

  return (
    <div
      style={{
        position:
          "relative",
      }}
    >
      <AnimatePresence mode="wait">
        {phase === "menu" && (
          <motion.div
            key="menu"
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
              levelInfo={
                levelInfo
              }
              state={state}
              hydrated={
                hydrated
              }
              onStart={start}
            />
          </motion.div>
        )}

        {phase === "playing" && (
          <motion.div
            key="playing"
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
            {/* ============================================================
                HEADER
            ============================================================= */}

            <div
              style={{
                display:
                  "flex",
                alignItems:
                  "center",
                justifyContent:
                  "space-between",
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  display:
                    "flex",
                  alignItems:
                    "center",
                  gap: 6,
                }}
              >
                <FlaskConical
                  size={14}
                  color={
                    COLORS.chrome
                  }
                />

                <span
                  style={{
                    fontFamily:
                      FONT_MONO,
                    fontSize: 10,
                    color:
                      COLORS.textMuted,
                  }}
                >
                  LAB
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
                  LV{" "}
                  {
                    levelInfo.level
                  }
                </span>
              </div>

              <div
                style={{
                  fontFamily:
                    FONT_MONO,
                  fontSize: 9,
                  color:
                    COLORS.textMuted,
                }}
              >
                RESET{" "}
                {
                  formatCountdown(
                    msUntilReset
                  )
                }
              </div>

              <button
                onClick={back}
                style={{
                  width: 30,
                  height: 30,
                  display:
                    "flex",
                  alignItems:
                    "center",
                  justifyContent:
                    "center",
                  borderRadius: 5,
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

            {/* ============================================================
                CURIOSITY HEADER
            ============================================================= */}

            <div
              style={{
                padding:
                  "17px 16px",
                borderRadius: 7,
                background:
                  COLORS.panel,
                border: `1px solid ${COLORS.panelLine}`,
                marginBottom: 10,
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
                    FONT_MONO,
                  fontSize: 9,
                  color:
                    COLORS.chrome,
                  letterSpacing:
                    1.3,
                }}
              >
                <HelpCircle
                  size={13}
                />

                YOU DON&apos;T
                KNOW YET
              </div>

              <div
                style={{
                  fontFamily:
                    FONT_DISPLAY,
                  fontSize: 21,
                  fontWeight: 800,
                  color:
                    COLORS.text,
                  marginTop: 6,
                }}
              >
                {
                  experiment.title
                }
              </div>

              <div
                style={{
                  fontFamily:
                    FONT_MONO,
                  fontSize: 11,
                  color:
                    COLORS.textMuted,
                  marginTop: 6,
                  lineHeight:
                    1.5,
                }}
              >
                {
                  experiment.question
                }
              </div>
            </div>

            {/* ============================================================
                SCENE
            ============================================================= */}

            <motion.div
              key={
                experiment.id
              }
              initial={{
                opacity: 0,
                scale: 0.98,
              }}
              animate={{
                opacity: 1,
                scale: 1,
              }}
              style={{
                minHeight: 145,
                padding:
                  "18px 16px",
                borderRadius: 7,
                background:
                  COLORS.void,
                border: `1px solid ${COLORS.panelLine}`,
                marginBottom: 10,
                display:
                  "flex",
                flexDirection:
                  "column",
                justifyContent:
                  "center",
              }}
            >
              <div
                style={{
                  fontFamily:
                    FONT_DISPLAY,
                  fontSize: 17,
                  fontWeight: 700,
                  color:
                    COLORS.text,
                  lineHeight:
                    1.4,
                }}
              >
                {
                  experiment.object
                }
              </div>

              <div
                style={{
                  fontFamily:
                    FONT_MONO,
                  fontSize: 10,
                  color:
                    COLORS.textMuted,
                  marginTop: 9,
                  lineHeight:
                    1.5,
                }}
              >
                {
                  experiment.atmosphere
                }
              </div>

              <div
                style={{
                  marginTop: 14,
                  display:
                    "flex",
                  alignItems:
                    "center",
                  gap: 6,
                  fontFamily:
                    FONT_MONO,
                  fontSize: 9,
                  color:
                    COLORS.textMuted,
                }}
              >
                <Sparkles
                  size={11}
                />
                There may be
                more than one
                answer.
              </div>
            </motion.div>

            {/* ============================================================
                RESULT
            ============================================================= */}

            <AnimatePresence mode="wait">
              {thinking && (
                <motion.div
                  key="thinking"
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
                    padding:
                      "18px",
                    textAlign:
                      "center",
                    borderRadius: 7,
                    background:
                      COLORS.panel,
                    border: `1px solid ${COLORS.panelLine}`,
                    marginBottom: 10,
                  }}
                >
                  <motion.div
                    animate={{
                      rotate: 360,
                    }}
                    transition={{
                      duration: 1,
                      repeat:
                        Infinity,
                      ease:
                        "linear",
                    }}
                    style={{
                      width: 28,
                      height: 28,
                      margin:
                        "0 auto 8px",
                      display:
                        "flex",
                      alignItems:
                        "center",
                      justifyContent:
                        "center",
                    }}
                  >
                    <Shuffle
                      size={20}
                      color={
                        COLORS.chrome
                      }
                    />
                  </motion.div>

                  <div
                    style={{
                      fontFamily:
                        FONT_MONO,
                      fontSize: 10,
                      color:
                        COLORS.textMuted,
                    }}
                  >
                    SEEING WHAT
                    HAPPENS...
                  </div>
                </motion.div>
              )}

              {result &&
                revealed && (
                  <motion.div
                    key="result"
                    initial={{
                      opacity: 0,
                      y: 10,
                    }}
                    animate={{
                      opacity: 1,
                      y: 0,
                    }}
                    style={{
                      padding:
                        "17px 16px",
                      borderRadius: 7,
                      background:
                        COLORS.panel,
                      border: `1px solid ${
                        result.rarity ===
                        "unknown"
                          ? COLORS.chrome
                          : COLORS.panelLine
                      }`,
                      marginBottom: 10,
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
                          fontFamily:
                            FONT_MONO,
                          fontSize: 9,
                          color:
                            COLORS.chrome,
                          letterSpacing:
                            1.2,
                        }}
                      >
                        {
                          result.rarity.toUpperCase()
                        }{" "}
                        RESULT
                      </div>

                      <div
                        style={{
                          fontFamily:
                            FONT_MONO,
                          fontSize: 11,
                          fontWeight: 700,
                          color:
                            COLORS.chrome,
                        }}
                      >
                        +
                        {formatPoints(
                          result.points
                        )}
                      </div>
                    </div>

                    <div
                      style={{
                        fontFamily:
                          FONT_DISPLAY,
                        fontSize: 18,
                        fontWeight: 800,
                        color:
                          COLORS.text,
                        marginTop: 7,
                      }}
                    >
                      {
                        result.title
                      }
                    </div>

                    <div
                      style={{
                        fontFamily:
                          FONT_MONO,
                        fontSize: 10.5,
                        lineHeight:
                          1.55,
                        color:
                          COLORS.textMuted,
                        marginTop: 6,
                      }}
                    >
                      {
                        result.text
                      }
                    </div>

                    {result.clue && (
                      <div
                        style={{
                          marginTop: 11,
                          padding:
                            "9px 10px",
                          borderRadius: 5,
                          background:
                            COLORS.void,
                          fontFamily:
                            FONT_MONO,
                          fontSize: 9,
                          color:
                            COLORS.chrome,
                          lineHeight:
                            1.5,
                        }}
                      >
                        <Sparkles
                          size={11}
                          style={{
                            verticalAlign:
                              "middle",
                            marginRight:
                              5,
                          }}
                        />
                        {
                          result.clue
                        }
                      </div>
                    )}
                  </motion.div>
                )}
            </AnimatePresence>

            {/* ============================================================
                ACTIONS
            ============================================================= */}

            {!thinking &&
              !revealed && (
                <motion.div
                  key={
                    experiment.id
                  }
                  initial={{
                    opacity: 0,
                    y: 8,
                  }}
                  animate={{
                    opacity: 1,
                    y: 0,
                  }}
                  style={{
                    display:
                      "flex",
                    flexDirection:
                      "column",
                    gap: 8,
                  }}
                >
                  <div
                    style={{
                      fontFamily:
                        FONT_MONO,
                      fontSize: 9,
                      color:
                        COLORS.textMuted,
                      textTransform:
                        "uppercase",
                      letterSpacing:
                        1.2,
                      marginBottom: 2,
                    }}
                  >
                    What do you try?
                  </div>

                  {experiment.actions.map(
                    (
                      action,
                      index
                    ) => (
                      <motion.button
                        key={
                          action.id
                        }
                        whileTap={{
                          scale: 0.98,
                        }}
                        onClick={() =>
                          tryAction(
                            action.id
                          )
                        }
                        style={{
                          display:
                            "flex",
                          alignItems:
                            "center",
                          gap: 11,
                          padding:
                            "13px 13px",
                          borderRadius: 6,
                          border: `1px solid ${COLORS.panelLine}`,
                          background:
                            COLORS.panel,
                          color:
                            COLORS.text,
                          textAlign:
                            "left",
                          cursor:
                            "pointer",
                          width:
                            "100%",
                        }}
                      >
                        <div
                          style={{
                            width: 34,
                            height: 34,
                            borderRadius: 5,
                            display:
                              "flex",
                            alignItems:
                              "center",
                            justifyContent:
                              "center",
                            background: `${COLORS.chrome}12`,
                            color:
                              COLORS.chrome,
                            flexShrink: 0,
                          }}
                        >
                          {
                            action.icon
                          }
                        </div>

                        <div
                          style={{
                            flex: 1,
                          }}
                        >
                          <div
                            style={{
                              fontFamily:
                                FONT_DISPLAY,
                              fontWeight: 700,
                              fontSize: 13,
                            }}
                          >
                            {
                              action.label
                            }
                          </div>

                          <div
                            style={{
                              fontFamily:
                                FONT_MONO,
                              fontSize: 9,
                              color:
                                COLORS.textMuted,
                              marginTop: 2,
                            }}
                          >
                            {
                              action.description
                            }
                          </div>
                        </div>

                        <span
                          style={{
                            fontFamily:
                              FONT_MONO,
                            fontSize: 9,
                            color:
                              COLORS.textMuted,
                          }}
                        >
                          {
                            index +
                              1
                          }
                        </span>
                      </motion.button>
                    )
                  )}
                </motion.div>
              )}

            {/* ============================================================
                AFTER RESULT
            ============================================================= */}

            {revealed &&
              !thinking && (
                <div
                  style={{
                    display:
                      "flex",
                    gap: 8,
                  }}
                >
                  <button
                    onClick={
                      restartExperiment
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
                        "12px 0",
                      borderRadius: 5,
                      border: `1px solid ${COLORS.panelLine}`,
                      background:
                        COLORS.panel,
                      color:
                        COLORS.text,
                      fontFamily:
                        FONT_MONO,
                      fontSize: 10,
                      cursor:
                        "pointer",
                    }}
                  >
                    <RotateCcw
                      size={12}
                    />
                    TRY AGAIN
                  </button>

                  <button
                    onClick={
                      nextExperiment
                    }
                    style={{
                      flex: 1.5,
                      display:
                        "flex",
                      alignItems:
                        "center",
                      justifyContent:
                        "center",
                      gap: 6,
                      padding:
                        "12px 0",
                      borderRadius: 5,
                      border: "none",
                      background:
                        COLORS.chrome,
                      color:
                        COLORS.void,
                      fontFamily:
                        FONT_DISPLAY,
                      fontWeight: 800,
                      fontSize: 11,
                      cursor:
                        "pointer",
                    }}
                  >
                    WHAT&apos;S NEXT?
                    <ArrowRight
                      size={13}
                    />
                  </button>
                </div>
              )}

            {/* ============================================================
                SCORE
            ============================================================= */}

            <div
              style={{
                display:
                  "flex",
                justifyContent:
                  "space-between",
                marginTop: 14,
                paddingTop: 12,
                borderTop: `1px solid ${COLORS.panelLine}`,
                fontFamily:
                  FONT_MONO,
                fontSize: 9,
                color:
                  COLORS.textMuted,
              }}
            >
              <span>
                {formatPoints(
                  state.points
                )}{" "}
                points
              </span>

              <span>
                {
                  state.discoveries
                }{" "}
                discoveries
              </span>

              <span>
                {
                  state.experimentsToday
                }{" "}
                experiments
              </span>
            </div>
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
// MENU
// ============================================================================

function MenuScreen({
  levelInfo,
  state,
  hydrated,
  onStart,
}: {
  levelInfo: LevelInfo;
  state: GameState;
  hydrated: boolean;
  onStart: () => void;
}) {
  return (
    <div>
      {/* LEVEL */}

      <div
        style={{
          padding:
            "17px 16px",
          borderRadius: 7,
          background:
            COLORS.panel,
          border: `1px solid ${COLORS.panelLine}`,
          marginBottom: 10,
        }}
      >
        <div
          style={{
            display:
              "flex",
            justifyContent:
              "space-between",
            alignItems:
              "center",
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
              size={16}
              color={
                COLORS.chrome
              }
            />

            <span
              style={{
                fontFamily:
                  FONT_DISPLAY,
                fontSize: 15,
                fontWeight: 800,
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
              levelInfo.multiplier.toFixed(
                2
              )
            }
            ×
          </span>
        </div>

        <div
          style={{
            height: 6,
            borderRadius: 3,
            background:
              COLORS.void,
            marginTop: 9,
            overflow:
              "hidden",
          }}
        >
          <div
            style={{
              height:
                "100%",
              width: `${
                levelInfo.progressPct *
                100
              }%`,
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
            marginTop: 5,
            fontFamily:
              FONT_MONO,
            fontSize: 8.5,
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
            }
          </span>

          <span>
            2 days / level
          </span>
        </div>
      </div>

      {/* CURIOSITY */}

      <div
        style={{
          padding:
            "18px 16px",
          borderRadius: 7,
          background:
            COLORS.panel,
          border: `1px solid ${COLORS.chrome}44`,
          marginBottom: 10,
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
            size={18}
            color={
              COLORS.chrome
            }
          />

          <span
            style={{
              fontFamily:
                FONT_DISPLAY,
              fontSize: 16,
              fontWeight: 800,
              color:
                COLORS.text,
            }}
          >
            I WONDER...
          </span>
        </div>

        <div
          style={{
            fontFamily:
              FONT_MONO,
            fontSize: 10,
            color:
              COLORS.textMuted,
            lineHeight:
              1.6,
            marginTop: 8,
          }}
        >
          Every experiment can
          behave differently.
          <br />
          There is no obvious
          correct button.
          <br />
          Try something and find
          out.
        </div>
      </div>

      {/* UNKNOWN PREVIEW */}

      <div
        style={{
          display:
            "flex",
          alignItems:
            "center",
          gap: 11,
          padding:
            "13px",
          borderRadius: 6,
          background:
            COLORS.void,
          border: `1px solid ${COLORS.panelLine}`,
          marginBottom: 10,
        }}
      >
        <div
          style={{
            width: 35,
            height: 35,
            borderRadius: 5,
            display:
              "flex",
            alignItems:
              "center",
            justifyContent:
              "center",
            background: `${COLORS.chrome}12`,
          }}
        >
          <Lock
            size={16}
            color={
              COLORS.chrome
            }
          />
        </div>

        <div
          style={{
            flex: 1,
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
            NEXT RESULT
          </div>

          <div
            style={{
              fontFamily:
                FONT_DISPLAY,
              fontSize: 13,
              fontWeight: 800,
              color:
                COLORS.chrome,
              marginTop: 3,
            }}
          >
            ???
          </div>
        </div>

        <Shuffle
          size={15}
          color={
            COLORS.textMuted
          }
        />
      </div>

      {/* STATS */}

      <div
        style={{
          display:
            "grid",
          gridTemplateColumns:
            "1fr 1fr 1fr",
          gap: 7,
          marginBottom: 10,
        }}
      >
        <MiniStat
          icon={
            <Trophy
              size={14}
            />
          }
          value={
            state.personalBest
              ? formatPoints(
                  state.personalBest
                )
              : "—"
          }
          label="BEST"
        />

        <MiniStat
          icon={
            <Star size={14} />
          }
          value={String(
            state.discoveries
          )}
          label="FOUND"
        />

        <MiniStat
          icon={
            <FlaskConical
              size={14}
            />
          }
          value={String(
            state.experimentsToday
          )}
          label="TRIED"
        />
      </div>

      {/* START */}

      <button
        onClick={
          onStart
        }
        disabled={
          !hydrated
        }
        style={{
          width:
            "100%",
          display:
            "flex",
          alignItems:
            "center",
          justifyContent:
            "center",
          gap: 8,
          padding:
            "14px 0",
          borderRadius: 5,
          border: "none",
          background:
            COLORS.chrome,
          color:
            COLORS.void,
          fontFamily:
            FONT_DISPLAY,
          fontSize: 13,
          fontWeight: 800,
          letterSpacing:
            0.8,
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
        ENTER THE UNKNOWN
      </button>
    </div>
  );
}

// ============================================================================
// MINI STAT
// ============================================================================

function MiniStat({
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
          "10px 8px",
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
          color:
            COLORS.chrome,
          display:
            "flex",
          justifyContent:
            "center",
        }}
      >
        {icon}
      </div>

      <div
        style={{
          fontFamily:
            FONT_MONO,
          fontSize: 13,
          fontWeight: 800,
          color:
            COLORS.text,
          marginTop: 4,
        }}
      >
        {value}
      </div>

      <div
        style={{
          fontFamily:
            FONT_MONO,
          fontSize: 7,
          color:
            COLORS.textMuted,
          marginTop: 2,
          letterSpacing:
            0.5,
        }}
      >
        {label}
      </div>
    </div>
  );
}
