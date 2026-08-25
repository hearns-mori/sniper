"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Brain,
  Crosshair,
  Dices,
  Flame,
  Heart,
  Play,
  RefreshCw,
  Shield,
  Skull,
  Sparkles,
  Swords,
  Target,
  Trophy,
  Zap,
} from "lucide-react";

import { COLORS, FONT_DISPLAY, FONT_MONO } from "@/lib/theme";

type Phase = "menu" | "build" | "battle" | "result";

interface PhaserShooterProps {
  lifetimeKills: number;
  onExit: () => void;
}

// ============================================================================
// TYPES
// ============================================================================

type StatKey =
  | "hp"
  | "attack"
  | "defense"
  | "crit"
  | "dodge"
  | "lifesteal"
  | "damageReduction"
  | "damageAmp"
  | "penetration"
  | "accuracy"
  | "thorns"
  | "attackSpeed"
  | "critDamage"
  | "execute"
  | "doubleStrike";

interface Stats {
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  crit: number;
  dodge: number;
  lifesteal: number;
  damageReduction: number;
  damageAmp: number;
  penetration: number;
  accuracy: number;
  thorns: number;
  attackSpeed: number;
  critDamage: number;
  execute: number;
  doubleStrike: number;
}

interface Enemy {
  id: number;
  name: string;
  title: string;
  stats: Stats;
  level: number;
  rarity: "common" | "elite" | "boss";
}

interface UpgradeCard {
  id: string;
  name: string;
  description: string;
  rarity: "common" | "rare" | "epic" | "legendary";
  apply: (stats: Stats) => Stats;
  tag: string;
}

interface BattleLog {
  id: number;
  text: string;
  type: "player" | "enemy" | "critical" | "system";
}

// ============================================================================
// STORAGE
// ============================================================================

const STORAGE_KEY = "phaserShooter_build_v2";

interface SavedState {
  bestCheckpoint: number;
  totalWins: number;
  totalRuns: number;
}

function loadSavedState(): SavedState {
  if (typeof window === "undefined") {
    return {
      bestCheckpoint: 0,
      totalWins: 0,
      totalRuns: 0,
    };
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return {
        bestCheckpoint: 0,
        totalWins: 0,
        totalRuns: 0,
      };
    }

    const parsed = JSON.parse(raw) as Partial<SavedState>;

    return {
      bestCheckpoint: Math.max(0, Number(parsed.bestCheckpoint) || 0),
      totalWins: Math.max(0, Number(parsed.totalWins) || 0),
      totalRuns: Math.max(0, Number(parsed.totalRuns) || 0),
    };
  } catch {
    return {
      bestCheckpoint: 0,
      totalWins: 0,
      totalRuns: 0,
    };
  }
}

function saveState(state: SavedState) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore localStorage errors.
  }
}

// ============================================================================
// RANDOM
// ============================================================================

let randomId = 0;

function uid(prefix = "id") {
  randomId += 1;
  return `${prefix}-${Date.now()}-${randomId}`;
}

function randomFloat(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

function randomInt(min: number, max: number) {
  return Math.floor(randomFloat(min, max + 1));
}

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];

  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));

    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

// ============================================================================
// LEVEL SYSTEM
// ============================================================================

interface LevelInfo {
  level: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
  multiplier: number;
}

function xpForLevel(level: number) {
  return Math.max(521, Math.floor(521 * Math.pow(1.08, level - 1)));
}

function levelFromLifetimeKills(kills: number): LevelInfo {
  let remaining = Math.max(0, Math.floor(kills));
  let level = 1;

  while (remaining >= xpForLevel(level)) {
    remaining -= xpForLevel(level);
    level += 1;
  }

  return {
    level,
    xpIntoLevel: remaining,
    xpForNextLevel: xpForLevel(level),
    multiplier: Math.pow(level, 1.521),
  };
}

// ============================================================================
// BASE STATS
// ============================================================================

function createBaseStats(levelInfo: LevelInfo): Stats {
  const l = levelInfo.level;
  const m = levelInfo.multiplier;

  return {
    hp: Math.round(100 + l * 18 * m),
    maxHp: Math.round(100 + l * 18 * m),
    attack: Math.round(15 + l * 5 * m),
    defense: Math.round(5 + l * 2.2 * m),
    crit: 5,
    dodge: 5,
    lifesteal: 0,
    damageReduction: 0,
    damageAmp: 0,
    penetration: 0,
    accuracy: 90,
    thorns: 0,
    attackSpeed: 1,
    critDamage: 150,
    execute: 0,
    doubleStrike: 0,
  };
}

function cloneStats(stats: Stats): Stats {
  return { ...stats };
}

function clampStats(stats: Stats): Stats {
  return {
    ...stats,
    hp: Math.max(1, stats.hp),
    maxHp: Math.max(1, stats.maxHp),
    attack: Math.max(1, stats.attack),
    defense: Math.max(0, stats.defense),
    crit: Math.min(100, Math.max(0, stats.crit)),
    dodge: Math.min(75, Math.max(0, stats.dodge)),
    lifesteal: Math.min(100, Math.max(0, stats.lifesteal)),
    damageReduction: Math.min(80, Math.max(0, stats.damageReduction)),
    damageAmp: Math.max(0, stats.damageAmp),
    penetration: Math.min(100, Math.max(0, stats.penetration)),
    accuracy: Math.min(100, Math.max(1, stats.accuracy)),
    thorns: Math.max(0, stats.thorns),
    attackSpeed: Math.max(0.25, stats.attackSpeed),
    critDamage: Math.max(100, stats.critDamage),
    execute: Math.min(100, Math.max(0, stats.execute)),
    doubleStrike: Math.min(75, Math.max(0, stats.doubleStrike)),
  };
}

// ============================================================================
// ENEMIES
// ============================================================================

const ENEMY_NAMES = [
  "The Unknown",
  "Iron Fang",
  "Glass Cannon",
  "Void Walker",
  "Blood Hunter",
  "The Gambler",
  "Nightmare",
  "Stone Giant",
  "Executioner",
  "Mirror Knight",
  "Chaos Beast",
  "The Collector",
  "Crimson Machine",
  "Phantom",
  "Overlord",
];

const ENEMY_TITLES = [
  "Unpredictable",
  "Relentless",
  "Adapted",
  "Cursed",
  "Ancient",
  "Experimental",
  "Awakened",
  "Ruthless",
  "Unknown",
];

