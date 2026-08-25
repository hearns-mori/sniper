"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Play,
  Zap,
  Trophy,
  Shield,
  Sword,
  Heart,
  Sparkles,
  Skull,
  RefreshCw,
  ChevronRight,
  Brain,
  Dice5,
  Eye,
  Flame,
} from "lucide-react";

import { COLORS, FONT_DISPLAY, FONT_MONO } from "@/lib/theme";

type Phase = "menu" | "draft" | "battle" | "result";

interface PhaserShooterProps {
  /** Lifetime kills across all productivity categories — powers the level. */
  lifetimeKills: number;
  onExit: () => void;
}

// ============================================================================
// STORAGE
// ============================================================================

const STORAGE_KEY = "tapgame_state_v2";

interface SavedState {
  bestRound: number;
  totalWins: number;
  totalRuns: number;
}

function defaultSavedState(): SavedState {
  return {
    bestRound: 0,
    totalWins: 0,
    totalRuns: 0,
  };
}

function loadSavedState(): SavedState {
  if (typeof window === "undefined") return defaultSavedState();

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSavedState();

    const parsed = JSON.parse(raw) as Partial<SavedState>;

    return {
      bestRound: parsed.bestRound ?? 0,
      totalWins: parsed.totalWins ?? 0,
      totalRuns: parsed.totalRuns ?? 0,
    };
  } catch {
    return defaultSavedState();
  }
}

function saveSavedState(state: SavedState) {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage failures.
  }
}

// ============================================================================
// LEVEL SYSTEM
// ============================================================================

interface LevelInfo {
  level: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
  powerMultiplier: number;
}

function xpForLevel(_level: number): number {
  // Preserves the existing integration where 521 lifetime kills = 1 level.
  return 521;
}

function levelFromLifetimeKills(lifetimeKills: number): LevelInfo {
  let level = 1;
  let xp = Math.max(0, Math.floor(lifetimeKills));

  while (xp >= xpForLevel(level)) {
    xp -= xpForLevel(level);
    level++;
  }

  /*
   * Every level compounds the player's baseline.
   *
   * Level 1 = 1.00x
   * Level 2 = 1.22x
   * Level 3 = 1.49x
   * Level 4 = 1.82x
   * ...
   *
   * This makes progressing through productivity levels materially
   * change what the player can survive.
   */
  const powerMultiplier = Math.pow(1.22, level - 1);

  return {
    level,
    xpIntoLevel: xp,
    xpForNextLevel: xpForLevel(level),
    powerMultiplier,
  };
}

// ============================================================================
// TYPES
// ============================================================================

interface Stats {
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  dodge: number;
  crit: number;
  critDamage: number;
  damageReduction: number;
  armorPen: number;
  lifesteal: number;
  attackSpeed: number;
  thorns: number;
  flatDamageReduction: number;
  finalDamage: number;
  healing: number;
}

interface Card {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;

  attack?: number;
  attackMultiplier?: number;
  defense?: number;
  hp?: number;
  hpMultiplier?: number;
  dodge?: number;
  crit?: number;
  critDamage?: number;
  damageReduction?: number;
  armorPen?: number;
  lifesteal?: number;
  attackSpeed?: number;
  thorns?: number;
  flatDamageReduction?: number;
  finalDamage?: number;
  healing?: number;
}

interface Enemy {
  name: string;
  title: string;
  stats: Stats;
  cards: Card[];
  visualSeed: number;
}

interface BattleLog {
  attacker: "player" | "enemy";
  text: string;
  damage?: number;
  critical?: boolean;
  dodged?: boolean;
}

interface RunState {
  round: number;
  checkpoint: number;
  playerStats: Stats;
  playerCards: Card[];
  enemy: Enemy | null;
}

// ============================================================================
// RANDOM
// ============================================================================

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function pick<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

function shuffle<T>(array: T[]): T[] {
  const copy = [...array];

  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
}

// ============================================================================
// CARD POOL
// ============================================================================

