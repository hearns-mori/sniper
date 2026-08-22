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

// ─────────────────────────────────────────────────────────────────────────────
// REWARDS
// ─────────────────────────────────────────────────────────────────────────────

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
                                const raw = window.localStorage.getItem(
                                    REWARD_PROGRESS_KEY
                                );

                                if (!raw) return null;

                                return JSON.parse(raw) as RewardProgress;
                            } catch {
                                return null;
                            }
                        }

                        function saveRewardProgress(progress: RewardProgress | null) {
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
                                // Ignore storage errors.
                            }
                        }

                        // ─────────────────────────────────────────────────────────────────────────────
                        // DAILY / LEADERBOARD CALCULATIONS
                        // ─────────────────────────────────────────────────────────────────────────────

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

                        function addDays(
                            timestamp: number,
                            days: number
                        ): number {
                            return timestamp + days * 24 * 60 * 60 * 1000;
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

                        function computeDailyKills(
                            sessions: KillSession[],
                            dayStart: number
                        ): number {
                            const dayEnd = dayStart + 24 * 60 * 60 * 1000;

                            return sessions.reduce((total, session) => {
                                if (
                                    session.startTime >= dayStart &&
                                    session.startTime < dayEnd
                                ) {
                                    return total + session.kills;
                                }

                                return total;
                            }, 0);
                        }

                        function getDailyKillsMap(
                            sessions: KillSession[],
                            now: number
                        ): Map<number, number> {
                            const map = new Map<number, number>();

                            const firstDay = startOfLocalDay(now);

                            for (const session of sessions) {
                                const sessionDay = startOfLocalDay(session.startTime);

                                if (sessionDay > firstDay) {
                                    continue;
                                }

                                const existing = map.get(sessionDay) ?? 0;

                                map.set(
                                    sessionDay,
                                    existing + session.kills
                                );
                            }

                            return map;
                        }

/**
 * Your ideal daily workload:
 *
 * 4 × 90-minute blocks
 * 24 × 15-minute blocks
 *
 * Total = 12 hours.
 *
 * We calculate the score as separate blocks because the whole point
 * of your system is structured blocks rather than one 12-hour grind.
 */
                        const IDEAL_90_MIN_BLOCKS = 4;
                        const IDEAL_15_MIN_BLOCKS = 24;

                        const IDEAL_MINUTES =
                            IDEAL_90_MIN_BLOCKS * 90 +
                            IDEAL_15_MIN_BLOCKS * 15;

                        const IDEAL_SELF_KILLS =
                            IDEAL_90_MIN_BLOCKS * calcKills(90 * 60 * 1000) +
                            IDEAL_15_MIN_BLOCKS * calcKills(15 * 60 * 1000);

                        function calculatePersonalBest(
                            sessions: KillSession[],
                            now: number
                        ): number {
                            const dailyMap = getDailyKillsMap(sessions, now);

                            let best = 0;

                            for (const kills of dailyMap.values()) {
                                best = Math.max(best, kills);
                            }

                            return best;
                        }

                        function calculateBestWithinDays(
                            sessions: KillSession[],
                            now: number,
                            days: number
                        ): number {
                            const today = startOfLocalDay(now);

                            const earliest =
                                today - (days - 1) * 24 * 60 * 60 * 1000;

                            const dailyMap = getDailyKillsMap(sessions, now);

                            let best = 0;

                            for (const [day, kills] of dailyMap.entries()) {
                                if (day >= earliest && day <= today) {
                                    best = Math.max(best, kills);
                                }
                            }

                            return best;
                        }

                        function calculateYesterday(
                            sessions: KillSession[],
                            now: number
                        ): number {
                            const yesterday = addDays(
                                startOfLocalDay(now),
                                -1
                            );

                            return computeDailyKills(
                                sessions,
                                yesterday
                            );
                        }

                        function calculateThirtyDayAverage(
                            sessions: KillSession[],
                            now: number
                        ): number {
                            const today = startOfLocalDay(now);

                            let total = 0;

                            /*
                             * Average over the complete 30-calendar-day window,
                             * including zero-productivity days.
                             *
                             * This makes the metric a true daily consistency metric.
                             */
                            for (let i = 0; i < 30; i++) {
                                const day = addDays(today, -i);

                                total += computeDailyKills(
                                    sessions,
                                    day
                                );
                            }

                            return Math.round(total / 30);
                        }

                        // ─────────────────────────────────────────────────────────────────────────────
                        // LEADERBOARD
                        // ─────────────────────────────────────────────────────────────────────────────

                        type LeaderboardEntry = {
                            id: string;
                            name: string;
                            subtitle: string;
                            kills: number;
                            isYou: boolean;
                            isIdeal?: boolean;
                        };

                        function rankColor(rank: number): string {
                            if (rank === 1) return COLORS.chrome;
                            if (rank === 2) return "#c7d0c6";
                            if (rank === 3) return "#b98a52";

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

                        // ─────────────────────────────────────────────────────────────────────────────
                        // COMPONENT
                        // ─────────────────────────────────────────────────────────────────────────────

                        export default function SniperGame() {
                            const [ready, setReady] = useState(false);

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
                                useState<ActiveSession | null>(null);

                            const [elapsedMs, setElapsedMs] =
                                useState(0);

                            const [result, setResult] =
                                useState<ResultData | null>(null);

                            const [rewards, setRewards] =
                                useState<RewardItem[]>([]);

                            const [heartbeat, setHeartbeat] =
                                useState(0);

                            const intervalRef =
                                useRef<ReturnType<typeof setInterval> | null>(
                                    null
                            );

                            const rewardProgressRef =
                                useRef<RewardProgress | null>(null);

                            // ─────────────────────────────────────────────────────────────────────────
                            // REWARD MINUTE GRANTING
                            // ─────────────────────────────────────────────────────────────────────────

                            const grantMinuteRewards = useCallback(
                                (
                                    elapsed: number,
                                    category: Category
                                ) => {
                                    const progress =
                                        rewardProgressRef.current;

                                    if (!progress) return;

                                    const currentMinute =
                                        Math.floor(elapsed / 60000);

                                    if (
                                        currentMinute <=
                                        progress.lastMinute
                                    ) {
                                        return;
                                    }

                                    const minted: RewardItem[] = [];

                                    for (
                                        let minute =
                                        progress.lastMinute + 1;
                                    minute <= currentMinute;
                                    minute++
                                    ) {
                                        minted.push({
                                            id: `${progress.startTime}-${minute}`,
                                            code: generateRewardCode(),
                                            category,
                                            earnedAt:
                                                progress.startTime +
                                                minute * 60000,
                                        });
                                    }

                                    setRewards((previous) => {
                                        const next = [
                                            ...minted,
                                            ...previous,
                                        ];

                                        saveRewards(next);

                                        return next;
                                    });

                                    const updated: RewardProgress = {
                                        startTime:
                                            progress.startTime,
                                        lastMinute: currentMinute,
                                    };

                                    rewardProgressRef.current =
                                        updated;

                                    saveRewardProgress(updated);
                                },
                                []
                            );

                            // ─────────────────────────────────────────────────────────────────────────
                            // INITIAL LOAD
                            // ─────────────────────────────────────────────────────────────────────────

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

                                            saveRewardProgress(progress);

                                            grantMinuteRewards(
                                                elapsed,
                                                activeSession.category
                                            );
                                }

                                setReady(true);
                            }, [grantMinuteRewards]);

                            // ─────────────────────────────────────────────────────────────────────────
                            // ACTIVE SESSION TIMER
                            // ─────────────────────────────────────────────────────────────────────────

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

                            // ─────────────────────────────────────────────────────────────────────────
                            // LEADERBOARD REFRESH
                            // ─────────────────────────────────────────────────────────────────────────

                            useEffect(() => {
                                const id = setInterval(() => {
                                    setHeartbeat(
                                        (value) => value + 1
                                    );
                                }, 30000);

                                return () => clearInterval(id);
                            }, []);

                            // ─────────────────────────────────────────────────────────────────────────
                            // START SESSION
                            // ─────────────────────────────────────────────────────────────────────────

                            const startSession = useCallback(
                                (category: Category) => {
                                    const session: ActiveSession = {
                                        category,
                                        startTime: Date.now(),
                                    };

                                    saveActiveSession(session);

                                    setActive(session);
                                    setElapsedMs(0);

                                    const progress: RewardProgress = {
                                        startTime:
                                            session.startTime,
                                        lastMinute: 0,
                                    };

                                    rewardProgressRef.current =
                                        progress;

                                    saveRewardProgress(progress);

                                    setScreen("active");
                                },
                                []
                            );

                            // ─────────────────────────────────────────────────────────────────────────
                            // END SESSION
                            // ─────────────────────────────────────────────────────────────────────────

                            const endSession = useCallback(() => {
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

                                const record: KillSession = {
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

                                setGameState((previous) => {
                                    const next: GameState = {
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

                            // ─────────────────────────────────────────────────────────────────────────
                            // ABORT SESSION
                            // ─────────────────────────────────────────────────────────────────────────

                            const abortSession = useCallback(() => {
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

                            // ─────────────────────────────────────────────────────────────────────────
                            // RESULT
                            // ─────────────────────────────────────────────────────────────────────────

                            const closeResult = useCallback(() => {
                                setResult(null);
                                setScreen("home");
                            }, []);

                            // ─────────────────────────────────────────────────────────────────────────
                            // DELETE REWARD
                            // ─────────────────────────────────────────────────────────────────────────

                            const deleteReward = useCallback(
                                (id: string) => {
                                    setRewards((previous) => {
                                        const next =
                                            previous.filter(
                                                (reward) =>
                                                reward.id !== id
                                        );

                                        saveRewards(next);

                                        return next;
                                    });
                                },
                                []
                            );

                            // ─────────────────────────────────────────────────────────────────────────
                            // RESET
                            // ─────────────────────────────────────────────────────────────────────────
                            const handleReset = useCallback(() => {
                                if (
                                    typeof window !== "undefined" &&
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
                                rewardProgressRef.current = null;
                                setActive(null);
                                setSubScreen("base");
                                setScreen("home");
                            }, []);

                            // ─────────────────────────────────────────────────────────────────────────
                            // CURRENT DAY DATA
                            // ─────────────────────────────────────────────────────────────────────────

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

                            // ─────────────────────────────────────────────────────────────────────────
                            // PERSONAL LEADERBOARD
                            // ─────────────────────────────────────────────────────────────────────────

                            const leaderboard =
                                useMemo<LeaderboardEntry[]>(
                                    () => {
                                        const personalBest =
                                            calculatePersonalBest(
                                                gameState.sessions,
                                                now
                                        );

                                        const sevenDayBest =
                                            calculateBestWithinDays(
                                                gameState.sessions,
                                                now,
                                                7
                                        );

                                        const yesterday =
                                            calculateYesterday(
                                                gameState.sessions,
                                                now
                                        );

                                        const thirtyDayBest =
                                            calculateBestWithinDays(
                                                gameState.sessions,
                                                now,
                                                30
                                        );

                                        const thirtyDayAverage =
                                            calculateThirtyDayAverage(
                                                gameState.sessions,
                                                now
                                        );

                                        return [
                                            {
                                                id: "you",
                                                name: "YOU",
                                                subtitle: "Today",
                                                kills: todaySum,
                                                isYou: true,
                                            },

                                            {
                                                id: "personal-best",
                                                name: "PERSONAL BEST",
                                                subtitle: "All-time best day",
                                                kills: personalBest,
                                                isYou: false,
                                            },

                                            {
                                                id: "seven-day-best",
                                                name: "7-DAY BEST",
                                                subtitle: "Best in last 7 days",
                                                kills: sevenDayBest,
                                                isYou: false,
                                            },

                                            {
                                                id: "yesterday",
                                                name: "YESTERDAY",
                                                subtitle: "Previous day",
                                                kills: yesterday,
                                                isYou: false,
                                            },

                                            {
                                                id: "thirty-day-best",
                                                name: "30-DAY BEST",
                                                subtitle: "Best in last 30 days",
                                                kills: thirtyDayBest,
                                                isYou: false,
                                            },

                                            {
                                                id: "thirty-day-average",
                                                name: "30-DAY AVG",
                                                subtitle: "Daily average",
                                                kills: thirtyDayAverage,
                                                isYou: false,
                                            },

                                            {
                                                id: "ideal-self",
                                                name: "IDEAL SELF",
                                                subtitle:
                                                    "4 × 90m + 24 × 15m · 12h",
                                                kills: IDEAL_SELF_KILLS,
                                                isYou: false,
                                                isIdeal: true,
                                            },
                                        ];
                                    },
                                    [
                                        gameState.sessions,
                                        todaySum,
                                        heartbeat,
                                    ]
                            );

                            // ─────────────────────────────────────────────────────────────────────────
                            // REWARDS SORTING
                            // ─────────────────────────────────────────────────────────────────────────

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

                            // ─────────────────────────────────────────────────────────────────────────
                            // LOADING
                            // ─────────────────────────────────────────────────────────────────────────

                            if (!ready) {
                                return (
                                    <div
                                    className="app-shell"
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        background: COLORS.void,
                                    }}
                                    >
                                    <Crosshair
                                    size={26}
                                    color={COLORS.chrome}
                                    />
                                    </div>
                                );
                            }

                            // ─────────────────────────────────────────────────────────────────────────
                            // UI
                            // ─────────────────────────────────────────────────────────────────────────

                            return (
                                <div
                                style={{
                                    background:
                                        "radial-gradient(ellipse at center, #10130f 0%, #0b0d0c 72%)",
                                    color: COLORS.text,
                                    maxWidth: 480,
                                    minHeight: "100vh",
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
                                ].map((corner, index) => (
                                    <div
                                    key={index}
                                    style={{
                                        position: "fixed",
                                        top: corner.top,
                                        bottom: corner.bottom,
                                        left: corner.left,
                                        right: corner.right,
                                        width: 16,
                                        height: 16,

                                        borderTop: corner.borderTop
                                            ? `1.5px solid ${COLORS.chrome}45`
                                            : undefined,

                                            borderBottom:
                                                corner.borderBottom
                                                    ? `1.5px solid ${COLORS.chrome}45`
                                                    : undefined,

                                                    borderLeft: corner.borderLeft
                                                        ? `1.5px solid ${COLORS.chrome}45`
                                                        : undefined,

                                                        borderRight:
                                                            corner.borderRight
                                                                ? `1.5px solid ${COLORS.chrome}45`
                                                                : undefined,

                                                                pointerEvents: "none",
                                                                zIndex: 50,
                                    }}
                                    />
                                ))}

                                <AnimatePresence mode="wait">
                                {/* ─────────────────────────────────────────────────────────────── */}
                                {/* HOME */}
                                {/* ─────────────────────────────────────────────────────────────── */}

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
                                        alignItems: "center",
                                        justifyContent: "center",
                                        gap: 8,
                                    }}
                                    >
                                    <Crosshair
                                    size={18}
                                    color={COLORS.chrome}
                                    strokeWidth={1.75}
                                    />

                                    <span
                                    style={{
                                        fontFamily: FONT_MONO,
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
                                        fontFamily: FONT_MONO,
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
                                        fontFamily: FONT_MONO,
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

                                    {/* TAB BAR */}

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
                                    {TABS.map((tab) => {
                                        const isActive =
                                            subScreen === tab.id;

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
                                                display: "flex",
                                                alignItems:
                                                    "center",
                                                justifyContent:
                                                    "center",
                                                gap: 6,
                                                padding:
                                                    "9px 6px",
                                                borderRadius: 3,
                                                border: "none",
                                                background:
                                                    isActive
                                                        ? COLORS.chrome
                                                        : "transparent",
                                                        color: isActive
                                                            ? COLORS.void
                                                            : COLORS.textMuted,
                                                            fontFamily:
                                                                FONT_DISPLAY,
                                                            fontWeight: 600,
                                                            fontSize: 13,
                                                            letterSpacing:
                                                                0.3,
                                                            cursor: "pointer",
                                            }}
                                            >
                                            <tab.Icon
                                            size={14}
                                            />

                                            {tab.label}
                                            </button>
                                        );
                                    })}
                                    </div>

                                    <AnimatePresence mode="wait">
                                    {/* ─────────────────────────────────────────────────────── */}
                                    {/* BASE */}
                                    {/* ─────────────────────────────────────────────────────── */}

                                    {subScreen === "base" && (
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
                                            display: "flex",
                                            flexDirection:
                                                "column",
                                            gap: 12,
                                        }}
                                        >
                                        {CATEGORY_ORDER.map(
                                            (category) => (
                                                <CategoryCard
                                                key={category}
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
                                                    display: "flex",
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

                                    {/* ─────────────────────────────────────────────────────── */}
                                    {/* LEADERBOARD */}
                                    {/* ─────────────────────────────────────────────────────── */}

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
                                                fontSize: 10.5,
                                                color:
                                                    COLORS.textMuted,
                                                textTransform:
                                                    "uppercase",
                                                letterSpacing:
                                                    1.5,
                                            }}
                                            >
                                            Personal
                                            leaderboard
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
                                            plus your current
                                            day. The final
                                            target is your
                                            12-hour ideal:
                                                4 × 90m + 24 ×
                                            15m.
                                                </div>
                                            </div>

                                            {/* IDEAL TARGET SUMMARY */}

                                            <div
                                            style={{
                                                marginBottom: 14,
                                                padding:
                                                    "12px 14px",
                                                borderRadius: 4,
                                                background: `${COLORS.chrome}0d`,
                                                border: `1px solid ${COLORS.chrome}33`,
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
                                            <div>
                                            <div
                                            style={{
                                                fontFamily:
                                                    FONT_MONO,
                                                fontSize: 10,
                                                color:
                                                    COLORS.chrome,
                                                textTransform:
                                                    "uppercase",
                                                letterSpacing:
                                                    1.2,
                                            }}
                                            >
                                            Ideal workload
                                            </div>

                                            <div
                                            style={{
                                                marginTop: 4,
                                                fontFamily:
                                                    FONT_DISPLAY,
                                                fontSize: 15,
                                                fontWeight: 700,
                                            }}
                                            >
                                            12 hours
                                            structured
                                            </div>
                                            </div>

                                            <div
                                            style={{
                                                textAlign:
                                                    "right",
                                                fontFamily:
                                                    FONT_MONO,
                                            }}
                                            >
                                            <div
                                            style={{
                                                fontSize: 16,
                                                fontWeight: 700,
                                                color:
                                                    COLORS.chrome,
                                            }}
                                            >
                                            {IDEAL_SELF_KILLS}
                                            </div>

                                            <div
                                            style={{
                                                fontSize: 9,
                                                color:
                                                    COLORS.textMuted,
                                                textTransform:
                                                    "uppercase",
                                            }}
                                            >
                                            target kills
                                            </div>
                                            </div>
                                            </div>

                                            <div
                                            style={{
                                                marginTop: 8,
                                                display:
                                                    "flex",
                                                gap: 6,
                                                flexWrap:
                                                    "wrap",
                                            }}
                                            >
                                            <span
                                            style={{
                                                padding:
                                                    "4px 7px",
                                                borderRadius: 3,
                                                background:
                                                    COLORS.panel,
                                                fontFamily:
                                                    FONT_MONO,
                                                fontSize: 9.5,
                                                color:
                                                    COLORS.textMuted,
                                            }}
                                            >
                                            4 × 90m
                                            </span>

                                            <span
                                            style={{
                                                padding:
                                                    "4px 7px",
                                                borderRadius: 3,
                                                background:
                                                    COLORS.panel,
                                                fontFamily:
                                                    FONT_MONO,
                                                fontSize: 9.5,
                                                color:
                                                    COLORS.textMuted,
                                            }}
                                            >
                                            24 × 15m
                                            </span>

                                            <span
                                            style={{
                                                padding:
                                                    "4px 7px",
                                                borderRadius: 3,
                                                background:
                                                    COLORS.panel,
                                                fontFamily:
                                                    FONT_MONO,
                                                fontSize: 9.5,
                                                color:
                                                    COLORS.textMuted,
                                            }}
                                            >
                                            720m total
                                            </span>
                                            </div>
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
                                                        index + 1;

                                                    const isTop =
                                                        rank <= 3;

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
                                                            gap: 12,
                                                            padding:
                                                                "11px 14px",
                                                            borderRadius: 4,

                                                            background:
                                                                entry.isYou
                                                                    ? `${COLORS.chrome}14`
                                                                    : entry.isIdeal
                                                                        ? `${COLORS.chrome}09`
                                                                        : COLORS.panel,

                                                                        border:
                                                                            entry.isYou
                                                                                ? `1px solid ${COLORS.chrome}66`
                                                                                : entry.isIdeal
                                                                                    ? `1px solid ${COLORS.chrome}33`
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
                                                                entry.isIdeal
                                                                    ? COLORS.chrome
                                                                    : rankColor(
                                                                        rank
                                                                    ),
                                                        }}
                                                        >
                                                        {isTop &&
                                                            !entry.isIdeal ? (
                                                                <Trophy
                                                                size={
                                                                    15
                                                                }
                                                                color={
                                                                    rankColor(
                                                                        rank
                                                                    )
                                                                }
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
                                                                entry.isYou ||
                                                                entry.isIdeal
                                                                    ? 700
                                                                    : 600,
                                                                    fontSize: 14,
                                                                    color:
                                                                        entry.isYou
                                                                            ? COLORS.chrome
                                                                            : entry.isIdeal
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

                                                        <div
                                                        style={{
                                                            marginTop: 2,
                                                            fontFamily:
                                                                FONT_MONO,
                                                            fontSize: 9.5,
                                                            color:
                                                                COLORS.textMuted,
                                                            textTransform:
                                                                "uppercase",
                                                            letterSpacing:
                                                                0.6,
                                                        }}
                                                        >
                                                        {
                                                            entry.subtitle
                                                        }
                                                        </div>
                                                        </div>

                                                        {/* KILLS */}

                                                        <div
                                                        style={{
                                                            fontFamily:
                                                                FONT_MONO,
                                                            fontSize: 15,
                                                            fontWeight: 700,
                                                            color:
                                                                entry.isYou ||
                                                                entry.isIdeal
                                                                    ? COLORS.chrome
                                                                    : COLORS.textMuted,
                                                        }}
                                                        >
                                                        {
                                                            entry.kills
                                                        }
                                                        </div>
                                                        </motion.div>
                                                    );
                                                }
                                            )}
                                            </div>

                                            {/* METRIC EXPLANATION */}

                                            <div
                                            style={{
                                                marginTop: 18,
                                                padding:
                                                    "10px 12px",
                                                borderTop: `1px solid ${COLORS.panelLine}`,
                                                fontFamily:
                                                    FONT_MONO,
                                                fontSize: 9.5,
                                                lineHeight: 1.55,
                                                color:
                                                    COLORS.textMuted,
                                            }}
                                            >
                                            <div>
                                            PERSONAL BEST =
                                                all-time highest
                                            daily score.
                                                </div>

                                            <div>
                                            7-DAY BEST = highest
                                            score in the
                                            rolling 7-day
                                            window.
                                                </div>

                                            <div>
                                            YESTERDAY = exact
                                            previous calendar
                                            day.
                                                </div>

                                            <div>
                                            30-DAY BEST = highest
                                            score in the
                                            rolling 30-day
                                            window.
                                                </div>

                                            <div>
                                            30-DAY AVG = average
                                            across all 30
                                            calendar days,
                                            including zero
                                            days.
                                                </div>

                                            <div
                                            style={{
                                                marginTop: 4,
                                                color:
                                                    COLORS.chrome,
                                            }}
                                            >
                                            IDEAL SELF = 4 ×
                                            calcKills(90m) +
                                                24 ×
                                            calcKills(15m).
                                                </div>
                                            </div>
                                            </motion.div>
                                    )}

                                    {/* ─────────────────────────────────────────────────────── */}
                                    {/* REWARDS */}
                                    {/* ─────────────────────────────────────────────────────── */}

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
                                                    (reward) => {
                                                        const tier =
                                                            rewardTier(
                                                                reward.code
                                                        );

                                                        const categoryColor =
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
                                                                    categoryColor,
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
                                                                reward.code
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
                                        cursor: "pointer",
                                    }}
                                    >
                                    <RotateCcw
                                    size={12}
                                    />

                                    Reset log
                                    </button>
                                    </motion.div>
                                )}

                                {/* ─────────────────────────────────────────────────────────────── */}
                                {/* ACTIVE SESSION */}
                                {/* ─────────────────────────────────────────────────────────────── */}

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

                                {/* ─────────────────────────────────────────────────────────────── */}
                                {/* RESULT */}
                                {/* ─────────────────────────────────────────────────────────────── */}

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