function createEnemy(
  checkpoint: number,
  levelInfo: LevelInfo,
): Enemy {
  const difficulty = Math.pow(1.105, checkpoint);
  const levelScale = Math.pow(levelInfo.level, 0.72);

  const baseHp =
    (115 + levelInfo.level * 14) *
    difficulty *
    levelScale;

  const baseAttack =
    (13 + levelInfo.level * 4) *
    difficulty *
    Math.pow(levelScale, 0.65);

  const style = randomInt(0, 7);

  const stats: Stats = {
    hp: baseHp,
    maxHp: baseHp,
    attack: baseAttack,
    defense: 5 * difficulty,
    crit: 5,
    dodge: 5,
    lifesteal: 0,
    damageReduction: 0,
    damageAmp: 0,
    penetration: 0,
    accuracy: 90,
    thorns: 0,
    attackSpeed: 1,
    critDamage: 150,
    execute: 0,
    doubleStrike: 0,
  };

  // Every enemy gets a different archetype.
  switch (style) {
    case 0:
      stats.attack *= 1.65;
      stats.hp *= 0.72;
      stats.crit += 20;
      stats.critDamage += 35;
      break;

    case 1:
      stats.hp *= 1.85;
      stats.defense *= 1.55;
      stats.attack *= 0.72;
      stats.damageReduction += 15;
      break;

    case 2:
      stats.dodge += 30;
      stats.accuracy += 5;
      stats.attack *= 0.92;
      break;

    case 3:
      stats.attack *= 1.25;
      stats.lifesteal += 25;
      stats.thorns += baseAttack * 0.15;
      break;

    case 4:
      stats.penetration += 45;
      stats.damageAmp += 35;
      stats.defense *= 0.7;
      break;

    case 5:
      stats.doubleStrike += 30;
      stats.attack *= 0.82;
      stats.attackSpeed = 1.4;
      break;

    case 6:
      stats.damageReduction += 25;
      stats.dodge += 10;
      stats.attack *= 0.78;
      break;

    default:
      stats.hp *= 1.15;
      stats.attack *= 1.15;
      stats.crit += 10;
      stats.dodge += 8;
      stats.lifesteal += 10;
      stats.penetration += 10;
      break;
  }

  // Random mutations make identical checkpoint enemies unlikely.
  stats.hp *= randomFloat(0.82, 1.22);
  stats.attack *= randomFloat(0.84, 1.18);
  stats.defense *= randomFloat(0.8, 1.2);
  stats.crit += randomFloat(-4, 8);
  stats.dodge += randomFloat(-3, 8);

  const rarityRoll = Math.random();

  let rarity: Enemy["rarity"] = "common";

  if (checkpoint > 0 && rarityRoll > 0.9) {
    rarity = "boss";
  } else if (rarityRoll > 0.68) {
    rarity = "elite";
  }

  if (rarity === "elite") {
    stats.hp *= 1.25;
    stats.attack *= 1.18;
    stats.defense *= 1.15;
  }

  if (rarity === "boss") {
    stats.hp *= 1.75;
    stats.attack *= 1.4;
    stats.defense *= 1.3;
  }

  stats.maxHp = stats.hp;

  return {
    id: randomInt(1, 999999999),
    name: pick(ENEMY_NAMES),
    title: pick(ENEMY_TITLES),
    stats: clampStats(stats),
    level: Math.max(1, levelInfo.level + Math.floor(checkpoint * 0.65)),
    rarity,
  };
}

// ============================================================================
// UPGRADE CARDS
// ============================================================================

function card(
  id: string,
  name: string,
  description: string,
  rarity: UpgradeCard["rarity"],
  tag: string,
  apply: (stats: Stats) => Stats,
): UpgradeCard {
  return {
    id,
    name,
    description,
    rarity,
    tag,
    apply,
  };
}

