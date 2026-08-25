"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Play,
  Shield,
  Sword,
  Zap,
  Heart,
  Flame,
  Snowflake,
  Skull,
  RefreshCw,
  Eye,
  Sparkles,
  ChevronRight,
  Trophy,
  Swords,
  RotateCcw,
  Brain,
  Crosshair,
} from "lucide-react";

import { COLORS, FONT_DISPLAY, FONT_MONO } from "@/lib/theme";

type Phase = "menu" | "build" | "battle" | "result";

interface PhaserShooterProps {
  /** Lifetime kills across all productivity categories — powers the level. */
  lifetimeKills: number;
  onExit: () => void;
}

// ============================================================================
// TYPES
// ============================================================================

type Element = "fire" | "ice" | "shock" | "void" | "physical";

type Trait =
  | "berserker"
  | "guardian"
  | "vampire"
  | "glass"
  | "regenerator"
  | "thorns"
  | "evasive"
  | "unstable";

interface Item {
  id: string;
  name: string;
  icon: string;
  rarity: "common" | "rare" | "epic" | "legendary";
  element: Element;
  description: string;

  attack: number;
  defense: number;
  health: number;
  speed: number;
  crit: number;
  lifesteal: number;

  strongAgainst?: Element;
  weakAgainst?: Element;
}

interface Enemy {
  name: string;
  title: string;
  icon: string;
  element: Element;
  trait: Trait;

  attack: number;
  defense: number;
  health: number;
  speed: number;
  crit: number;

  weakness: Element;
  resistance: Element;

  description: string;
}

interface BuildStats {
  attack: number;
  defense: number;
  health: number;
  speed: number;
  crit: number;
  lifesteal: number;
}

interface BattleLog {
  text: string;
  type: "normal" | "good" | "bad" | "critical";
}

interface GameState {
  discovered: string[];
  victories: number;
  defeats: number;
  bestStreak: number;
  currentStreak: number;
}

const STORAGE_KEY = "adaptive_battle_game_v2";

// ============================================================================
// RANDOMIZATION
// ============================================================================

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

function shuffle<T>(array: T[]): T[] {
  return [...array].sort(() => Math.random() - 0.5);
}

// ============================================================================
// LEVEL SYSTEM
//
// Each lifetime kill contributes to level progression.
// The amount required per level remains stable so that the user's
// existing lifetimeKills integration remains meaningful.
//
// Combat power increases EXPONENTIALLY from level.
// ============================================================================

interface LevelInfo {
  level: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
  powerMultiplier: number;
}

function xpForLevel(_level: number): number {
  return 521;
}

function levelFromLifetimeKills(lifetimeKills: number): LevelInfo {
  let level = 1;
  let xp = Math.max(0, Math.floor(lifetimeKills));

  while (xp >= xpForLevel(level)) {
    xp -= xpForLevel(level);
    level++;
  }

  return {
    level,
    xpIntoLevel: xp,
    xpForNextLevel: xpForLevel(level),

    // Exponential progression.
    // Level 1 = 1x
    // Level 2 = ~1.7x
    // Level 5 = ~6.8x
    // Level 10 = ~31x
    // Level 20 = ~370x
    powerMultiplier: Math.pow(1.17, level - 1),
  };
}

// ============================================================================
// ELEMENT SYSTEM
// ============================================================================

const ELEMENTS: Record<
  Element,
  {
    label: string;
    icon: string;
    color: string;
    strongAgainst: Element;
    weakAgainst: Element;
  }
> = {
  fire: {
    label: "Fire",
    icon: "🔥",
    color: "#ff795f",
    strongAgainst: "ice",
    weakAgainst: "water" as Element,
  },

  ice: {
    label: "Ice",
    icon: "❄️",
    color: "#76c9ff",
    strongAgainst: "shock",
    weakAgainst: "fire",
  },

  shock: {
    label: "Shock",
    icon: "⚡",
    color: "#e5c75f",
    strongAgainst: "physical",
    weakAgainst: "ice",
  },

  void: {
    label: "Void",
    icon: "◈",
    color: "#c18cff",
    strongAgainst: "fire",
    weakAgainst: "physical",
  },

  physical: {
    label: "Steel",
    icon: "⚔️",
    color: COLORS.chrome,
    strongAgainst: "void",
    weakAgainst: "shock",
  },
};

// ============================================================================
// ITEM DATABASE
//
// Items are intentionally asymmetric.
// There is no single universally best item.
// ============================================================================

