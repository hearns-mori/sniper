"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Pause, Play, X, Target, Crosshair, Zap } from "lucide-react";

import { COLORS, FONT_DISPLAY, FONT_MONO } from "@/lib/theme";
import {
  getCombatStats,
  levelFromTotalKills,
  computeAccuracy,
  computeScore,
  MATCH_DURATION_MS,
} from "@/lib/shooterProgression";
import type { CombatStats } from "@/lib/shooterProgression";
import {
  loadShooterHighScores,
  recordShooterMatch,
} from "@/lib/shooterStorage";
import type {
  MatchMode,
  ShooterHighScores,
  ShooterMatchResult,
} from "@/lib/shooterStorage";
import type {
  ShooterEndResult,
  ShooterHudSnapshot,
} from "@/lib/ShooterScene";

type Phase = "menu" | "countdown" | "playing" | "paused" | "results";

interface PhaserShooterProps {
  /** Lifetime kills across all productivity categories — powers the level. */
  lifetimeKills: number;
  onExit: () => void;
}

interface SceneHandle {
  setMoveVector: (x: number, y: number) => void;
  setAimVector: (x: number, y: number) => void;
  setFiring: (firing: boolean) => void;
  setPaused: (paused: boolean) => void;
}

const CANVAS_HEIGHT = 560;

// ============================================================================
// VIRTUAL STICK (shared implementation for move + aim pads)
// ============================================================================

interface StickState {
  active: boolean;
  originX: number;
  originY: number;
  dx: number;
  dy: number;
}

const STICK_RADIUS = 46;

function useVirtualStick(onVector: (x: number, y: number) => void) {
  const [state, setState] = useState<StickState>({
    active: false,
    originX: 0,
    originY: 0,
    dx: 0,
    dy: 0,
  });

  const touchIdRef = useRef<number | null>(null);

  const handleStart = useCallback((clientX: number, clientY: number, id: number) => {
    touchIdRef.current = id;
    setState({ active: true, originX: clientX, originY: clientY, dx: 0, dy: 0 });
  }, []);

  const handleMove = useCallback(
    (clientX: number, clientY: number, id: number) => {
      if (touchIdRef.current !== id) return;

      setState((prev) => {
        if (!prev.active) return prev;

        let dx = clientX - prev.originX;
        let dy = clientY - prev.originY;
        const len = Math.hypot(dx, dy);

        if (len > STICK_RADIUS) {
          dx = (dx / len) * STICK_RADIUS;
          dy = (dy / len) * STICK_RADIUS;
        }

        const nx = dx / STICK_RADIUS;
        const ny = dy / STICK_RADIUS;

        onVector(nx, ny);

        return { ...prev, dx, dy };
      });
    },
    [onVector]
  );

  const handleEnd = useCallback(
    (id: number) => {
      if (touchIdRef.current !== id) return;
      touchIdRef.current = null;
      onVector(0, 0);
      setState({ active: false, originX: 0, originY: 0, dx: 0, dy: 0 });
    },
    [onVector]
  );

  return { state, handleStart, handleMove, handleEnd };
}