function createCardPool(): UpgradeCard[] {
  return [
    card(
      "attack25",
      "+25% Attack",
      "Increase final attack by 25%.",
      "common",
      "OFFENSE",
      (s) => ({ ...s, attack: s.attack * 1.25 }),
    ),

    card(
      "attack50",
      "+50% Attack",
      "Massively increase attack.",
      "rare",
      "OFFENSE",
      (s) => ({ ...s, attack: s.attack * 1.5 }),
    ),

    card(
      "attack100",
      "+100 Attack",
      "Add 100 flat attack.",
      "common",
      "OFFENSE",
      (s) => ({ ...s, attack: s.attack + 100 }),
    ),

    card(
      "doubleAttack",
      "×2 Attack",
      "Double your current attack.",
      "legendary",
      "OFFENSE",
      (s) => ({ ...s, attack: s.attack * 2 }),
    ),

    card(
      "damageAmp25",
      "+25% Final Damage",
      "Deal 25% more final damage.",
      "common",
      "DAMAGE",
      (s) => ({ ...s, damageAmp: s.damageAmp + 25 }),
    ),

    card(
      "damageAmp50",
      "+50% Final Damage",
      "Deal 50% more final damage.",
      "rare",
      "DAMAGE",
      (s) => ({ ...s, damageAmp: s.damageAmp + 50 }),
    ),

    card(
      "ignoreDefense",
      "+35% Penetration",
      "Ignore 35% of enemy defense.",
      "rare",
      "DAMAGE",
      (s) => ({ ...s, penetration: s.penetration + 35 }),
    ),

    card(
      "ignoreDefenseHuge",
      "Ignore 75% Defense",
      "Massively penetrate enemy defense.",
      "legendary",
      "DAMAGE",
      (s) => ({ ...s, penetration: s.penetration + 75 }),
    ),

    card(
      "crit25",
      "+25% Critical",
      "Gain 25 percentage points of critical chance.",
      "rare",
      "CRIT",
      (s) => ({ ...s, crit: s.crit + 25 }),
    ),

    card(
      "critDamage",
      "+100% Critical Damage",
      "Critical hits deal 100% additional damage.",
      "epic",
      "CRIT",
      (s) => ({ ...s, critDamage: s.critDamage + 100 }),
    ),

    card(
      "dodge25",
      "+25% Dodge",
      "25% chance to completely avoid an attack.",
      "rare",
      "DEFENSE",
      (s) => ({ ...s, dodge: s.dodge + 25 }),
    ),

    card(
      "dodge50",
      "+50% Dodge",
      "Huge chance to avoid attacks.",
      "legendary",
      "DEFENSE",
      (s) => ({ ...s, dodge: s.dodge + 50 }),
    ),

    card(
      "reduction25",
      "+25% Damage Reduction",
      "Take 25% less incoming damage.",
      "rare",
      "DEFENSE",
      (s) => ({ ...s, damageReduction: s.damageReduction + 25 }),
    ),

    card(
      "reduction50",
      "+50% Damage Reduction",
      "Take dramatically less incoming damage.",
      "epic",
      "DEFENSE",
      (s) => ({ ...s, damageReduction: s.damageReduction + 50 }),
    ),

    card(
      "hp50",
      "+50% Maximum HP",
      "Multiply your maximum health by 50%.",
      "common",
      "SURVIVAL",
      (s) => {
        const factor = 1.5;

        return {
          ...s,
          maxHp: s.maxHp * factor,
          hp: s.hp * factor,
        };
      },
    ),

    card(
      "hp100",
      "×2 Maximum HP",
      "Double your maximum health.",
      "legendary",
      "SURVIVAL",
      (s) => ({
        ...s,
        maxHp: s.maxHp * 2,
        hp: s.hp * 2,
      }),
    ),

    card(
      "lifesteal25",
      "+25% Lifesteal",
      "Recover 25% of damage dealt as HP.",
      "rare",
      "SUSTAIN",
      (s) => ({ ...s, lifesteal: s.lifesteal + 25 }),
    ),

    card(
      "lifesteal50",
      "+50% Lifesteal",
      "Recover half of damage dealt.",
      "epic",
      "SUSTAIN",
      (s) => ({ ...s, lifesteal: s.lifesteal + 50 }),
    ),

    card(
      "defense50",
      "+50 Defense",
      "Add 50 defense.",
      "common",
      "DEFENSE",
      (s) => ({ ...s, defense: s.defense + 50 }),
    ),

    card(
      "defense100",
      "+100 Defense",
      "Add 100 defense.",
      "rare",
      "DEFENSE",
      (s) => ({ ...s, defense: s.defense + 100 }),
    ),

    card(
      "accuracy",
      "+15% Accuracy",
      "Reduce the enemy's ability to evade your attacks.",
      "common",
      "PRECISION",
      (s) => ({ ...s, accuracy: s.accuracy + 15 }),
    ),

    card(
      "thorns",
      "+50 Thorns",
      "Reflect 50 damage whenever attacked.",
      "common",
      "REFLECT",
      (s) => ({ ...s, thorns: s.thorns + 50 }),
    ),

    card(
      "thornsPercent",
      "+20% Thorns",
      "Reflect 20% of incoming damage.",
      "epic",
      "REFLECT",
      (s) => ({ ...s, thorns: s.thorns + s.attack * 0.2 }),
    ),

    card(
      "doubleStrike",
      "+25% Double Strike",
      "25% chance to attack twice.",
      "epic",
      "SPEED",
      (s) => ({ ...s, doubleStrike: s.doubleStrike + 25 }),
    ),

    card(
      "speed",
      "+50% Attack Speed",
      "Attack 50% more often.",
      "rare",
      "SPEED",
      (s) => ({ ...s, attackSpeed: s.attackSpeed * 1.5 }),
    ),

    card(
      "execute",
      "+15% Execute",
      "Instantly finish enemies below 15% HP.",
      "epic",
      "EXECUTE",
      (s) => ({ ...s, execute: s.execute + 15 }),
    ),

    card(
      "berserker",
      "Berserker",
      "Gain 75% attack but lose 20% damage reduction.",
      "epic",
      "RISK",
      (s) => ({
        ...s,
        attack: s.attack * 1.75,
        damageReduction: Math.max(0, s.damageReduction - 20),
      }),
    ),

    card(
      "glassCannon",
      "Glass Cannon",
      "Double attack, but lose 30% maximum HP.",
      "legendary",
      "RISK",
      (s) => ({
        ...s,
        attack: s.attack * 2,
        maxHp: s.maxHp * 0.7,
        hp: s.hp * 0.7,
      }),
    ),

    card(
      "fortress",
      "Fortress",
      "Double defense and gain 25% damage reduction, but lose 20% attack.",
      "legendary",
      "RISK",
      (s) => ({
        ...s,
        defense: s.defense * 2,
        damageReduction: s.damageReduction + 25,
        attack: s.attack * 0.8,
      }),
    ),

    card(
      "vampire",
      "Vampire",
      "Gain 40% lifesteal and 20% attack.",
      "epic",
      "SUSTAIN",
      (s) => ({
        ...s,
        lifesteal: s.lifesteal + 40,
        attack: s.attack * 1.2,
      }),
    ),

    card(
      "assassin",
      "Assassin",
      "Gain 35% crit and 50% critical damage.",
      "epic",
      "CRIT",
      (s) => ({
        ...s,
        crit: s.crit + 35,
        critDamage: s.critDamage + 50,
      }),
    ),

    card(
      "chaos",
      "???",
      "Something random happens.",
      "legendary",
      "CHAOS",
      (s) => {
        const outcomes = [
          (x: Stats) => ({ ...x, attack: x.attack * 1.8 }),
          (x: Stats) => ({ ...x, maxHp: x.maxHp * 1.8, hp: x.hp * 1.8 }),
          (x: Stats) => ({ ...x, dodge: x.dodge + 35 }),
          (x: Stats) => ({ ...x, crit: x.crit + 40 }),
          (x: Stats) => ({
            ...x,
            damageReduction: x.damageReduction + 30,
          }),
          (x: Stats) => ({
            ...x,
            penetration: x.penetration + 60,
          }),
        ];

        return pick(outcomes)(s);
      },
    ),
  ];
}

// ============================================================================
// CARD DRAW
// ============================================================================

function drawCards(count = 3): UpgradeCard[] {
  const pool = createCardPool();

  return shuffle(pool).slice(0, count);
}

// ============================================================================
// BATTLE
// ============================================================================

interface BattleResult {
  winner: "player" | "enemy";
  playerHp: number;
  enemyHp: number;
  logs: BattleLog[];
  turns: number;
}

function calculateDamage(
  attacker: Stats,
  defender: Stats,
): {
  damage: number;
  critical: boolean;
  dodged: boolean;
} {
  const accuracyRoll = Math.random() * 100;

  if (accuracyRoll > attacker.accuracy - defender.dodge) {
    return {
      damage: 0,
      critical: false,
      dodged: true,
    };
  }

  const critical = Math.random() * 100 < attacker.crit;

  const defenseAfterPen =
    defender.defense *
    Math.max(0, 1 - attacker.penetration / 100);

  const defenseMultiplier =
    100 / (100 + Math.max(0, defenseAfterPen));

  let damage =
    attacker.attack *
    defenseMultiplier;

  damage *= 1 + attacker.damageAmp / 100;

  if (critical) {
    damage *= attacker.critDamage / 100;
  }

  damage *= randomFloat(0.88, 1.12);

  return {
    damage: Math.max(1, damage),
    critical,
    dodged: false,
  };
}