const CARD_POOL: Card[] = [
  {
    id: "berserker",
    name: "Berserker",
    description: "+100% attack, but -15% defense.",
    category: "OFFENSE",
    icon: "⚔️",
    attackMultiplier: 2,
    defense: -15,
  },
  {
    id: "executioner",
    name: "Executioner",
    description: "+50% final damage against enemies below 50% HP.",
    category: "OFFENSE",
    icon: "🪓",
    finalDamage: 50,
  },
  {
    id: "double-edge",
    name: "Double Edge",
    description: "+150 attack. +10% crit. -10% max HP.",
    category: "OFFENSE",
    icon: "🩸",
    attack: 150,
    crit: 10,
    hpMultiplier: 0.9,
  },
  {
    id: "glass-cannon",
    name: "Glass Cannon",
    description: "×2.5 attack. Your defense is reduced by 35%.",
    category: "OFFENSE",
    icon: "💥",
    attackMultiplier: 2.5,
    defense: -35,
  },
  {
    id: "critical-core",
    name: "Critical Core",
    description: "+30% critical chance and +75% critical damage.",
    category: "CRIT",
    icon: "🎯",
    crit: 30,
    critDamage: 75,
  },
  {
    id: "lucky-strike",
    name: "Lucky Strike",
    description: "+15% dodge and +20% crit.",
    category: "CRIT",
    icon: "🍀",
    dodge: 15,
    crit: 20,
  },
  {
    id: "iron-wall",
    name: "Iron Wall",
    description: "+50% final damage reduction.",
    category: "DEFENSE",
    icon: "🛡️",
    damageReduction: 50,
  },
  {
    id: "fortress",
    name: "Fortress",
    description: "+300 defense and +500 HP.",
    category: "DEFENSE",
    icon: "🏰",
    defense: 300,
    hp: 500,
  },
  {
    id: "evasion",
    name: "Phantom Step",
    description: "+25% dodge.",
    category: "DEFENSE",
    icon: "👻",
    dodge: 25,
  },
  {
    id: "untouchable",
    name: "Untouchable",
    description: "+40% dodge, but -20% attack.",
    category: "DEFENSE",
    icon: "🌫️",
    dodge: 40,
    attackMultiplier: 0.8,
  },
  {
    id: "vampire",
    name: "Vampire",
    description: "Recover 15% of damage dealt as HP.",
    category: "SUSTAIN",
    icon: "🧛",
    lifesteal: 15,
  },
  {
    id: "regenerator",
    name: "Regenerator",
    description: "Recover 3% max HP every turn.",
    category: "SUSTAIN",
    icon: "💚",
    healing: 3,
  },
  {
    id: "blood-furnace",
    name: "Blood Furnace",
    description: "+20% lifesteal and +100 attack.",
    category: "SUSTAIN",
    icon: "🔥",
    lifesteal: 20,
    attack: 100,
  },
  {
    id: "thorns",
    name: "Thorns",
    description: "Reflect 25% of incoming damage.",
    category: "SUSTAIN",
    icon: "🌵",
    thorns: 25,
  },
  {
    id: "armor-piercer",
    name: "Armor Piercer",
    description: "Ignore 50% of enemy defense.",
    category: "UTILITY",
    icon: "🏹",
    armorPen: 50,
  },
  {
    id: "absolute-piercer",
    name: "Absolute Piercer",
    description: "Ignore 90% of enemy damage reduction.",
    category: "UTILITY",
    icon: "🗡️",
    armorPen: 90,
  },
  {
    id: "momentum",
    name: "Momentum",
    description: "+20% attack speed. Each consecutive hit adds +5% damage.",
    category: "UTILITY",
    icon: "⚡",
    attackSpeed: 20,
  },
  {
    id: "overclock",
    name: "Overclock",
    description: "+50% attack speed and +25% attack.",
    category: "UTILITY",
    icon: "🚀",
    attackSpeed: 50,
    attackMultiplier: 1.25,
  },
  {
    id: "heavy-blow",
    name: "Heavy Blow",
    description: "+400 attack, but -25% attack speed.",
    category: "OFFENSE",
    icon: "🔨",
    attack: 400,
    attackSpeed: -25,
  },
  {
    id: "fortified-heart",
    name: "Fortified Heart",
    description: "+1000 HP and +10% damage reduction.",
    category: "DEFENSE",
    icon: "❤️",
    hp: 1000,
    damageReduction: 10,
  },
  {
    id: "counter",
    name: "Counterstance",
    description: "+15% dodge and +20% thorns.",
    category: "DEFENSE",
    icon: "🥋",
    dodge: 15,
    thorns: 20,
  },
  {
    id: "true-power",
    name: "True Power",
    description: "+250 attack and ignore 25% defense.",
    category: "UTILITY",
    icon: "✨",
    attack: 250,
    armorPen: 25,
  },
  {
    id: "survivalist",
    name: "Survivalist",
    description: "+25% max HP and +10% healing.",
    category: "SUSTAIN",
    icon: "🧬",
    hpMultiplier: 1.25,
    healing: 10,
  },
  {
    id: "glass-heart",
    name: "Glass Heart",
    description: "×1.8 max HP, but -20% attack.",
    category: "SUSTAIN",
    icon: "💎",
    hpMultiplier: 1.8,
    attackMultiplier: 0.8,
  },
  {
    id: "annihilator",
    name: "Annihilator",
    description: "+75% final damage and +200 attack.",
    category: "OFFENSE",
    icon: "☄️",
    finalDamage: 75,
    attack: 200,
  },
  {
    id: "last-stand",
    name: "Last Stand",
    description: "When below 25% HP, gain +100% attack.",
    category: "SPECIAL",
    icon: "☠️",
    attackMultiplier: 2,
  },
  {
    id: "mirage",
    name: "Mirage",
    description: "+30% dodge. Every dodge restores 5% max HP.",
    category: "SPECIAL",
    icon: "🌀",
    dodge: 30,
    healing: 5,
  },
  {
    id: "juggernaut",
    name: "Juggernaut",
    description: "+60% damage reduction, but -35% dodge.",
    category: "DEFENSE",
    icon: "🤖",
    damageReduction: 60,
    dodge: -35,
  },
  {
    id: "glass-blade",
    name: "Glass Blade",
    description: "×3 attack, but -40% max HP.",
    category: "OFFENSE",
    icon: "🔪",
    attackMultiplier: 3,
    hpMultiplier: 0.6,
  },
  {
    id: "immovable",
    name: "Immovable",
    description: "+1000 defense and +20% damage reduction.",
    category: "DEFENSE",
    icon: "🗿",
    defense: 1000,
    damageReduction: 20,
  },
];

// ============================================================================
// BASE STATS
// ============================================================================

function basePlayerStats(level: LevelInfo): Stats {
  const m = level.powerMultiplier;

  return {
    hp: Math.round(1000 * m),
    maxHp: Math.round(1000 * m),
    attack: Math.round(100 * m),
    defense: Math.round(100 * m),
    dodge: 5,
    crit: 5,
    critDamage: 100,
    damageReduction: 0,
    armorPen: 0,
    lifesteal: 0,
    attackSpeed: 100,
    thorns: 0,
    flatDamageReduction: 0,
    finalDamage: 0,
    healing: 0,
  };
}

// ============================================================================
// APPLY CARDS
// ============================================================================

function applyCard(stats: Stats, card: Card): Stats {
  const next = { ...stats };

  if (card.attack) next.attack += card.attack;
  if (card.defense) next.defense += card.defense;
  if (card.hp) {
    next.hp += card.hp;
    next.maxHp += card.hp;
  }

  if (card.attackMultiplier) {
    next.attack *= card.attackMultiplier;
  }

  if (card.hpMultiplier) {
    next.maxHp *= card.hpMultiplier;
    next.hp *= card.hpMultiplier;
  }

  if (card.dodge) next.dodge += card.dodge;
  if (card.crit) next.crit += card.crit;
  if (card.critDamage) next.critDamage += card.critDamage;
  if (card.damageReduction) next.damageReduction += card.damageReduction;
  if (card.armorPen) next.armorPen += card.armorPen;
  if (card.lifesteal) next.lifesteal += card.lifesteal;
  if (card.attackSpeed) next.attackSpeed += card.attackSpeed;
  if (card.thorns) next.thorns += card.thorns;
  if (card.flatDamageReduction) next.flatDamageReduction += card.flatDamageReduction;
  if (card.finalDamage) next.finalDamage += card.finalDamage;
  if (card.healing) next.healing += card.healing;

  next.maxHp = Math.max(1, Math.round(next.maxHp));
  next.hp = Math.min(next.maxHp, Math.max(1, Math.round(next.hp)));
  next.attack = Math.max(1, Math.round(next.attack));
  next.defense = Math.max(0, Math.round(next.defense));
  next.dodge = Math.min(75, Math.max(0, next.dodge));
  next.crit = Math.min(100, Math.max(0, next.crit));
  next.damageReduction = Math.min(90, Math.max(0, next.damageReduction));
  next.armorPen = Math.min(100, Math.max(0, next.armorPen));
  next.lifesteal = Math.min(100, Math.max(0, next.lifesteal));
  next.attackSpeed = Math.max(25, next.attackSpeed);
  next.thorns = Math.min(100, Math.max(0, next.thorns));

  return next;
}

