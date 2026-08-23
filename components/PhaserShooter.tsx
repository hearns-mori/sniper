"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Play,
  Zap,
  Trophy,
  TrendingUp,
  MousePointerClick,
  ArrowUpCircle,
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
  lastPlayDate: string; // Date#toDateString() — drives the daily reset
  balance: number; // spendable points (goes down when buying upgrades)
  scoreToday: number; // cumulative points earned today (never decreases)
  tapLevel: number;
  perSecondLevel: number;
  personalBest: number; // live all-time high of scoreToday
  targetBest: number; // personalBest as of the start of today — frozen goal
  milestonesToday: Milestones;
}

const STORAGE_KEY = "tapgame_state_v1";

function todayKey(): string {
  return new Date().toDateString();
}

function defaultState(carry?: { personalBest: number; targetBest: number }): TapGameState {
  return {
    lastPlayDate: todayKey(),
    balance: 0,
    scoreToday: 0,
    tapLevel: 0,
    perSecondLevel: 0,
    personalBest: carry?.personalBest ?? 0,
    targetBest: carry?.targetBest ?? 0,
    milestonesToday: { m50: false, m75: false, m100: false },
  };
}

function loadState(): TapGameState {
  if (typeof window === "undefined") return defaultState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as Partial<TapGameState>;
    if (parsed.lastPlayDate !== todayKey()) {
      // New day: points and upgrades reset, personal best carries over and
      // becomes the frozen goal for today.
      return defaultState({
        personalBest: parsed.personalBest ?? 0,
        targetBest: parsed.personalBest ?? 0,
      });
    }
    return { ...defaultState(), ...parsed, lastPlayDate: todayKey() };
  } catch {
    return defaultState();
  }
}

function saveState(state: TapGameState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore quota / privacy-mode errors
  }
}

function applyPoints(prev: TapGameState, amount: number): TapGameState {
  if (amount <= 0) return prev;

  const scoreToday = prev.scoreToday + amount;
  const balance = prev.balance + amount;
  const personalBest = scoreToday > prev.personalBest ? scoreToday : prev.personalBest;

  let milestonesToday = prev.milestonesToday;
  if (prev.targetBest > 0) {
    const m50 = milestonesToday.m50 || scoreToday >= prev.targetBest * 0.5;
    const m75 = milestonesToday.m75 || scoreToday >= prev.targetBest * 0.75;
    const m100 = milestonesToday.m100 || scoreToday >= prev.targetBest;
    if (m50 !== milestonesToday.m50 || m75 !== milestonesToday.m75 || m100 !== milestonesToday.m100) {
      milestonesToday = { m50, m75, m100 };
    }
  }

  return { ...prev, balance, scoreToday, personalBest, milestonesToday };
}

// ============================================================================
// LEVEL CURVE — lifetimeKills drives an account level that exponentially
// boosts tap power. This does NOT reset daily; it only grows with the app.
// ============================================================================

interface LevelInfo {
  level: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
  tapMultiplier: number;
}

function xpForLevel(level: number): number {
  return 521;
}

function levelFromLifetimeKills(lifetimeKills: number): LevelInfo {
  let level = 1;
  let xp = Math.max(0, Math.floor(lifetimeKills));
  while (xp >= xpForLevel(level)) {
    xp -= xpForLevel(level);
    level += 1;
  }
  return {
    level,
    xpIntoLevel: xp,
    xpForNextLevel: xpForLevel(level),
    tapMultiplier: Math.pow(level, 1.521),
  };
}

// ============================================================================
// SHOP ECONOMY
// ============================================================================

const TAP_BASE_COST = 10;
const TAP_COST_GROWTH = 1.1521;
const TAP_VALUE_PER_LEVEL = 1;

const DPS_BASE_COST = 10;
const DPS_COST_GROWTH = 1.1521;
const DPS_VALUE_PER_LEVEL = 1;

function tapUpgradeCost(level: number): number {
  return Math.round(TAP_BASE_COST * Math.pow(TAP_COST_GROWTH, level));
}

function dpsUpgradeCost(level: number): number {
  return Math.round(DPS_BASE_COST * Math.pow(DPS_COST_GROWTH, level));
}