function runBattle(
  originalPlayer: Stats,
  originalEnemy: Stats,
): BattleResult {
  const player = cloneStats(originalPlayer);
  const enemy = cloneStats(originalEnemy);

  const logs: BattleLog[] = [];
  let playerHp = player.hp;
  let enemyHp = enemy.hp;

  let turns = 0;

  const addLog = (
    text: string,
    type: BattleLog["type"],
  ) => {
    logs.push({
      id: logs.length,
      text,
      type,
    });
  };

  while (playerHp > 0 && enemyHp > 0 && turns < 100) {
    turns += 1;

    // Player attacks.
    const playerHit = calculateDamage(player, enemy);

    if (playerHit.dodged) {
      addLog("Enemy dodged your attack.", "enemy");
    } else {
      let damage = playerHit.damage;

      damage *= Math.max(
        0.2,
        1 - enemy.damageReduction / 100,
      );

      damage = Math.max(1, damage);

      enemyHp -= damage;

      if (playerHit.critical) {
        addLog(
          `CRITICAL! You dealt ${Math.round(damage)} damage.`,
          "critical",
        );
      } else {
        addLog(
          `You dealt ${Math.round(damage)} damage.`,
          "player",
        );
      }

      if (player.lifesteal > 0) {
        const healing =
          damage * (player.lifesteal / 100);

        playerHp = Math.min(
          player.maxHp,
          playerHp + healing,
        );
      }

      if (
        enemyHp <=
        enemy.maxHp * (player.execute / 100)
      ) {
        enemyHp = 0;

        addLog(
          "EXECUTED. The enemy could not survive.",
          "critical",
        );
      }
    }

    if (enemyHp <= 0) break;

    // Double strike.
    if (Math.random() * 100 < player.doubleStrike) {
      const second = calculateDamage(player, enemy);

      if (!second.dodged) {
        let damage =
          second.damage *
          Math.max(
            0.2,
            1 - enemy.damageReduction / 100,
          );

        damage = Math.max(1, damage);

        enemyHp -= damage;

        addLog(
          `DOUBLE STRIKE dealt ${Math.round(damage)} damage.`,
          second.critical ? "critical" : "player",
        );
      }
    }

    if (enemyHp <= 0) break;

    // Enemy attacks.
    const enemyHit = calculateDamage(enemy, player);

    if (enemyHit.dodged) {
      addLog("You dodged the enemy attack.", "player");
    } else {
      let damage =
        enemyHit.damage *
        Math.max(
          0.2,
          1 - player.damageReduction / 100,
        );

      damage = Math.max(1, damage);

      playerHp -= damage;

      if (enemyHit.critical) {
        addLog(
          `Enemy CRIT! You lost ${Math.round(damage)} HP.`,
          "critical",
        );
      } else {
        addLog(
          `Enemy dealt ${Math.round(damage)} damage.`,
          "enemy",
        );
      }

      if (player.thorns > 0) {
        const reflected = Math.min(
          player.thorns,
          enemyHp,
        );

        enemyHp -= reflected;

        addLog(
          `Thorns reflected ${Math.round(reflected)} damage.`,
          "player",
        );
      }

      if (enemy.lifesteal > 0) {
        const healing =
          damage * (enemy.lifesteal / 100);

        enemyHp = Math.min(
          enemy.maxHp,
          enemyHp + healing,
        );
      }
    }
  }

  const winner =
    playerHp > 0 && enemyHp <= 0
      ? "player"
      : "enemy";

  return {
    winner,
    playerHp: Math.max(0, playerHp),
    enemyHp: Math.max(0, enemyHp),
    logs: logs.slice(-30),
    turns,
  };
}

// ============================================================================
// FORMAT
// ============================================================================

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";

  if (Math.abs(value) < 1000) {
    return Math.round(value).toString();
  }

  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: number) {
  return `${Math.round(value)}%`;
}

function rarityColor(
  rarity: UpgradeCard["rarity"],
): string {
  switch (rarity) {
    case "legendary":
      return "#ffd166";
    case "epic":
      return "#c77dff";
    case "rare":
      return "#5dade2";
    default:
      return COLORS.chrome;
  }
}

// ============================================================================
// MAIN
// ============================================================================

export default function PhaserShooter({
  lifetimeKills,
  onExit,
}: PhaserShooterProps) {
  const levelInfo = useMemo(
    () => levelFromLifetimeKills(lifetimeKills),
    [lifetimeKills],
  );

  const [phase, setPhase] =
    useState<Phase>("menu");

  const [saved, setSaved] =
    useState<SavedState>(() => loadSavedState());

  const [checkpoint, setCheckpoint] =
    useState(0);

  const [playerStats, setPlayerStats] =
    useState<Stats>(() => createBaseStats(levelInfo));

  const [enemy, setEnemy] =
    useState<Enemy | null>(null);

  const [cards, setCards] =
    useState<UpgradeCard[]>([]);

  const [selectedCards, setSelectedCards] =
    useState<string[]>([]);

  const [battle, setBattle] =
    useState<BattleResult | null>(null);

  const [battleStep, setBattleStep] =
    useState(0);

  const [isHydrated, setIsHydrated] =
    useState(false);

  // --------------------------------------------------------------------------
  // Hydration
  // --------------------------------------------------------------------------

  useEffect(() => {
    setSaved(loadSavedState());
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (!isHydrated) return;

    saveState(saved);
  }, [saved, isHydrated]);

  // --------------------------------------------------------------------------
  // Start
  // --------------------------------------------------------------------------

  const startRun = useCallback(() => {
    const base = createBaseStats(levelInfo);

    setCheckpoint(0);
    setPlayerStats(base);
    setSelectedCards([]);
    setBattle(null);
    setBattleStep(0);

    const firstEnemy =
      createEnemy(0, levelInfo);

    setEnemy(firstEnemy);
    setCards(drawCards(3));

    setSaved((prev) => ({
      ...prev,
      totalRuns: prev.totalRuns + 1,
    }));

    setPhase("build");
  }, [levelInfo]);

  // --------------------------------------------------------------------------
  // Pick card
  // --------------------------------------------------------------------------

  const chooseCard = useCallback(
    (upgrade: UpgradeCard) => {
      setPlayerStats((previous) =>
        clampStats(
          upgrade.apply(
            cloneStats(previous),
          ),
        ),
      );

      setSelectedCards((previous) => [
        ...previous,
        upgrade.id,
      ]);

      setPhase("battle");
    },
    [],
  );

  // --------------------------------------------------------------------------
  // Fight
  // --------------------------------------------------------------------------

  const fight = useCallback(() => {
    if (!enemy) return;

    const result = runBattle(
      playerStats,
      enemy.stats,
    );

    setBattle(result);
    setBattleStep(0);
  }, [enemy, playerStats]);

  useEffect(() => {
    if (phase !== "battle") return;
    if (battle) return;

    const timer = window.setTimeout(
      fight,
      350,
    );

    return () => window.clearTimeout(timer);
  }, [phase, battle, fight]);

  // --------------------------------------------------------------------------
  // Battle animation
  // --------------------------------------------------------------------------

  useEffect(() => {
    if (!battle) return;

    if (
      battleStep >= battle.logs.length
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      setBattleStep((previous) =>
        previous + 1,
      );
    }, 420);

    return () => window.clearTimeout(timer);
  }, [battle, battleStep]);

  // --------------------------------------------------------------------------
  // Battle finished
  // --------------------------------------------------------------------------

  const battleFinished =
    !!battle &&
    battleStep >= battle.logs.length;

  useEffect(() => {
    if (!battleFinished || !battle) return;

    if (battle.winner === "enemy") {
      setSaved((previous) => ({
        ...previous,
        bestCheckpoint: Math.max(
          previous.bestCheckpoint,
          checkpoint,
        ),
      }));

      setPhase("result");

      return;
    }

    // Player won.
    setSaved((previous) => ({
      ...previous,
      totalWins: previous.totalWins + 1,
      bestCheckpoint: Math.max(
        previous.bestCheckpoint,
        checkpoint + 1,
      ),
    }));
  }, [
    battleFinished,
    battle,
    checkpoint,
  ]);

  // --------------------------------------------------------------------------
  // Next enemy
  // --------------------------------------------------------------------------

  const nextEnemy = useCallback(() => {
    const nextCheckpoint =
      checkpoint + 1;

    const next = createEnemy(
      nextCheckpoint,
      levelInfo,
    );

    setCheckpoint(nextCheckpoint);
    setEnemy(next);
    setCards(drawCards(3));
    setBattle(null);
    setBattleStep(0);

    setPhase("build");
  }, [checkpoint, levelInfo]);

  // --------------------------------------------------------------------------
  // Restart
  // --------------------------------------------------------------------------

  const restartRun = useCallback(() => {
    startRun();
  }, [startRun]);

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------

  return (
    <div
      style={{
        width: "100%",
        position: "relative",
      }}
    >
      <AnimatePresence mode="wait">
        {phase === "menu" && (
          <motion.div
            key="menu"
            initial={{
              opacity: 0,
              y: 10,
            }}
            animate={{
              opacity: 1,
              y: 0,
            }}
            exit={{
              opacity: 0,
              y: -10,
            }}
          >
            <Menu
              levelInfo={levelInfo}
              saved={saved}
              hydrated={isHydrated}
              onStart={startRun}
            />
          </motion.div>
        )}

        {phase === "build" &&
          enemy && (
            <motion.div
              key={`build-${checkpoint}-${enemy.id}`}
              initial={{
                opacity: 0,
                scale: 0.98,
              }}
              animate={{
                opacity: 1,
                scale: 1,
              }}
              exit={{
                opacity: 0,
                scale: 0.98,
              }}
            >
              <BuildScreen
                levelInfo={levelInfo}
                checkpoint={checkpoint}
                player={playerStats}
                enemy={enemy}
                cards={cards}
                selectedCards={selectedCards}
                onChoose={chooseCard}
              />
            </motion.div>
          )}

        {phase === "battle" &&
          enemy && (
            <motion.div
              key="battle"
              initial={{
                opacity: 0,
              }}
              animate={{
                opacity: 1,
              }}
            >
              <BattleScreen
                checkpoint={checkpoint}
                player={playerStats}
                enemy={enemy}
                battle={battle}
                battleStep={battleStep}
              />
            </motion.div>
          )}

        {phase === "result" &&
          battle &&
          enemy && (
            <motion.div
              key="result"
              initial={{
                opacity: 0,
                scale: 0.96,
              }}
              animate={{
                opacity: 1,
                scale: 1,
              }}
            >
              <ResultScreen
                checkpoint={checkpoint}
                battle={battle}
                enemy={enemy}
                bestCheckpoint={
                  saved.bestCheckpoint
                }
                onRestart={restartRun}
                onExit={onExit}
              />
            </motion.div>
          )}
      </AnimatePresence>

      {phase !== "result" && (
        <button
          onClick={onExit}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 5,
            margin:
              "18px auto 0",
            padding:
              "7px 8px",
            border: "none",
            background:
              "transparent",
            color:
              COLORS.textMuted,
            fontFamily:
              FONT_MONO,
            fontSize: 10,
            textTransform:
              "uppercase",
            letterSpacing: 1,
            cursor: "pointer",
          }}
        >
          <ArrowLeft size={12} />
          Exit
        </button>
      )}
    </div>
  );
}

