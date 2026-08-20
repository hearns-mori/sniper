"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Crosshair, RotateCcw } from "lucide-react";
import { calcKills, calcRate, type Category } from "@/lib/gameLogic";
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
import { CATEGORY_META, COLORS, FONT_MONO } from "@/lib/theme";
import CategoryCard from "./CategoryCard";
import ScopeOverlay from "./ScopeOverlay";
import ResultCard from "./ResultCard";

type Screen = "home" | "active" | "result";

interface ResultData {
  category: Category;
  kills: number;
  rate: number;
  durationMs: number;
}

const CATEGORY_ORDER: Category[] = ["architect", "commander", "army"];

export default function SniperGame() {
  const [ready, setReady] = useState(false);
  const [screen, setScreen] = useState<Screen>("home");
  const [gameState, setGameState] = useState<GameState>({
    totals: { architect: 0, commander: 0, army: 0 },
    sessions: [],
  });
  const [active, setActive] = useState<ActiveSession | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [result, setResult] = useState<ResultData | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load persisted state once on mount. If a session was left running —
  // even if the browser was closed entirely — elapsed time is recomputed
  // from the stored start timestamp, not from a counter that would have
  // stopped along with the tab.
  useEffect(() => {
    setGameState(loadState());
    const activeSession = loadActiveSession();
    if (activeSession) {
      setActive(activeSession);
      setElapsedMs(Date.now() - activeSession.startTime);
      setScreen("active");
    }
    setReady(true);
  }, []);

  // Tick while a session is running. Every tick re-reads Date.now() against
  // the fixed start timestamp rather than incrementing a counter, so there's
  // no drift from tab throttling, sleep, or being backgrounded.
  useEffect(() => {
    if (screen !== "active" || !active) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    const tick = () => setElapsedMs(Date.now() - active.startTime);
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
  }, [screen, active]);

  const startSession = useCallback((category: Category) => {
    const session: ActiveSession = { category, startTime: Date.now() };
    saveActiveSession(session);
    setActive(session);
    setElapsedMs(0);
    setScreen("active");
  }, []);

  const endSession = useCallback(() => {
    if (!active) return;
    const finalElapsed = Date.now() - active.startTime;
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
    setActive(null);
    setResult({ category: active.category, kills, rate, durationMs: finalElapsed });
    setScreen("result");
  }, [active]);

  const abortSession = useCallback(() => {
    saveActiveSession(null);
    setActive(null);
    setScreen("home");
  }, []);

  const closeResult = useCallback(() => {
    setResult(null);
    setScreen("home");
  }, []);

  const handleReset = useCallback(() => {
    if (typeof window !== "undefined" && !window.confirm("Clear all kill history? This can't be undone.")) return;
    resetAll();
    setGameState({ totals: { architect: 0, commander: 0, army: 0 }, sessions: [] });
    setActive(null);
    setScreen("home");
  }, []);

  if (!ready) {
    return (
      <div className="app-shell" style={{ display: "flex", alignItems: "center", justifyContent: "center", background: COLORS.void }}>
        <Crosshair size={26} color={COLORS.chrome} />
      </div>
    );
  }

  const totalKills = gameState.totals.architect + gameState.totals.commander + gameState.totals.army;

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
            <div style={{ textAlign: "center", marginBottom: 30 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                <Crosshair size={18} color={COLORS.chrome} strokeWidth={1.75} />
                <span style={{ fontFamily: FONT_MONO, fontSize: 12, letterSpacing: 3.5, color: COLORS.textMuted, textTransform: "uppercase" }}>
                  Range Log
                </span>
              </div>
              <div style={{ fontFamily: FONT_MONO, fontSize: "clamp(36px, 10vw, 44px)", fontWeight: 700, marginTop: 10 }}>
                {totalKills}
              </div>
              <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 1.2 }}>
                total confirmed kills
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {CATEGORY_ORDER.map((cat) => (
                <CategoryCard key={cat} category={cat} total={gameState.totals[cat]} onSelect={startSession} />
              ))}
            </div>

            {gameState.sessions.length > 0 && (
              <div style={{ marginTop: 34 }}>
                <div style={{ fontFamily: FONT_MONO, fontSize: 10.5, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 10 }}>
                  Recent sessions
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  {gameState.sessions.slice(0, 5).map((s) => {
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
