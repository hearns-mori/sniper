"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Check, Crosshair, X } from "lucide-react";
import type { Category } from "@/lib/gameLogic";
import { formatDuration } from "@/lib/gameLogic";
import { CATEGORY_META, COLORS, FONT_DISPLAY, FONT_MONO } from "@/lib/theme";
import RangeRuler from "./RangeRuler";

interface Props {
  category: Category;
  elapsedMs: number;
  rate: number;
  liveKills: number;
  onDone: () => void;
  onAbort: () => void;
}

export default function ScopeOverlay({ category, elapsedMs, rate, liveKills, onDone, onAbort }: Props) {
  const shouldReduceMotion = useReducedMotion();
  const meta = CATEGORY_META[category];

  return (
    <motion.div
      key="active"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="app-shell"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "30px 20px calc(24px + env(safe-area-inset-bottom))",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: 3, color: COLORS.textMuted, textTransform: "uppercase" }}>
          Engaging
        </div>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 600, color: meta.color, marginTop: 4 }}>
          {meta.label} · {meta.verb}
        </div>
      </div>

      <div style={{ position: "relative", width: 200, height: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <motion.div
          animate={shouldReduceMotion ? {} : { rotate: 360 }}
          transition={{ repeat: Infinity, duration: 14, ease: "linear" }}
          style={{ position: "absolute", inset: 0, borderRadius: "50%", border: `1.5px dashed ${meta.color}55` }}
        />
        <motion.div
          animate={shouldReduceMotion ? {} : { scale: [1, 1.05, 1] }}
          transition={{ repeat: Infinity, duration: 3.6, ease: "easeInOut" }}
          style={{
            position: "absolute",
            inset: 16,
            borderRadius: "50%",
            border: `1px solid ${meta.color}77`,
            boxShadow: `0 0 36px ${meta.glow}`,
          }}
        />
        <Crosshair size={42} color={meta.color} strokeWidth={1.5} />
      </div>

      <div style={{ textAlign: "center" }}>
        <div style={{ fontFamily: FONT_MONO, fontSize: "clamp(34px, 11vw, 46px)", fontWeight: 700, letterSpacing: 1 }}>
          {formatDuration(elapsedMs)}
        </div>
        <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: COLORS.textMuted, marginTop: 4, textTransform: "uppercase", letterSpacing: 1.5 }}>
          elapsed
        </div>
      </div>

      <div style={{ width: "100%", maxWidth: 360 }}>
        <RangeRuler elapsedMs={elapsedMs} rate={rate} color={meta.color} />

        <div style={{ textAlign: "center", marginTop: 18 }}>
          <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 1.5 }}>
            Projected kills
          </div>
          <div style={{ fontFamily: FONT_MONO, fontSize: 30, fontWeight: 700, color: meta.color }}>{liveKills}</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, width: "100%", maxWidth: 360 }}>
        <motion.button
          onClick={onAbort}
          whileTap={{ scale: 0.95 }}
          aria-label="Abort session"
          style={{
            flex: "0 0 auto",
            padding: "15px 18px",
            borderRadius: 4,
            border: `1px solid ${COLORS.danger}55`,
            background: "#1a0e0c",
            color: "#e2897a",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          <X size={19} />
        </motion.button>
        <motion.button
          onClick={onDone}
          whileTap={{ scale: 0.97 }}
          style={{
            flex: 1,
            padding: "15px 18px",
            borderRadius: 4,
            border: `1px solid ${meta.color}`,
            background: meta.color,
            color: COLORS.void,
            fontFamily: FONT_DISPLAY,
            fontWeight: 700,
            fontSize: 17,
            letterSpacing: 0.4,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            cursor: "pointer",
          }}
        >
          <Check size={19} /> Confirm Kill
        </motion.button>
      </div>
    </motion.div>
  );
}