// ============================================================================
// MENU
// ============================================================================

function Menu({
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
  const xp =
    levelInfo.xpForNextLevel > 0
      ? levelInfo.xpIntoLevel /
        levelInfo.xpForNextLevel
      : 0;

  return (
    <div>
      <div
        style={{
          padding:
            "18px 16px",
          border:
            `1px solid ${COLORS.panelLine}`,
          background:
            COLORS.panel,
          borderRadius: 8,
          marginBottom: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent:
              "space-between",
            alignItems:
              "center",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems:
                "center",
              gap: 8,
            }}
          >
            <Sparkles
              size={17}
              color={
                COLORS.chrome
              }
            />

            <span
              style={{
                fontFamily:
                  FONT_DISPLAY,
                fontSize: 18,
                fontWeight: 800,
                color:
                  COLORS.text,
              }}
            >
              Level{" "}
              {levelInfo.level}
            </span>
          </div>

          <span
            style={{
              fontFamily:
                FONT_MONO,
              fontSize: 9,
              color:
                COLORS.textMuted,
            }}
          >
            ×
            {levelInfo.multiplier.toFixed(
              2,
            )} power
          </span>
        </div>

        <div
          style={{
            height: 6,
            marginTop: 12,
            borderRadius: 4,
            background:
              COLORS.void,
            overflow:
              "hidden",
          }}
        >
          <motion.div
            animate={{
              width:
                `${xp * 100}%`,
            }}
            style={{
              height: "100%",
              background:
                COLORS.chrome,
            }}
          />
        </div>

        <div
          style={{
            display: "flex",
            justifyContent:
              "space-between",
            marginTop: 5,
            fontFamily:
              FONT_MONO,
            fontSize: 8,
            color:
              COLORS.textMuted,
          }}
        >
          <span>
            {formatNumber(
              levelInfo.xpIntoLevel,
            )}{" "}
            XP
          </span>

          <span>
            {formatNumber(
              levelInfo.xpForNextLevel,
            )}{" "}
            needed
          </span>
        </div>
      </div>

      <div
        style={{
          padding:
            "18px 16px",
          border:
            `1px solid ${COLORS.panelLine}`,
          background:
            COLORS.panel,
          borderRadius: 8,
          marginBottom: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems:
              "center",
            gap: 8,
            marginBottom: 8,
          }}
        >
          <Brain
            size={17}
            color={
              COLORS.chrome
            }
          />

          <span
            style={{
              fontFamily:
                FONT_DISPLAY,
              fontWeight: 800,
              color:
                COLORS.text,
            }}
          >
            UNKNOWN BUILD
          </span>
        </div>

        <p
          style={{
            margin: 0,
            fontFamily:
              FONT_MONO,
            fontSize: 10.5,
            lineHeight: 1.6,
            color:
              COLORS.textMuted,
          }}
        >
          Every run creates a different
          enemy and a different set of
          choices. Build your fighter,
          discover what works, and see
          what happens next.
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(3, 1fr)",
          gap: 7,
          marginBottom: 14,
        }}
      >
        <MiniStat
          icon={
            <Trophy size={14} />
          }
          label="BEST"
          value={String(
            saved.bestCheckpoint,
          )}
        />

        <MiniStat
          icon={
            <Swords size={14} />
          }
          label="WINS"
          value={String(
            saved.totalWins,
          )}
        />

        <MiniStat
          icon={
            <RefreshCw
              size={14}
            />
          }
          label="RUNS"
          value={String(
            saved.totalRuns,
          )}
        />
      </div>

      <button
        onClick={onStart}
        disabled={!hydrated}
        style={{
          width: "100%",
          display: "flex",
          alignItems:
            "center",
          justifyContent:
            "center",
          gap: 8,
          padding:
            "14px 12px",
          border: "none",
          borderRadius: 6,
          background:
            COLORS.chrome,
          color:
            COLORS.void,
          fontFamily:
            FONT_DISPLAY,
          fontSize: 13,
          fontWeight: 800,
          letterSpacing:
            0.8,
          cursor:
            hydrated
              ? "pointer"
              : "default",
          opacity:
            hydrated
              ? 1
              : 0.5,
        }}
      >
        <Play size={15} />
        ENTER THE UNKNOWN
      </button>
    </div>
  );
}

// ============================================================================
// BUILD SCREEN
// ============================================================================