const ITEM_POOL: Item[] = [
  {
    id: "iron-sword",
    name: "Iron Fang",
    icon: "⚔️",
    rarity: "common",
    element: "physical",
    description: "Reliable damage. Nothing fancy.",
    attack: 18,
    defense: 2,
    health: 0,
    speed: 0,
    crit: 3,
    lifesteal: 0,
  },
  {
    id: "thorn-armor",
    name: "Thorn Shell",
    icon: "🌵",
    rarity: "rare",
    element: "physical",
    description: "Turns defense into punishment.",
    attack: 4,
    defense: 22,
    health: 18,
    speed: -2,
    crit: 0,
    lifesteal: 0,
  },
  {
    id: "flame-core",
    name: "Flame Core",
    icon: "🔥",
    rarity: "rare",
    element: "fire",
    description: "Huge offensive pressure.",
    attack: 31,
    defense: -5,
    health: 0,
    speed: 2,
    crit: 6,
    lifesteal: 0,
    strongAgainst: "ice",
    weakAgainst: "void",
  },
  {
    id: "frost-heart",
    name: "Frost Heart",
    icon: "❄️",
    rarity: "rare",
    element: "ice",
    description: "Slow, durable and difficult to break.",
    attack: 9,
    defense: 19,
    health: 35,
    speed: -4,
    crit: 0,
    lifesteal: 2,
    strongAgainst: "shock",
    weakAgainst: "fire",
  },
  {
    id: "storm-engine",
    name: "Storm Engine",
    icon: "⚡",
    rarity: "epic",
    element: "shock",
    description: "Speed creates explosive openings.",
    attack: 20,
    defense: 2,
    health: 0,
    speed: 18,
    crit: 12,
    lifesteal: 0,
    strongAgainst: "physical",
    weakAgainst: "ice",
  },
  {
    id: "void-mask",
    name: "Void Mask",
    icon: "🎭",
    rarity: "epic",
    element: "void",
    description: "Sacrifice defense for strange power.",
    attack: 26,
    defense: -8,
    health: -10,
    speed: 15,
    crit: 15,
    lifesteal: 5,
    strongAgainst: "fire",
    weakAgainst: "physical",
  },
  {
    id: "blood-crown",
    name: "Blood Crown",
    icon: "👑",
    rarity: "legendary",
    element: "void",
    description: "Every hit becomes a little more dangerous.",
    attack: 23,
    defense: 5,
    health: 15,
    speed: 8,
    crit: 8,
    lifesteal: 18,
  },
  {
    id: "glass-cannon",
    name: "Glass Cannon",
    icon: "💎",
    rarity: "epic",
    element: "fire",
    description: "Ridiculous offense. Almost no forgiveness.",
    attack: 54,
    defense: -25,
    health: -25,
    speed: 5,
    crit: 20,
    lifesteal: 0,
    strongAgainst: "ice",
    weakAgainst: "void",
  },
  {
    id: "gravity-plate",
    name: "Gravity Plate",
    icon: "🛡️",
    rarity: "legendary",
    element: "physical",
    description: "Almost impossible to move.",
    attack: 5,
    defense: 45,
    health: 55,
    speed: -18,
    crit: 0,
    lifesteal: 0,
    strongAgainst: "void",
    weakAgainst: "shock",
  },
  {
    id: "phantom-cloak",
    name: "Phantom Cloak",
    icon: "🪽",
    rarity: "legendary",
    element: "void",
    description: "Avoid the hit instead of surviving it.",
    attack: 12,
    defense: 8,
    health: 10,
    speed: 35,
    crit: 9,
    lifesteal: 4,
    strongAgainst: "fire",
    weakAgainst: "physical",
  },
];

// ============================================================================
// ENEMY GENERATION
//
// Every run generates a different enemy combination.
// ============================================================================

const ENEMY_NAMES = [
  "Morrow",
  "Vex",
  "Ruin",
  "Kairo",
  "Nyx",
  "Sol",
  "Axiom",
  "Grim",
  "Echo",
  "Rook",
  "Vale",
  "Nero",
];

const ENEMY_TITLES = [
  "the Unfinished",
  "the Hungry",
  "the Counter",
  "the Wanderer",
  "the Unstable",
  "the Silent",
  "the Collector",
  "the Broken",
  "the Patient",
  "the Gambler",
];

const ENEMY_ICONS = ["👹", "🧿", "🤖", "👾", "☠️", "🦂", "🦾", "🐉", "🕷️"];

const TRAITS: Trait[] = [
  "berserker",
  "guardian",
  "vampire",
  "glass",
  "regenerator",
  "thorns",
  "evasive",
  "unstable",
];

const TRAIT_TEXT: Record<Trait, string> = {
  berserker: "Gets stronger as health falls.",
  guardian: "Takes significantly reduced damage.",
  vampire: "Heals from every successful attack.",
  glass: "Extremely dangerous but extremely fragile.",
  regenerator: "Slowly regenerates health.",
  thorns: "Damages attackers whenever struck.",
  evasive: "Sometimes completely avoids attacks.",
  unstable: "Randomly becomes much stronger or weaker.",
};

function generateEnemy(level: number): Enemy {
  const element = pick(Object.keys(ELEMENTS) as Element[]);

  const possibleWeaknesses = (Object.keys(ELEMENTS) as Element[]).filter(
    (e) => e !== element
  );

  const weakness = pick(possibleWeaknesses);

  const possibleResistances = (Object.keys(ELEMENTS) as Element[]).filter(
    (e) => e !== element && e !== weakness
  );

  const resistance = pick(possibleResistances);

  const trait = pick(TRAITS);

  const difficulty = Math.pow(1.145, Math.max(0, level - 1));

  let health = 130 * difficulty;
  let attack = 18 * difficulty;
  let defense = 8 * difficulty;
  let speed = 10 + level * 0.7;
  let crit = 4;

  switch (trait) {
    case "berserker":
      attack *= 1.28;
      health *= 0.9;
      break;

    case "guardian":
      defense *= 1.55;
      health *= 1.18;
      attack *= 0.82;
      break;

    case "vampire":
      attack *= 1.05;
      health *= 1.1;
      break;

    case "glass":
      attack *= 1.65;
      health *= 0.58;
      defense *= 0.65;
      crit += 15;
      break;

    case "regenerator":
      health *= 1.28;
      defense *= 1.05;
      break;

    case "thorns":
      defense *= 1.25;
      health *= 1.15;
      break;

    case "evasive":
      speed *= 1.5;
      health *= 0.92;
      break;

    case "unstable":
      if (Math.random() > 0.5) {
        attack *= 1.6;
        health *= 0.75;
      } else {
        attack *= 0.75;
        health *= 1.55;
      }
      break;
  }

  return {
    name: pick(ENEMY_NAMES),
    title: pick(ENEMY_TITLES),
    icon: pick(ENEMY_ICONS),
    element,
    trait,
    attack,
    defense,
    health,
    speed,
    crit,
    weakness,
    resistance,
    description: TRAIT_TEXT[trait],
  };
}

