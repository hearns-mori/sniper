"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Crosshair, Gem, ListOrdered, RotateCcw, Trash2, Trophy } from "lucide-react";
import { calcKills, calcRate, OPTIMAL_MINUTES, type Category } from "@/lib/gameLogic";
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
import { CATEGORY_META, COLORS, FONT_DISPLAY, FONT_MONO } from "@/lib/theme";
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

const CATEGORY_ORDER: Category[] = ["architect", "commander", "army"];

// ── Rewards ──────────────────────────────────────────────────────────────
// A brand new 3-character code (0-9, a-z, A-Z — 62 possible characters per
// slot) is minted for every full minute spent in the field. Everything
// about rewards lives in this file only, in its own localStorage keys, so
// it never has to touch lib/storage.ts.

const REWARD_CHARS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const REWARDS_KEY = "sniper_kpi_rewards_v1";
const REWARD_PROGRESS_KEY = "sniper_kpi_reward_progress_v1";

interface RewardItem {
  id: string;
  code: string;
  category: Category;
  earnedAt: number;
}

/** Tracks how many per-minute rewards have already been paid out for the
 *  currently running session, keyed to that session's start time so a new
 *  session always starts back at zero. */
interface RewardProgress {
  startTime: number;
  lastMinute: number;
}

function generateRewardCode(): string {
  let code = "";
  for (let i = 0; i < 3; i++) {
    code += REWARD_CHARS[Math.floor(Math.random() * REWARD_CHARS.length)];
  }
  return code;
}

/** Character rank used for reward value: digits (0-9) < lowercase (a-z) <
 *  uppercase (A-Z), so 'Z' outranks 'z' which outranks '9'. This is what
 *  makes ZZZ the single most valuable code obtainable. */
function charRank(ch: string): number {
  const code = ch.charCodeAt(0);
  if (code >= 48 && code <= 57) return code - 48; // '0'-'9' -> 0..9
  if (code >= 97 && code <= 122) return 10 + (code - 97); // 'a'-'z' -> 10..35
  if (code >= 65 && code <= 90) return 36 + (code - 65); // 'A'-'Z' -> 36..61
  return -1;
}

function rewardValue(code: string): number {
  return charRank(code[0]) * 62 * 62 + charRank(code[1]) * 62 + charRank(code[2]);
}

function rewardTier(code: string): "gold" | "silver" | "bronze" {
  const c = code[0];
  if (c >= "A" && c <= "Z") return "gold";
  if (c >= "a" && c <= "z") return "silver";
  return "bronze";
}

const TIER_COLOR: Record<"gold" | "silver" | "bronze", string> = {
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
    window.localStorage.setItem(REWARDS_KEY, JSON.stringify(rewards));
  } catch {
    // ignore
  }
}

function loadRewardProgress(): RewardProgress | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(REWARD_PROGRESS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as RewardProgress;
  } catch {
    return null;
  }
}

function saveRewardProgress(progress: RewardProgress | null) {
  if (!isBrowser()) return;
  try {
    if (progress) window.localStorage.setItem(REWARD_PROGRESS_KEY, JSON.stringify(progress));
    else window.localStorage.removeItem(REWARD_PROGRESS_KEY);
  } catch {
    // ignore
  }
}

// ── Daily reset ──────────────────────────────────────────────────────────
// Kill totals reset every day by construction: rather than storing a
// separate "today" counter, today's totals are derived by filtering the
// existing session log down to sessions that started on today's calendar
// date. Roll past midnight and yesterday's sessions simply stop counting.