function BuildScreen({
  levelInfo,
  checkpoint,
  player,
  enemy,
  cards,
  selectedCards,
  onChoose,
}: {
  levelInfo: LevelInfo;
  checkpoint: number;
  player: Stats;
  enemy: Enemy;
  cards: UpgradeCard[];
  selectedCards: string[];
  onChoose: (
    card: UpgradeCard,
  ) => void;
}) {
  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent:
            "space-between",
          alignItems:
            "center",
          marginBottom: 10,
        }}
      >
        <div
          style={{
            fontFamily:
              FONT_MONO,
            fontSize: 10,
            color:
              COLORS.textMuted,
          }}
        >
          LEVEL{" "}
          {levelInfo.level}
        </div>

        <div
          style={{
            display: "flex",
            alignItems:
              "center",
            gap: 5,
            fontFamily:
              FONT_MONO,
            fontSize: 10,
            color:
              COLORS.chrome,
          }}
        >
          <Target size={12} />
          CHECKPOINT{" "}
          {checkpoint}
        </div>
      </div>

      <EnemyPreview enemy={enemy} />

      <div
        style={{
          marginTop: 15,
          marginBottom: 8,
          display: "flex",
          justifyContent:
            "space-between",
          alignItems:
            "center",
        }}
      >
        <span
          style={{
            fontFamily:
              FONT_DISPLAY,
            fontSize: 14,
            fontWeight: 800,
            color:
              COLORS.text,
          }}
        >
          WHAT DO YOU PICK?
        </span>

        <span
          style={{
            fontFamily:
              FONT_MONO,
            fontSize: 9,
            color:
              COLORS.textMuted,
          }}
        >
          Choose 1
        </span>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection:
            "column",
          gap: 9,
        }}
      >
        {cards.map(
          (upgrade) => (
            <UpgradeCardView
              key={
                upgrade.id
              }
              upgrade={
                upgrade
              }
              player={
                player
              }
              disabled={selectedCards.includes(
                upgrade.id,
              )}
              onClick={() =>
                onChoose(
                  upgrade,
                )
              }
            />
          ),
        )}
      </div>

      <div
        style={{
          marginTop: 12,
          textAlign:
            "center",
          fontFamily:
            FONT_MONO,
          fontSize: 8.5,
          color:
            COLORS.textMuted,
        }}
      >
        You cannot know what comes next.
        Choose based on calculation or
        intuition.
      </div>
    </div>
  );
}

// ============================================================================
// ENEMY PREVIEW
// ============================================================================

function EnemyPreview({
  enemy,
}: {
  enemy: Enemy;
}) {
  const s = enemy.stats;

  const rarity =
    enemy.rarity === "boss"
      ? "#ff6b6b"
      : enemy.rarity ===
          "elite"
        ? "#c77dff"
        : COLORS.chrome;

  return (
    <div
      style={{
        padding:
          "14px 14px",
        borderRadius: 8,
        border:
          `1px solid ${rarity}55`,
        background:
          COLORS.panel,
        boxShadow:
          `0 0 20px ${rarity}10`,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent:
            "space-between",
          alignItems:
            "center",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems:
              "center",
            gap: 8,
          }}
        >
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 7,
              display: "flex",
              alignItems:
                "center",
              justifyContent:
                "center",
              background:
                `${rarity}18`,
            }}
          >
            <Skull
              size={20}
              color={
                rarity
              }
            />
          </div>

          <div>
            <div
              style={{
                fontFamily:
                  FONT_DISPLAY,
                fontSize: 15,
                fontWeight: 800,
                color:
                  COLORS.text,
              }}
            >
              {enemy.name}
            </div>

            <div
              style={{
                fontFamily:
                  FONT_MONO,
                fontSize: 8.5,
                color:
                  rarity,
                textTransform:
                  "uppercase",
              }}
            >
              {enemy.title} ·{" "}
              {enemy.rarity}
            </div>
          </div>
        </div>

        <div
          style={{
            fontFamily:
              FONT_MONO,
            fontSize: 9,
            color:
              COLORS.textMuted,
          }}
        >
          LV {enemy.level}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(4, 1fr)",
          gap: 5,
          marginTop: 12,
        }}
      >
        <StatBox
          label="HP"
          value={s.maxHp}
        />

        <StatBox
          label="ATK"
          value={s.attack}
        />

        <StatBox
          label="DEF"
          value={s.defense}
        />

        <StatBox
          label="CRIT"
          value={s.crit}
          percent
        />
      </div>

      <div
        style={{
          display: "flex",
          flexWrap:
            "wrap",
          gap: 5,
          marginTop: 8,
        }}
      >
        <Badge>
          Dodge{" "}
          {formatPercent(
            s.dodge,
          )}
        </Badge>

        <Badge>
          Reduce{" "}
          {formatPercent(
            s.damageReduction,
          )}
        </Badge>

        <Badge>
          Pen{" "}
          {formatPercent(
            s.penetration,
          )}
        </Badge>

        <Badge>
          Speed{" "}
          {s.attackSpeed.toFixed(
            1,
          )}
        </Badge>
      </div>
    </div>
  );
}

// ============================================================================
// UPGRADE CARD
// ============================================================================

function UpgradeCardView({
  upgrade,
  player,
  disabled,
  onClick,
}: {
  upgrade: UpgradeCard;
  player: Stats;
  disabled: boolean;
  onClick: () => void;
}) {
  const color =
    rarityColor(
      upgrade.rarity,
    );

  const preview =
    upgrade.apply(
      cloneStats(
        player,
      ),
    );

  return (
    <motion.button
      whileHover={
        !disabled
          ? {
              scale: 1.015,
              y: -2,
            }
          : undefined
      }
      whileTap={
        !disabled
          ? {
              scale: 0.985,
            }
          : undefined
      }
      onClick={onClick}
      disabled={disabled}
      style={{
        width: "100%",
        textAlign:
          "left",
        padding:
          "13px 13px",
        borderRadius: 7,
        border:
          `1px solid ${color}55`,
        background:
          COLORS.panel,
        cursor:
          disabled
            ? "default"
            : "pointer",
        opacity:
          disabled
            ? 0.45
            : 1,
        position:
          "relative",
        overflow:
          "hidden",
      }}
    >
      <div
        style={{
          position:
            "absolute",
          top: 0,
          left: 0,
          bottom: 0,
          width: 3,
          background:
            color,
        }}
      />

      <div
        style={{
          display: "flex",
          justifyContent:
            "space-between",
          gap: 10,
        }}
      >
        <div
          style={{
            minWidth: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems:
                "center",
              gap: 7,
            }}
          >
            <span
              style={{
                fontFamily:
                  FONT_DISPLAY,
                fontSize: 14,
                fontWeight: 800,
                color:
                  COLORS.text,
              }}
            >
              {upgrade.name}
            </span>

            <span
              style={{
                fontFamily:
                  FONT_MONO,
                fontSize: 7.5,
                padding:
                  "2px 5px",
                borderRadius: 3,
                background:
                  `${color}18`,
                color,
              }}
            >
              {upgrade.rarity}
            </span>
          </div>

          <div
            style={{
              marginTop: 4,
              fontFamily:
                FONT_MONO,
              fontSize: 9.5,
              lineHeight: 1.45,
              color:
                COLORS.textMuted,
            }}
          >
            {
              upgrade.description
            }
          </div>
        </div>

        <ArrowRight
          size={15}
          color={color}
          style={{
            flexShrink: 0,
            marginTop: 2,
          }}
        />
      </div>

      <div
        style={{
          display: "flex",
          flexWrap:
            "wrap",
          gap: 4,
          marginTop: 8,
        }}
      >
        <PreviewChange
          label="ATK"
          before={
            player.attack
          }
          after={
            preview.attack
          }
        />

        <PreviewChange
          label="HP"
          before={
            player.maxHp
          }
          after={
            preview.maxHp
          }
        />

        <PreviewChange
          label="DEF"
          before={
            player.defense
          }
          after={
            preview.defense
          }
        />

        <PreviewChange
          label="CRIT"
          before={
            player.crit
          }
          after={
            preview.crit
          }
          percent
        />
      </div>
    </motion.button>
  );
}