function buildStats(base: Stats, cards: Card[]): Stats {
  return cards.reduce(applyCard, { ...base });
}

// ============================================================================
// ENEMY GENERATION
// ============================================================================

const ENEMY_NAMES = [
  "The Gambler",
  "Iron Wraith",
  "Void Hunter",
  "Glass King",
  "Blood Beast",
  "The Architect",
  "Phantom",
  "Storm Bringer",
  "The Collector",
  "Chaos Knight",
  "Red Machine",
  "Unknown",
];

const ENEMY_TITLES = [
  "reads your build",
  "came prepared",
  "is hiding something",
  "looks unusually strong",
  "has an unstable build",
  "chose chaos",
  "is adapting",
  "doesn't play fair",
];

function generateEnemy(round: number, level: LevelInfo): Enemy {
  /*
   * Enemy strength increases exponentially with the round,
   * while the exact composition is randomized every time.
   */
  const roundPower = Math.pow(1.16, round - 1);
  const levelPower = level.powerMultiplier;

  const base: Stats = {
    hp: Math.round(1000 * levelPower * roundPower * randomFloat(0.8, 1.3)),
    maxHp: 0,
    attack: Math.round(100 * levelPower * roundPower * randomFloat(0.8, 1.35)),
    defense: Math.round(100 * levelPower * roundPower * randomFloat(0.7, 1.4)),
    dodge: randomFloat(0, 20),
    crit: randomFloat(0, 25),
    critDamage: 100,
    damageReduction: 0,
    armorPen: 0,
    lifesteal: 0,
    attackSpeed: randomFloat(75, 130),
    thorns: 0,
    flatDamageReduction: 0,
    finalDamage: 0,
    healing: 0,
  };

  base.maxHp = base.hp;

  /*
   * Enemy gets a random number of cards.
   * Later rounds can produce nastier builds.
   */
  const cardCount = Math.min(
    5,
    1 + Math.floor((round - 1) / 2)
  );

  const cards = shuffle(CARD_POOL).slice(0, cardCount);
  const stats = buildStats(base, cards);

  return {
    name: pick(ENEMY_NAMES),
    title: pick(ENEMY_TITLES),
    stats,
    cards,
    visualSeed: randomInt(1, 999999),
  };
}

// ============================================================================
// BATTLE ENGINE
// ============================================================================

function effectiveDefense(defense: number, armorPen: number): number {
  return Math.max(0, defense * (1 - armorPen / 100));
}

function calculateDamage(
  attacker: Stats,
  defender: Stats,
  defenderHp: number
): {
  damage: number;
  critical: boolean;
} {
  let attack = attacker.attack;

  if (attacker === undefined) {
    attack = 1;
  }

  // Last Stand
  if (attacker.hp <= attacker.maxHp * 0.25) {
    attack *= 2;
  }

  const critical = Math.random() * 100 < attacker.crit;

  if (critical) {
    attack *= 1 + attacker.critDamage / 100;
  }

  const defense = effectiveDefense(defender.defense, attacker.armorPen);

  /*
   * Defense follows diminishing returns.
   * This means stacking defense is powerful but never becomes absolute.
   */
  const defenseMultiplier = 100 / (100 + defense);

  let damage = attack * defenseMultiplier;

  /*
   * Final damage modifiers.
   */
  damage *= 1 + attacker.finalDamage / 100;

  /*
   * Executioner.
   */
  if (defenderHp <= defender.maxHp * 0.5) {
    const executioner = false;
    if (executioner) {
      damage *= 1.5;
    }
  }

  /*
   * Defender's final damage reduction.
   * Attacker armor penetration can partially ignore it.
   */
  const remainingReduction =
    defender.damageReduction *
    (1 - attacker.armorPen / 100);

  damage *= Math.max(0.05, 1 - remainingReduction / 100);

  damage -= defender.flatDamageReduction;

  return {
    damage: Math.max(1, Math.round(damage)),
    critical,
  };
}

function simulateBattle(
  originalPlayer: Stats,
  originalEnemy: Stats
): {
  playerWon: boolean;
  player: Stats;
  enemy: Stats;
  logs: BattleLog[];
  turns: number;
} {
  const player = { ...originalPlayer };
  const enemy = { ...originalEnemy };

  const logs: BattleLog[] = [];

  let playerHp = player.maxHp;
  let enemyHp = enemy.maxHp;

  let turn = 0;
  let playerStreak = 0;
  let enemyStreak = 0;

  /*
   * Attack speed determines who gets more attacks.
   * 100 = normal.
   */
  const playerInterval = 100 / Math.max(25, player.attackSpeed);
  const enemyInterval = 100 / Math.max(25, enemy.attackSpeed);

  let playerTimer = 0;
  let enemyTimer = 0;

  while (playerHp > 0 && enemyHp > 0 && turn < 100) {
    turn++;

    playerTimer += 1;
    enemyTimer += 1;

    const playerActs = playerTimer >= playerInterval;
    const enemyActs = enemyTimer >= enemyInterval;

    if (playerActs) playerTimer = 0;
    if (enemyActs) enemyTimer = 0;

    if (playerActs && enemyHp > 0) {
      if (Math.random() * 100 < enemy.dodge) {
        playerStreak = 0;

        logs.push({
          attacker: "player",
          text: "Enemy dodged your attack.",
          dodged: true,
        });
      } else {
        playerStreak++;

        const streakMultiplier = 1 + Math.min(0.5, (playerStreak - 1) * 0.05);

        const adjustedPlayer = {
          ...player,
          attack: player.attack * streakMultiplier,
        };

        const result = calculateDamage(
          adjustedPlayer,
          enemy,
          enemyHp
        );

        enemyHp -= result.damage;

        const healing =
          result.damage * (player.lifesteal / 100);

        playerHp = Math.min(
          player.maxHp,
          playerHp + healing
        );

        logs.push({
          attacker: "player",
          text: `You hit for ${result.damage}${result.critical ? " CRIT" : ""}.`,
          damage: result.damage,
          critical: result.critical,
        });

        /*
         * Thorns.
         */
        if (enemy.thorns > 0 && enemyHp > 0) {
          const reflected =
            Math.max(1, Math.round(result.damage * enemy.thorns / 100));

          playerHp -= reflected;

          logs.push({
            attacker: "enemy",
            text: `Thorns reflected ${reflected}.`,
            damage: reflected,
          });
        }
      }
    }

    if (enemyActs && playerHp > 0) {
      if (Math.random() * 100 < player.dodge) {
        enemyStreak = 0;

        logs.push({
          attacker: "enemy",
          text: "You dodged the enemy.",
          dodged: true,
        });
      } else {
        enemyStreak++;

        const streakMultiplier =
          1 + Math.min(0.5, (enemyStreak - 1) * 0.05);

        const adjustedEnemy = {
          ...enemy,
          attack: enemy.attack * streakMultiplier,
        };

        const result = calculateDamage(
          adjustedEnemy,
          player,
          playerHp
        );

        playerHp -= result.damage;

        logs.push({
          attacker: "enemy",
          text: `Enemy hit for ${result.damage}${result.critical ? " CRIT" : ""}.`,
          damage: result.damage,
          critical: result.critical,
        });

        if (player.thorns > 0 && playerHp > 0) {
          const reflected =
            Math.max(1, Math.round(result.damage * player.thorns / 100));

          enemyHp -= reflected;

          logs.push({
            attacker: "player",
            text: `Your thorns reflected ${reflected}.`,
            damage: reflected,
          });
        }
      }
    }

    /*
     * Regeneration / healing.
     */
    if (player.healing > 0 && playerHp > 0) {
      playerHp = Math.min(
        player.maxHp,
        playerHp + player.maxHp * (player.healing / 100)
      );
    }

    if (enemy.healing > 0 && enemyHp > 0) {
      enemyHp = Math.min(
        enemy.maxHp,
        enemyHp + enemy.maxHp * (enemy.healing / 100)
      );
    }
  }

  player.hp = Math.max(0, Math.round(playerHp));
  enemy.hp = Math.max(0, Math.round(enemyHp));

  return {
    playerWon: playerHp > 0 && enemyHp <= 0,
    player,
    enemy,
    logs: logs.slice(-14),
    turns: turn,
  };
}