function isSameLocalDay(ts: number, referenceNow: number): boolean {
  const a = new Date(ts);
  const b = new Date(referenceNow);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function computeTodayTotals(sessions: KillSession[], now: number): Record<Category, number> {
  const totals: Record<Category, number> = { architect: 0, commander: 0, army: 0 };
  for (const s of sessions) {
    if (isSameLocalDay(s.startTime, now)) totals[s.category] += s.kills;
  }
  return totals;
}

// ── Leaderboard bots ─────────────────────────────────────────────────────
// Every bot is scored with the exact same calcKills formula the player is
// scored with — "ideal" means the same thing for everyone. A bot's edge
// comes entirely from how close its typical session length sits to the
// 90-minute zero and how many sessions it puts in per day. Good bots run
// tight ~90-minute sessions; bad bots either quit too early or grind on
// long past the point of diminishing returns.

interface Bot {
  id: string;
  name: string;
  typicalMinutes: number;
  sessionsPerDay: number;
  startFrac: number; // fraction of the day (0-1) their grind ramps up from
  endFrac: number; // fraction of the day their grind is maxed out by
}

const BOTS: Bot[] = [
  { id: "ghost7", name: "GHOST-7", typicalMinutes: 92, sessionsPerDay: 2, startFrac: 0.25, endFrac: 0.85 },
  { id: "viper1", name: "VIPER-1", typicalMinutes: 85, sessionsPerDay: 2, startFrac: 0.3, endFrac: 0.9 },
  { id: "nullpoint", name: "NULLPOINT", typicalMinutes: 100, sessionsPerDay: 2, startFrac: 0.2, endFrac: 0.75 },
  { id: "echo3", name: "ECHO-3", typicalMinutes: 78, sessionsPerDay: 2, startFrac: 0.35, endFrac: 0.95 },
  { id: "raven", name: "RAVEN", typicalMinutes: 70, sessionsPerDay: 2, startFrac: 0.1, endFrac: 0.6 },
  { id: "static", name: "STATIC", typicalMinutes: 110, sessionsPerDay: 1, startFrac: 0.4, endFrac: 0.7 },
  { id: "drifter", name: "DRIFTER", typicalMinutes: 55, sessionsPerDay: 2, startFrac: 0.15, endFrac: 0.65 },
  { id: "cobalt", name: "COBALT", typicalMinutes: 130, sessionsPerDay: 1, startFrac: 0.3, endFrac: 0.55 },
  { id: "blip", name: "BLIP", typicalMinutes: 25, sessionsPerDay: 3, startFrac: 0.1, endFrac: 0.9 },
  { id: "sparrow", name: "SPARROW", typicalMinutes: 45, sessionsPerDay: 2, startFrac: 0.2, endFrac: 0.8 },
  { id: "rusty", name: "RUSTY", typicalMinutes: 150, sessionsPerDay: 1, startFrac: 0.45, endFrac: 0.65 },
  { id: "flicker", name: "FLICKER", typicalMinutes: 20, sessionsPerDay: 3, startFrac: 0.05, endFrac: 0.95 },
  { id: "idle9", name: "IDLE-9", typicalMinutes: 15, sessionsPerDay: 2, startFrac: 0.5, endFrac: 0.9 },
  { id: "novice", name: "NOVICE", typicalMinutes: 35, sessionsPerDay: 1, startFrac: 0.6, endFrac: 0.95 },
];

/** Deterministic 0..1 pseudo-random value from a string seed — same day,
 *  same bot, same number, every time, with no state to persist. */
function hash01(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

function startOfLocalDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function smoothstep(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/** A bot's kill count for "today", as of `now`. Deterministic per calendar
 *  day (a small daily jitter keeps bots from being perfectly identical
 *  every day) and grows smoothly across the bot's active window as the day
 *  goes on — this is what makes the board feel alive without needing any
 *  simulated ticking in the background. */
function botKillsNow(bot: Bot, now: number): number {
  const dayKey = new Date(now).toDateString();
  const sizeJitter = 0.85 + hash01(`${dayKey}:${bot.id}:size`) * 0.3; // 0.85x - 1.15x
  const phaseJitter = (hash01(`${dayKey}:${bot.id}:phase`) - 0.5) * 0.08;

  const perSession = calcKills(bot.typicalMinutes * 60000);
  const maxDaily = Math.round(perSession * bot.sessionsPerDay * sizeJitter);

  const dayFrac = (now - startOfLocalDay(now)) / (24 * 60 * 60 * 1000);
  const start = Math.max(0, bot.startFrac + phaseJitter);
  const end = Math.min(1, bot.endFrac + phaseJitter);
  const span = Math.max(0.05, end - start);
  const progress = smoothstep((dayFrac - start) / span);

  return Math.round(maxDaily * progress);
}

function rankColor(rank: number): string {
  if (rank === 1) return COLORS.chrome;
  if (rank === 2) return "#c7d0c6";
  if (rank === 3) return "#b98a52";
  return COLORS.textMuted;
}

const TABS: { id: SubScreen; label: string; Icon: typeof Crosshair }[] = [
  { id: "base", label: "Base", Icon: Crosshair },
  { id: "leaderboard", label: "Ranks", Icon: ListOrdered },
  { id: "rewards", label: "Vault", Icon: Gem },
];

export default function SniperGame() {
  const [ready, setReady] = useState(false);
  const [screen, setScreen] = useState<Screen>("home");
  const [subScreen, setSubScreen] = useState<SubScreen>("base");
  const [gameState, setGameState] = useState<GameState>({
    totals: { architect: 0, commander: 0, army: 0 },
    sessions: [],
  });
  const [active, setActive] = useState<ActiveSession | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [result, setResult] = useState<ResultData | null>(null);
  const [rewards, setRewards] = useState<RewardItem[]>([]);
  const [heartbeat, setHeartbeat] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rewardProgressRef = useRef<RewardProgress | null>(null);

  // Pays out any reward minutes newly crossed since the last check-in. Also
  // covers the "away from the browser" case: if 47 minutes passed while the
  // tab was closed, all 47 rewards land the moment the timer resyncs.
  const grantMinuteRewards = useCallback((elapsed: number, category: Category) => {
    const progress = rewardProgressRef.current;
    if (!progress) return;
    const currentMinute = Math.floor(elapsed / 60000);
    if (currentMinute <= progress.lastMinute) return;

    const minted: RewardItem[] = [];
    for (let m = progress.lastMinute + 1; m <= currentMinute; m++) {
      minted.push({
        id: `${progress.startTime}-${m}`,
        code: generateRewardCode(),
        category,
        earnedAt: progress.startTime + m * 60000,
      });
    }

    setRewards((prev) => {
      const next = [...minted, ...prev];
      saveRewards(next);
      return next;
    });

    const updated: RewardProgress = { startTime: progress.startTime, lastMinute: currentMinute };
    rewardProgressRef.current = updated;
    saveRewardProgress(updated);
  }, []);

  // Load persisted state once on mount. If a session was left running —
  // even if the browser was closed entirely — elapsed time is recomputed
  // from the stored start timestamp, not from a counter that would have
  // stopped along with the tab, and any reward minutes missed while away
  // are paid out immediately.
  useEffect(() => {
    setGameState(loadState());
    setRewards(loadRewards());

    const activeSession = loadActiveSession();
    if (activeSession) {
      setActive(activeSession);
      const elapsed = Date.now() - activeSession.startTime;
      setElapsedMs(elapsed);
      setScreen("active");

      const storedProgress = loadRewardProgress();
      const progress: RewardProgress =
        storedProgress && storedProgress.startTime === activeSession.startTime
          ? storedProgress
          : { startTime: activeSession.startTime, lastMinute: 0 };
      rewardProgressRef.current = progress;
      saveRewardProgress(progress);
      grantMinuteRewards(elapsed, activeSession.category);
    }
    setReady(true);
  }, [grantMinuteRewards]);

  // Tick while a session is running. Every tick re-reads Date.now() against
  // the fixed start timestamp rather than incrementing a counter, so there's
  // no drift from tab throttling, sleep, or being backgrounded.
  useEffect(() => {
    if (screen !== "active" || !active) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    const tick = () => {
      const elapsed = Date.now() - active.startTime;
      setElapsedMs(elapsed);
      grantMinuteRewards(elapsed, active.category);
    };
    tick();
    intervalRef.current = setInterval(tick, 1000);
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", tick);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", tick);
    };
  }, [screen, active, grantMinuteRewards]);

  // Keeps the leaderboard's bot numbers (and the midnight daily-reset
  // boundary) fresh even while the player is just sitting on a tab with no
  // session running.
  useEffect(() => {
    const id = setInterval(() => setHeartbeat((h) => h + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const startSession = useCallback((category: Category) => {
    const session: ActiveSession = { category, startTime: Date.now() };
    saveActiveSession(session);
    setActive(session);
    setElapsedMs(0);
    const progress: RewardProgress = { startTime: session.startTime, lastMinute: 0 };
    rewardProgressRef.current = progress;
    saveRewardProgress(progress);
    setScreen("active");
  }, []);

  const endSession = useCallback(() => {
    if (!active) return;
    const finalElapsed = Date.now() - active.startTime;
    grantMinuteRewards(finalElapsed, active.category);

    const kills = calcKills(finalElapsed);
    const rate = calcRate(finalElapsed);
    const record: KillSession = {
      id: `${active.startTime}-${Date.now()}`,
      category: active.category,
      startTime: active.startTime,
      endTime: Date.now(),
      durationMs: finalElapsed,
      kills,
      rate,
    };

    setGameState((prev) => {
      const next: GameState = {
        totals: { ...prev.totals, [active.category]: prev.totals[active.category] + kills },
        sessions: [record, ...prev.sessions],
      };
      saveState(next);
      return next;
    });

    saveActiveSession(null);
    rewardProgressRef.current = null;
    saveRewardProgress(null);
    setActive(null);
    setResult({ category: active.category, kills, rate, durationMs: finalElapsed });
    setScreen("result");
  }, [active, grantMinuteRewards]);

  const abortSession = useCallback(() => {
    if (active) grantMinuteRewards(Date.now() - active.startTime, active.category);
    saveActiveSession(null);
    rewardProgressRef.current = null;
    saveRewardProgress(null);
    setActive(null);
    setScreen("home");
  }, [active, grantMinuteRewards]);

  const closeResult = useCallback(() => {
    setResult(null);
    setScreen("home");
  }, []);

  const deleteReward = useCallback((id: string) => {
    setRewards((prev) => {
      const next = prev.filter((r) => r.id !== id);
      saveRewards(next);
      return next;
    });
  }, []);

  const handleReset = useCallback(() => {
    if (typeof window !== "undefined" && !window.confirm("Clear all kill history and rewards? This can't be undone.")) return;
    resetAll();
    saveRewards([]);
    saveRewardProgress(null);
    setGameState({ totals: { architect: 0, commander: 0, army: 0 }, sessions: [] });
    setRewards([]);
    rewardProgressRef.current = null;
    setActive(null);
    setSubScreen("base");
    setScreen("home");
  }, []);

  const now = Date.now();
  const todayTotals = computeTodayTotals(gameState.sessions, now);
  const todaySum = todayTotals.architect + todayTotals.commander + todayTotals.army;
  const todaySessions = gameState.sessions.filter((s) => isSameLocalDay(s.startTime, now));

  const leaderboard = useMemo(() => {
    const entries = [
      { id: "you", name: "YOU", kills: todaySum, isYou: true },
      ...BOTS.map((b) => ({ id: b.id, name: b.name, kills: botKillsNow(b, now), isYou: false })),
    ];
    return entries.sort((a, b) => b.kills - a.kills);
    // `now` is intentionally left out — it advances together with `heartbeat`
    // and with elapsedMs ticks, both of which already drive re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todaySum, heartbeat]);

  const sortedRewards = useMemo(
    () => [...rewards].sort((a, b) => rewardValue(b.code) - rewardValue(a.code)),
    [rewards]
  );

  if (!ready) {
    return (
      <div className="app-shell" style={{ display: "flex", alignItems: "center", justifyContent: "center", background: COLORS.void }}>
        <Crosshair size={26} color={COLORS.chrome} />
      </div>
    );
  }

  return (
    <div
      style={{
        background: "radial-gradient(ellipse at center, #10130f 0%, #0b0d0c 72%)",
        color: COLORS.text,
        maxWidth: 480,
        margin: "0 auto",
        position: "relative",
        overflowX: "hidden",
      }}
    >
      {/* HUD corner brackets — quiet, persistent viewfinder chrome */}
      {[
        { top: 10, left: 10, borderTop: true, borderLeft: true },
        { top: 10, right: 10, borderTop: true, borderRight: true },
        { bottom: 10, left: 10, borderBottom: true, borderLeft: true },
        { bottom: 10, right: 10, borderBottom: true, borderRight: true },
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
            borderTop: c.borderTop ? `1.5px solid ${COLORS.chrome}45` : undefined,
            borderBottom: c.borderBottom ? `1.5px solid ${COLORS.chrome}45` : undefined,
            borderLeft: c.borderLeft ? `1.5px solid ${COLORS.chrome}45` : undefined,
            borderRight: c.borderRight ? `1.5px solid ${COLORS.chrome}45` : undefined,
            pointerEvents: "none",
            zIndex: 50,
          }}
        />
      ))}

      <AnimatePresence mode="wait">
        {screen === "home" && (
          <motion.div
            key="home"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="app-shell"
            style={{ padding: "30px 20px calc(28px + env(safe-area-inset-bottom))" }}
          >
            <div style={{ textAlign: "center", marginBottom: 24 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                <Crosshair size={18} color={COLORS.chrome} strokeWidth={1.75} />
                <span style={{ fontFamily: FONT_MONO, fontSize: 12, letterSpacing: 3.5, color: COLORS.textMuted, textTransform: "uppercase" }}>
                  Range Log
                </span>
              </div>
              <div style={{ fontFamily: FONT_MONO, fontSize: "clamp(36px, 10vw, 44px)", fontWeight: 700, marginTop: 10 }}>
                {todaySum}
              </div>
              <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 1.2 }}>
                kills today
              </div>
            </div>

            {/* Tab bar */}
            <div
              style={{
                display: "flex",
                gap: 4,
                marginBottom: 22,
                padding: 4,
                background: COLORS.panel,
                borderRadius: 4,
                border: `1px solid ${COLORS.panelLine}`,
              }}
            >
              {TABS.map((tab) => {
                const isActive = subScreen === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setSubScreen(tab.id)}
                    style={{
                      flex: 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                      padding: "9px 6px",
                      borderRadius: 3,
                      border: "none",
                      background: isActive ? COLORS.chrome : "transparent",
                      color: isActive ? COLORS.void : COLORS.textMuted,
                      fontFamily: FONT_DISPLAY,
                      fontWeight: 600,
                      fontSize: 13,
                      letterSpacing: 0.3,
                      cursor: "pointer",
                    }}
                  >
                    <tab.Icon size={14} />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <AnimatePresence mode="wait">
              {subScreen === "base" && (
                <motion.div key="base" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {CATEGORY_ORDER.map((cat) => (
                      <CategoryCard key={cat} category={cat} total={todayTotals[cat]} onSelect={startSession} />
                    ))}
                  </div>

                  {todaySessions.length > 0 && (
                    <div style={{ marginTop: 34 }}>
                      <div
                        style={{
                          fontFamily: FONT_MONO,
                          fontSize: 10.5,
                          color: COLORS.textMuted,
                          textTransform: "uppercase",
                          letterSpacing: 1.5,
                          marginBottom: 10,
                        }}
                      >
                        Today&apos;s sessions
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                        {todaySessions.slice(0, 6).map((s) => {
                          const meta = CATEGORY_META[s.category];
                          return (
                            <div
                              key={s.id}
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                padding: "10px 14px",
                                borderRadius: 4,
                                borderLeft: `2px solid ${meta.color}`,
                                background: COLORS.panel,
                                fontFamily: FONT_MONO,
                                fontSize: 12.5,
                              }}
                            >
                              <span style={{ color: meta.color, fontWeight: 600 }}>{meta.label}</span>
                              <span style={{ color: COLORS.textMuted }}>{Math.round(s.durationMs / 60000)}m</span>
                              <span style={{ fontWeight: 700 }}>{s.kills} kills</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </motion.div>
              )}

              {subScreen === "leaderboard" && (
                <motion.div key="leaderboard" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <div style={{ marginBottom: 16 }}>
                    <div
                      style={{
                        fontFamily: FONT_MONO,
                        fontSize: 10.5,
                        color: COLORS.textMuted,
                        textTransform: "uppercase",
                        letterSpacing: 1.5,
                      }}
                    >
                      Today&apos;s standings
                    </div>
                    <div style={{ fontFamily: FONT_DISPLAY, fontSize: 13.5, color: COLORS.textMuted, marginTop: 4, lineHeight: 1.4 }}>
                      Bots grind in bursts through the day. A clean {OPTIMAL_MINUTES}-minute rhythm outpaces every one of them.
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {leaderboard.map((entry, i) => {
                      const rank = i + 1;
                      return (
                        <div
                          key={entry.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 12,
                            padding: "11px 14px",
                            borderRadius: 4,
                            background: entry.isYou ? `${COLORS.chrome}14` : COLORS.panel,
                            border: entry.isYou ? `1px solid ${COLORS.chrome}66` : `1px solid transparent`,
                          }}
                        >
                          <div
                            style={{
                              width: 22,
                              flexShrink: 0,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontFamily: FONT_MONO,
                              fontSize: 13,
                              fontWeight: 700,
                              color: rankColor(rank),
                            }}
                          >
                            {rank === 1 ? <Trophy size={15} color={rankColor(rank)} /> : rank}
                          </div>
                          <div
                            style={{
                              flex: 1,
                              fontFamily: FONT_DISPLAY,
                              fontWeight: entry.isYou ? 700 : 600,
                              fontSize: 15,
                              color: entry.isYou ? COLORS.chrome : COLORS.text,
                              letterSpacing: 0.3,
                            }}
                          >
                            {entry.name}
                          </div>
                          <div style={{ fontFamily: FONT_MONO, fontSize: 15, fontWeight: 700, color: entry.isYou ? COLORS.chrome : COLORS.textMuted }}>
                            {entry.kills}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              )}

              {subScreen === "rewards" && (
                <motion.div key="rewards" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <div style={{ marginBottom: 16 }}>
                    <div
                      style={{
                        fontFamily: FONT_MONO,
                        fontSize: 10.5,
                        color: COLORS.textMuted,
                        textTransform: "uppercase",
                        letterSpacing: 1.5,
                      }}
                    >
                      Collected codes
                    </div>
                    <div style={{ fontFamily: FONT_DISPLAY, fontSize: 13.5, color: COLORS.textMuted, marginTop: 4, lineHeight: 1.4 }}>
                      Sorted highest value first — uppercase outranks lowercase outranks digits, so ZZZ is as good as it gets.
                    </div>
                  </div>

                  {sortedRewards.length === 0 ? (
                    <div
                      style={{
                        padding: "28px 18px",
                        textAlign: "center",
                        borderRadius: 4,
                        border: `1px dashed ${COLORS.panelLine}`,
                        color: COLORS.textMuted,
                        fontFamily: FONT_DISPLAY,
                        fontSize: 14,
                      }}
                    >
                      No rewards logged yet. Every minute in the field earns one.
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                      <AnimatePresence initial={false}>
                        {sortedRewards.map((r) => {
                          const tier = rewardTier(r.code);
                          const catColor = CATEGORY_META[r.category].color;
                          return (
                            <motion.div
                              key={r.id}
                              layout
                              initial={{ opacity: 0, y: -6 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, height: 0, marginBottom: 0, paddingTop: 0, paddingBottom: 0 }}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 12,
                                padding: "10px 12px",
                                borderRadius: 4,
                                background: COLORS.panel,
                                borderLeft: `3px solid ${TIER_COLOR[tier]}`,
                                overflow: "hidden",
                              }}
                            >
                              <div
                                style={{ width: 7, height: 7, borderRadius: "50%", background: catColor, flexShrink: 0 }}
                                aria-hidden
                              />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontFamily: FONT_MONO, fontSize: 19, fontWeight: 700, color: TIER_COLOR[tier], letterSpacing: 1 }}>
                                  {r.code}
                                </div>
                                <div style={{ fontFamily: FONT_MONO, fontSize: 10, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.8 }}>
                                  {tier} · {new Date(r.earnedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                </div>
                              </div>
                              <button
                                onClick={() => deleteReward(r.id)}
                                aria-label="Delete reward"
                                style={{
                                  flexShrink: 0,
                                  width: 32,
                                  height: 32,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  borderRadius: 4,
                                  border: `1px solid ${COLORS.panelLine}`,
                                  background: "transparent",
                                  color: COLORS.textMuted,
                                  cursor: "pointer",
                                }}
                              >
                                <Trash2 size={14} />
                              </button>
                            </motion.div>
                          );
                        })}
                      </AnimatePresence>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            <button
              onClick={handleReset}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                margin: "30px auto 0",
                padding: "8px 4px",
                background: "transparent",
                border: "none",
                color: COLORS.textMuted,
                fontFamily: FONT_MONO,
                fontSize: 10.5,
                textTransform: "uppercase",
                letterSpacing: 1,
                cursor: "pointer",
              }}
            >
              <RotateCcw size={12} /> Reset log
            </button>
          </motion.div>
        )}

        {screen === "active" && active && (
          <ScopeOverlay
            category={active.category}
            elapsedMs={elapsedMs}
            rate={calcRate(elapsedMs)}
            liveKills={calcKills(elapsedMs)}
            onDone={endSession}
            onAbort={abortSession}
          />
        )}

        {screen === "result" && result && (
          <ResultCard category={result.category} kills={result.kills} rate={result.rate} durationMs={result.durationMs} onClose={closeResult} />
        )}
      </AnimatePresence>
    </div>
  );
}

