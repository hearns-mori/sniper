"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  ArrowLeft,
  ArrowUp,
  Crosshair,
  Dices,
  Heart,
  RotateCcw,
  Shield,
  Skull,
  Swords,
  Target,
  Trophy,
  Zap,
} from "lucide-react";

import { COLORS, FONT_DISPLAY, FONT_MONO } from "@/lib/theme";

type Phase = "menu" | "battle";

interface PhaserShooterProps {
  lifetimeKills: number;
  onExit: () => void;
}

/* ============================================================================
   CORE LEVEL SYSTEM
   ========================================================================== */

/*
 * 521 productivity kills = 1 game level.
 *
 * Level is permanent.
 * Allocation is freely changeable.
 * The player gets exactly one stat point per level.
 */
interface LevelInfo {
  level: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
}

function xpForLevel(_level: number): number {
  return 521;
}

function levelFromLifetimeKills(lifetimeKills: number): LevelInfo {
  let level = 1;
  let xp = Math.max(0, Math.floor(lifetimeKills));

  while (xp >= xpForLevel(level)) {
    xp -= xpForLevel(level);
    level += 1;
  }

  return {
    level,
    xpIntoLevel: xp,
    xpForNextLevel: xpForLevel(level),
  };
}

/* ============================================================================
   PLAYER BUILD
   ========================================================================== */

type StatKey =
  | "vitality"
  | "power"
  | "armor"
  | "agility"
  | "precision"
  | "critical"
  | "evasion"
  | "lifesteal"
  | "penetration"
  | "fortitude"
  | "regeneration"
  | "block"
  | "counter";

interface Allocation {
  vitality: number;
  power: number;
  armor: number;
  agility: number;
  precision: number;
  critical: number;
  evasion: number;
  lifesteal: number;
  penetration: number;
  fortitude: number;
  regeneration: number;
  block: number;
  counter: number;
}

const EMPTY_ALLOCATION: Allocation = {
  vitality: 0,
  power: 0,
  armor: 0,
  agility: 0,
  precision: 0,
  critical: 0,
  evasion: 0,
  lifesteal: 0,
  penetration: 0,
  fortitude: 0,
  regeneration: 0,
  block: 0,
  counter: 0,
};

interface Stats {
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  speed: number;
  accuracy: number;
  critChance: number;
  critMultiplier: number;
  dodgeChance: number;
  lifesteal: number;
  penetration: number;
  damageReduction: number;
  regeneration: number;
  blockChance: number;
  blockAmount: number;
  counterChance: number;
  counterDamage: number;
}

/*
 * Broad stat system.
 *
 * Every allocation has a meaningful identity:
 *
 * Vitality      = enormous HP
 * Power         = attack
 * Armor         = defense
 * Agility       = speed + dodge
 * Precision     = accuracy + penetration
 * Critical      = crit
 * Evasion       = dodge
 * Lifesteal     = sustain
 * Penetration   = bypass defense / reduction
 * Fortitude     = damage reduction
 * Regeneration  = healing
 * Block         = chance to reduce hits
 * Counter       = retaliation
 *
 * Soft caps prevent one stat from becoming mathematically unbeatable.
 */
function buildPlayerStats(allocation: Allocation): Stats {
  const hp = 100 + allocation.vitality * 28;

  const attack =
    12 +
    allocation.power * 6 +
    Math.floor(Math.pow(allocation.power, 1.08));

  const defense =
    5 +
    allocation.armor * 4 +
    Math.floor(Math.pow(allocation.armor, 1.04));

  const speed = 10 + allocation.agility * 2.2;

  const accuracy = Math.min(
    98,
    82 + allocation.precision * 1.2
  );

  const critChance = Math.min(
    55,
    5 + allocation.critical * 1.35
  );

  const critMultiplier =
    1.5 + Math.min(1.0, allocation.critical * 0.025);

  const dodgeChance = Math.min(
    45,
    allocation.agility * 0.65 + allocation.evasion * 1.35
  );

  const lifesteal = Math.min(
    35,
    allocation.lifesteal * 1.15
  );

  const penetration = Math.min(
    70,
    allocation.precision * 0.8 +
      allocation.penetration * 1.4
  );

  const damageReduction = Math.min(
    55,
    allocation.fortitude * 1.15
  );

  const regeneration =
    allocation.regeneration * 0.7;

  const blockChance = Math.min(
    50,
    allocation.block * 1.25
  );

  const blockAmount = Math.min(
    65,
    15 + allocation.block * 0.85
  );

  const counterChance = Math.min(
    45,
    allocation.counter * 1.25
  );

  const counterDamage =
    0.25 + Math.min(0.75, allocation.counter * 0.018);

  return {
    hp,
    maxHp: hp,
    attack,
    defense,
    speed,
    accuracy,
    critChance,
    critMultiplier,
    dodgeChance,
    lifesteal,
    penetration,
    damageReduction,
    regeneration,
    blockChance,
    blockAmount,
    counterChance,
    counterDamage,
  };
}

/* ============================================================================
   ENEMY SYSTEM
   ========================================================================== */

interface Enemy {
  id: number;
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  speed: number;
  accuracy: number;
  critChance: number;
  critMultiplier: number;
  dodgeChance: number;
  lifesteal: number;
  penetration: number;
  damageReduction: number;
  regeneration: number;
  blockChance: number;
  blockAmount: number;
  counterChance: number;
  counterDamage: number;
  archetype: string;
}

let enemyId = 1;

const ENEMY_NAMES = [
  "Iron Revenant",
  "Void Hunter",
  "Glass Predator",
  "Ash Knight",
  "Blood Warden",
  "Storm Stalker",
  "Bone Titan",
  "Night Fang",
  "Rift Soldier",
  "Crimson Machine",
  "Silent Executioner",
  "Obsidian Beast",
  "Feral Construct",
  "Dread Vanguard",
  "Chaos Runner",
];

const ARCHETYPES = [
  "Tank",
  "Berserker",
  "Assassin",
  "Vampire",
  "Guardian",
  "Marksman",
  "Juggernaut",
  "Balanced",
];