// ============================================================================
// FORMAT
// ============================================================================

function formatNumber(n: number): string {
  const value = Math.round(n);

  if (Math.abs(value) < 1000) {
    return value.toString();
  }

  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(n: number): string {
  return `${Math.round(n)}%`;
}

// ============================================================================
// CARD DESCRIPTION
// ============================================================================

function CardStatPreview({ card }: { card: Card }) {
  const items: string[] = [];

  if (card.attack) items.push(`${card.attack > 0 ? "+" : ""}${card.attack} ATK`);
  if (card.attackMultiplier)
    items.push(`×${card.attackMultiplier} ATK`);
  if (card.defense) items.push(`${card.defense > 0 ? "+" : ""}${card.defense} DEF`);
  if (card.hp) items.push(`${card.hp > 0 ? "+" : ""}${card.hp} HP`);
  if (card.hpMultiplier)
    items.push(`×${card.hpMultiplier} HP`);
  if (card.dodge) items.push(`${card.dodge > 0 ? "+" : ""}${card.dodge}% DODGE`);
  if (card.crit) items.push(`+${card.crit}% CRIT`);
  if (card.damageReduction)
    items.push(`+${card.damageReduction}% REDUCTION`);
  if (card.armorPen) items.push(`+${card.armorPen}% PEN`);
  if (card.lifesteal) items.push(`+${card.lifesteal}% LIFESTEAL`);
  if (card.thorns) items.push(`+${card.thorns}% THORNS`);

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 5,
        marginTop: 8,
      }}
    >
      {items.slice(0, 4).map((item) => (
        <span
          key={item}
          style={{
            padding: "3px 5px",
            borderRadius: 3,
            background: `${COLORS.chrome}12`,
            color: COLORS.chrome,
            fontFamily: FONT_MONO,
            fontSize: 8,
          }}
        >
          {item}
        </span>
      ))}
    </div>
  );
}

// ============================================================================
// STAT BAR
// ============================================================================

function StatRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        minWidth: 0,
      }}
    >
      <span style={{ opacity: 0.7 }}>{icon}</span>

      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: 8.5,
          color: COLORS.textMuted,
          flex: 1,
        }}
      >
        {label}
      </span>

      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: 9,
          fontWeight: 700,
          color: COLORS.text,
        }}
      >
        {value}
      </span>
    </div>
  );
}

// ============================================================================
// MAIN
// ============================================================================