function StickPad({
  label,
  stick,
  onStart,
  onMove,
  onEnd,
  accent,
}: {
  label: string;
  stick: StickState;
  onStart: (x: number, y: number, id: number) => void;
  onMove: (x: number, y: number, id: number) => void;
  onEnd: (id: number) => void;
  accent: string;
}) {
  const padRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={padRef}
      onTouchStart={(e) => {
        e.preventDefault();
        const t = e.changedTouches[0];
        onStart(t.clientX, t.clientY, t.identifier);
      }}
      onTouchMove={(e) => {
        e.preventDefault();
        for (const t of Array.from(e.changedTouches)) {
          onMove(t.clientX, t.clientY, t.identifier);
        }
      }}
      onTouchEnd={(e) => {
        e.preventDefault();
        for (const t of Array.from(e.changedTouches)) {
          onEnd(t.identifier);
        }
      }}
      onMouseDown={(e) => {
        onStart(e.clientX, e.clientY, -1);
      }}
      onMouseMove={(e) => {
        if (stick.active) onMove(e.clientX, e.clientY, -1);
      }}
      onMouseUp={() => onEnd(-1)}
      onMouseLeave={() => {
        if (stick.active) onEnd(-1);
      }}
      style={{
        position: "relative",
        width: 108,
        height: 108,
        borderRadius: "50%",
        background: `${COLORS.panel}cc`,
        border: `1px solid ${accent}55`,
        touchAction: "none",
        userSelect: "none",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 6,
          left: 0,
          right: 0,
          textAlign: "center",
          fontFamily: FONT_MONO,
          fontSize: 8,
          letterSpacing: 1,
          color: COLORS.textMuted,
          textTransform: "uppercase",
          pointerEvents: "none",
        }}
      >
        {label}
      </div>

      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: 40,
          height: 40,
          borderRadius: "50%",
          background: accent,
          opacity: stick.active ? 0.9 : 0.45,
          transform: `translate(calc(-50% + ${stick.dx}px), calc(-50% + ${stick.dy}px))`,
          pointerEvents: "none",
          transition: stick.active ? "none" : "transform 120ms ease-out",
        }}
      />
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function PhaserShooter({
  lifetimeKills,
  onExit,
}: PhaserShooterProps) {
  const [phase, setPhase] = useState<Phase>("menu");
  const [mode, setMode] = useState<MatchMode>("casual");
  const [countdownValue, setCountdownValue] = useState(3);
  const [hud, setHud] = useState<ShooterHudSnapshot | null>(null);
  const [result, setResult] = useState<ShooterMatchResult | null>(null);
  const [isNewHighScore, setIsNewHighScore] = useState(false);
  const [highScores, setHighScores] = useState<ShooterHighScores>(() =>
    loadShooterHighScores()
  );
  const [hitFlash, setHitFlash] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<import("phaser").Game | null>(null);
  const sceneRef = useRef<SceneHandle | null>(null);

  const levelInfo = useMemo(
    () => levelFromTotalKills(lifetimeKills),
    [lifetimeKills]
  );

  const combatStats: CombatStats = useMemo(
    () => getCombatStats(levelInfo.level, mode),
    [levelInfo.level, mode]
  );

  // ==========================================================================
  // TOUCH CONTROLS -> SCENE
  // ==========================================================================

  const moveStick = useVirtualStick((x, y) => {
    sceneRef.current?.setMoveVector(x, y);
  });

  const aimStick = useVirtualStick((x, y) => {
    const len = Math.hypot(x, y);
    sceneRef.current?.setAimVector(x, y);
    sceneRef.current?.setFiring(len > 0.15);
  });

  // ==========================================================================
  // LAUNCH PHASER once we enter "playing"
  // ==========================================================================

  useEffect(() => {
    if (phase !== "playing") return;
    if (!canvasHostRef.current) return;
    if (gameRef.current) return;

    let cancelled = false;

    (async () => {
      const Phaser = await import("phaser");
      const { ShooterScene } = await import("@/lib/ShooterScene");

      if (cancelled || !canvasHostRef.current) return;

      const width = canvasHostRef.current.clientWidth || 360;

      const game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: canvasHostRef.current,
        width,
        height: CANVAS_HEIGHT,
        backgroundColor: "#0b0d0c",
        physics: {
          default: "arcade",
          arcade: { gravity: { x: 0, y: 0 }, debug: false },
        },
        scene: [ShooterScene],
      });

      game.scene.start("ShooterScene", {
        combatStats,
        onHudUpdate: (snapshot: ShooterHudSnapshot) => setHud(snapshot),
        onPlayerHit: () => {
          setHitFlash(true);
          setTimeout(() => setHitFlash(false), 150);
        },
        onMatchEnd: (endResult: ShooterEndResult) => {
          const accuracy = computeAccuracy(
            endResult.shotsFired,
            endResult.shotsHit
          );
          const score = computeScore(endResult);

          const record: ShooterMatchResult = {
            id: `${Date.now()}`,
            playedAt: Date.now(),
            mode,
            kills: endResult.kills,
            shotsFired: endResult.shotsFired,
            shotsHit: endResult.shotsHit,
            accuracy,
            score,
            survived: endResult.survived,
            durationMs: endResult.durationMs,
            levelAtPlay: levelInfo.level,
          };

          const { data, isNewHighScore: isNew } = recordShooterMatch(record);

          setHighScores(data);
          setResult(record);
          setIsNewHighScore(isNew);
          setPhase("results");
        },
      });

      gameRef.current = game;
      sceneRef.current = {
        setMoveVector: (x, y) => {
          const scene = game.scene.getScene("ShooterScene") as any;
          scene?.setMoveVector?.(x, y);
        },
        setAimVector: (x, y) => {
          const scene = game.scene.getScene("ShooterScene") as any;
          scene?.setAimVector?.(x, y);
        },
        setFiring: (firing) => {
          const scene = game.scene.getScene("ShooterScene") as any;
          scene?.setFiring?.(firing);
        },
        setPaused: (paused) => {
          const scene = game.scene.getScene("ShooterScene") as any;
          scene?.setPaused?.(paused);
        },
      };
    })();

    return () => {
      cancelled = true;
    };
    // combatStats/mode intentionally excluded: they're captured at launch
    // time via init() and shouldn't hot-swap mid-match.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Tear down Phaser fully whenever we leave the playing/paused phases.
  useEffect(() => {
    if (phase === "playing" || phase === "paused") return;

    if (gameRef.current) {
      gameRef.current.destroy(true);
      gameRef.current = null;
      sceneRef.current = null;
    }
  }, [phase]);

  useEffect(() => {
    return () => {
      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
      }
    };
  }, []);

  // ==========================================================================
  // COUNTDOWN
  // ==========================================================================

  useEffect(() => {
    if (phase !== "countdown") return;

    setCountdownValue(3);

    const id = setInterval(() => {
      setCountdownValue((v) => {
        if (v <= 1) {
          clearInterval(id);
          setPhase("playing");
          return 0;
        }
        return v - 1;
      });
    }, 700);

    return () => clearInterval(id);
  }, [phase]);

  // ==========================================================================
  // ACTIONS
  // ==========================================================================

  const startMatch = useCallback((selectedMode: MatchMode) => {
    setMode(selectedMode);
    setResult(null);
    setHud(null);
    setPhase("countdown");
  }, []);

  const togglePause = useCallback(() => {
    setPhase((prev) => {
      const next = prev === "playing" ? "paused" : "playing";
      sceneRef.current?.setPaused(next === "paused");
      return next;
    });
  }, []);

  const quitToMenu = useCallback(() => {
    setPhase("menu");
    setHud(null);
    setResult(null);
  }, []);

  const bestForMode = mode === "casual" ? highScores.casual : highScores.ranked;

  // ==========================================================================
  // RENDER
  // ==========================================================================

  return (
    <div style={{ position: "relative" }}>
      <AnimatePresence mode="wait">
        {phase === "menu" && (
          <motion.div
            key="shooter-menu"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <MenuScreen
              levelInfo={levelInfo}
              highScores={highScores}
              onStart={startMatch}
            />
          </motion.div>
        )}

        {(phase === "countdown" ||
          phase === "playing" ||
          phase === "paused") && (
          <motion.div
            key="shooter-play"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{ position: "relative" }}
          >
            {/* HUD BAR */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 8,
                padding: "0 2px",
              }}
            >
              <HpBar hp={hud?.hp ?? combatStats.maxHp} maxHp={combatStats.maxHp} />

              <div
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 20,
                  fontWeight: 700,
                  color: COLORS.chrome,
                  letterSpacing: 1,
                }}
              >
                {formatClock(hud?.remainingMs ?? MATCH_DURATION_MS)}
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <div style={{ textAlign: "right" }}>
                  <div
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: 15,
                      fontWeight: 700,
                      color: COLORS.text,
                    }}
                  >
                    {hud?.kills ?? 0}
                  </div>
                  <div
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: 8,
                      color: COLORS.textMuted,
                      textTransform: "uppercase",
                    }}
                  >
                    kills
                  </div>
                </div>

                <button
                  onClick={togglePause}
                  aria-label={phase === "paused" ? "Resume" : "Pause"}
                  style={{
                    width: 34,
                    height: 34,
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
                  {phase === "paused" ? <Play size={15} /> : <Pause size={15} />}
                </button>
              </div>
            </div>

            {/* CANVAS */}
            <div
              style={{
                position: "relative",
                borderRadius: 6,
                overflow: "hidden",
                border: `1px solid ${COLORS.panelLine}`,
                boxShadow: hitFlash
                  ? `inset 0 0 0 3px #ff4d4d99`
                  : `inset 0 0 0 1px transparent`,
                transition: "box-shadow 100ms ease-out",
              }}
            >
              <div ref={canvasHostRef} style={{ width: "100%", height: CANVAS_HEIGHT }} />

              {phase === "countdown" && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "#0b0d0ccc",
                  }}
                >
                  <motion.div
                    key={countdownValue}
                    initial={{ scale: 1.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: 64,
                      fontWeight: 700,
                      color: COLORS.chrome,
                    }}
                  >
                    {countdownValue}
                  </motion.div>
                </div>
              )}

              {phase === "paused" && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 16,
                    background: "#0b0d0cdd",
                  }}
                >
                  <div
                    style={{
                      fontFamily: FONT_DISPLAY,
                      fontSize: 18,
                      fontWeight: 700,
                      color: COLORS.text,
                      letterSpacing: 1,
                      textTransform: "uppercase",
                    }}
                  >
                    Paused
                  </div>

                  <button
                    onClick={togglePause}
                    style={pauseMenuButtonStyle(COLORS.chrome, COLORS.void)}
                  >
                    Resume
                  </button>

                  <button
                    onClick={quitToMenu}
                    style={pauseMenuButtonStyle("transparent", COLORS.textMuted, COLORS.panelLine)}
                  >
                    Quit match
                  </button>
                </div>
              )}
            </div>

            {/* TOUCH CONTROLS */}
            {(phase === "playing") && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginTop: 14,
                  padding: "0 4px",
                }}
              >
                <StickPad
                  label="move"
                  stick={moveStick.state}
                  onStart={moveStick.handleStart}
                  onMove={moveStick.handleMove}
                  onEnd={moveStick.handleEnd}
                  accent={COLORS.chrome}
                />

                <StickPad
                  label="aim / fire"
                  stick={aimStick.state}
                  onStart={aimStick.handleStart}
                  onMove={aimStick.handleMove}
                  onEnd={aimStick.handleEnd}
                  accent="#d6453d"
                />
              </div>
            )}
          </motion.div>
        )}

        {phase === "results" && result && (
          <motion.div
            key="shooter-results"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <ResultsScreen
              result={result}
              isNewHighScore={isNewHighScore}
              bestForMode={bestForMode}
              onPlayAgain={() => startMatch(result.mode)}
              onExit={onExit}
              onBackToMenu={quitToMenu}
            />
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
          Exit to base
        </button>
      )}
    </div>
  );
}