// ============================================================================
// BUILD GENERATION
// ============================================================================

function generateChoices(enemy: Enemy): Item[] {
  // Occasionally produce a deliberately strange set where the player
  // has to reason about tradeoffs rather than simply choosing the highest
  // number.
  const candidates = shuffle(ITEM_POOL);

  const guaranteedCounter = candidates.find(
    (item) =>
      item.element === enemy.weakness ||
      item.strongAgainst === enemy.element
  );

  const guaranteedDefense = candidates.find(
    (item) => item.defense >= 20 || item.health >= 30
  );

  const weirdChoice = candidates.find(
    (item) =>
      item.defense < 0 ||
      item.health < 0 ||
      item.speed >= 30
  );

  const randomChoices = candidates.slice(0, 5);

  const combined = [
    guaranteedCounter,
    guaranteedDefense,
    weirdChoice,
    ...randomChoices,
  ].filter(Boolean) as Item[];

  return shuffle(
    combined.filter(
      (item, index, arr) => arr.findIndex((x) => x.id === item.id) === index
    )
  ).slice(0, 5);
}

// ============================================================================
// COMBAT
// ============================================================================

function calculateBuildStats(
  items: Item[],
  levelInfo: LevelInfo
): BuildStats {
  const base: BuildStats = {
    attack: 20,
    defense: 10,
    health: 120,
    speed: 10,
    crit: 5,
    lifesteal: 0,
  };

  for (const item of items) {
    base.attack += item.attack;
    base.defense += item.defense;
    base.health += item.health;
    base.speed += item.speed;
    base.crit += item.crit;
    base.lifesteal += item.lifesteal;
  }

  // Exponential level scaling.
  base.attack *= levelInfo.powerMultiplier;
  base.defense *= levelInfo.powerMultiplier;
  base.health *= levelInfo.powerMultiplier;
  base.speed *= Math.pow(levelInfo.powerMultiplier, 0.35);

  return {
    attack: Math.max(1, base.attack),
    defense: Math.max(0, base.defense),
    health: Math.max(20, base.health),
    speed: Math.max(1, base.speed),
    crit: Math.max(0, base.crit),
    lifesteal: Math.max(0, base.lifesteal),
  };
}

function elementMultiplier(
  attacker: Element,
  defender: Element,
  enemyWeakness?: Element,
  enemyResistance?: Element
) {
  let multiplier = 1;

  if (ELEMENTS[attacker].strongAgainst === defender) {
    multiplier *= 1.35;
  }

  if (ELEMENTS[attacker].weakAgainst === defender) {
    multiplier *= 0.72;
  }

  if (enemyWeakness === attacker) {
    multiplier *= 1.45;
  }

  if (enemyResistance === attacker) {
    multiplier *= 0.62;
  }

  return multiplier;
}

function runBattle(
  build: BuildStats,
  buildElement: Element,
  enemy: Enemy
): { playerWon: boolean; logs: BattleLog[]; turns: number } {
  let playerHP = build.health;
  let enemyHP = enemy.health;

  const logs: BattleLog[] = [];

  let turn = 0;

  while (playerHP > 0 && enemyHP > 0 && turn < 80) {
    turn++;

    const playerFirst = build.speed >= enemy.speed;

    const attacks = playerFirst
      ? ["player", "enemy"]
      : ["enemy", "player"];

    for (const attacker of attacks) {
      if (playerHP <= 0 || enemyHP <= 0) break;

      if (attacker === "player") {
        if (enemy.trait === "evasive" && Math.random() < 0.16) {
          logs.push({
            text: `${enemy.name} vanished before the attack landed.`,
            type: "bad",
          });
          continue;
        }

        const crit = Math.random() * 100 < build.crit;

        let damage =
          build.attack *
          elementMultiplier(
            buildElement,
            enemy.element,
            enemy.weakness,
            enemy.resistance
          );

        damage *= crit ? 1.8 : 1;

        damage = Math.max(
          1,
          damage - enemy.defense * 0.35
        );

        enemyHP -= damage;

        if (crit) {
          logs.push({
            text: `CRITICAL HIT — ${Math.round(damage)} damage.`,
            type: "critical",
          });
        } else {
          logs.push({
            text: `You deal ${Math.round(damage)} damage.`,
            type: "normal",
          });
        }

        if (build.lifesteal > 0) {
          const heal = damage * (build.lifesteal / 100);
          playerHP = Math.min(build.health, playerHP + heal);
        }

        if (enemy.trait === "thorns" && enemyHP > 0) {
          const thorn = Math.max(1, enemy.defense * 0.22);
          playerHP -= thorn;

          logs.push({
            text: `Thorns return ${Math.round(thorn)} damage.`,
            type: "bad",
          });
        }
      } else {
        if (Math.random() < build.speed / (build.speed + 220)) {
          logs.push({
            text: "You dodged the attack.",
            type: "good",
          });
          continue;
        }

        let enemyAttack = enemy.attack;

        if (enemy.trait === "berserker") {
          const missing = 1 - enemyHP / enemy.health;
          enemyAttack *= 1 + missing * 1.1;
        }

        if (enemy.trait === "unstable") {
          enemyAttack *= Math.random() > 0.5 ? 1.5 : 0.65;
        }

        const crit = Math.random() * 100 < enemy.crit;

        let damage =
          enemyAttack *
          elementMultiplier(
            enemy.element,
            buildElement
          );

        damage *= crit ? 1.65 : 1;

        damage = Math.max(
          1,
          damage - build.defense * 0.3
        );

        playerHP -= damage;

        logs.push({
          text: crit
            ? `CRITICAL — enemy deals ${Math.round(damage)} damage.`
            : `Enemy deals ${Math.round(damage)} damage.`,
          type: crit ? "bad" : "normal",
        });

        if (enemy.trait === "vampire") {
          const heal = damage * 0.18;
          enemyHP = Math.min(enemy.health, enemyHP + heal);

          logs.push({
            text: `${enemy.name} drains ${Math.round(heal)} health.`,
            type: "bad",
          });
        }
      }
    }

    if (enemy.trait === "regenerator" && enemyHP > 0) {
      const heal = enemy.health * 0.018;
      enemyHP = Math.min(enemy.health, enemyHP + heal);
    }
  }

  return {
    playerWon: playerHP > 0 && enemyHP <= 0,
    logs,
    turns: turn,
  };
}