export default function PhaserShooter({
  lifetimeKills,
  onExit,
}: PhaserShooterProps) {
  const [phase, setPhase] = useState<Phase>("menu");
  const [hydrated, setHydrated] = useState(false);

  const [saved, setSaved] = useState<SavedState>(() =>
    defaultSavedState()
  );

  const [round, setRound] = useState(1);
  const [checkpoint, setCheckpoint] = useState(1);

  const [playerCards, setPlayerCards] = useState<Card[]>([]);
  const [choices, setChoices] = useState<Card[]>([]);
  const [enemy, setEnemy] = useState<Enemy | null>(null);

  const [battleResult, setBattleResult] = useState<ReturnType<
    typeof simulateBattle
  > | null>(null);

  const [selectedCard, setSelectedCard] = useState<Card | null>(null);

  const [toast, setToast] = useState<string | null>(null);

  const levelInfo = useMemo(
    () => levelFromLifetimeKills(lifetimeKills),
    [lifetimeKills]
  );

  const baseStats = useMemo(
    () => basePlayerStats(levelInfo),
    [levelInfo]
  );

  const playerStats = useMemo(
    () => buildStats(baseStats, playerCards),
    [baseStats, playerCards]
  );

  // --------------------------------------------------------------------------
  // LOAD
  // --------------------------------------------------------------------------

  useEffect(() => {
    setSaved(loadSavedState());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) {
      saveSavedState(saved);
    }
  }, [saved, hydrated]);

  // --------------------------------------------------------------------------
  // NEW RUN
  // --------------------------------------------------------------------------

  const startRun = useCallback(() => {
    const firstEnemy = generateEnemy(1, levelInfo);

    setRound(1);
    setCheckpoint(1);
    setPlayerCards([]);
    setChoices(shuffle(CARD_POOL).slice(0, 3));
    setEnemy(firstEnemy);
    setBattleResult(null);
    setSelectedCard(null);

    setSaved((prev) => ({
      ...prev,
      totalRuns: prev.totalRuns + 1,
    }));

    setPhase("draft");
  }, [levelInfo]);

  // --------------------------------------------------------------------------
  // CHOOSE CARD
  // --------------------------------------------------------------------------

  const chooseCard = useCallback(
    (card: Card) => {
      setSelectedCard(card);

      const nextCards = [...playerCards, card];

      setPlayerCards(nextCards);

      /*
       * Tiny anticipation delay.
       * The player sees their choice become part of the build before battle.
       */
      setTimeout(() => {
        setPhase("battle");
      }, 450);
    },
    [playerCards]
  );

  // --------------------------------------------------------------------------
  // FIGHT
  // --------------------------------------------------------------------------

  const fight = useCallback(() => {
    if (!enemy) return;

    const result = simulateBattle(playerStats, enemy);

    setBattleResult(result);
    setPhase("result");
  }, [enemy, playerStats]);

  // --------------------------------------------------------------------------
  // NEXT ROUND
  // --------------------------------------------------------------------------

  const nextRound = useCallback(() => {
    const next = round + 1;

    /*
     * Checkpoints every 5 rounds.
     *
     * The run can keep climbing indefinitely.
     * Losing later doesn't erase your best reached checkpoint.
     */
    const nextCheckpoint =
      next % 5 === 0 ? next : checkpoint;

    if (next % 5 === 0) {
      setCheckpoint(next);
      setToast(`CHECKPOINT ${next} REACHED`);
    }

    setRound(next);

    const nextEnemy = generateEnemy(next, levelInfo);

    setEnemy(nextEnemy);
    setChoices(shuffle(CARD_POOL).slice(0, 3));
    setSelectedCard(null);
    setBattleResult(null);

    setPhase("draft");
  }, [round, checkpoint, levelInfo]);

  // --------------------------------------------------------------------------
  // RETRY FROM CHECKPOINT
  // --------------------------------------------------------------------------

  const retryCheckpoint = useCallback(() => {
    const restartRound = checkpoint;

    /*
     * You keep the cards earned during the current run,
     * but the enemy is rerolled.
     *
     * This creates the "maybe I can beat it with a different
     * interpretation" feeling.
     */
    setRound(restartRound);

    const nextEnemy = generateEnemy(
      restartRound,
      levelInfo
    );

    setEnemy(nextEnemy);
    setChoices(shuffle(CARD_POOL).slice(0, 3));
    setSelectedCard(null);
    setBattleResult(null);

    setPhase("draft");
  }, [checkpoint, levelInfo]);

  // --------------------------------------------------------------------------
  // MENU
  // --------------------------------------------------------------------------

  if (phase === "menu") {
    return (
      <div style={{ position: "relative" }}>
        <MenuScreen
          levelInfo={levelInfo}
          saved={saved}
          hydrated={hydrated}
          onStart={startRun}
        />

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
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // GAME
  // --------------------------------------------------------------------------

  return (
    <div style={{ position: "relative" }}>
      {/* HEADER */}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
          }}
        >
          <Flame size={14} color={COLORS.chrome} />

          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 10,
              color: COLORS.textMuted,
            }}
          >
            RUN {round}
          </span>

          <span
            style={{
              padding: "3px 5px",
              borderRadius: 3,
              background: `${COLORS.chrome}15`,
              color: COLORS.chrome,
              fontFamily: FONT_MONO,
              fontSize: 8,
            }}
          >
            CHECKPOINT {checkpoint}
          </span>
        </div>

        <button
          onClick={() => setPhase("menu")}
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

      {/* LEVEL */}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
          padding: "8px 10px",
          borderRadius: 5,
          border: `1px solid ${COLORS.panelLine}`,
          background: COLORS.panel,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Zap size={13} color={COLORS.chrome} />

          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 10,
              color: COLORS.text,
              fontWeight: 700,
            }}
          >
            LV {levelInfo.level}
          </span>
        </div>

        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: 9,
            color: COLORS.chrome,
          }}
        >
          ×{levelInfo.powerMultiplier.toFixed(2)} POWER
        </span>
      </div>

      <AnimatePresence mode="wait">
        {phase === "draft" && (
          <motion.div
            key="draft"
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
          >
            <DraftScreen
              round={round}
              playerStats={playerStats}
              enemy={enemy}
              choices={choices}
              playerCards={playerCards}
              selectedCard={selectedCard}
              onChoose={chooseCard}
            />
          </motion.div>
        )}

        {phase === "battle" && enemy && (
          <motion.div
            key="battle"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <BattlePreview
              playerStats={playerStats}
              enemy={enemy}
              playerCards={playerCards}
              selectedCard={selectedCard}
              onFight={fight}
            />
          </motion.div>
        )}

        {phase === "result" && battleResult && enemy && (
          <motion.div
            key="result"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <ResultScreen
              round={round}
              result={battleResult}
              enemy={enemy}
              checkpoint={checkpoint}
              onNext={nextRound}
              onRetry={retryCheckpoint}
              onMenu={() => setPhase("menu")}
            />
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
              top: -5,
              left: "50%",
              transform: "translateX(-50%)",
              padding: "8px 14px",
              borderRadius: 20,
              background: COLORS.chrome,
              color: COLORS.void,
              fontFamily: FONT_MONO,
              fontSize: 10,
              fontWeight: 700,
              whiteSpace: "nowrap",
              zIndex: 20,
            }}
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// MENU SCREEN
// ============================================================================

