"use client";

import { motion } from "framer-motion";
import type { Category } from "@/lib/gameLogic";
import { CATEGORY_META, COLORS, FONT_DISPLAY, FONT_MONO } from "@/lib/theme";

interface Props {
  category: Category;
  total: number;
  onSelect: (c: Category) => void;
}

export default function CategoryCard({ category, total, onSelect }: Props) {
  const meta = CATEGORY_META[category];
  const Icon = meta.Icon;

  return (
    <motion.button
      onClick={() => onSelect(category)}
      whileTap={{ scale: 0.97 }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        width: "100%",
        padding: "16px 18px",
        borderRadius: 4,
        border: `1px solid ${meta.color}40`,
        borderLeft: `3px solid ${meta.color}`,
        background: `linear-gradient(135deg, ${meta.color}14, ${COLORS.panel})`,
        color: COLORS.text,
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 4,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: `${meta.color}1a`,
          border: `1px solid ${meta.color}55`,
          flexShrink: 0,
        }}
      >
        <Icon size={22} color={meta.color} strokeWidth={1.75} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 600, letterSpacing: 0.3, lineHeight: 1.1 }}>
          {meta.label}
        </div>
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 11,
            color: COLORS.textMuted,
            marginTop: 3,
            textTransform: "uppercase",
            letterSpacing: 1.2,
          }}
        >
          {meta.verb}
        </div>
      </div>

      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ fontFamily: FONT_MONO, fontSize: 22, fontWeight: 700, color: meta.color }}>{total}</div>
        <div style={{ fontFamily: FONT_MONO, fontSize: 9.5, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 1 }}>
          kills
        </div>
      </div>
    </motion.button>
  );
}