function computeTapValue(tapLevel: number, tapMultiplier: number): number {
  return Math.max(1, Math.round((1 + tapLevel * TAP_VALUE_PER_LEVEL) * tapMultiplier));
}

function computePerSecondValue(perSecondLevel: number, tapMultiplier: number): number {
  return perSecondLevel * DPS_VALUE_PER_LEVEL * tapMultiplier;
}

// ============================================================================
// FORMATTING
// ============================================================================

function formatPoints(n: number): string {
  const rounded = Math.round(n);
  if (rounded < 1000) return rounded.toString();
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(rounded);
}

function formatCountdown(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

let tapBurstId = 0;

export default function PhaserShooter({ lifetimeKills, onExit }: PhaserShooterProps) {
  const [phase, setPhase] = useState<Phase>("menu");
  const [state, setState] = useState<TapGameState>(() => defaultState());
  const [hydrated, setHydrated] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [toast, setToast] = useState<string | null>(null);
  const [tapBursts, setTapBursts] = useState<
    { id: number; x: number; y: number; value: number }[]
  >([]);

  const tapButtonRef = useRef<HTMLButtonElement>(null);
  const prevMilestonesRef = useRef<Milestones>(state.milestonesToday);

  const levelInfo = useMemo(() => levelFromLifetimeKills(lifetimeKills), [lifetimeKills]);
  const tapValue = useMemo(
    () => computeTapValue(state.tapLevel, levelInfo.tapMultiplier),
    [state.tapLevel, levelInfo.tapMultiplier]
  );
  const perSecondValue = useMemo(
    () => computePerSecondValue(state.perSecondLevel, levelInfo.tapMultiplier),
    [state.perSecondLevel, levelInfo.tapMultiplier]
  );

  // ==========================================================================
  // LOAD / SAVE / DAILY RESET
  // ==========================================================================

  useEffect(() => {
    setState(loadState());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveState(state);
  }, [state, hydrated]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    setState((prev) => {
      if (prev.lastPlayDate === todayKey()) return prev;
      return defaultState({ personalBest: prev.personalBest, targetBest: prev.personalBest });
    });
  }, [now]);

  const msUntilReset = useMemo(() => {
    const next = new Date();
    next.setHours(24, 0, 0, 0);
    return next.getTime() - now;
  }, [now]);

  // ==========================================================================
  // PASSIVE INCOME (points per second)
  // ==========================================================================

  useEffect(() => {
    if (phase !== "playing") return;
    if (perSecondValue <= 0) return;
    const id = setInterval(() => {
      setState((prev) => applyPoints(prev, perSecondValue));
    }, 1000);
    return () => clearInterval(id);
  }, [phase, perSecondValue]);

  // ==========================================================================
  // MILESTONE TOASTS
  // ==========================================================================

  useEffect(() => {
    const prev = prevMilestonesRef.current;
    const curr = state.milestonesToday;
    if (!prev.m100 && curr.m100) setToast("New personal best!");
    else if (!prev.m75 && curr.m75) setToast("75% of your best — almost there!");
    else if (!prev.m50 && curr.m50) setToast("Halfway to your best!");
    prevMilestonesRef.current = curr;
  }, [state.milestonesToday]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(id);
  }, [toast]);

  // ==========================================================================
  // ACTIONS
  // ==========================================================================

  const handleTap = useCallback(
    (clientX: number, clientY: number) => {
      setState((prev) => applyPoints(prev, tapValue));

      const rect = tapButtonRef.current?.getBoundingClientRect();
      const id = tapBurstId++;
      setTapBursts((prev) => [
        ...prev,
        {
          id,
          x: rect ? clientX - rect.left : 0,
          y: rect ? clientY - rect.top : 0,
          value: tapValue,
        },
      ]);
      setTimeout(() => {
        setTapBursts((prev) => prev.filter((b) => b.id !== id));
      }, 650);
    },
    [tapValue]
  );

  const buyTapUpgrade = useCallback(() => {
    setState((prev) => {
      const cost = tapUpgradeCost(prev.tapLevel);
      if (prev.balance < cost) return prev;
      return { ...prev, balance: prev.balance - cost, tapLevel: prev.tapLevel + 1 };
    });
  }, []);

  const buyDpsUpgrade = useCallback(() => {
    setState((prev) => {
      const cost = dpsUpgradeCost(prev.perSecondLevel);
      if (prev.balance < cost) return prev;
      return { ...prev, balance: prev.balance - cost, perSecondLevel: prev.perSecondLevel + 1 };
    });
  }, []);

  const startPlaying = useCallback(() => setPhase("playing"), []);
  const backToMenu = useCallback(() => setPhase("menu"), []);

  const tapUpgradeCostNow = tapUpgradeCost(state.tapLevel);
  const dpsUpgradeCostNow = dpsUpgradeCost(state.perSecondLevel);
  const nextTapValue = computeTapValue(state.tapLevel + 1, levelInfo.tapMultiplier);
  const nextPerSecondValue = computePerSecondValue(state.perSecondLevel + 1, levelInfo.tapMultiplier);

  const progressPct = state.targetBest > 0 ? Math.min(1, state.scoreToday / state.targetBest) : 0;

  // ==========================================================================
  // RENDER
  // ==========================================================================

  return (
    <div style={{ position: "relative" }}>
      <AnimatePresence mode="wait">
        {phase === "menu" && (
          <motion.div
            key="tap-menu"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <MenuScreen
              levelInfo={levelInfo}
              state={state}
              hydrated={hydrated}
              onStart={startPlaying}
            />
          </motion.div>
        )}

        {phase === "playing" && (
          <motion.div
            key="tap-play"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {/* HEADER */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 10,
                padding: "0 2px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Zap size={13} color={COLORS.chrome} />
                <span
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: 11,
                    color: COLORS.textMuted,
                  }}
                >
                  Lv {levelInfo.level}
                </span>
              </div>

              <div
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 10,
                  color: COLORS.textMuted,
                  textTransform: "uppercase",
                  letterSpacing: 0.6,
                }}
              >
                Resets in {formatCountdown(msUntilReset)}
              </div>

              <button
                onClick={backToMenu}
                aria-label="Back to menu"
                style={{
                  width: 30,
                  height: 30,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 4,
                  border: `1px solid ${COLORS.panelLine}`,
                  background: COLORS.panel,
                  color: COLORS.text,
                  cursor: "pointer",
                }}
              >
                <X size={14} />
              </button>
            </div>

            {/* SCORE */}
            <div
              style={{
                padding: "18px 16px",
                borderRadius: 6,
                background: COLORS.panel,
                border: `1px solid ${COLORS.panelLine}`,
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 10,
                  color: COLORS.textMuted,
                  textTransform: "uppercase",
                  letterSpacing: 1.5,
                }}
              >
                Today&apos;s score
              </div>
              <motion.div
                key={Math.floor(state.scoreToday / 10)}
                initial={{ scale: 1.04 }}
                animate={{ scale: 1 }}
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 42,
                  fontWeight: 700,
                  color: COLORS.text,
                  marginTop: 4,
                }}
              >
                {formatPoints(state.scoreToday)}
              </motion.div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  gap: 18,
                  marginTop: 10,
                  fontFamily: FONT_MONO,
                  fontSize: 10.5,
                  color: COLORS.textMuted,
                }}
              >
                <span>{formatPoints(state.balance)} to spend</span>
                {perSecondValue > 0 && <span>+{formatPoints(perSecondValue)}/sec</span>}
              </div>

              <MilestoneBar
                progressPct={progressPct}
                targetBest={state.targetBest}
                milestones={state.milestonesToday}
              />
            </div>

            {/* TAP BUTTON */}
            <div
              style={{
                position: "relative",
                display: "flex",
                justifyContent: "center",
                margin: "22px 0 20px",
              }}
            >
              <motion.button
                ref={tapButtonRef}
                onClick={(e) => handleTap(e.clientX, e.clientY)}
                whileTap={{ scale: 0.93 }}
                style={{
                  width: 156,
                  height: 156,
                  borderRadius: "50%",
                  border: "none",
                  background: COLORS.chrome,
                  color: COLORS.void,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 4,
                  cursor: "pointer",
                  boxShadow: `0 0 0 6px ${COLORS.panel}, 0 0 24px ${COLORS.chrome}55`,
                }}
              >
                <MousePointerClick size={34} />
                <span
                  style={{
                    fontFamily: FONT_DISPLAY,
                    fontWeight: 700,
                    fontSize: 15,
                    letterSpacing: 1,
                    textTransform: "uppercase",
                  }}
                >
                  Tap
                </span>
                <span style={{ fontFamily: FONT_MONO, fontSize: 11, opacity: 0.75 }}>
                  +{formatPoints(tapValue)}
                </span>
              </motion.button>

              <AnimatePresence>
                {tapBursts.map((b) => (
                  <motion.div
                    key={b.id}
                    initial={{ opacity: 1, y: 0 }}
                    animate={{ opacity: 0, y: -54 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.6, ease: "easeOut" }}
                    style={{
                      position: "absolute",
                      left: b.x,
                      top: b.y,
                      pointerEvents: "none",
                      fontFamily: FONT_MONO,
                      fontWeight: 700,
                      fontSize: 15,
                      color: COLORS.chrome,
                    }}
                  >
                    +{formatPoints(b.value)}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            {/* SHOP */}
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
              Shop — resets daily
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <ShopCard
                icon={<MousePointerClick size={18} color={COLORS.chrome} />}
                title="Tap power"
                level={state.tapLevel}
                description={`Each tap earns +${formatPoints(nextTapValue - tapValue)} more`}
                currentLabel={`+${formatPoints(tapValue)} / tap`}
                cost={tapUpgradeCostNow}
                canAfford={state.balance >= tapUpgradeCostNow}
                accent={COLORS.chrome}
                onBuy={buyTapUpgrade}
              />

              <ShopCard
                icon={<TrendingUp size={18} color="#7fd48a" />}
                title="Auto-collect"
                level={state.perSecondLevel}
                description={`Passive income +${formatPoints(
                  nextPerSecondValue - perSecondValue
                )}/sec more`}
                currentLabel={`+${formatPoints(perSecondValue)} / sec`}
                cost={dpsUpgradeCostNow}
                canAfford={state.balance >= dpsUpgradeCostNow}
                accent="#7fd48a"
                onBuy={buyDpsUpgrade}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            style={{
              position: "absolute",
              top: -6,
              left: "50%",
              transform: "translateX(-50%)",
              padding: "8px 14px",
              borderRadius: 20,
              background: COLORS.chrome,
              color: COLORS.void,
              fontFamily: FONT_MONO,
              fontSize: 11,
              fontWeight: 700,
              whiteSpace: "nowrap",
              zIndex: 10,
            }}
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {phase === "menu" && (
        <button
          onClick={onExit}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            margin: "18px auto 0",
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
          <X size={12} />
          Exit
        </button>
      )}
    </div>
  );
}

// ============================================================================
// SUBCOMPONENTS
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
          fontFamily: FONT_MONO,
          fontSize: 9.5,
          color: COLORS.textMuted,
          marginTop: 14,
        }}
      >
        No personal best yet — today sets the bar.
      </div>
    );
  }

  return (
    <div style={{ marginTop: 16 }}>
      <div
        style={{
          position: "relative",
          height: 8,
          borderRadius: 4,
          background: COLORS.void,
          border: `1px solid ${COLORS.panelLine}`,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${progressPct * 100}%`,
            background: milestones.m100 ? "#7fd48a" : COLORS.chrome,
            transition: "width 200ms ease-out",
          }}
        />
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 5,
          fontFamily: FONT_MONO,
          fontSize: 8.5,
          color: COLORS.textMuted,
        }}
      >
        <span style={{ color: milestones.m50 ? COLORS.chrome : COLORS.textMuted }}>50%</span>
        <span style={{ color: milestones.m75 ? COLORS.chrome : COLORS.textMuted }}>75%</span>
        <span style={{ color: milestones.m100 ? "#7fd48a" : COLORS.textMuted }}>100%</span>
      </div>
    </div>
  );
}

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
  icon: React.ReactNode;
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
    <button
      onClick={onBuy}
      disabled={!canAfford}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "14px 14px",
        borderRadius: 6,
        border: `1px solid ${accent}44`,
        background: COLORS.panel,
        textAlign: "left",
        cursor: canAfford ? "pointer" : "not-allowed",
        opacity: canAfford ? 1 : 0.55,
        width: "100%",
      }}
    >
      <div
        style={{
          width: 38,
          height: 38,
          borderRadius: 6,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: `${accent}18`,
          flexShrink: 0,
        }}
      >
        {icon}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontFamily: FONT_DISPLAY,
            fontWeight: 700,
            fontSize: 14,
            color: COLORS.text,
          }}
        >
          {title}
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 9,
              color: COLORS.textMuted,
              fontWeight: 400,
            }}
          >
            Lv {level}
          </span>
        </div>
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 10,
            color: COLORS.textMuted,
            marginTop: 2,
            lineHeight: 1.4,
          }}
        >
          {description}
        </div>
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 9.5,
            color: accent,
            marginTop: 4,
          }}
        >
          {currentLabel}
        </div>
      </div>

      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 3,
            fontFamily: FONT_MONO,
            fontSize: 14,
            fontWeight: 700,
            color: canAfford ? accent : COLORS.textMuted,
          }}
        >
          <ArrowUpCircle size={12} />
          {formatPoints(cost)}
        </div>
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 8,
            color: COLORS.textMuted,
            textTransform: "uppercase",
          }}
        >
          cost
        </div>
      </div>
    </button>
  );
}

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
  const xpPct = levelInfo.xpForNextLevel > 0 ? levelInfo.xpIntoLevel / levelInfo.xpForNextLevel : 0;
  const hasProgressToday = state.scoreToday > 0;

  return (
    <div>
      {/* LEVEL CARD */}
      <div
        style={{
          padding: "16px 16px 14px",
          borderRadius: 6,
          background: COLORS.panel,
          border: `1px solid ${COLORS.panelLine}`,
          marginBottom: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Zap size={16} color={COLORS.chrome} />
            <span
              style={{
                fontFamily: FONT_DISPLAY,
                fontWeight: 700,
                fontSize: 15,
                color: COLORS.text,
              }}
            >
              Level {levelInfo.level}
            </span>
          </div>

          <span style={{ fontFamily: FONT_MONO, fontSize: 10, color: COLORS.textMuted }}>
            {levelInfo.xpIntoLevel} / {levelInfo.xpForNextLevel} XP
          </span>
        </div>

        <div
          style={{
            height: 6,
            borderRadius: 3,
            background: COLORS.void,
            marginTop: 8,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${xpPct * 100}%`,
              background: COLORS.chrome,
            }}
          />
        </div>

        <div
          style={{
            marginTop: 12,
            fontFamily: FONT_MONO,
            fontSize: 9.5,
            color: COLORS.textMuted,
          }}
        >
          ×{levelInfo.tapMultiplier.toFixed(2)} income multiplier from level
        </div>
      </div>

      {/* PERSONAL BEST CARD */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "14px 16px",
          borderRadius: 6,
          background: COLORS.panel,
          border: `1px solid ${COLORS.panelLine}`,
          marginBottom: 16,
        }}
      >
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: 6,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: `${COLORS.chrome}18`,
            flexShrink: 0,
          }}
        >
          <Trophy size={18} color={COLORS.chrome} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 700,
              fontSize: 14,
              color: COLORS.text,
            }}
          >
            {state.personalBest > 0 ? formatPoints(state.personalBest) : "No record yet"}
          </div>
          <div style={{ fontFamily: FONT_MONO, fontSize: 10, color: COLORS.textMuted, marginTop: 2 }}>
            {state.targetBest > 0
              ? `Beat 50% / 75% / 100% of ${formatPoints(state.targetBest)} today`
              : "Play today to set your first personal best"}
          </div>
        </div>
      </div>

      {hasProgressToday && (
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 10,
            color: COLORS.textMuted,
            textAlign: "center",
            marginBottom: 10,
          }}
        >
          {formatPoints(state.scoreToday)} points earned today so far
        </div>
      )}

      <button
        onClick={onStart}
        disabled={!hydrated}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          width: "100%",
          padding: "13px 0",
          borderRadius: 4,
          border: "none",
          background: COLORS.chrome,
          color: COLORS.void,
          fontFamily: FONT_DISPLAY,
          fontWeight: 700,
          fontSize: 13,
          letterSpacing: 0.6,
          textTransform: "uppercase",
          cursor: hydrated ? "pointer" : "default",
          opacity: hydrated ? 1 : 0.6,
        }}
      >
        <Play size={14} />
        {hasProgressToday ? "Continue tapping" : "Start tapping"}
      </button>
    </div>
  );
}