function seededRandom(seed: number): () => number {
  let s = Math.abs(Math.floor(seed)) || 1;

  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function generateEnemy(depth: number, playerLevel: number): Enemy {
  /*
   * A deterministic seed based on depth + current time.
   *
   * This means every new enemy is different while the combat itself
   * remains reproducible during one fight.
   */
  const seed =
    Date.now() +
    depth * 7919 +
    playerLevel * 104729 +
    Math.floor(Math.random() * 999999);

  const random = seededRandom(seed);

  const archetype =
    ARCHETYPES[Math.floor(random() * ARCHETYPES.length)];

  const name =
    ENEMY_NAMES[Math.floor(random() * ENEMY_NAMES.length)];

  /*
   * Enemy power rises with depth, but not linearly.
   *
   * This creates increasing danger without requiring absurd numbers.
   */
  const difficulty =
    1 +
    depth * 0.095 +
    Math.pow(depth, 1.18) * 0.018;

  const variance = 0.82 + random() * 0.36;

  let hp = 120 * difficulty * variance;
  let attack = 13 * difficulty * variance;
  let defense = 6 * difficulty * variance;
  let speed = 10 * (0.9 + random() * 0.25);
  let accuracy = 82;
  let critChance = 5;
  let critMultiplier = 1.5;
  let dodgeChance = 3;
  let lifesteal = 0;
  let penetration = 0;
  let damageReduction = 0;
  let regeneration = 0;
  let blockChance = 0;
  let blockAmount = 20;
  let counterChance = 0;
  let counterDamage = 0.35;

  switch (archetype) {
    case "Tank":
      hp *= 1.7;
      defense *= 1.55;
      attack *= 0.78;
      speed *= 0.75;
      damageReduction = 12 + random() * 12;
      blockChance = 12 + random() * 10;
      blockAmount = 35;
      break;

    case "Berserker":
      hp *= 0.85;
      attack *= 1.65;
      defense *= 0.7;
      critChance = 15 + random() * 12;
      critMultiplier = 1.8;
      damageReduction = 3;
      break;

    case "Assassin":
      hp *= 0.7;
      attack *= 1.35;
      speed *= 1.8;
      critChance = 20 + random() * 15;
      critMultiplier = 1.9;
      dodgeChance = 18 + random() * 10;
      accuracy = 88;
      break;

    case "Vampire":
      hp *= 0.95;
      attack *= 1.05;
      lifesteal = 18 + random() * 15;
      regeneration = 0.5 + random() * 1.2;
      break;

    case "Guardian":
      hp *= 1.35;
      defense *= 1.25;
      attack *= 0.9;
      blockChance = 25 + random() * 12;
      blockAmount = 45;
      counterChance = 12;
      break;

    case "Marksman":
      hp *= 0.8;
      attack *= 1.25;
      accuracy = 94;
      penetration = 15 + random() * 15;
      critChance = 12 + random() * 8;
      break;

    case "Juggernaut":
      hp *= 2;
      defense *= 1.2;
      attack *= 1.15;
      speed *= 0.65;
      damageReduction = 20 + random() * 10;
      break;

    case "Balanced":
    default:
      hp *= 1.05;
      attack *= 1.05;
      defense *= 1.05;
      break;
  }

  return {
    id: enemyId++,
    name,
    level: Math.max(1, playerLevel + Math.floor(depth * 0.4)),
    hp: Math.round(hp),
    maxHp: Math.round(hp),
    attack: Math.round(attack * 10) / 10,
    defense: Math.round(defense * 10) / 10,
    speed: Math.round(speed * 10) / 10,
    accuracy,
    critChance,
    critMultiplier,
    dodgeChance,
    lifesteal,
    penetration,
    damageReduction,
    regeneration,
    blockChance,
    blockAmount,
    counterChance,
    counterDamage,
    archetype,
  };
}

/* ============================================================================
   COMBAT
   ========================================================================== */

interface CombatLog {
  id: number;
  text: string;
  type: "player" | "enemy" | "system" | "critical" | "heal";
}

interface CombatResult {
  won: boolean;
  playerHp: number;
  enemyHp: number;
  log: CombatLog[];
  rounds: number;
}

function calculateDamage(
  attacker: Stats,
  defender: Stats,
  defenderHp: number,
  random: () => number
): {
  damage: number;
  critical: boolean;
  dodged: boolean;
  blocked: boolean;
  healed: number;
} {
  /*
   * Dodge first.
   */
  if (random() * 100 > attacker.accuracy) {
    return {
      damage: 0,
      critical: false,
      dodged: true,
      blocked: false,
      healed: 0,
    };
  }

  if (random() * 100 < defender.dodgeChance) {
    return {
      damage: 0,
      critical: false,
      dodged: true,
      blocked: false,
      healed: 0,
    };
  }

  /*
   * Defense is reduced by penetration.
   *
   * This makes penetration useful without making defense irrelevant.
   */
  const effectiveDefense =
    defender.defense *
    (1 - Math.min(0.85, attacker.penetration / 100));

  /*
   * Defense follows diminishing returns.
   */
  const defenseMultiplier =
    100 / (100 + Math.max(0, effectiveDefense));

  let damage = attacker.attack * defenseMultiplier;

  const critical =
    random() * 100 < attacker.critChance;

  if (critical) {
    damage *= attacker.critMultiplier;
  }

  /*
   * Final damage reduction happens after armor.
   */
  damage *=
    1 - Math.min(0.8, defender.damageReduction / 100);

  /*
   * Block is multiplicative rather than absolute.
   */
  const blocked =
    random() * 100 < defender.blockChance;

  if (blocked) {
    damage *=
      1 - Math.min(0.8, defender.blockAmount / 100);
  }

  damage = Math.max(1, damage);

  const healed =
    damage * (attacker.lifesteal / 100);

  return {
    damage,
    critical,
    dodged: false,
    blocked,
    healed: Math.min(healed, attacker.maxHp - defenderHp),
  };
}

function fight(
  player: Stats,
  enemy: Enemy,
  seed: number
): CombatResult {
  const random = seededRandom(seed);

  let playerHp = player.maxHp;
  let enemyHp = enemy.maxHp;

  const log: CombatLog[] = [];
  let logId = 1;
  let rounds = 0;

  /*
   * Hard safety cap.
   *
   * A properly balanced battle should end long before this.
   */
  while (
    playerHp > 0 &&
    enemyHp > 0 &&
    rounds < 250
  ) {
    rounds += 1;

    const playerFirst =
      player.speed >= enemy.speed
        ? random() > 0.15
        : random() < 0.15;

    const turns = playerFirst
      ? ["player", "enemy"]
      : ["enemy", "player"];

    for (const turn of turns) {
      if (playerHp <= 0 || enemyHp <= 0) break;

      if (turn === "player") {
        const result = calculateDamage(
          player,
          enemy,
          enemyHp,
          random
        );

        if (result.dodged) {
          log.push({
            id: logId++,
            text: "Your attack missed.",
            type: "system",
          });
        } else {
          enemyHp = Math.max(
            0,
            enemyHp - result.damage
          );

          playerHp = Math.min(
            player.maxHp,
            playerHp + result.healed
          );

          log.push({
            id: logId++,
            text: result.critical
              ? `CRITICAL hit for ${Math.round(result.damage)}`
              : `You dealt ${Math.round(result.damage)} damage`,
            type: result.critical
              ? "critical"
              : "player",
          });

          if (result.healed > 0) {
            log.push({
              id: logId++,
              text: `Lifesteal +${Math.round(result.healed)} HP`,
              type: "heal",
            });
          }

          if (result.blocked) {
            log.push({
              id: logId++,
              text: "Enemy blocked part of the hit.",
              type: "system",
            });
          }
        }
      } else {
        const enemyStats: Stats = {
          hp: enemy.hp,
          maxHp: enemy.maxHp,
          attack: enemy.attack,
          defense: enemy.defense,
          speed: enemy.speed,
          accuracy: enemy.accuracy,
          critChance: enemy.critChance,
          critMultiplier: enemy.critMultiplier,
          dodgeChance: enemy.dodgeChance,
          lifesteal: enemy.lifesteal,
          penetration: enemy.penetration,
          damageReduction: enemy.damageReduction,
          regeneration: enemy.regeneration,
          blockChance: enemy.blockChance,
          blockAmount: enemy.blockAmount,
          counterChance: enemy.counterChance,
          counterDamage: enemy.counterDamage,
        };

        const result = calculateDamage(
          enemyStats,
          player,
          playerHp,
          random
        );

        if (result.dodged) {
          log.push({
            id: logId++,
            text: "You dodged the enemy attack.",
            type: "player",
          });
        } else {
          playerHp = Math.max(
            0,
            playerHp - result.damage
          );

          log.push({
            id: logId++,
            text: result.critical
              ? `Enemy CRIT for ${Math.round(result.damage)}`
              : `Enemy dealt ${Math.round(result.damage)} damage`,
            type: result.critical
              ? "critical"
              : "enemy",
          });

          if (result.blocked) {
            log.push({
              id: logId++,
              text: "You blocked part of the attack.",
              type: "system",
            });
          }

          /*
           * Counterattack.
           */
          if (
            playerHp > 0 &&
            random() * 100 < player.counterChance
          ) {
            const counter =
              enemy.defense *
                0 +
              player.attack *
                player.counterDamage *
                (1 -
                  Math.min(
                    0.7,
                    enemy.defense /
                      (enemy.defense + 150)
                  ));

            const counterDamage =
              Math.max(1, counter);

            enemyHp = Math.max(
              0,
              enemyHp - counterDamage
            );

            log.push({
              id: logId++,
              text: `Counterattack for ${Math.round(counterDamage)}`,
              type: "critical",
            });
          }
        }
      }

      if (playerHp <= 0 || enemyHp <= 0) {
        break;
      }
    }

    /*
     * Regeneration occurs after each round.
     */
    if (playerHp > 0) {
      playerHp = Math.min(
        player.maxHp,
        playerHp + player.regeneration
      );
    }

    if (enemyHp > 0) {
      enemyHp = Math.min(
        enemy.maxHp,
        enemyHp + enemy.regeneration
      );
    }
  }

  /*
   * If a battle somehow reaches the cap, higher remaining HP wins.
   */
  if (
    rounds >= 250 &&
    playerHp > 0 &&
    enemyHp > 0
  ) {
    return {
      won: playerHp >= enemyHp,
      playerHp,
      enemyHp,
      log,
      rounds,
    };
  }

  return {
    won: enemyHp <= 0,
    playerHp,
    enemyHp,
    log,
    rounds,
  };
}

/* ============================================================================
   PERSISTENCE
   ========================================================================== */

interface GameState {
  allocation: Allocation;
  checkpoint: number;
  highestDepth: number;
  totalWins: number;
}

const NEW_STORAGE_KEY = "phaser_battle_v2";
const OLD_STORAGE_KEY = "tapgame_state_v1";

function defaultGameState(): GameState {
  return {
    allocation: { ...EMPTY_ALLOCATION },
    checkpoint: 0,
    highestDepth: 0,
    totalWins: 0,
  };
}

function loadGameState(): GameState {
  if (typeof window === "undefined") {
    return defaultGameState();
  }

  try {
    const raw =
      window.localStorage.getItem(
        NEW_STORAGE_KEY
      );

    if (raw) {
      const parsed = JSON.parse(raw) as Partial<GameState>;

      return {
        ...defaultGameState(),
        ...parsed,
        allocation: {
          ...EMPTY_ALLOCATION,
          ...(parsed.allocation ?? {}),
        },
      };
    }

    /*
     * We deliberately inspect the old state only so this replacement
     * does not crash an existing installation.
     */
    const oldRaw =
      window.localStorage.getItem(
        OLD_STORAGE_KEY
      );

    if (oldRaw) {
      return defaultGameState();
    }

    return defaultGameState();
  } catch {
    return defaultGameState();
  }
}

function saveGameState(state: GameState) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      NEW_STORAGE_KEY,
      JSON.stringify(state)
    );
  } catch {
    // Ignore storage errors.
  }
}