function MenuScreen({
  levelInfo,
  saved,
  hydrated,
  onStart,
}: {
  levelInfo: LevelInfo;
  saved: SavedState;
  hydrated: boolean;
  onStart: () => void;
}) {
  return (
    <div>
      <div
        style={{
          padding: "18px 16px",
          borderRadius: 7,
          background: COLORS.panel,
          border: `1px solid ${COLORS.panelLine}`,
          marginBottom: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Brain size={17} color={COLORS.chrome} />

            <span
              style={{
                fontFamily: FONT_DISPLAY,
                fontWeight: 700,
                fontSize: 16,
                color: COLORS.text,
              }}
            >
              Chaos Build
            </span>
          </div>

          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 9,
              color: COLORS.chrome,
            }}
          >
            LV {levelInfo.level}
          </span>
        </div>

        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 10,
            lineHeight: 1.6,
            color: COLORS.textMuted,
            marginTop: 10,
          }}
        >
          Build a fighter from unpredictable choices.
          <br />
          Discover what works. Beat the next thing.
          <br />
          <span style={{ color: COLORS.chrome }}>
            Every enemy is different.
          </span>
        </div>
      </div>

      {/* POWER */}

      <div
        style={{
          padding: "14px 16px",
          borderRadius: 6,
          background: COLORS.panel,
          border: `1px solid ${COLORS.panelLine}`,
          marginBottom: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 9,
              color: COLORS.textMuted,
              textTransform: "uppercase",
              letterSpacing: 1,
            }}
          >
            Productivity level
          </span>

          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 11,
              color: COLORS.chrome,
              fontWeight: 700,
            }}
          >
            ×{levelInfo.powerMultiplier.toFixed(2)}
          </span>
        </div>

        <div
          style={{
            height: 5,
            borderRadius: 3,
            background: COLORS.void,
            marginTop: 8,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${
                (levelInfo.xpIntoLevel /
                  levelInfo.xpForNextLevel) *
                100
              }%`,
              background: COLORS.chrome,
            }}
          />
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 6,
            fontFamily: FONT_MONO,
            fontSize: 8,
            color: COLORS.textMuted,
          }}
        >
          <span>
            {levelInfo.xpIntoLevel} / {levelInfo.xpForNextLevel}
          </span>

          <span>
            Each level = 2 days productivity
          </span>
        </div>
      </div>

      {/* STATS */}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 8,
          marginBottom: 12,
        }}
      >
        <StatTile
          icon={<Trophy size={14} />}
          label="Best round"
          value={`${saved.bestRound}`}
        />

        <StatTile
          icon={<Sword size={14} />}
          label="Wins"
          value={formatNumber(saved.totalWins)}
        />
      </div>

      <button
        onClick={onStart}
        disabled={!hydrated}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          padding: "14px 0",
          borderRadius: 5,
          border: "none",
          background: COLORS.chrome,
          color: COLORS.void,
          fontFamily: FONT_DISPLAY,
          fontWeight: 700,
          fontSize: 13,
          letterSpacing: 0.7,
          textTransform: "uppercase",
          cursor: hydrated ? "pointer" : "default",
          opacity: hydrated ? 1 : 0.5,
        }}
      >
        <Play size={14} />
        Enter the unknown
      </button>
    </div>
  );
}

// ============================================================================
// DRAFT SCREEN
// ============================================================================

function DraftScreen({
  round,
  playerStats,
  enemy,
  choices,
  playerCards,
  selectedCard,
  onChoose,
}: {
  round: number;
  playerStats: Stats;
  enemy: Enemy | null;
  choices: Card[];
  playerCards: Card[];
  selectedCard: Card | null;
  onChoose: (card: Card) => void;
}) {
  return (
    <div>
      {/* UNKNOWN HEADER */}

      <div
        style={{
          textAlign: "center",
          marginBottom: 14,
        }}
      >
        <motion.div
          animate={{ rotate: [0, -3, 3, 0] }}
          transition={{
            duration: 1.8,
            repeat: Infinity,
          }}
        >
          <Dice5
            size={24}
            color={COLORS.chrome}
            style={{ margin: "0 auto" }}
          />
        </motion.div>

        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 700,
            fontSize: 17,
            color: COLORS.text,
            marginTop: 7,
          }}
        >
          What happens next?
        </div>

        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 9.5,
            color: COLORS.textMuted,
            marginTop: 3,
          }}
        >
          Choose one. You won't know exactly what the enemy has.
        </div>
      </div>

      {/* CURRENT BUILD */}

      <BuildStrip
        cards={playerCards}
        stats={playerStats}
      />

      {/* ENEMY PREVIEW */}

      {enemy && (
        <div
          style={{
            padding: "11px 12px",
            borderRadius: 6,
            border: `1px solid ${COLORS.panelLine}`,
            background: COLORS.panel,
            marginBottom: 14,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <div
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontWeight: 700,
                  fontSize: 13,
                  color: COLORS.text,
                }}
              >
                {enemy.name}
              </div>

              <div
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 8.5,
                  color: COLORS.textMuted,
                  marginTop: 2,
                }}
              >
                {enemy.title}
              </div>
            </div>

            <Eye size={14} color={COLORS.textMuted} />
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 5,
              marginTop: 9,
            }}
          >
            <MiniStat label="HP" value={formatNumber(enemy.stats.maxHp)} />
            <MiniStat label="ATK" value={formatNumber(enemy.stats.attack)} />
            <MiniStat label="DEF" value={formatNumber(enemy.stats.defense)} />
          </div>

          <div
            style={{
              marginTop: 8,
              fontFamily: FONT_MONO,
              fontSize: 8,
              color: COLORS.textMuted,
            }}
          >
            {enemy.cards.length} unknown modifiers equipped
          </div>
        </div>
      )}

      {/* CARDS */}

      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 9,
          color: COLORS.textMuted,
          textTransform: "uppercase",
          letterSpacing: 1.2,
          marginBottom: 8,
        }}
      >
        Three possible futures
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {choices.map((card, index) => (
          <DraftCard
            key={`${card.id}-${index}`}
            card={card}
            number={index + 1}
            selected={selectedCard?.id === card.id}
            onClick={() => onChoose(card)}
          />
        ))}
      </div>

      <div
        style={{
          marginTop: 12,
          textAlign: "center",
          fontFamily: FONT_MONO,
          fontSize: 8,
          color: COLORS.textMuted,
        }}
      >
        There is no perfect choice.
        <br />
        <span style={{ color: COLORS.chrome }}>
          Find out.
        </span>
      </div>
    </div>
  );
}

// ============================================================================
// DRAFT CARD
// ============================================================================

function DraftCard({
  card,
  number,
  selected,
  onClick,
}: {
  card: Card;
  number: number;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.985 }}
      onClick={onClick}
      style={{
        width: "100%",
        textAlign: "left",
        padding: "13px 12px",
        borderRadius: 6,
        border: `1px solid ${
          selected ? COLORS.chrome : COLORS.panelLine
        }`,
        background: selected
          ? `${COLORS.chrome}10`
          : COLORS.panel,
        cursor: "pointer",
        color: COLORS.text,
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "flex-start",
        }}
      >
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 5,
            background: `${COLORS.chrome}14`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 18,
            flexShrink: 0,
          }}
        >
          {card.icon}
        </div>

        <div style={{ flex: 1 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
            }}
          >
            <span
              style={{
                fontFamily: FONT_DISPLAY,
                fontWeight: 700,
                fontSize: 13,
              }}
            >
              {card.name}
            </span>

            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: 7.5,
                color: COLORS.chrome,
              }}
            >
              {card.category}
            </span>
          </div>

          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 9,
              color: COLORS.textMuted,
              lineHeight: 1.45,
              marginTop: 3,
            }}
          >
            {card.description}
          </div>

          <CardStatPreview card={card} />
        </div>

        <div
          style={{
            width: 20,
            height: 20,
            borderRadius: "50%",
            border: `1px solid ${COLORS.panelLine}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: FONT_MONO,
            fontSize: 8,
            color: COLORS.textMuted,
            flexShrink: 0,
          }}
        >
          {number}
        </div>
      </div>
    </motion.button>
  );
}

