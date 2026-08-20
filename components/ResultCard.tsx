"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, Target } from "lucide-react";
import { calcRank, formatDuration, type Category } from "@/lib/gameLogic";
import { CATEGORY_META, COLORS, FONT_DISPLAY, FONT_MONO, RANK_META } from "@/lib/theme";

interface Props {
  category: Category;
  kills: number;
  rate: number;
  durationMs: number;
  onClose: () => void;
}

export default function ResultCard({ category, kills, rate, durationMs, onClose }: Props) {
  const shouldReduceMotion = useReducedMotion();
  const meta = CATEGORY_META[category];
  const rank = RANK_META[calcRank(rate)];
  const [displayKills, setDisplayKills] = useState(shouldReduceMotion ? kills : 0);

  useEffect(() => {
    if (shouldReduceMotion || kills === 0) {
      setDisplayKills(kills);
      return;
    }
    const duration = 700;
    const start = performance.now();
    let raf: number;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setDisplayKills(Math.round(kills * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kills, shouldReduceMotion]);

  return (
    <motion.div
      key="result"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="app-shell"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px 20px calc(24px + env(safe-area-inset-bottom))",
        textAlign: "center",
        gap: 22,
      }}
    >
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 18 }}
        style={{
          width: 84,
          height: 84,
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: `${meta.color}1a`,
          border: `2px solid ${meta.color}`,
          boxShadow: `0 0 46px ${meta.glow}`,
        }}
      >
        <Target size={36} color={meta.color} strokeWidth={1.75} />
      </motion.div>

      <div>
        <div style={{ fontFamily: FONT_MONO, fontSize: 12, letterSpacing: 2, color: COLORS.textMuted, textTransform: "uppercase" }}>
          {meta.label} · {meta.verb} · {formatDuration(durationMs)}
        </div>
        <div style={{ fontFamily: FONT_MONO, fontSize: "clamp(48px, 15vw, 66px)", fontWeight: 700, color: meta.color, margin: "8px 0" }}>
          {displayKills}
        </div>
        <div style={{ fontFamily: FONT_MONO, fontSize: 12, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 14 }}>
          kills confirmed
        </div>
        <div
          style={{
            display: "inline-block",
            padding: "7px 18px",
            borderRadius: 3,
            background: `${rank.color}1a`,
            border: `1px solid ${rank.color}66`,
            color: rank.color,
            fontFamily: FONT_DISPLAY,
            fontWeight: 700,
            fontSize: 14,
            letterSpacing: 1.5,
            textTransform: "uppercase",
          }}
        >
          {rank.label}
        </div>
        <div style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: COLORS.textMuted, marginTop: 14 }}>
          {Math.round(rate * 100)}% zero · peak is a 90-minute session
        </div>
      </div>

      <motion.button
        onClick={onClose}
        whileTap={{ scale: 0.96 }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "13px 22px",
          borderRadius: 4,
          border: `1px solid ${COLORS.panelLine}`,
          background: COLORS.panel,
          color: COLORS.text,
          fontFamily: FONT_DISPLAY,
          fontWeight: 600,
          fontSize: 15,
          marginTop: 6,
          cursor: "pointer",
        }}
      >
        <ArrowLeft size={17} /> Return to Base
      </motion.button>
    </motion.div>
  );
}