/* ============================================================================
   STAT DEFINITIONS
   ========================================================================== */

interface StatDefinition {
  key: StatKey;
  name: string;
  short: string;
  description: string;
  icon: React.ReactNode;
}

const STAT_DEFINITIONS: StatDefinition[] = [
  {
    key: "vitality",
    name: "Vitality",
    short: "HP",
    description: "+28 maximum HP",
    icon: <Heart size={15} />,
  },
  {
    key: "power",
    name: "Power",
    short: "ATK",
    description: "+attack damage",
    icon: <Swords size={15} />,
  },
  {
    key: "armor",
    name: "Armor",
    short: "DEF",
    description: "+defense",
    icon: <Shield size={15} />,
  },
  {
    key: "agility",
    name: "Agility",
    short: "SPD",
    description: "+speed and dodge",
    icon: <Zap size={15} />,
  },
  {
    key: "precision",
    name: "Precision",
    short: "ACC",
    description: "+accuracy and penetration",
    icon: <Crosshair size={15} />,
  },
  {
    key: "critical",
    name: "Critical",
    short: "CRIT",
    description: "+crit chance and crit power",
    icon: <Target size={15} />,
  },
  {
    key: "evasion",
    name: "Evasion",
    short: "DODGE",
    description: "+dodge chance",
    icon: <Activity size={15} />,
  },
  {
    key: "lifesteal",
    name: "Lifesteal",
    short: "LS",
    description: "+% damage returned as HP",
    icon: <Heart size={15} />,
  },
  {
    key: "penetration",
    name: "Penetration",
    short: "PEN",
    description: "Ignore enemy defense",
    icon: <Crosshair size={15} />,
  },
  {
    key: "fortitude",
    name: "Fortitude",
    short: "DR",
    description: "+final damage reduction",
    icon: <Shield size={15} />,
  },
  {
    key: "regeneration",
    name: "Regeneration",
    short: "REGEN",
    description: "Recover HP every round",
    icon: <Activity size={15} />,
  },
  {
    key: "block",
    name: "Block",
    short: "BLOCK",
    description: "Chance to reduce incoming damage",
    icon: <Shield size={15} />,
  },
  {
    key: "counter",
    name: "Counter",
    short: "COUNTER",
    description: "Chance to retaliate",
    icon: <Swords size={15} />,
  },
];