// ============================================================================
// SUBCOMPONENTS
// ============================================================================

function HpBar({ hp, maxHp }: { hp: number; maxHp: number }) {
  const pct = Math.max(0, Math.min(1, hp / Math.max(1, maxHp)));
  const color = pct > 0.5 ? "#7fd48a" : pct > 0.25 ? "#e0b84a" : "#d6453d";

  return (
    <div style={{ width: 92 }}>
      <div
        style={{
          height: 8,
          borderRadius: 4,
          background: COLORS.panel,
          border: `1px solid ${COLORS.panelLine}`,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct * 100}%`,
            background: color,
            transition: "width 150ms ease-out, background 150ms ease-out",
          }}
        />
      </div>
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 8,
          color: COLORS.textMuted,
          marginTop: 2,
        }}
      >
        {Math.max(0, Math.round(hp))} / {maxHp} HP
      </div>
    </div>
  );
}

function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function pauseMenuButtonStyle(
  bg: string,
  color: string,
  border?: string
): React.CSSProperties {
  return {
    width: 200,
    padding: "12px 0",
    borderRadius: 4,
    border: border ? `1px solid ${border}` : "none",
    background: bg,
    color,
    fontFamily: FONT_DISPLAY,
    fontWeight: 700,
    fontSize: 13,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    cursor: "pointer",
  };
}

function MenuScreen({
  levelInfo,
  highScores,
  onStart,
}: {
  levelInfo: ReturnType<typeof levelFromTotalKills>;
  highScores: ShooterHighScores;
  onStart: (mode: MatchMode) => void;
}) {
  const casualStats = getCombatStats(levelInfo.level, "casual");
  const xpPct =
    levelInfo.xpForNextLevel > 0
      ? levelInfo.xpIntoLevel / levelInfo.xpForNextLevel
      : 0;

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
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
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

          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 10,
              color: COLORS.textMuted,
            }}
          >
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
            display: "flex",
            gap: 14,
            marginTop: 12,
            fontFamily: FONT_MONO,
            fontSize: 9.5,
            color: COLORS.textMuted,
          }}
        >
          <span>{casualStats.maxHp} HP</span>
          <span>
            {Math.round((1 - casualStats.fireRateMultiplier) * 100)}% faster fire
          </span>
          <span>
            {Math.round((1 - casualStats.reloadMultiplier) * 100)}% faster reload
          </span>
        </div>
      </div>

      {/* MODE SELECT */}
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
        Select mode
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <ModeCard
          icon={<Target size={18} color={COLORS.chrome} />}
          title="Casual"
          description="Your level bonuses apply. Build your edge through daily kills."
          best={highScores.casual}
          accent={COLORS.chrome}
          onSelect={() => onStart("casual")}
        />

        <ModeCard
          icon={<Crosshair size={18} color="#d6453d" />}
          title="Ranked"
          description="Stats normalized to baseline. Pure aim, pure movement."
          best={highScores.ranked}
          accent="#d6453d"
          onSelect={() => onStart("ranked")}
        />
      </div>
    </div>
  );
}

function ModeCard({
  icon,
  title,
  description,
  best,
  accent,
  onSelect,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  best: ShooterMatchResult | null;
  accent: string;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "14px 14px",
        borderRadius: 6,
        border: `1px solid ${accent}44`,
        background: COLORS.panel,
        textAlign: "left",
        cursor: "pointer",
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
            fontFamily: FONT_DISPLAY,
            fontWeight: 700,
            fontSize: 14,
            color: COLORS.text,
          }}
        >
          {title}
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
      </div>

      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 15,
            fontWeight: 700,
            color: accent,
          }}
        >
          {best?.score ?? "—"}
        </div>
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 8,
            color: COLORS.textMuted,
            textTransform: "uppercase",
          }}
        >
          best score
        </div>
      </div>
    </button>
  );
}

function ResultsScreen({
  result,
  isNewHighScore,
  bestForMode,
  onPlayAgain,
  onExit,
  onBackToMenu,
}: {
  result: ShooterMatchResult;
  isNewHighScore: boolean;
  bestForMode: ShooterMatchResult | null;
  onPlayAgain: () => void;
  onExit: () => void;
  onBackToMenu: () => void;
}) {
  return (
    <div style={{ textAlign: "center", padding: "8px 4px" }}>
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 11,
          color: COLORS.textMuted,
          textTransform: "uppercase",
          letterSpacing: 2,
        }}
      >
        {result.survived ? "Time's up" : "You went down"}
      </div>

      {isNewHighScore && (
        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: 13,
            fontWeight: 700,
            color: COLORS.chrome,
            marginTop: 6,
            textTransform: "uppercase",
            letterSpacing: 0.8,
          }}
        >
          New {result.mode} high score
        </div>
      )}

      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 52,
          fontWeight: 700,
          color: COLORS.text,
          marginTop: 10,
        }}
      >
        {result.score}
      </div>
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 10,
          color: COLORS.textMuted,
          textTransform: "uppercase",
          letterSpacing: 1,
        }}
      >
        score
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "center",
          gap: 22,
          marginTop: 22,
        }}
      >
        <Stat label="kills" value={result.kills} />
        <Stat
          label="accuracy"
          value={`${Math.round(result.accuracy * 100)}%`}
        />
        <Stat
          label="best"
          value={bestForMode ? bestForMode.score : result.score}
        />
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          marginTop: 30,
        }}
      >
        <button
          onClick={onPlayAgain}
          style={pauseMenuButtonStyle(COLORS.chrome, COLORS.void)}
        >
          Play again
        </button>

        <button
          onClick={onBackToMenu}
          style={pauseMenuButtonStyle(
            "transparent",
            COLORS.textMuted,
            COLORS.panelLine
          )}
        >
          Change mode
        </button>

        <button
          onClick={onExit}
          style={{
            fontFamily: FONT_MONO,
            fontSize: 10.5,
            color: COLORS.textMuted,
            textTransform: "uppercase",
            letterSpacing: 1,
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: "8px 0",
          }}
        >
          Exit to base
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 20,
          fontWeight: 700,
          color: COLORS.text,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 8.5,
          color: COLORS.textMuted,
          textTransform: "uppercase",
          letterSpacing: 0.8,
        }}
      >
        {label}
      </div>
    </div>
  );
}

