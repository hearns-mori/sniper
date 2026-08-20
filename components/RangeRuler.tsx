"use client";

import { motion, useReducedMotion } from "framer-motion";
import { OPTIMAL_MINUTES, RULER_MAX_MINUTES } from "@/lib/gameLogic";
import { COLORS, FONT_MONO } from "@/lib/theme";

const MAJOR_TICKS = [0, 30, 60, 90, 120, 150, 180];
const MINOR_STEP = 10;

interface Props {
  elapsedMs: number;
  rate: number;
  color: string;
}

export default function RangeRuler({ elapsedMs, rate, color }: Props) {
  const shouldReduceMotion = useReducedMotion();
  const minutes = elapsedMs / 60000;
  const clamped = Math.min(RULER_MAX_MINUTES, minutes);
  const pos = (clamped / RULER_MAX_MINUTES) * 100;
  const zeroPos = (OPTIMAL_MINUTES / RULER_MAX_MINUTES) * 100;
  const bandStart = ((OPTIMAL_MINUTES - 15) / RULER_MAX_MINUTES) * 100;
  const bandWidth = (30 / RULER_MAX_MINUTES) * 100;

  const minorTicks: number[] = [];
  for (let m = 0; m <= RULER_MAX_MINUTES; m += MINOR_STEP) minorTicks.push(m);

  return (
    <div style={{ width: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: 10.5,
            letterSpacing: 1.5,
            color: COLORS.textMuted,
            textTransform: "uppercase",
          }}
        >
          Range to zero · 90m
        </span>
        <span style={{ fontFamily: FONT_MONO, fontSize: 15, fontWeight: 700, color }}>{Math.round(rate * 100)}%</span>
      </div>

      <div style={{ position: "relative", height: 44 }}>
        <div
          style={{
            position: "absolute",
            left: `${bandStart}%`,
            width: `${bandWidth}%`,
            top: 13,
            height: 10,
            background: `${color}1f`,
            borderTop: `1px solid ${color}55`,
            borderBottom: `1px solid ${color}55`,
          }}
        />
        <div style={{ position: "absolute", left: 0, right: 0, top: 17, height: 2, background: COLORS.panelLine }} />

        {minorTicks.map((m) => {
          const isMajor = MAJOR_TICKS.includes(m);
          const left = (m / RULER_MAX_MINUTES) * 100;
          return (
            <div
              key={m}
              style={{
                position: "absolute",
                left: `${left}%`,
                top: isMajor ? 11 : 14,
                width: 1,
                height: isMajor ? 14 : 8,
                background: isMajor ? COLORS.textMuted : COLORS.panelLine,
              }}
            />
          );
        })}

        <div
          style={{
            position: "absolute",
            left: `${zeroPos}%`,
            top: -3,
            transform: "translateX(-50%)",
            fontFamily: FONT_MONO,
            fontSize: 9,
            color: COLORS.chrome,
            letterSpacing: 0.5,
          }}
        >
          ZERO
        </div>

        <motion.div
          animate={{ left: `${pos}%` }}
          transition={{ duration: shouldReduceMotion ? 0 : 0.4, ease: "easeOut" }}
          style={{
            position: "absolute",
            top: 25,
            transform: "translateX(-50%)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <div
            style={{
              width: 0,
              height: 0,
              borderLeft: "5px solid transparent",
              borderRight: "5px solid transparent",
              borderBottom: `7px solid ${color}`,
            }}
          />
          <div style={{ width: 2, height: 9, background: color }} />
        </motion.div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: FONT_MONO, fontSize: 9.5, color: COLORS.textMuted, marginTop: 4 }}>
        {MAJOR_TICKS.map((m) => (
          <span key={m}>{m}</span>
        ))}
      </div>
    </div>
  );
}