// ============================================================================
// BUILD STRIP
// ============================================================================

function BuildStrip({
  cards,
  stats,
}: {
  cards: Card[];
  stats: Stats;
}) {
  return (
    <div
      style={{
        padding: "10px",
        borderRadius: 6,
        background: COLORS.panel,
        border: `1px solid ${COLORS.panelLine}`,
        marginBottom: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: 8,
            color: COLORS.textMuted,
            textTransform: "uppercase",
            letterSpacing: 1,
          }}
        >
          Your build
        </span>

        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: 8,
            color: COLORS.chrome,
          }}
        >
          {cards.length} effects
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 5,
        }}
      >
        <MiniStat label="HP" value={formatNumber(stats.maxHp)} />
        <MiniStat label="ATK" value={formatNumber(stats.attack)} />
        <MiniStat label="DEF" value={formatNumber(stats.defense)} />
        <MiniStat label="DODGE" value={formatPercent(stats.dodge)} />
        <MiniStat label="CRIT" value={formatPercent(stats.crit)} />
        <MiniStat label="REDUCE" value={formatPercent(stats.damageReduction)} />
      </div>
    </div>
  );
}

// ============================================================================
// BATTLE PREVIEW
// ============================================================================

function BattlePreview({
  playerStats,
  enemy,
  playerCards,
  selectedCard,
  onFight,
}: {
  playerStats: Stats;
  enemy: Enemy;
  playerCards: Card[];
  selectedCard: Card | null;
  onFight: () => void;
}) {
  return (
    <div>
      {/* VERSUS */}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 38px 1fr",
          gap: 7,
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <Combatant
          title="YOU"
          hp={playerStats.maxHp}
          attack={playerStats.attack}
          defense={playerStats.defense}
          icon={<Sword size={15} />}
        />

        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: "50%",
            background: COLORS.chrome,
            color: COLORS.void,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: FONT_DISPLAY,
            fontWeight: 800,
            fontSize: 10,
          }}
        >
          VS
        </div>

        <Combatant
          title={enemy.name}
          hp={enemy.stats.maxHp}
          attack={enemy.stats.attack}
          defense={enemy.stats.defense}
          icon={<Skull size={15} />}
        />
      </div>

      {/* SELECTED */}

      {selectedCard && (
        <div
          style={{
            padding: "9px 11px",
            borderRadius: 5,
            background: `${COLORS.chrome}0d`,
            border: `1px solid ${COLORS.chrome}33`,
            marginBottom: 12,
          }}
        >
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 8,
              color: COLORS.textMuted,
              textTransform: "uppercase",
            }}
          >
            You chose
          </div>

          <div
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 700,
              fontSize: 12,
              color: COLORS.chrome,
              marginTop: 3,
            }}
          >
            {selectedCard.icon} {selectedCard.name}
          </div>
        </div>
      )}

      {/* BUILD */}

      <div
        style={{
          padding: 12,
          borderRadius: 6,
          background: COLORS.panel,
          border: `1px solid ${COLORS.panelLine}`,
          marginBottom: 12,
        }}
      >
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 8,
            color: COLORS.textMuted,
            textTransform: "uppercase",
            letterSpacing: 1,
            marginBottom: 8,
          }}
        >
          Final matchup
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 7,
          }}
        >
          <StatRow
            icon={<Heart size={11} />}
            label="HP"
            value={formatNumber(playerStats.maxHp)}
          />

          <StatRow
            icon={<Sword size={11} />}
            label="Attack"
            value={formatNumber(playerStats.attack)}
          />

          <StatRow
            icon={<Shield size={11} />}
            label="Defense"
            value={formatNumber(playerStats.defense)}
          />

          <StatRow
            icon={<Sparkles size={11} />}
            label="Dodge"
            value={formatPercent(playerStats.dodge)}
          />

          <StatRow
            icon={<Flame size={11} />}
            label="Crit"
            value={formatPercent(playerStats.crit)}
          />

          <StatRow
            icon={<Shield size={11} />}
            label="Reduction"
            value={formatPercent(playerStats.damageReduction)}
          />
        </div>
      </div>

      <button
        onClick={onFight}
        style={{
          width: "100%",
          padding: "14px 0",
          borderRadius: 5,
          border: "none",
          background: COLORS.chrome,
          color: COLORS.void,
          fontFamily: FONT_DISPLAY,
          fontWeight: 800,
          fontSize: 13,
          letterSpacing: 0.8,
          textTransform: "uppercase",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 7,
        }}
      >
        <Sword size={14} />
        Fight
      </button>

      <div
        style={{
          textAlign: "center",
          fontFamily: FONT_MONO,
          fontSize: 8,
          color: COLORS.textMuted,
          marginTop: 8,
        }}
      >
        No undo. See what happens.
      </div>
    </div>
  );
}

// ============================================================================
// RESULT
// ============================================================================