function PreviewChange({
  label,
  before,
  after,
  percent = false,
}: {
  label: string;
  before: number;
  after: number;
  percent?: boolean;
}) {
  const difference =
    after - before;

  if (
    Math.abs(
      difference,
    ) < 0.01
  ) {
    return null;
  }

  const positive =
    difference > 0;

  return (
    <span
      style={{
        padding:
          "2px 5px",
        borderRadius: 3,
        background:
          positive
            ? "#7fd48a18"
            : "#ff6b6b18",
        color:
          positive
            ? "#7fd48a"
            : "#ff6b6b",
        fontFamily:
          FONT_MONO,
        fontSize: 7.5,
      }}
    >
      {label}{" "}
      {positive
        ? "+"
        : ""}
      {percent
        ? Math.round(
            difference,
          )
        : formatNumber(
            difference,
          )}
      {percent
        ? "%"
        : ""}
    </span>
  );
}

// ============================================================================
// BATTLE SCREEN
// ============================================================================

function BattleScreen({
  checkpoint,
  player,
  enemy,
  battle,
  battleStep,
}: {
  checkpoint: number;
  player: Stats;
  enemy: Enemy;
  battle: BattleResult | null;
  battleStep: number;
}) {
  const playerHp =
    battle
      ? battle.playerHp
      : player.hp;

  const enemyHp =
    battle
      ? battle.enemyHp
      : enemy.stats.hp;

  const visibleLogs =
    battle
      ? battle.logs.slice(
          0,
          battleStep,
        )
      : [];

  const playerPct =
    Math.max(
      0,
      playerHp /
        player.maxHp,
    );

  const enemyPct =
    Math.max(
      0,
      enemyHp /
        enemy.stats.maxHp,
    );

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent:
            "space-between",
          alignItems:
            "center",
          marginBottom: 10,
        }}
      >
        <div
          style={{
            fontFamily:
              FONT_MONO,
            fontSize: 9,
            color:
              COLORS.textMuted,
          }}
        >
          CHECKPOINT{" "}
          {checkpoint}
        </div>

        <motion.div
          animate={{
            opacity:
              battle
                ? [1, 0.4, 1]
                : 1,
          }}
          transition={{
            duration: 0.8,
            repeat:
              battle
                ? Infinity
                : 0,
          }}
          style={{
            display: "flex",
            alignItems:
              "center",
            gap: 5,
            fontFamily:
              FONT_MONO,
            fontSize: 9,
            color:
              COLORS.chrome,
          }}
        >
          <Swords size={12} />
          FIGHTING
        </motion.div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "1fr 38px 1fr",
          gap: 7,
          alignItems:
            "center",
        }}
      >
        <Fighter
          name="YOU"
          icon={
            <Shield
              size={20}
            />
          }
          hp={playerHp}
          maxHp={
            player.maxHp
          }
          attack={
            player.attack
          }
          accent={
            COLORS.chrome
          }
        />

        <div
          style={{
            display: "flex",
            justifyContent:
              "center",
          }}
        >
          <motion.div
            animate={{
              rotate: [0, 15, -15, 0],
            }}
            transition={{
              duration: 0.8,
              repeat:
                Infinity,
            }}
          >
            <Swords
              size={22}
              color={
                COLORS.chrome
              }
            />
          </motion.div>
        </div>

        <Fighter
          name={
            enemy.name
          }
          icon={
            <Skull
              size={20}
            />
          }
          hp={enemyHp}
          maxHp={
            enemy.stats
              .maxHp
          }
          attack={
            enemy.stats
              .attack
          }
          accent="#ff6b6b"
        />
      </div>

      <div
        style={{
          marginTop: 12,
          padding:
            "10px 11px",
          borderRadius: 7,
          background:
            COLORS.panel,
          border:
            `1px solid ${COLORS.panelLine}`,
          minHeight: 190,
          maxHeight: 260,
          overflowY:
            "auto",
        }}
      >
        {visibleLogs.length ===
        0 ? (
          <div
            style={{
              height: 170,
              display: "flex",
              alignItems:
                "center",
              justifyContent:
                "center",
              fontFamily:
                FONT_MONO,
              fontSize: 10,
              color:
                COLORS.textMuted,
            }}
          >
            Calculating outcome...
          </div>
        ) : (
          <div
            style={{
              display:
                "flex",
              flexDirection:
                "column",
              gap: 5,
            }}
          >
            {visibleLogs.map(
              (log) => (
                <motion.div
                  key={
                    log.id
                  }
                  initial={{
                    opacity: 0,
                    x: -5,
                  }}
                  animate={{
                    opacity: 1,
                    x: 0,
                  }}
                  style={{
                    fontFamily:
                      FONT_MONO,
                    fontSize: 9,
                    color:
                      log.type ===
                      "critical"
                        ? "#ffd166"
                        : log.type ===
                            "enemy"
                          ? "#ff8a8a"
                          : log.type ===
                              "player"
                            ? "#8be0a0"
                            : COLORS.textMuted,
                  }}
                >
                  {log.text}
                </motion.div>
              ),
            )}
          </div>
        )}
      </div>

      {battle && (
        <div
          style={{
            display:
              "grid",
            gridTemplateColumns:
              "1fr 1fr",
            gap: 7,
            marginTop: 8,
          }}
        >
          <StatBox
            label="TURNS"
            value={
              battle.turns
            }
          />

          <StatBox
            label="OUTCOME"
            value={
              battle.winner ===
              "player"
                ? "WIN"
                : "LOSS"
            }
          />
        </div>
      )}

      <div
        style={{
          display: "none",
        }}
      >
        {playerPct}
        {enemyPct}
      </div>
    </div>
  );
}