// ============================================================================
// PERSISTENCE
// ============================================================================

function defaultGameState(): GameState {
  return {
    discovered: [],
    victories: 0,
    defeats: 0,
    bestStreak: 0,
    currentStreak: 0,
  };
}

function loadGameState(): GameState {
  if (typeof window === "undefined") return defaultGameState();

  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) return defaultGameState();

    return {
      ...defaultGameState(),
      ...JSON.parse(raw),
    };
  } catch {
    return defaultGameState();
  }
}

function saveGameState(state: GameState) {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage failures.
  }
}

// ============================================================================
// FORMAT
// ============================================================================

function formatNumber(n: number) {
  if (n < 1000) return Math.round(n).toString();

  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function PhaserShooter({
  lifetimeKills,
  onExit,
}: PhaserShooterProps) {
  const [phase, setPhase] = useState<Phase>("menu");
  const [gameState, setGameState] = useState<GameState>(() =>
    defaultGameState()
  );

  const [enemy, setEnemy] = useState<Enemy | null>(null);
  const [choices, setChoices] = useState<Item[]>([]);
  const [selectedItems, setSelectedItems] = useState<Item[]>([]);
  const [battleResult, setBattleResult] = useState<{
    won: boolean;
    logs: BattleLog[];
    turns: number;
  } | null>(null);

  const [battleLogIndex, setBattleLogIndex] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [showEnemyDetails, setShowEnemyDetails] = useState(false);

  const levelInfo = useMemo(
    () => levelFromLifetimeKills(lifetimeKills),
    [lifetimeKills]
  );

  const buildStats = useMemo(
    () => calculateBuildStats(selectedItems, levelInfo),
    [selectedItems, levelInfo]
  );

  const buildElement = useMemo(() => {
    if (selectedItems.length === 0) return "physical";

    const counts = new Map<Element, number>();

    for (const item of selectedItems) {
      counts.set(item.element, (counts.get(item.element) ?? 0) + 1);
    }

    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }, [selectedItems]);

  // --------------------------------------------------------------------------
  // LOAD
  // --------------------------------------------------------------------------

  useEffect(() => {
    setGameState(loadGameState());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;

    saveGameState(gameState);
  }, [gameState, hydrated]);

  // --------------------------------------------------------------------------
  // START A NEW EXPERIMENT
  // --------------------------------------------------------------------------

  const startRun = useCallback(() => {
    const generatedEnemy = generateEnemy(levelInfo.level);
    const generatedChoices = generateChoices(generatedEnemy);

    setEnemy(generatedEnemy);
    setChoices(generatedChoices);
    setSelectedItems([]);
    setBattleResult(null);
    setBattleLogIndex(0);
    setShowEnemyDetails(false);

    setPhase("build");
  }, [levelInfo.level]);

  // --------------------------------------------------------------------------
  // SELECT ITEM
  // --------------------------------------------------------------------------

  const toggleItem = useCallback((item: Item) => {
    setSelectedItems((prev) => {
      const exists = prev.some((x) => x.id === item.id);

      if (exists) {
        return prev.filter((x) => x.id !== item.id);
      }

      // Four slots.
      if (prev.length >= 4) {
        return prev;
      }

      return [...prev, item];
    });
  }, []);

  // --------------------------------------------------------------------------
  // FIGHT
  // --------------------------------------------------------------------------

  const fight = useCallback(() => {
    if (!enemy || selectedItems.length === 0) return;

    const result = runBattle(
      buildStats,
      buildElement,
      enemy
    );

    setBattleResult({
      won: result.playerWon,
      logs: result.logs,
      turns: result.turns,
    });

    setBattleLogIndex(0);

    const discoveryKey =
      `${enemy.element}-${enemy.trait}-${selectedItems
        .map((x) => x.id)
        .sort()
        .join("+")}`;

    setGameState((prev) => {
      const discovered = prev.discovered.includes(discoveryKey)
        ? prev.discovered
        : [...prev.discovered, discoveryKey];

      if (result.playerWon) {
        const currentStreak = prev.currentStreak + 1;

        return {
          ...prev,
          discovered,
          victories: prev.victories + 1,
          currentStreak,
          bestStreak: Math.max(prev.bestStreak, currentStreak),
        };
      }

      return {
        ...prev,
        discovered,
        defeats: prev.defeats + 1,
        currentStreak: 0,
      };
    });

    setPhase("result");
  }, [enemy, selectedItems, buildStats, buildElement]);

  // --------------------------------------------------------------------------
  // NEXT LOG
  // --------------------------------------------------------------------------

  useEffect(() => {
    if (phase !== "result" || !battleResult) return;

    if (battleLogIndex >= battleResult.logs.length - 1) return;

    const timeout = setTimeout(() => {
      setBattleLogIndex((x) => x + 1);
    }, 520);

    return () => clearTimeout(timeout);
  }, [phase, battleResult, battleLogIndex]);

  // --------------------------------------------------------------------------
  // RENDER
  // --------------------------------------------------------------------------

  return (
    <div style={{ position: "relative" }}>
      <AnimatePresence mode="wait">
        {phase === "menu" && (
          <motion.div
            key="menu"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            <MenuScreen
              levelInfo={levelInfo}
              gameState={gameState}
              hydrated={hydrated}
              onStart={startRun}
            />
          </motion.div>
        )}

        {phase === "build" && enemy && (
          <motion.div
            key="build"
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
          >
            <BuildScreen
              levelInfo={levelInfo}
              enemy={enemy}
              choices={choices}
              selectedItems={selectedItems}
              stats={buildStats}
              buildElement={buildElement}
              showEnemyDetails={showEnemyDetails}
              onToggleItem={toggleItem}
              onShowEnemy={() =>
                setShowEnemyDetails((x) => !x)
              }
              onFight={fight}
              onExit={() => setPhase("menu")}
              onReroll={startRun}
            />
          </motion.div>
        )}

        {phase === "result" && enemy && battleResult && (
          <motion.div
            key="result"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
          >
            <ResultScreen
              enemy={enemy}
              result={battleResult}
              logIndex={battleLogIndex}
              gameState={gameState}
              onAgain={startRun}
              onMenu={() => setPhase("menu")}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {phase !== "menu" && (
        <button
          onClick={() => setPhase("menu")}
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
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: 1,
            cursor: "pointer",
          }}
        >
          <X size={12} />
          Back
        </button>
      )}

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
// MENU
// ============================================================================

function MenuScreen({
  levelInfo,
  gameState,
  hydrated,
  onStart,
}: {
  levelInfo: LevelInfo;
  gameState: GameState;
  hydrated: boolean;
  onStart: () => void;
}) {
  const xpPct =
    levelInfo.xpIntoLevel / levelInfo.xpForNextLevel;

  return (
    <div>
      <div
        style={{
          padding: 18,
          borderRadius: 8,
          background: COLORS.panel,
          border: `1px solid ${COLORS.panelLine}`,
          marginBottom: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Sparkles size={17} color={COLORS.chrome} />

            <span
              style={{
                fontFamily: FONT_DISPLAY,
                fontWeight: 700,
                fontSize: 16,
              }}
            >
              Level {levelInfo.level}
            </span>
          </div>

          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 9,
              color: COLORS.textMuted,
            }}
          >
            {levelInfo.xpIntoLevel} / {levelInfo.xpForNextLevel}
          </span>
        </div>

        <div
          style={{
            height: 5,
            marginTop: 10,
            borderRadius: 4,
            overflow: "hidden",
            background: COLORS.void,
          }}
        >
          <div
            style={{
              width: `${xpPct * 100}%`,
              height: "100%",
              background: COLORS.chrome,
            }}
          />
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 12,
            fontFamily: FONT_MONO,
            fontSize: 9,
            color: COLORS.textMuted,
          }}
        >
          <span>COMBAT POWER</span>

          <span style={{ color: COLORS.chrome }}>
            ×{levelInfo.powerMultiplier.toFixed(2)}
          </span>
        </div>
      </div>

      <div
        style={{
          padding: 16,
          borderRadius: 8,
          background: COLORS.panel,
          border: `1px solid ${COLORS.panelLine}`,
          marginBottom: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontFamily: FONT_DISPLAY,
            fontWeight: 700,
            fontSize: 15,
          }}
        >
          <Brain size={17} color={COLORS.chrome} />
          UNKNOWN ENCOUNTER
        </div>

        <p
          style={{
            fontFamily: FONT_MONO,
            fontSize: 10.5,
            lineHeight: 1.6,
            color: COLORS.textMuted,
            margin: "10px 0 0",
          }}
        >
          Every run creates a different enemy, trait,
          weakness and set of equipment.
        </p>

        <div
          style={{
            display: "flex",
            gap: 8,
            marginTop: 14,
            flexWrap: "wrap",
          }}
        >
          <Tag icon={<Eye size={11} />} text="Unknown enemy" />
          <Tag icon={<Crosshair size={11} />} text="Find weakness" />
          <Tag icon={<Swords size={11} />} text="Build counter" />
          <Tag icon={<Sparkles size={11} />} text="Unexpected result" />
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 8,
          marginBottom: 14,
        }}
      >
        <StatMini
          icon={<Trophy size={13} />}
          label="Wins"
          value={gameState.victories}
        />

        <StatMini
          icon={<Skull size={13} />}
          label="Losses"
          value={gameState.defeats}
        />

        <StatMini
          icon={<Sparkles size={13} />}
          label="Discoveries"
          value={gameState.discovered.length}
        />
      </div>

      <button
        onClick={onStart}
        disabled={!hydrated}
        style={{
          width: "100%",
          padding: "14px 0",
          border: "none",
          borderRadius: 5,
          background: COLORS.chrome,
          color: COLORS.void,
          fontFamily: FONT_DISPLAY,
          fontWeight: 700,
          fontSize: 13,
          cursor: hydrated ? "pointer" : "default",
          opacity: hydrated ? 1 : 0.6,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
        }}
      >
        <Play size={14} />
        DISCOVER WHAT&apos;S NEXT
      </button>
    </div>
  );
}