function ResultScreen({
  round,
  result,
  enemy,
  checkpoint,
  onNext,
  onRetry,
  onMenu,
}: {
  round: number;
  result: ReturnType<typeof simulateBattle>;
  enemy: Enemy;
  checkpoint: number;
  onNext: () => void;
  onRetry: () => void;
  onMenu: () => void;
}) {
  const won = result.playerWon;

  return (
    <div>
      <div
        style={{
          textAlign: "center",
          padding: "15px 0 13px",
        }}
      >
        <motion.div
          initial={{ scale: 0.5, rotate: -20 }}
          animate={{ scale: 1, rotate: 0 }}
        >
          {won ? (
            <Trophy
              size={32}
              color={COLORS.chrome}
              style={{ margin: "0 auto" }}
            />
          ) : (
            <Skull
              size={32}
              color={COLORS.textMuted}
              style={{ margin: "0 auto" }}
            />
          )}
        </motion.div>

        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 800,
            fontSize: 20,
            color: COLORS.text,
            marginTop: 8,
          }}
        >
          {won ? "YOU WON" : "YOU LOST"}
        </div>

        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 9,
            color: COLORS.textMuted,
            marginTop: 3,
          }}
        >
          Round {round} · {result.turns} turns
        </div>
      </div>

      {/* FINAL HP */}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 8,
          marginBottom: 10,
        }}
      >
        <ResultStat
          label="Your HP"
          value={formatNumber(result.player.hp)}
          sub={`/${formatNumber(result.player.maxHp)}`}
        />

        <ResultStat
          label="Enemy HP"
          value={formatNumber(result.enemy.hp)}
          sub={`/${formatNumber(result.enemy.maxHp)}`}
        />
      </div>

      {/* BATTLE LOG */}

      <div
        style={{
          padding: "10px",
          borderRadius: 6,
          background: COLORS.panel,
          border: `1px solid ${COLORS.panelLine}`,
          marginBottom: 10,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontFamily: FONT_MONO,
            fontSize: 8,
            color: COLORS.textMuted,
            textTransform: "uppercase",
            letterSpacing: 1,
            marginBottom: 7,
          }}
        >
          <Eye size={11} />
          What happened
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {result.logs.map((log, index) => (
            <div
              key={index}
              style={{
                display: "flex",
                gap: 7,
                alignItems: "center",
                fontFamily: FONT_MONO,
                fontSize: 8.5,
                color:
                  log.attacker === "player"
                    ? COLORS.text
                    : COLORS.textMuted,
              }}
            >
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  background:
                    log.attacker === "player"
                      ? COLORS.chrome
                      : COLORS.textMuted,
                  flexShrink: 0,
                }}
              />

              <span style={{ flex: 1 }}>{log.text}</span>

              {log.damage && (
                <span
                  style={{
                    color: log.critical
                      ? COLORS.chrome
                      : COLORS.textMuted,
                    fontWeight: log.critical ? 800 : 400,
                  }}
                >
                  -{formatNumber(log.damage)}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ENEMY REVEAL */}

      <div
        style={{
          padding: "11px 12px",
          borderRadius: 6,
          background: COLORS.panel,
          border: `1px solid ${COLORS.panelLine}`,
          marginBottom: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div
              style={{
                fontFamily: FONT_DISPLAY,
                fontWeight: 700,
                fontSize: 12,
                color: COLORS.text,
              }}
            >
              {enemy.name}
            </div>

            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 8,
                color: COLORS.textMuted,
                marginTop: 2,
              }}
            >
              Enemy build revealed
            </div>
          </div>

          <Eye size={14} color={COLORS.chrome} />
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 4,
            marginTop: 8,
          }}
        >
          {enemy.cards.map((card, index) => (
            <span
              key={`${card.id}-${index}`}
              style={{
                padding: "4px 6px",
                borderRadius: 3,
                background: `${COLORS.chrome}10`,
                border: `1px solid ${COLORS.panelLine}`,
                fontFamily: FONT_MONO,
                fontSize: 7.5,
                color: COLORS.textMuted,
              }}
            >
              {card.icon} {card.name}
            </span>
          ))}
        </div>
      </div>

      {won ? (
        <button
          onClick={onNext}
          style={{
            width: "100%",
            padding: "13px 0",
            borderRadius: 5,
            border: "none",
            background: COLORS.chrome,
            color: COLORS.void,
            fontFamily: FONT_DISPLAY,
            fontWeight: 800,
            fontSize: 12,
            letterSpacing: 0.7,
            textTransform: "uppercase",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
          }}
        >
          <ChevronRight size={15} />
          See what&apos;s next
        </button>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <button
            onClick={onRetry}
            style={{
              width: "100%",
              padding: "13px 0",
              borderRadius: 5,
              border: "none",
              background: COLORS.chrome,
              color: COLORS.void,
              fontFamily: FONT_DISPLAY,
              fontWeight: 800,
              fontSize: 12,
              letterSpacing: 0.7,
              textTransform: "uppercase",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
          >
            <RefreshCw size={14} />
            Reroll from checkpoint {checkpoint}
          </button>

          <button
            onClick={onMenu}
            style={{
              width: "100%",
              padding: "11px 0",
              borderRadius: 5,
              border: `1px solid ${COLORS.panelLine}`,
              background: COLORS.panel,
              color: COLORS.textMuted,
              fontFamily: FONT_MONO,
              fontSize: 9,
              cursor: "pointer",
            }}
          >
            End run
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// SMALL COMPONENTS
// ============================================================================

function StatTile({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div
      style={{
        padding: "11px 12px",
        borderRadius: 5,
        background: COLORS.panel,
        border: `1px solid ${COLORS.panelLine}`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          color: COLORS.chrome,
        }}
      >
        {icon}

        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: 8,
            color: COLORS.textMuted,
            textTransform: "uppercase",
          }}
        >
          {label}
        </span>
      </div>

      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 15,
          fontWeight: 700,
          color: COLORS.text,
          marginTop: 5,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div
      style={{
        padding: "6px",
        borderRadius: 3,
        background: COLORS.void,
        border: `1px solid ${COLORS.panelLine}`,
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 7,
          color: COLORS.textMuted,
        }}
      >
        {label}
      </div>

      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 9,
          color: COLORS.text,
          fontWeight: 700,
          marginTop: 2,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function Combatant({
  title,
  hp,
  attack,
  defense,
  icon,
}: {
  title: string;
  hp: number;
  attack: number;
  defense: number;
  icon: React.ReactNode;
}) {
  return (
    <div
      style={{
        padding: "10px",
        borderRadius: 6,
        background: COLORS.panel,
        border: `1px solid ${COLORS.panelLine}`,
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          color: COLORS.chrome,
        }}
      >
        {icon}

        <span
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: 9,
            fontWeight: 700,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </span>
      </div>

      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 15,
          fontWeight: 700,
          color: COLORS.text,
          marginTop: 6,
        }}
      >
        {formatNumber(hp)}
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          marginTop: 3,
          fontFamily: FONT_MONO,
          fontSize: 7.5,
          color: COLORS.textMuted,
        }}
      >
        <span>ATK {formatNumber(attack)}</span>
        <span>DEF {formatNumber(defense)}</span>
      </div>
    </div>
  );
}

function ResultStat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div
      style={{
        padding: "12px",
        borderRadius: 6,
        background: COLORS.panel,
        border: `1px solid ${COLORS.panelLine}`,
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 8,
          color: COLORS.textMuted,
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>

      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 17,
          fontWeight: 700,
          color: COLORS.text,
          marginTop: 4,
        }}
      >
        {value}
      </div>

      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 7.5,
          color: COLORS.textMuted,
          marginTop: 1,
        }}
      >
        {sub}
      </div>
    </div>
  );
}
