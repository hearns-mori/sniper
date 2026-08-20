import { Layers, TrendingUp, Users, type LucideIcon } from "lucide-react";
import type { Category, RankId } from "./gameLogic";

// A weapon-sight HUD, not a dashboard: void black, phosphor amber chrome,
// and three optics-inspired accents for the three targets.
export const COLORS = {
  void: "#0b0d0c",
  panel: "#12160f",
  panelLine: "#232a1e",
  chrome: "#f2a53c",
  text: "#e9ece4",
  textMuted: "#7d8b7c",
  danger: "#c1462f",
} as const;

export const FONT_MONO =
  "'JetBrains Mono', 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
export const FONT_DISPLAY = "'Barlow Condensed', 'Oswald', 'Arial Narrow', sans-serif";

export interface CategoryMeta {
  label: string;
  verb: string;
  color: string;
  glow: string;
  Icon: LucideIcon;
}

// Architect = optic-glass cyan (Abstraction), Commander = brass gold
// (Leverage — spent ammunition, value already invested), Army = olive drab
// (Build — the actual color of the thing being assembled in the field).
export const CATEGORY_META: Record<Category, CategoryMeta> = {
  architect: {
    label: "Architect",
    verb: "Abstraction",
    color: "#5fc8d6",
    glow: "rgba(95, 200, 214, 0.35)",
    Icon: Layers,
  },
  commander: {
    label: "Commander",
    verb: "Leverage",
    color: "#c9a227",
    glow: "rgba(201, 162, 39, 0.35)",
    Icon: TrendingUp,
  },
  army: {
    label: "Army",
    verb: "Build",
    color: "#8a9a5b",
    glow: "rgba(138, 154, 91, 0.35)",
    Icon: Users,
  },
};

export interface RankMeta {
  label: string;
  color: string;
}

// Real range terminology, not generic "epic/legendary" game copy.
export const RANK_META: Record<RankId, RankMeta> = {
  "dead-zero": { label: "Dead Zero", color: COLORS.chrome },
  "tight-group": { label: "Tight Group", color: "#8a9a5b" },
  "on-target": { label: "On Target", color: "#5fc8d6" },
  "off-zero": { label: "Off Zero", color: "#c9a227" },
  "no-zero": { label: "No Zero", color: COLORS.danger },
};