// ============================================================================
// BUILD SCREEN
// ============================================================================

function BuildScreen({
  levelInfo,
  enemy,
  choices,
  selectedItems,
  stats,
  buildElement,
  showEnemyDetails,
  onToggleItem,
  onShowEnemy,
  onFight,
  onExit,
  onReroll,
}: {
  levelInfo: LevelInfo;
  enemy: Enemy;
  choices: Item[];
  selectedItems: Item[];
  stats: BuildStats;
  buildElement: Element;
  showEnemyDetails: boolean;
  onToggleItem: (item: Item) => void;
  onShowEnemy: () => void;
  onFight: () => void;
  onExit: () => void;
  onReroll: () => void;
}) {
  return (
    <div>
      {/* ENEMY */}
      <div
        style={{
          padding: 15,
          borderRadius: 8,
          background: COLORS.panel,
          border: `1px solid ${ELEMENTS[enemy.element].color}55`,
          marginBottom: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div
            style={{
              width: 54,
              height: 54,
              borderRadius: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: `${ELEMENTS[enemy.element].color}16`,
              fontSize: 30,
            }}
          >
            {enemy.icon}
          </div>

          <div style={{ flex: 1 }}>
            <div
              style={{
                fontFamily: FONT_DISPLAY,
                fontWeight: 700,
                fontSize: 16,
              }}
            >
              {enemy.name}
            </div>

            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 9,
                color: COLORS.textMuted,
                marginTop: 3,
              }}
            >
              {enemy.title}
            </div>

            <div
              style={{
                marginTop: 7,
                fontFamily: FONT_MONO,
                fontSize: 10,
                color: ELEMENTS[enemy.element].color,
              }}
            >
              {ELEMENTS[enemy.element].icon}{" "}
              {ELEMENTS[enemy.element].label}
            </div>
          </div>

          <button
            onClick={onShowEnemy}
            style={{
              width: 34,
              height: 34,
              borderRadius: 6,
              border: `1px solid ${COLORS.panelLine}`,
              background: COLORS.void,
              color: COLORS.text,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <Eye size={14} />
          </button>
        </div>

        <AnimatePresence>
          {showEnemyDetails && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              style={{
                overflow: "hidden",
                marginTop: 12,
                paddingTop: 12,
                borderTop: `1px solid ${COLORS.panelLine}`,
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 7,
                }}
              >
                <EnemyFact
                  label="Trait"
                  value={enemy.trait}
                />

                <EnemyFact
                  label="Weakness"
                  value={`${ELEMENTS[enemy.weakness].icon} ${ELEMENTS[enemy.weakness].label}`}
                  good
                />

                <EnemyFact
                  label="Resistance"
                  value={`${ELEMENTS[enemy.resistance].icon} ${ELEMENTS[enemy.resistance].label}`}
                />

                <EnemyFact
                  label="Behavior"
                  value={enemy.description}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* BUILD HEADER */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 9,
        }}
      >
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 10,
            letterSpacing: 1.2,
            color: COLORS.textMuted,
            textTransform: "uppercase",
          }}
        >
          Choose your experiment
        </div>

        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 9,
            color: COLORS.chrome,
          }}
        >
          {selectedItems.length}/4 equipped
        </div>
      </div>

      {/* ITEMS */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 7,
        }}
      >
        {choices.map((item) => {
          const selected = selectedItems.some(
            (x) => x.id === item.id
          );

          return (
            <ItemCard
              key={item.id}
              item={item}
              selected={selected}
              onClick={() => onToggleItem(item)}
            />
          );
        })}
      </div>

      {/* BUILD STATS */}
      <div
        style={{
          marginTop: 12,
          padding: 12,
          borderRadius: 7,
          background: COLORS.panel,
          border: `1px solid ${COLORS.panelLine}`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 9,
          }}
        >
          <span
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 700,
              fontSize: 12,
            }}
          >
            Your build
          </span>

          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 9,
              color: ELEMENTS[buildElement].color,
            }}
          >
            {ELEMENTS[buildElement].icon}{" "}
            {ELEMENTS[buildElement].label}
          </span>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 6,
          }}
        >
          <CombatStat
            icon={<Sword size={12} />}
            label="ATK"
            value={stats.attack}
          />

          <CombatStat
            icon={<Shield size={12} />}
            label="DEF"
            value={stats.defense}
          />

          <CombatStat
            icon={<Heart size={12} />}
            label="HP"
            value={stats.health}
          />

          <CombatStat
            icon={<Zap size={12} />}
            label="SPD"
            value={stats.speed}
          />

          <CombatStat
            icon={<Crosshair size={12} />}
            label="CRIT"
            value={`${Math.round(stats.crit)}%`}
          />

          <CombatStat
            icon={<Flame size={12} />}
            label="DRAIN"
            value={`${Math.round(stats.lifesteal)}%`}
          />
        </div>
      </div>

      {/* ACTIONS */}
      <div
        style={{
          display: "flex",
          gap: 7,
          marginTop: 12,
        }}
      >
        <button
          onClick={onReroll}
          style={{
            width: 42,
            borderRadius: 5,
            border: `1px solid ${COLORS.panelLine}`,
            background: COLORS.panel,
            color: COLORS.textMuted,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
          title="Generate another encounter"
        >
          <RefreshCw size={14} />
        </button>

        <button
          onClick={onFight}
          disabled={selectedItems.length === 0}
          style={{
            flex: 1,
            padding: "13px 0",
            border: "none",
            borderRadius: 5,
            background:
              selectedItems.length > 0
                ? COLORS.chrome
                : COLORS.panelLine,
            color:
              selectedItems.length > 0
                ? COLORS.void
                : COLORS.textMuted,
            fontFamily: FONT_DISPLAY,
            fontWeight: 700,
            fontSize: 13,
            cursor:
              selectedItems.length > 0
                ? "pointer"
                : "not-allowed",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          <Swords size={15} />
          FIGHT
          <ChevronRight size={14} />
        </button>
      </div>

      <button
        onClick={onExit}
        style={{
          width: "100%",
          marginTop: 8,
          padding: "8px 0",
          background: "transparent",
          border: "none",
          color: COLORS.textMuted,
          fontFamily: FONT_MONO,
          fontSize: 9,
          cursor: "pointer",
        }}
      >
        Abandon experiment
      </button>
    </div>
  );
}

// ============================================================================
// RESULT
// ============================================================================

function ResultScreen({
  enemy,
  result,
  logIndex,
  gameState,
  onAgain,
  onMenu,
}: {
  enemy: Enemy;
  result: {
    won: boolean;
    logs: BattleLog[];
    turns: number;
  };
  logIndex: number;
  gameState: GameState;
  onAgain: () => void;
  onMenu: () => void;
}) {
  const visibleLogs = result.logs.slice(
    0,
    Math.min(logIndex + 1, result.logs.length)
  );

  return (
    <div>
      <motion.div
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        style={{
          textAlign: "center",
          padding: "22px 12px",
          borderRadius: 8,
          background: COLORS.panel,
          border: `1px solid ${
            result.won ? "#7fd48a55" : "#ff795f55"
          }`,
        }}
      >
        <div
          style={{
            fontSize: 42,
            marginBottom: 8,
          }}
        >
          {result.won ? "🏆" : "💥"}
        </div>

        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 700,
            fontSize: 20,
            color: result.won ? "#7fd48a" : "#ff795f",
          }}
        >
          {result.won ? "YOU WON" : "YOU LOST"}
        </div>

        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 10,
            color: COLORS.textMuted,
            marginTop: 5,
          }}
        >
          {result.turns} turns against {enemy.name}
        </div>
      </motion.div>

      {/* BATTLE LOG */}
      <div
        style={{
          marginTop: 12,
          padding: 13,
          borderRadius: 8,
          background: COLORS.panel,
          border: `1px solid ${COLORS.panelLine}`,
          minHeight: 155,
        }}
      >
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 9,
            textTransform: "uppercase",
            letterSpacing: 1.2,
            color: COLORS.textMuted,
            marginBottom: 9,
          }}
        >
          Battle discovery
        </div>

        <AnimatePresence initial={false}>
          {visibleLogs.slice(-7).map((log, index) => (
            <motion.div
              key={`${logIndex}-${index}-${log.text}`}
              initial={{ opacity: 0, x: -5 }}
              animate={{ opacity: 1, x: 0 }}
              style={{
                fontFamily: FONT_MONO,
                fontSize: 9.5,
                lineHeight: 1.55,
                padding: "4px 0",
                color:
                  log.type === "critical"
                    ? "#e5c75f"
                    : log.type === "good"
                    ? "#7fd48a"
                    : log.type === "bad"
                    ? "#ff795f"
                    : COLORS.textMuted,
              }}
            >
              {log.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* RESULT INSIGHT */}
      <div
        style={{
          marginTop: 10,
          padding: 13,
          borderRadius: 7,
          background: COLORS.panel,
          border: `1px solid ${COLORS.panelLine}`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            fontFamily: FONT_DISPLAY,
            fontWeight: 700,
            fontSize: 12,
          }}
        >
          <Brain size={14} color={COLORS.chrome} />
          WHAT DID YOU LEARN?
        </div>

        <div
          style={{
            marginTop: 8,
            fontFamily: FONT_MONO,
            fontSize: 9.5,
            color: COLORS.textMuted,
            lineHeight: 1.6,
          }}
        >
          {result.won
            ? "That combination worked. But was it the best possible combination? The next enemy may completely change the answer."
            : "Your build failed this matchup. Change one variable, try a different counter, and see what changes."}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 8,
          marginTop: 10,
        }}
      >
        <button
          onClick={onAgain}
          style={{
            padding: "13px 0",
            borderRadius: 5,
            border: "none",
            background: COLORS.chrome,
            color: COLORS.void,
            fontFamily: FONT_DISPLAY,
            fontWeight: 700,
            fontSize: 11,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
          }}
        >
          <RotateCcw size={13} />
          TRY SOMETHING ELSE
        </button>

        <button
          onClick={onMenu}
          style={{
            padding: "13px 0",
            borderRadius: 5,
            border: `1px solid ${COLORS.panelLine}`,
            background: COLORS.panel,
            color: COLORS.text,
            fontFamily: FONT_DISPLAY,
            fontWeight: 700,
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          MENU
        </button>
      </div>

      <div
        style={{
          textAlign: "center",
          marginTop: 10,
          fontFamily: FONT_MONO,
          fontSize: 8.5,
          color: COLORS.textMuted,
        }}
      >
        {gameState.victories} wins · {gameState.defeats} losses ·{" "}
        {gameState.discovered.length} discoveries
      </div>
    </div>
  );
}

// ============================================================================
// ITEM CARD
// ============================================================================

function ItemCard({
  item,
  selected,
  onClick,
}: {
  item: Item;
  selected: boolean;
  onClick: () => void;
}) {
  const element = ELEMENTS[item.element];

  return (
    <motion.button
      whileTap={{ scale: 0.985 }}
      onClick={onClick}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "11px 12px",
        borderRadius: 7,
        border: `1px solid ${
          selected ? element.color : COLORS.panelLine
        }`,
        background: selected
          ? `${element.color}12`
          : COLORS.panel,
        textAlign: "left",
        cursor: "pointer",
        opacity: selected ? 1 : 0.92,
      }}
    >
      <div
        style={{
          width: 38,
          height: 38,
          borderRadius: 7,
          background: `${element.color}15`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 20,
          flexShrink: 0,
        }}
      >
        {item.icon}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
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
              fontSize: 12,
              color: COLORS.text,
            }}
          >
            {item.name}
          </span>

          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 7.5,
              textTransform: "uppercase",
              color: element.color,
            }}
          >
            {item.rarity}
          </span>
        </div>

        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 8.5,
            lineHeight: 1.4,
            color: COLORS.textMuted,
            marginTop: 3,
          }}
        >
          {item.description}
        </div>

        <div
          style={{
            display: "flex",
            gap: 8,
            marginTop: 5,
            flexWrap: "wrap",
            fontFamily: FONT_MONO,
            fontSize: 8,
          }}
        >
          {item.attack !== 0 && (
            <span>
              ⚔ {item.attack > 0 ? "+" : ""}
              {item.attack}
            </span>
          )}

          {item.defense !== 0 && (
            <span>
              🛡 {item.defense > 0 ? "+" : ""}
              {item.defense}
            </span>
          )}

          {item.health !== 0 && (
            <span>
              ♥ {item.health > 0 ? "+" : ""}
              {item.health}
            </span>
          )}

          {item.speed !== 0 && (
            <span>
              ⚡ {item.speed > 0 ? "+" : ""}
              {item.speed}
            </span>
          )}

          {item.crit > 0 && (
            <span>
              ✦ +{item.crit}%
            </span>
          )}
        </div>
      </div>

      <div
        style={{
          width: 20,
          height: 20,
          borderRadius: "50%",
          border: `1px solid ${
            selected ? element.color : COLORS.panelLine
          }`,
          background: selected ? element.color : "transparent",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {selected && (
          <span
            style={{
              color: COLORS.void,
              fontSize: 11,
              fontWeight: 900,
            }}
          >
            ✓
          </span>
        )}
      </div>
    </motion.button>
  );
}