function Fighter({
  name,
  icon,
  hp,
  maxHp,
  attack,
  accent,
}: {
  name: string;
  icon: React.ReactNode;
  hp: number;
  maxHp: number;
  attack: number;
  accent: string;
}) {
  const hpPct =
    Math.max(
      0,
      Math.min(
        1,
        hp / maxHp,
      ),
    );

  return (
    <div
      style={{
        padding:
          "12px 10px",
        borderRadius: 7,
        background:
          COLORS.panel,
        border:
          `1px solid ${accent}44`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems:
            "center",
          justifyContent:
            "center",
          gap: 6,
          color:
            accent,
          fontFamily:
            FONT_DISPLAY,
          fontSize: 10,
          fontWeight: 800,
          overflow:
            "hidden",
          textOverflow:
            "ellipsis",
          whiteSpace:
            "nowrap",
        }}
      >
        {icon}
        {name}
      </div>

      <div
        style={{
          marginTop: 10,
          height: 7,
          borderRadius: 4,
          background:
            COLORS.void,
          overflow:
            "hidden",
        }}
      >
        <motion.div
          animate={{
            width:
              `${hpPct * 100}%`,
          }}
          style={{
            height: "100%",
            background:
              accent,
          }}
        />
      </div>

      <div
        style={{
          display: "flex",
          justifyContent:
            "space-between",
          marginTop: 4,
          fontFamily:
            FONT_MONO,
          fontSize: 8,
          color:
            COLORS.textMuted,
        }}
      >
        <span>
          HP{" "}
          {formatNumber(
            hp,
          )}
        </span>

        <span>
          ATK{" "}
          {formatNumber(
            attack,
          )}
        </span>
      </div>
    </div>
  );
}

// ============================================================================
// RESULT
// ============================================================================

function ResultScreen({
  checkpoint,
  battle,
  enemy,
  bestCheckpoint,
  onRestart,
  onExit,
}: {
  checkpoint: number;
  battle: BattleResult;
  enemy: Enemy;
  bestCheckpoint: number;
  onRestart: () => void;
  onExit: () => void;
}) {
  const won =
    battle.winner ===
    "player";

  return (
    <div
      style={{
        textAlign:
          "center",
      }}
    >
      <motion.div
        initial={{
          scale: 0.5,
          rotate: -10,
        }}
        animate={{
          scale: 1,
          rotate: 0,
        }}
        transition={{
          type: "spring",
        }}
        style={{
          width: 70,
          height: 70,
          margin:
            "5px auto 14px",
          borderRadius:
            "50%",
          display: "flex",
          alignItems:
            "center",
          justifyContent:
            "center",
          background:
            won
              ? `${COLORS.chrome}18`
              : "#ff6b6b18",
          border:
            `1px solid ${
              won
                ? COLORS.chrome
                : "#ff6b6b"
            }55`,
        }}
      >
        {won ? (
          <Trophy
            size={31}
            color={
              COLORS.chrome
            }
          />
        ) : (
          <Skull
            size={31}
            color="#ff6b6b"
          />
        )}
      </motion.div>

      <div
        style={{
          fontFamily:
            FONT_DISPLAY,
          fontSize: 24,
          fontWeight: 900,
          color:
            COLORS.text,
        }}
      >
        {won
          ? "YOU WON"
          : "BUILD DESTROYED"}
      </div>

      <div
        style={{
          marginTop: 5,
          fontFamily:
            FONT_MONO,
          fontSize: 10,
          color:
            COLORS.textMuted,
        }}
      >
        {won
          ? `Checkpoint ${checkpoint} cleared`
          : `${enemy.name} ended the run`}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "1fr 1fr",
          gap: 8,
          marginTop: 18,
        }}
      >
        <MiniStat
          icon={
            <Target size={14} />
          }
          label="CHECKPOINT"
          value={String(
            checkpoint,
          )}
        />

        <MiniStat
          icon={
            <Trophy size={14} />
          }
          label="BEST"
          value={String(
            bestCheckpoint,
          )}
        />
      </div>

      <div
        style={{
          marginTop: 12,
          padding:
            "13px 14px",
          borderRadius: 7,
          background:
            COLORS.panel,
          border:
            `1px solid ${COLORS.panelLine}`,
          fontFamily:
            FONT_MONO,
          fontSize: 9.5,
          lineHeight: 1.6,
          color:
            COLORS.textMuted,
        }}
      >
        The next run will generate
        a completely different
        combination of enemies and
        choices.
      </div>

      <button
        onClick={onRestart}
        style={{
          width: "100%",
          marginTop: 12,
          padding:
            "13px 10px",
          border: "none",
          borderRadius: 6,
          background:
            COLORS.chrome,
          color:
            COLORS.void,
          fontFamily:
            FONT_DISPLAY,
          fontSize: 12,
          fontWeight: 800,
          cursor:
            "pointer",
        }}
      >
        <RefreshCw
          size={14}
          style={{
            verticalAlign:
              "middle",
            marginRight: 6,
          }}
        />
        TRY A NEW BUILD
      </button>

      <button
        onClick={onExit}
        style={{
          width: "100%",
          marginTop: 7,
          padding:
            "11px 10px",
          border:
            `1px solid ${COLORS.panelLine}`,
          borderRadius: 6,
          background:
            COLORS.panel,
          color:
            COLORS.textMuted,
          fontFamily:
            FONT_MONO,
          fontSize: 10,
          cursor:
            "pointer",
        }}
      >
        EXIT
      </button>
    </div>
  );
}

// ============================================================================
// SMALL COMPONENTS
// ============================================================================

function StatBox({
  label,
  value,
  percent = false,
}: {
  label: string;
  value: number | string;
  percent?: boolean;
}) {
  return (
    <div
      style={{
        padding:
          "7px 6px",
        borderRadius: 4,
        background:
          COLORS.void,
        border:
          `1px solid ${COLORS.panelLine}`,
        textAlign:
          "center",
      }}
    >
      <div
        style={{
          fontFamily:
            FONT_MONO,
          fontSize: 7,
          color:
            COLORS.textMuted,
        }}
      >
        {label}
      </div>

      <div
        style={{
          marginTop: 2,
          fontFamily:
            FONT_MONO,
          fontSize: 10,
          fontWeight: 700,
          color:
            COLORS.text,
        }}
      >
        {typeof value ===
        "number"
          ? percent
            ? formatPercent(
                value,
              )
            : formatNumber(
                value,
              )
          : value}
      </div>
    </div>
  );
}

function Badge({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <span
      style={{
        padding:
          "3px 5px",
        borderRadius: 3,
        background:
          COLORS.void,
        border:
          `1px solid ${COLORS.panelLine}`,
        fontFamily:
          FONT_MONO,
        fontSize: 7,
        color:
          COLORS.textMuted,
      }}
    >
      {children}
    </span>
  );
}

function MiniStat({
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
        padding:
          "10px 7px",
        borderRadius: 6,
        background:
          COLORS.panel,
        border:
          `1px solid ${COLORS.panelLine}`,
        textAlign:
          "center",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent:
            "center",
          alignItems:
            "center",
          gap: 4,
          color:
            COLORS.chrome,
        }}
      >
        {icon}
      </div>

      <div
        style={{
          marginTop: 3,
          fontFamily:
            FONT_MONO,
          fontSize: 12,
          fontWeight: 700,
          color:
            COLORS.text,
        }}
      >
        {value}
      </div>

      <div
        style={{
          marginTop: 2,
          fontFamily:
            FONT_MONO,
          fontSize: 7,
          color:
            COLORS.textMuted,
        }}
      >
        {label}
      </div>
    </div>
  );
}