/* ============================================================================
   FORMATTING
   ========================================================================== */

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";

  if (Math.abs(value) < 1000) {
    return Math.round(value).toString();
  }

  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function pct(value: number): string {
  return `${value.toFixed(1)}%`;
}

/* ============================================================================
   MAIN COMPONENT
   ========================================================================== */

export default function PhaserShooter({
  lifetimeKills,
  onExit,
}: PhaserShooterProps) {
  const levelInfo = useMemo(
    () =>
      levelFromLifetimeKills(
        lifetimeKills
      ),
    [lifetimeKills]
  );

  const [phase, setPhase] =
    useState<Phase>("menu");

  const [gameState, setGameState] =
    useState<GameState>(() =>
      defaultGameState()
    );

  const [hydrated, setHydrated] =
    useState(false);

  const [enemy, setEnemy] =
    useState<Enemy | null>(null);

  const [combat, setCombat] =
    useState<CombatResult | null>(null);

  const [fighting, setFighting] =
    useState(false);

  const [toast, setToast] =
    useState<string | null>(null);

  const [showStats, setShowStats] =
    useState(false);

  const stats = useMemo(
    () =>
      buildPlayerStats(
        gameState.allocation
      ),
    [gameState.allocation]
  );

  const allocatedPoints = useMemo(
    () =>
      Object.values(
        gameState.allocation
      ).reduce(
        (sum, value) => sum + value,
        0
      ),
    [gameState.allocation]
  );

  const availablePoints =
    Math.max(
      0,
      levelInfo.level -
        1 -
        allocatedPoints
    );

  /* --------------------------------------------------------------------------
     LOAD
     ------------------------------------------------------------------------ */

  useEffect(() => {
    setGameState(loadGameState());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveGameState(gameState);
  }, [gameState, hydrated]);

  /* --------------------------------------------------------------------------
     TOAST
     ------------------------------------------------------------------------ */

  useEffect(() => {
    if (!toast) return;

    const timeout =
      window.setTimeout(
        () => setToast(null),
        2200
      );

    return () =>
      window.clearTimeout(timeout);
  }, [toast]);

  /* --------------------------------------------------------------------------
     ALLOCATION
     ------------------------------------------------------------------------ */

  const allocate = useCallback(
    (key: StatKey) => {
      if (availablePoints <= 0) {
        setToast(
          "No level points available."
        );
        return;
      }

      setGameState((previous) => ({
        ...previous,
        allocation: {
          ...previous.allocation,
          [key]:
            previous.allocation[key] + 1,
        },
      }));
    },
    [availablePoints]
  );

  const resetBuild = useCallback(() => {
    setGameState((previous) => ({
      ...previous,
      allocation: {
        ...EMPTY_ALLOCATION,
      },
    }));

    setToast(
      "Build reset. Redistribute your levels."
    );
  }, []);

  /* --------------------------------------------------------------------------
     START BATTLE
     ------------------------------------------------------------------------ */

  const startBattle = useCallback(
    (depth: number) => {
      const nextEnemy =
        generateEnemy(
          depth,
          levelInfo.level
        );

      setEnemy(nextEnemy);
      setCombat(null);
      setPhase("battle");
    },
    [levelInfo.level]
  );

  const startFromCheckpoint =
    useCallback(() => {
      startBattle(
        gameState.checkpoint + 1
      );
    }, [
      gameState.checkpoint,
      startBattle,
    ]);

  /* --------------------------------------------------------------------------
     FIGHT
     ------------------------------------------------------------------------ */

  const fightEnemy = useCallback(() => {
    if (!enemy || fighting) return;

    setFighting(true);

    /*
     * Tiny delay makes the fight feel like an event rather than an
     * instantaneous calculation.
     */
    window.setTimeout(() => {
      const result = fight(
        stats,
        enemy,
        Date.now() +
          enemy.id * 997
      );

      setCombat(result);
      setFighting(false);

      if (result.won) {
        const newDepth =
          gameState.checkpoint +
          1;

        const newCheckpoint =
          newDepth % 5 === 0
            ? newDepth
            : gameState.checkpoint;

        setGameState(
          (previous) => ({
            ...previous,
            checkpoint:
              Math.max(
                previous.checkpoint,
                newCheckpoint
              ),
            highestDepth:
              Math.max(
                previous.highestDepth,
                newDepth
              ),
            totalWins:
              previous.totalWins + 1,
          })
        );

        if (
          newCheckpoint >
          gameState.checkpoint
        ) {
          setToast(
            `CHECKPOINT ${newCheckpoint} REACHED`
          );
        } else {
          setToast(
            "Enemy defeated. What's next?"
          );
        }
      } else {
        setToast(
          `Defeated. Checkpoint ${gameState.checkpoint} restored.`
        );
      }
    }, 350);
  }, [
    enemy,
    fighting,
    stats,
    gameState.checkpoint,
  ]);

  const nextEnemy = useCallback(() => {
    startBattle(
      gameState.checkpoint + 1
    );
  }, [
    gameState.checkpoint,
    startBattle,
  ]);

  const backToMenu = useCallback(() => {
    setPhase("menu");
    setEnemy(null);
    setCombat(null);
  }, []);

  /* --------------------------------------------------------------------------
     RENDER
     ------------------------------------------------------------------------ */

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
      }}
    >
      <AnimatePresence mode="wait">
        {phase === "menu" && (
          <motion.div
            key="battle-menu"
            initial={{
              opacity: 0,
              y: 8,
            }}
            animate={{
              opacity: 1,
              y: 0,
            }}
            exit={{
              opacity: 0,
              y: -8,
            }}
          >
            <Menu
              levelInfo={levelInfo}
              stats={stats}
              gameState={gameState}
              availablePoints={
                availablePoints
              }
              allocatedPoints={
                allocatedPoints
              }
              hydrated={hydrated}
              showStats={showStats}
              onToggleStats={() =>
                setShowStats(
                  (value) => !value
                )
              }
              onAllocate={allocate}
              onReset={resetBuild}
              onStart={
                startFromCheckpoint
              }
            />
          </motion.div>
        )}

        {phase === "battle" &&
          enemy && (
            <motion.div
              key="battle"
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
              <BattleScreen
                level={levelInfo.level}
                depth={
                  gameState.checkpoint +
                  1
                }
                checkpoint={
                  gameState.checkpoint
                }
                stats={stats}
                enemy={enemy}
                combat={combat}
                fighting={fighting}
                onFight={fightEnemy}
                onNext={nextEnemy}
                onBack={backToMenu}
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
            justifyContent: "center",
            gap: 6,
            margin:
              "18px auto 0",
            padding: "8px 4px",
            background:
              "transparent",
            border: "none",
            color:
              COLORS.textMuted,
            fontFamily:
              FONT_MONO,
            fontSize: 10.5,
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

/* ============================================================================
   MENU
   ========================================================================== */

function Menu({
  levelInfo,
  stats,
  gameState,
  availablePoints,
  allocatedPoints,
  hydrated,
  showStats,
  onToggleStats,
  onAllocate,
  onReset,
  onStart,
}: {
  levelInfo: LevelInfo;
  stats: Stats;
  gameState: GameState;
  availablePoints: number;
  allocatedPoints: number;
  hydrated: boolean;
  showStats: boolean;
  onToggleStats: () => void;
  onAllocate: (key: StatKey) => void;
  onReset: () => void;
  onStart: () => void;
}) {
  const xpPct =
    levelInfo.xpForNextLevel > 0
      ? levelInfo.xpIntoLevel /
        levelInfo.xpForNextLevel
      : 0;

  return (
    <div>
      {/* LEVEL / CHECKPOINT */}
      <div
        style={{
          padding:
            "16px 16px 14px",
          borderRadius: 6,
          background:
            COLORS.panel,
          border:
            `1px solid ${COLORS.panelLine}`,
          marginBottom: 10,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent:
              "space-between",
            gap: 12,
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
            <Zap
              size={17}
              color={
                COLORS.chrome
              }
            />

            <div>
              <div
                style={{
                  fontFamily:
                    FONT_DISPLAY,
                  fontWeight: 700,
                  fontSize: 16,
                  color:
                    COLORS.text,
                }}
              >
                Level{" "}
                {levelInfo.level}
              </div>

              <div
                style={{
                  fontFamily:
                    FONT_MONO,
                  fontSize: 9,
                  color:
                    COLORS.textMuted,
                  marginTop: 2,
                }}
              >
                {allocatedPoints}{" "}
                allocated ·{" "}
                {availablePoints}{" "}
                available
              </div>
            </div>
          </div>

          <div
            style={{
              textAlign:
                "right",
              fontFamily:
                FONT_MONO,
              fontSize: 9,
              color:
                COLORS.textMuted,
            }}
          >
            <div>
              CP{" "}
              {gameState.checkpoint}
            </div>
            <div
              style={{
                marginTop: 2,
              }}
            >
              {gameState.totalWins}{" "}
              wins
            </div>
          </div>
        </div>

        <div
          style={{
            height: 6,
            borderRadius: 3,
            background:
              COLORS.void,
            marginTop: 10,
            overflow:
              "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${
                xpPct * 100
              }%`,
              background:
                COLORS.chrome,
              transition:
                "width 200ms ease",
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
            fontSize: 8.5,
            color:
              COLORS.textMuted,
          }}
        >
          <span>
            {levelInfo.xpIntoLevel}
            /
            {levelInfo.xpForNextLevel}{" "}
            productivity
          </span>

          <span>
            Best depth{" "}
            {gameState.highestDepth}
          </span>
        </div>
      </div>

      {/* BUILD HEADER */}
      <div
        style={{
          display: "flex",
          alignItems:
            "center",
          justifyContent:
            "space-between",
          margin:
            "14px 0 8px",
        }}
      >
        <div
          style={{
            fontFamily:
              FONT_MONO,
            fontSize: 10,
            color:
              COLORS.textMuted,
            textTransform:
              "uppercase",
            letterSpacing: 1.5,
          }}
        >
          Build your fighter
        </div>

        <button
          onClick={onReset}
          style={{
            display: "flex",
            alignItems:
              "center",
            gap: 4,
            padding:
              "5px 7px",
            borderRadius: 4,
            border:
              `1px solid ${COLORS.panelLine}`,
            background:
              COLORS.panel,
            color:
              COLORS.textMuted,
            fontFamily:
              FONT_MONO,
            fontSize: 8.5,
            cursor:
              "pointer",
          }}
        >
          <RotateCcw
            size={10}
          />
          RESET
        </button>
      </div>

      {/* STAT ALLOCATION */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "1fr 1fr",
          gap: 7,
        }}
      >
        {STAT_DEFINITIONS.map(
          (definition) => {
            const amount =
              gameState
                .allocation[
                definition.key
              ];

            return (
              <StatAllocation
                key={
                  definition.key
                }
                definition={
                  definition
                }
                amount={amount}
                canAllocate={
                  availablePoints >
                  0
                }
                onAllocate={() =>
                  onAllocate(
                    definition.key
                  )
                }
              />
            );
          }
        )}
      </div>

      {/* CURRENT STATS */}
      <button
        onClick={
          onToggleStats
        }
        style={{
          width: "100%",
          marginTop: 10,
          padding:
            "10px 12px",
          borderRadius: 5,
          border:
            `1px solid ${COLORS.panelLine}`,
          background:
            COLORS.panel,
          color:
            COLORS.textMuted,
          fontFamily:
            FONT_MONO,
          fontSize: 9,
          textTransform:
            "uppercase",
          letterSpacing:
            0.8,
          cursor:
            "pointer",
        }}
      >
        {showStats
          ? "Hide combat stats"
          : "Inspect combat stats"}
      </button>

      <AnimatePresence>
        {showStats && (
          <motion.div
            initial={{
              opacity: 0,
              height: 0,
            }}
            animate={{
              opacity: 1,
              height: "auto",
            }}
            exit={{
              opacity: 0,
              height: 0,
            }}
            style={{
              overflow:
                "hidden",
            }}
          >
            <CombatStats
              stats={stats}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* START */}
      <button
        onClick={onStart}
        disabled={!hydrated}
        style={{
          width: "100%",
          marginTop: 12,
          padding:
            "14px 0",
          borderRadius: 5,
          border: "none",
          background:
            COLORS.chrome,
          color:
            COLORS.void,
          fontFamily:
            FONT_DISPLAY,
          fontWeight: 700,
          fontSize: 13,
          letterSpacing:
            0.8,
          textTransform:
            "uppercase",
          cursor:
            hydrated
              ? "pointer"
              : "default",
          opacity:
            hydrated
              ? 1
              : 0.6,
          display: "flex",
          alignItems:
            "center",
          justifyContent:
            "center",
          gap: 7,
        }}
      >
        <Swords size={15} />
        Fight next enemy
      </button>

      <div
        style={{
          marginTop: 8,
          textAlign:
            "center",
          fontFamily:
            FONT_MONO,
          fontSize: 8.5,
          color:
            COLORS.textMuted,
        }}
      >
        Every 5 victories =
        checkpoint
      </div>
    </div>
  );
}

/* ============================================================================
   STAT ALLOCATION CARD
   ========================================================================== */

function StatAllocation({
  definition,
  amount,
  canAllocate,
  onAllocate,
}: {
  definition: StatDefinition;
  amount: number;
  canAllocate: boolean;
  onAllocate: () => void;
}) {
  return (
    <motion.button
      whileTap={
        canAllocate
          ? { scale: 0.97 }
          : undefined
      }
      onClick={onAllocate}
      disabled={!canAllocate}
      style={{
        minWidth: 0,
        textAlign:
          "left",
        padding:
          "10px 10px",
        borderRadius: 5,
        border:
          `1px solid ${
            amount > 0
              ? `${COLORS.chrome}55`
              : COLORS.panelLine
          }`,
        background:
          amount > 0
            ? `${COLORS.chrome}0c`
            : COLORS.panel,
        color:
          COLORS.text,
        cursor:
          canAllocate
            ? "pointer"
            : "not-allowed",
        opacity:
          canAllocate
            ? 1
            : 0.62,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems:
            "center",
          gap: 6,
        }}
      >
        <span
          style={{
            color:
              amount > 0
                ? COLORS.chrome
                : COLORS.textMuted,
            display: "flex",
          }}
        >
          {definition.icon}
        </span>

        <span
          style={{
            fontFamily:
              FONT_DISPLAY,
            fontWeight: 700,
            fontSize: 11,
            flex: 1,
          }}
        >
          {definition.name}
        </span>

        <span
          style={{
            fontFamily:
              FONT_MONO,
            fontSize: 10,
            color:
              amount > 0
                ? COLORS.chrome
                : COLORS.textMuted,
            fontWeight: 700,
          }}
        >
          +{amount}
        </span>
      </div>

      <div
        style={{
          fontFamily:
            FONT_MONO,
          fontSize: 8,
          color:
            COLORS.textMuted,
          marginTop: 4,
          lineHeight: 1.3,
        }}
      >
        {definition.description}
      </div>
    </motion.button>
  );
}

/* ============================================================================
   COMBAT STATS
   ========================================================================== */

function CombatStats({
  stats,
}: {
  stats: Stats;
}) {
  const values = [
    ["HP", formatNumber(stats.maxHp)],
    ["ATK", formatNumber(stats.attack)],
    ["DEF", formatNumber(stats.defense)],
    ["SPD", formatNumber(stats.speed)],
    ["ACC", pct(stats.accuracy)],
    ["CRIT", pct(stats.critChance)],
    [
      "CRIT DMG",
      `${stats.critMultiplier.toFixed(
        2
      )}x`,
    ],
    ["DODGE", pct(stats.dodgeChance)],
    ["LIFESTEAL", pct(stats.lifesteal)],
    ["PEN", pct(stats.penetration)],
    [
      "FINAL DR",
      pct(stats.damageReduction),
    ],
    [
      "REGEN",
      formatNumber(stats.regeneration),
    ],
    ["BLOCK", pct(stats.blockChance)],
    ["COUNTER", pct(stats.counterChance)],
  ];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns:
          "repeat(2, 1fr)",
        gap: 5,
        marginTop: 7,
        padding: 8,
        borderRadius: 5,
        background:
          COLORS.void,
        border:
          `1px solid ${COLORS.panelLine}`,
      }}
    >
      {values.map(
        ([label, value]) => (
          <div
            key={label}
            style={{
              display:
                "flex",
              justifyContent:
                "space-between",
              gap: 5,
              fontFamily:
                FONT_MONO,
              fontSize: 8.5,
            }}
          >
            <span
              style={{
                color:
                  COLORS.textMuted,
              }}
            >
              {label}
            </span>

            <span
              style={{
                color:
                  COLORS.text,
                fontWeight: 700,
              }}
            >
              {value}
            </span>
          </div>
        )
      )}
    </div>
  );
}

/* ============================================================================
   BATTLE SCREEN
   ========================================================================== */

function BattleScreen({
  level,
  depth,
  checkpoint,
  stats,
  enemy,
  combat,
  fighting,
  onFight,
  onNext,
  onBack,
}: {
  level: number;
  depth: number;
  checkpoint: number;
  stats: Stats;
  enemy: Enemy;
  combat: CombatResult | null;
  fighting: boolean;
  onFight: () => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const playerHp =
    combat?.playerHp ??
    stats.maxHp;

  const enemyHp =
    combat?.enemyHp ??
    enemy.maxHp;

  const playerHpPct =
    Math.max(
      0,
      Math.min(
        1,
        playerHp /
          stats.maxHp
      )
    );

  const enemyHpPct =
    Math.max(
      0,
      Math.min(
        1,
        enemyHp /
          enemy.maxHp
      )
    );

  return (
    <div>
      {/* HEADER */}
      <div
        style={{
          display:
            "flex",
          alignItems:
            "center",
          justifyContent:
            "space-between",
          marginBottom: 10,
        }}
      >
        <button
          onClick={onBack}
          style={{
            display:
              "flex",
            alignItems:
              "center",
            gap: 5,
            padding:
              "6px 8px",
            borderRadius: 4,
            border:
              `1px solid ${COLORS.panelLine}`,
            background:
              COLORS.panel,
            color:
              COLORS.textMuted,
            fontFamily:
              FONT_MONO,
            fontSize: 9,
            cursor:
              "pointer",
          }}
        >
          <ArrowLeft
            size={11}
          />
          Build
        </button>

        <div
          style={{
            textAlign:
              "center",
            fontFamily:
              FONT_MONO,
          }}
        >
          <div
            style={{
              fontSize: 9,
              color:
                COLORS.textMuted,
              textTransform:
                "uppercase",
              letterSpacing:
                1,
            }}
          >
            Enemy {depth}
          </div>

          <div
            style={{
              fontSize: 10,
              color:
                COLORS.chrome,
              marginTop: 2,
            }}
          >
            Checkpoint{" "}
            {checkpoint}
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
          Lv {level}
        </div>
      </div>

      {/* ENEMY */}
      <div
        style={{
          padding:
            "16px 14px",
          borderRadius: 6,
          background:
            COLORS.panel,
          border:
            `1px solid ${COLORS.panelLine}`,
          marginBottom: 9,
        }}
      >
        <div
          style={{
            display:
              "flex",
            alignItems:
              "center",
            gap: 10,
          }}
        >
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 6,
              display:
                "flex",
              alignItems:
                "center",
              justifyContent:
                "center",
              background:
                "#d9575718",
              border:
                "1px solid #d9575735",
              flexShrink: 0,
            }}
          >
            <Skull
              size={20}
              color="#d95757"
            />
          </div>

          <div
            style={{
              flex: 1,
              minWidth: 0,
            }}
          >
            <div
              style={{
                fontFamily:
                  FONT_DISPLAY,
                fontWeight: 700,
                fontSize: 16,
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
                fontSize: 9,
                color:
                  COLORS.textMuted,
                marginTop: 2,
              }}
            >
              Lv {enemy.level} ·{" "}
              {enemy.archetype}
            </div>
          </div>
        </div>

        <HealthBar
          label="ENEMY"
          current={enemyHp}
          max={enemy.maxHp}
          percentage={
            enemyHpPct
          }
          enemy
        />

        <div
          style={{
            display:
              "grid",
            gridTemplateColumns:
              "repeat(3, 1fr)",
            gap: 5,
            marginTop: 10,
          }}
        >
          <MiniStat
            label="HP"
            value={formatNumber(
              enemyHp
            )}
          />
          <MiniStat
            label="ATK"
            value={formatNumber(
              enemy.attack
            )}
          />
          <MiniStat
            label="DEF"
            value={formatNumber(
              enemy.defense
            )}
          />
        </div>
      </div>

      {/* VS */}
      <div
        style={{
          display:
            "flex",
          alignItems:
            "center",
          gap: 8,
          margin:
            "8px 0",
        }}
      >
        <div
          style={{
            flex: 1,
            height: 1,
            background:
              COLORS.panelLine,
          }}
        />

        <span
          style={{
            fontFamily:
              FONT_MONO,
            fontWeight: 700,
            fontSize: 9,
            color:
              COLORS.textMuted,
          }}
        >
          VS
        </span>

        <div
          style={{
            flex: 1,
            height: 1,
            background:
              COLORS.panelLine,
          }}
        />
      </div>

      {/* PLAYER */}
      <div
        style={{
          padding:
            "16px 14px",
          borderRadius: 6,
          background:
            COLORS.panel,
          border:
            `1px solid ${COLORS.chrome}35`,
        }}
      >
        <div
          style={{
            display:
              "flex",
            alignItems:
              "center",
            gap: 10,
          }}
        >
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 6,
              display:
                "flex",
              alignItems:
                "center",
              justifyContent:
                "center",
              background:
                `${COLORS.chrome}18`,
              border:
                `1px solid ${COLORS.chrome}35`,
            }}
          >
            <Trophy
              size={20}
              color={
                COLORS.chrome
              }
            />
          </div>

          <div
            style={{
              flex: 1,
            }}
          >
            <div
              style={{
                fontFamily:
                  FONT_DISPLAY,
                fontWeight: 700,
                fontSize: 16,
                color:
                  COLORS.text,
              }}
            >
              YOU
            </div>

            <div
              style={{
                fontFamily:
                  FONT_MONO,
                fontSize: 9,
                color:
                  COLORS.textMuted,
                marginTop: 2,
              }}
            >
              Level {level}
            </div>
          </div>
        </div>

        <HealthBar
          label="YOU"
          current={playerHp}
          max={stats.maxHp}
          percentage={
            playerHpPct
          }
        />

        <div
          style={{
            display:
              "grid",
            gridTemplateColumns:
              "repeat(4, 1fr)",
            gap: 5,
            marginTop: 10,
          }}
        >
          <MiniStat
            label="ATK"
            value={formatNumber(
              stats.attack
            )}
          />
          <MiniStat
            label="DEF"
            value={formatNumber(
              stats.defense
            )}
          />
          <MiniStat
            label="DODGE"
            value={pct(
              stats.dodgeChance
            )}
          />
          <MiniStat
            label="CRIT"
            value={pct(
              stats.critChance
            )}
          />
        </div>
      </div>

      {/* FIGHT BUTTON */}
      {!combat && (
        <motion.button
          whileTap={{
            scale: 0.98,
          }}
          onClick={onFight}
          disabled={fighting}
          style={{
            width: "100%",
            marginTop: 12,
            padding:
              "15px 0",
            borderRadius: 5,
            border: "none",
            background:
              fighting
                ? COLORS.panelLine
                : COLORS.chrome,
            color:
              fighting
                ? COLORS.textMuted
                : COLORS.void,
            fontFamily:
              FONT_DISPLAY,
            fontWeight: 700,
            fontSize: 14,
            letterSpacing:
              1,
            textTransform:
              "uppercase",
            cursor:
              fighting
                ? "wait"
                : "pointer",
            display:
              "flex",
            alignItems:
              "center",
            justifyContent:
              "center",
            gap: 7,
          }}
        >
          {fighting ? (
            <>
              <Activity
                size={16}
              />
              Simulating...
            </>
          ) : (
            <>
              <Swords
                size={16}
              />
              Fight
            </>
          )}
        </motion.button>
      )}

      {/* RESULT */}
      {combat && (
        <BattleResult
          combat={combat}
          onNext={onNext}
          onBack={onBack}
        />
      )}
    </div>
  );
}

/* ============================================================================
   HEALTH BAR
   ========================================================================== */

function HealthBar({
  label,
  current,
  max,
  percentage,
  enemy = false,
}: {
  label: string;
  current: number;
  max: number;
  percentage: number;
  enemy?: boolean;
}) {
  return (
    <div
      style={{
        marginTop: 12,
      }}
    >
      <div
        style={{
          display:
            "flex",
          justifyContent:
            "space-between",
          marginBottom: 4,
          fontFamily:
            FONT_MONO,
          fontSize: 8,
          color:
            COLORS.textMuted,
        }}
      >
        <span>{label}</span>
        <span>
          {formatNumber(
            current
          )}{" "}
          /{" "}
          {formatNumber(max)}
        </span>
      </div>

      <div
        style={{
          height: 8,
          borderRadius: 4,
          background:
            COLORS.void,
          border:
            `1px solid ${COLORS.panelLine}`,
          overflow:
            "hidden",
        }}
      >
        <motion.div
          animate={{
            width: `${
              percentage *
              100
            }%`,
          }}
          transition={{
            duration:
              0.35,
          }}
          style={{
            height: "100%",
            background:
              enemy
                ? "#d95757"
                : COLORS.chrome,
          }}
        />
      </div>
    </div>
  );
}

/* ============================================================================
   MINI STAT
   ========================================================================== */

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
        padding:
          "6px 5px",
        borderRadius: 4,
        background:
          COLORS.void,
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
          fontFamily:
            FONT_MONO,
          fontSize: 9,
          fontWeight: 700,
          color:
            COLORS.text,
          marginTop: 2,
        }}
      >
        {value}
      </div>
    </div>
  );
}

/* ============================================================================
   BATTLE RESULT
   ========================================================================== */

function BattleResult({
  combat,
  onNext,
  onBack,
}: {
  combat: CombatResult;
  onNext: () => void;
  onBack: () => void;
}) {
  const won = combat.won;

  /*
   * Only show the final part of the combat log.
   *
   * This keeps the UI compact while preserving the important information.
   */
  const visibleLog =
    combat.log.slice(-7);

  return (
    <motion.div
      initial={{
        opacity: 0,
        y: 8,
      }}
      animate={{
        opacity: 1,
        y: 0,
      }}
      style={{
        marginTop: 12,
      }}
    >
      <div
        style={{
          padding:
            "14px 14px",
          borderRadius: 6,
          border: `1px solid ${
            won
              ? `${COLORS.chrome}55`
              : "#d9575744"
          }`,
          background:
            COLORS.panel,
        }}
      >
        <div
          style={{
            textAlign:
              "center",
            fontFamily:
              FONT_DISPLAY,
            fontWeight: 700,
            fontSize: 19,
            color:
              won
                ? COLORS.chrome
                : "#d95757",
          }}
        >
          {won
            ? "VICTORY"
            : "DEFEATED"}
        </div>

        <div
          style={{
            textAlign:
              "center",
            fontFamily:
              FONT_MONO,
            fontSize: 9,
            color:
              COLORS.textMuted,
            marginTop: 3,
          }}
        >
          {combat.rounds} combat rounds
        </div>

        <div
          style={{
            marginTop: 11,
            display:
              "flex",
            flexDirection:
              "column",
            gap: 4,
            maxHeight: 145,
            overflowY:
              "auto",
          }}
        >
          {visibleLog.map(
            (entry) => (
              <div
                key={
                  entry.id
                }
                style={{
                  fontFamily:
                    FONT_MONO,
                  fontSize: 8.5,
                  color:
                    entry.type ===
                    "critical"
                      ? COLORS.chrome
                      : entry.type ===
                        "enemy"
                      ? "#d95757"
                      : entry.type ===
                        "heal"
                      ? "#7fd48a"
                      : COLORS.textMuted,
                  padding:
                    "2px 0",
                }}
              >
                {entry.text}
              </div>
            )
          )}
        </div>

        {won ? (
          <button
            onClick={onNext}
            style={{
              width:
                "100%",
              marginTop: 12,
              padding:
                "13px 0",
              borderRadius: 5,
              border:
                "none",
              background:
                COLORS.chrome,
              color:
                COLORS.void,
              fontFamily:
                FONT_DISPLAY,
              fontWeight: 700,
              fontSize: 12,
              letterSpacing:
                0.8,
              textTransform:
                "uppercase",
              cursor:
                "pointer",
              display:
                "flex",
              alignItems:
                "center",
              justifyContent:
                "center",
              gap: 6,
            }}
          >
            <Dices
              size={14}
            />
            Generate next enemy
          </button>
        ) : (
          <button
            onClick={onBack}
            style={{
              width:
                "100%",
              marginTop: 12,
              padding:
                "13px 0",
              borderRadius: 5,
              border:
                `1px solid ${COLORS.chrome}55`,
              background:
                `${COLORS.chrome}12`,
              color:
                COLORS.chrome,
              fontFamily:
                FONT_DISPLAY,
              fontWeight: 700,
              fontSize: 12,
              letterSpacing:
                0.8,
              textTransform:
                "uppercase",
              cursor:
                "pointer",
              display:
                "flex",
              alignItems:
                "center",
              justifyContent:
                "center",
              gap: 6,
            }}
          >
            <RotateCcw
              size={14}
            />
            Rebuild at checkpoint
          </button>
        )}
      </div>
    </motion.div>
  );
}