// ============================================================================
// SMALL COMPONENTS
// ============================================================================

function Tag({
  icon,
  text,
}: {
  icon: React.ReactNode;
  text: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        padding: "5px 7px",
        borderRadius: 4,
        background: COLORS.void,
        border: `1px solid ${COLORS.panelLine}`,
        fontFamily: FONT_MONO,
        fontSize: 8,
        color: COLORS.textMuted,
      }}
    >
      {icon}
      {text}
    </div>
  );
}

function StatMini({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div
      style={{
        padding: "10px 5px",
        textAlign: "center",
        borderRadius: 6,
        background: COLORS.panel,
        border: `1px solid ${COLORS.panelLine}`,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          color: COLORS.chrome,
        }}
      >
        {icon}
      </div>

      <div
        style={{
          fontFamily: FONT_DISPLAY,
          fontWeight: 700,
          fontSize: 14,
          marginTop: 3,
        }}
      >
        {value}
      </div>

      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 7.5,
          color: COLORS.textMuted,
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
    </div>
  );
}

function EnemyFact({
  label,
  value,
  good,
}: {
  label: string;
  value: string;
  good?: boolean;
}) {
  return (
    <div>
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 7.5,
          textTransform: "uppercase",
          color: COLORS.textMuted,
        }}
      >
        {label}
      </div>

      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 9,
          marginTop: 3,
          color: good ? "#7fd48a" : COLORS.text,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function CombatStat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
}) {
  return (
    <div
      style={{
        padding: "7px 6px",
        borderRadius: 5,
        background: COLORS.void,
        border: `1px solid ${COLORS.panelLine}`,
        textAlign: "center",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          color: COLORS.chrome,
        }}
      >
        {icon}
      </div>

      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 10,
          fontWeight: 700,
          marginTop: 2,
        }}
      >
        {typeof value === "number"
          ? formatNumber(value)
          : value}
      </div>

      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 7,
          color: COLORS.textMuted,
        }}
      >
        {label}
      </div>
    </div>
  );
}
