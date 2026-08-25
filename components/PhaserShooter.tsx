import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Dices,
  Droplet,
  Eye,
  Flame,
  Heart,
  HelpCircle,
  Info,
  Layers,
  Lock,
  Pause,
  RefreshCw,
  Repeat,
  RotateCcw,
  Shield,
  ShieldCheck,
  Skull,
  Sparkles,
  Swords,
  Target,
  Trophy,
  Wind,
  X,
  Zap,
} from "lucide-react";

/* ============================================================================
   THEME
   ========================================================================== */

const COLORS = {
  void: "#0a0a0f",
  panel: "#14141c",
  panelLine: "#26262f",
  text: "#e9e9ee",
  textMuted: "#8b8b98",
  chrome: "#8fc9dd",
  enemy: "#e0605f",
  heal: "#7fd48a",
  gold: "#e0b05f",
  offense: "#e0a05f",
  defense: "#5fb3e0",
  utility: "#b48fe0",
};

const FONT_DISPLAY = "'Rajdhani', 'Arial Narrow', sans-serif";
const FONT_MONO = "'JetBrains Mono', 'SFMono-Regular', Consolas, monospace";

const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap');

.af-fade { animation: af-fade-kf 260ms ease both; }
@keyframes af-fade-kf { from { opacity:0; transform:translateY(5px);} to { opacity:1; transform:translateY(0);} }

.af-pop { animation: af-pop-kf 220ms cubic-bezier(.34,1.56,.64,1) both; }
@keyframes af-pop-kf { from { opacity:0; transform:scale(0.92);} to { opacity:1; transform:scale(1);} }

.af-pulse { animation: af-pulse-kf 1.7s ease-in-out infinite; }
@keyframes af-pulse-kf { 0%,100% { opacity:0.5; } 50% { opacity:1; } }

.af-spin { animation: af-spin-kf 900ms linear infinite; }
@keyframes af-spin-kf { from { transform:rotate(0deg);} to { transform:rotate(360deg);} }

.af-btn { transition: transform 120ms ease, background 120ms ease, border-color 120ms ease, opacity 120ms ease; }
.af-btn:active:not(:disabled) { transform: scale(0.96); }
.af-btn:disabled { cursor: not-allowed; }
.af-btn:focus-visible { outline: 2px solid ${COLORS.chrome}; outline-offset: 2px; }

.af-scroll::-webkit-scrollbar { width: 5px; }
.af-scroll::-webkit-scrollbar-track { background: transparent; }
.af-scroll::-webkit-scrollbar-thumb { background: ${COLORS.panelLine}; border-radius: 3px; }

@media (prefers-reduced-motion: reduce) {
  .af-fade, .af-pop, .af-pulse, .af-spin { animation: none !important; }
  .af-btn { transition: none !important; }
}
`;

/* ============================================================================
   MATH HELPERS
   ========================================================================== */

// Percentage-style stats grow toward a ceiling but mathematically never
// reach it — there is no clamp anywhere in this file. Every point always
// helps, by a little less each time.
function asymptotic(points, half, ceiling = 100) {
  const p = Math.max(0, points);
  return ceiling * (p / (p + half));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function pct(value) {
  return `${value.toFixed(1)}%`;
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) < 1000) return Math.round(value).toString();
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

/* ============================================================================
   LEVEL SYSTEM — exponential XP curve, exponential point payouts
   ========================================================================== */

function xpForLevel(level) {
  return Math.round(60 * Math.pow(1.09, level - 1));
}

function pointsForLevel(level) {
  return Math.max(1, Math.floor(Math.pow(1.15, level)));
}

function levelFromXp(totalXp) {
  let level = 1;
  let xp = Math.max(0, Math.floor(totalXp));
  let need = xpForLevel(level);
  while (xp >= need) {
    xp -= need;
    level += 1;
    need = xpForLevel(level);
  }
  return { level, xpIntoLevel: xp, xpForNextLevel: need };
}

function totalPointsThroughLevel(level) {
  let total = 0;
  for (let l = 1; l < level; l += 1) total += pointsForLevel(l);
  return total;
}

/* ============================================================================
   PLAYER BUILD
   ========================================================================== */

const STAT_KEYS = [
  "vitality", "armor", "fortitude", "block", "evasion",
  "power", "precision", "critical", "penetration", "momentum",
  "agility", "lifesteal", "regeneration", "counter", "insight",
];

const EMPTY_ALLOCATION = STAT_KEYS.reduce((acc, key) => ({ ...acc, [key]: 0 }), {});

function buildPlayerStats(a) {
  const maxHp = 100 + a.vitality * 32;
  const attack = 10 + a.power * 5 + Math.floor(Math.pow(a.power, 1.05));
  const defense = 5 + a.armor * 4;

  const accuracy = 70 + asymptotic(a.precision, 20, 28);
  const critChance = asymptotic(a.critical, 28, 100);
  const critMultiplier = 1.5 + a.critical * 0.015;
  const penetrationPct = asymptotic(a.penetration * 1.4 + a.precision * 0.25, 35, 95);
  const momentumBonus = a.momentum * 0.01;

  const damageReductionPct = asymptotic(a.fortitude, 35, 90);
  const blockPct = asymptotic(a.block * 1.2 + a.armor * 0.2, 28, 88);
  const dodgeChance = asymptotic(a.agility * 0.7 + a.evasion * 1.3, 30, 92);

  const lifestealPct = asymptotic(a.lifesteal, 40, 70);
  const regenAmount = 6 + a.regeneration * 1.3;
  const counterMult = 0.3 + a.counter * 0.02;
  const insightChance = asymptotic(a.insight, 15, 90);

  return {
    maxHp, attack, defense, accuracy, critChance, critMultiplier,
    penetrationPct, momentumBonus, damageReductionPct, blockPct,
    dodgeChance, lifestealPct, regenAmount, counterMult, insightChance,
  };
}

/* ============================================================================
   STAT DEFINITIONS (drives the loadout grid + live readouts)
   ========================================================================== */

const STAT_DEFINITIONS = [
  { key: "power", group: "OFFENSE", name: "Power", short: "ATK", Icon: Swords,
    blurb: "Raw attack damage. No ceiling.",
    kind: "linear", getValue: (s) => s.attack, format: (v) => `${Math.round(v)} ATK` },
  { key: "precision", group: "OFFENSE", name: "Precision", short: "ACC", Icon: Crosshair,
    blurb: "Accuracy, plus a sliver of penetration. Approaches ~98% to-hit.",
    kind: "asymptotic", ceiling: 98, getValue: (s) => s.accuracy, format: pct },
  { key: "critical", group: "OFFENSE", name: "Critical", short: "CRIT", Icon: Target,
    blurb: "Crit chance approaches 100% — crit damage keeps climbing forever.",
    kind: "critical", getValue: (s) => s.critChance, format: pct },
  { key: "penetration", group: "OFFENSE", name: "Penetration", short: "PEN", Icon: Zap,
    blurb: "Ignore enemy defense, and weaken their Defend card. Approaches 95%.",
    kind: "asymptotic", ceiling: 95, getValue: (s) => s.penetrationPct, format: pct },
  { key: "momentum", group: "OFFENSE", name: "Momentum", short: "COMBO", Icon: Flame,
    blurb: "Bonus damage per consecutive Attack card. No ceiling — never stop swinging.",
    kind: "linear", getValue: (s) => s.momentumBonus * 100, format: (v) => `+${v.toFixed(1)}%/stack` },

  { key: "vitality", group: "DEFENSE", name: "Vitality", short: "HP", Icon: Heart,
    blurb: "Flat max HP. No ceiling.",
    kind: "linear", getValue: (s) => s.maxHp, format: (v) => `${Math.round(v)} HP` },
  { key: "armor", group: "DEFENSE", name: "Armor", short: "DEF", Icon: Shield,
    blurb: "Raw defense. Diminishing returns are baked into the damage formula, but the stat itself never stops climbing.",
    kind: "linear", getValue: (s) => s.defense, format: (v) => `${v.toFixed(1)} DEF` },
  { key: "fortitude", group: "DEFENSE", name: "Fortitude", short: "DR", Icon: Layers,
    blurb: "A final passive damage-reduction layer, applies no matter which card you play. Approaches 90%.",
    kind: "asymptotic", ceiling: 90, getValue: (s) => s.damageReductionPct, format: pct },
  { key: "block", group: "DEFENSE", name: "Block", short: "BLK", Icon: ShieldCheck,
    blurb: "Powers the Defend card's guaranteed mitigation. Approaches 88%.",
    kind: "asymptotic", ceiling: 88, getValue: (s) => s.blockPct, format: pct },
  { key: "evasion", group: "DEFENSE", name: "Evasion", short: "EVA", Icon: Activity,
    blurb: "Feeds the Dodge card's evade chance, together with Agility.",
    kind: "asymptotic", ceiling: 92, getValue: (s) => s.dodgeChance, format: pct },

  { key: "agility", group: "UTILITY", name: "Agility", short: "AGI", Icon: Wind,
    blurb: "Also feeds the Dodge card's evade chance, together with Evasion.",
    kind: "asymptotic", ceiling: 92, getValue: (s) => s.dodgeChance, format: pct },
  { key: "lifesteal", group: "UTILITY", name: "Lifesteal", short: "LS", Icon: Droplet,
    blurb: "Heal a share of the damage your attacks deal. Approaches 70%.",
    kind: "asymptotic", ceiling: 70, getValue: (s) => s.lifestealPct, format: pct },
  { key: "regeneration", group: "UTILITY", name: "Regeneration", short: "REGEN", Icon: RefreshCw,
    blurb: "HP restored by the Do Nothing card. No ceiling.",
    kind: "linear", getValue: (s) => s.regenAmount, format: (v) => `+${Math.round(v)} HP` },
  { key: "counter", group: "UTILITY", name: "Counter", short: "CNTR", Icon: Repeat,
    blurb: "Damage returned when Counter Stance lands. No ceiling — 1 point unlocks the card.",
    kind: "linear", getValue: (s) => s.counterMult * 100, format: (v) => `${Math.round(v)}% of ATK` },
  { key: "insight", group: "UTILITY", name: "Insight", short: "INS", Icon: Eye,
    blurb: "Chance to glimpse the enemy's next move before you choose. Approaches 90%.",
    kind: "asymptotic", ceiling: 90, getValue: (s) => s.insightChance, format: pct },
];

const GROUP_ORDER = ["OFFENSE", "DEFENSE", "UTILITY"];
const GROUP_COLOR = { OFFENSE: COLORS.offense, DEFENSE: COLORS.defense, UTILITY: COLORS.utility };

/* ============================================================================
   CARDS
   ========================================================================== */

const CARD_DEFS = [
  { key: "attack", name: "Attack", Icon: Swords,
    blurb: "A direct strike using your Power and accuracy.",
    unlocked: () => true, hint: "" },
  { key: "powerAttack", name: "Power Strike", Icon: Zap,
    blurb: "1.55x damage, -15% accuracy.",
    unlocked: (a) => a.power >= 5, hint: "Invest 5 in Power" },
  { key: "defend", name: "Defend", Icon: Shield,
    blurb: "Guaranteed mitigation from Block, this turn only.",
    unlocked: () => true, hint: "" },
  { key: "dodge", name: "Dodge", Icon: Activity,
    blurb: "Chance to fully evade the incoming hit. All or nothing.",
    unlocked: () => true, hint: "" },
  { key: "doNothing", name: "Do Nothing", Icon: Pause,
    blurb: "Recover HP via Regeneration and reset your combo.",
    unlocked: () => true, hint: "" },
  { key: "counter", name: "Counter Stance", Icon: Repeat,
    blurb: "If they attack, you retaliate for a share of your ATK.",
    unlocked: (a) => a.counter >= 1, hint: "Invest 1 in Counter" },
];

/* ============================================================================
   ENEMIES
   ========================================================================== */

let enemyId = 1;

const ENEMY_NAMES = [
  "Iron Revenant", "Void Hunter", "Glass Predator", "Ash Knight", "Blood Warden",
  "Storm Stalker", "Bone Titan", "Night Fang", "Rift Soldier", "Crimson Machine",
  "Silent Executioner", "Obsidian Beast", "Feral Construct", "Dread Vanguard", "Chaos Runner",
];

const ARCHETYPES = [
  { name: "Tank", hp: 1.7, atk: 0.8, def: 1.55,
    extra: { blockPct: 22, damageReductionPct: 12 },
    weights: { attack: 30, defend: 45, dodge: 5, doNothing: 20 } },
  { name: "Berserker", hp: 0.85, atk: 1.6, def: 0.7,
    extra: { critChance: 14, critMultiplier: 1.8 },
    weights: { attack: 45, powerAttack: 30, defend: 10, doNothing: 15 } },
  { name: "Assassin", hp: 0.7, atk: 1.3, def: 0.8,
    extra: { critChance: 18, dodgeChance: 22 },
    weights: { attack: 30, powerAttack: 15, dodge: 45, doNothing: 10 } },
  { name: "Vampire", hp: 0.95, atk: 1.05, def: 0.9,
    extra: { lifestealPct: 22, regenAmount: 5 },
    weights: { attack: 55, defend: 15, doNothing: 30 } },
  { name: "Guardian", hp: 1.3, atk: 0.9, def: 1.25,
    extra: { blockPct: 24 },
    weights: { attack: 25, defend: 50, doNothing: 25 } },
  { name: "Marksman", hp: 0.8, atk: 1.25, def: 0.85,
    extra: { accuracy: 92, critChance: 10 },
    weights: { attack: 45, powerAttack: 35, dodge: 20 } },
  { name: "Juggernaut", hp: 2.0, atk: 1.1, def: 1.15,
    extra: { damageReductionPct: 16 },
    weights: { attack: 45, defend: 40, powerAttack: 15 } },
  { name: "Balanced", hp: 1.0, atk: 1.0, def: 1.0,
    extra: {},
    weights: { attack: 35, defend: 20, dodge: 15, doNothing: 15, powerAttack: 15 } },
];

function generateEnemy(depth, playerLevel) {
  const archetype = ARCHETYPES[Math.floor(Math.random() * ARCHETYPES.length)];
  const name = ENEMY_NAMES[Math.floor(Math.random() * ENEMY_NAMES.length)];

  const difficulty = 1 + depth * 0.11 + Math.pow(depth, 1.15) * 0.02;
  const variance = 0.85 + Math.random() * 0.3;

  const hp = Math.round(90 * difficulty * variance * archetype.hp);
  const attack = Math.round(11 * difficulty * variance * archetype.atk * 10) / 10;
  const defense = Math.round(5 * difficulty * variance * archetype.def * 10) / 10;

  const base = {
    accuracy: 82, critChance: 6, critMultiplier: 1.6, dodgeChance: 4,
    blockPct: 10, damageReductionPct: 0, lifestealPct: 0, regenAmount: 0,
  };
  const merged = { ...base, ...archetype.extra };

  return {
    id: enemyId++,
    name,
    archetypeName: archetype.name,
    level: Math.max(1, playerLevel + Math.floor(depth * 0.35)),
    hp, maxHp: hp,
    attack, defense,
    accuracy: merged.accuracy,
    critChance: merged.critChance,
    critMultiplier: merged.critMultiplier,
    dodgeChance: merged.dodgeChance,
    blockPct: merged.blockPct,
    damageReductionPct: merged.damageReductionPct,
    lifestealPct: merged.lifestealPct,
    regenAmount: merged.regenAmount,
    weights: archetype.weights,
  };
}

function pickEnemyAction(enemy) {
  const entries = Object.entries(enemy.weights);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let roll = Math.random() * total;
  for (const [key, w] of entries) {
    if (roll < w) return key;
    roll -= w;
  }
  return entries[0][0];
}

const CARD_LABELS = {
  attack: "Attack", powerAttack: "Power Strike", defend: "Defend",
  dodge: "Dodge", doNothing: "Do Nothing", counter: "Counter Stance",
};

/* ============================================================================
   COMBAT RESOLUTION — one round, one player card, one enemy card
   ========================================================================== */

function resolveExchange({ playerCard, enemyCard, playerStats, enemy, momentum }) {
  const log = [];
  let playerDamage = 0;
  let enemyDamage = 0;
  let playerHeal = 0;
  let enemyHeal = 0;
  let momentumAfter = momentum;

  const playerAttacking = playerCard === "attack" || playerCard === "powerAttack";
  const enemyAttacking = enemyCard === "attack" || enemyCard === "powerAttack";

  // --- Player's offense ---
  if (playerAttacking) {
    const power = playerCard === "powerAttack";
    const acc = playerStats.accuracy - (power ? 15 : 0);

    if (Math.random() * 100 < acc) {
      let effDef = enemy.defense * (1 - playerStats.penetrationPct / 100);
      if (enemyCard === "defend") effDef += enemy.defense * (enemy.blockPct / 100) * 1.5;

      let dmg = playerStats.attack * (power ? 1.55 : 1) * (100 / (100 + Math.max(0, effDef)));

      if (momentum > 0) dmg *= 1 + Math.min(2.5, momentum * playerStats.momentumBonus);

      const crit = Math.random() * 100 < playerStats.critChance;
      if (crit) dmg *= playerStats.critMultiplier;

      const evaded = enemyCard === "dodge" && Math.random() * 100 < Math.min(96, enemy.dodgeChance * 1.6);

      if (evaded) {
        log.push({ text: `${enemy.name} slips away from your strike.`, type: "system" });
      } else {
        dmg = Math.max(1, dmg);
        enemyDamage = dmg;
        playerHeal += dmg * (playerStats.lifestealPct / 100);
        log.push({
          text: crit ? `CRITICAL — ${Math.round(dmg)} damage dealt` : `You deal ${Math.round(dmg)} damage`,
          type: crit ? "critical" : "player",
        });
      }
    } else {
      log.push({ text: "Your attack missed.", type: "system" });
    }
    momentumAfter = momentum + 1;
  } else if (playerCard === "doNothing") {
    playerHeal += playerStats.regenAmount;
    log.push({ text: `You steady yourself (+${Math.round(playerStats.regenAmount)} HP)`, type: "heal" });
    momentumAfter = 0;
  } else {
    momentumAfter = 0;
  }

  // --- Enemy's offense ---
  if (enemyAttacking) {
    const power = enemyCard === "powerAttack";
    const acc = enemy.accuracy - (power ? 15 : 0);

    if (Math.random() * 100 < acc) {
      const evaded = playerCard === "dodge" && Math.random() * 100 < playerStats.dodgeChance;

      if (evaded) {
        log.push({ text: "You dodge the attack completely.", type: "player" });
      } else {
        let dmg = enemy.attack * (power ? 1.55 : 1);
        if (playerCard === "defend") dmg *= 1 - playerStats.blockPct / 100;
        dmg *= 100 / (100 + playerStats.defense);

        const crit = Math.random() * 100 < enemy.critChance;
        if (crit) dmg *= enemy.critMultiplier;

        dmg *= 1 - playerStats.damageReductionPct / 100;
        dmg = Math.max(1, Math.round(dmg));
        playerDamage = dmg;

        log.push({
          text: crit ? `${enemy.name} CRITs for ${dmg}` : `${enemy.name} deals ${dmg} damage`,
          type: crit ? "critical" : "enemy",
        });

        if (playerCard === "counter") {
          const counterDmg = Math.max(1, Math.round(playerStats.attack * playerStats.counterMult));
          enemyDamage += counterDmg;
          log.push({ text: `You counter for ${counterDmg}!`, type: "critical" });
        }
      }
    } else {
      log.push({ text: `${enemy.name}'s attack misses.`, type: "system" });
    }
  } else if (enemyCard === "doNothing") {
    enemyHeal = enemy.regenAmount || 0;
    log.push({ text: `${enemy.name} recovers${enemyHeal ? ` (+${Math.round(enemyHeal)} HP)` : ""}.`, type: "system" });
  } else if (enemyCard === "defend") {
    log.push({ text: `${enemy.name} braces defensively.`, type: "system" });
  } else if (enemyCard === "dodge") {
    log.push({ text: `${enemy.name} readies to evade.`, type: "system" });
  }

  return { log, playerDamage, enemyDamage, playerHeal, enemyHeal, momentumAfter };
}

/* ============================================================================
   PERSISTENCE — Claude artifact storage (never localStorage/sessionStorage)
   ========================================================================== */

const STORAGE_KEY = "ascent-game-state-v1";
const CHECKPOINT_INTERVAL = 3;

function defaultGameState() {
  return {
    allocation: { ...EMPTY_ALLOCATION },
    checkpoint: 0,
    runDepth: 0,
    highestDepth: 0,
    totalWins: 0,
    totalXp: 0,
    tutorialSeen: false,
  };
}

/* ============================================================================
   TUTORIAL CONTENT
   ========================================================================== */

const TUTORIAL_STEPS = [
  {
    title: "Welcome to Ascent",
    body: "Win fights to earn XP and level up. Every level hands you more allocation points than the last — the curve is exponential, so late levels hit hard.",
    Icon: Sparkles,
  },
  {
    title: "Stats have no ceiling",
    body: "There's no cap anywhere in this build. Raw stats like Power and Vitality grow forever. Percentage stats like Dodge or Crit chase a ceiling but never quite touch it — every point still helps, always a little less than the last. Go ahead, dump everything into one stat and see what happens.",
    Icon: Layers,
  },
  {
    title: "Combat is a card each round",
    body: "Every round you pick one card: Attack, Power Strike, Defend, Dodge, Do Nothing, or Counter Stance. The enemy picks too — you resolve both at once. Two cards unlock only once you've invested in the matching stat.",
    Icon: Swords,
  },
  {
    title: "Insight reveals intent",
    body: "Invest in Insight and you'll sometimes see the enemy's next move before you choose your own card — turning a guess into a read.",
    Icon: Eye,
  },
  {
    title: "Checkpoints save your run",
    body: `Every ${CHECKPOINT_INTERVAL} wins locks in a checkpoint. Lose a fight and you're sent back to your last checkpoint depth — never to zero.`,
    Icon: Trophy,
  },
];

/* ============================================================================
   ROOT COMPONENT
   ========================================================================== */

export default function App() {
  const [phase, setPhase] = useState("menu");
  const [gameState, setGameState] = useState(defaultGameState);
  const [hydrated, setHydrated] = useState(false);
  const [toast, setToast] = useState(null);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [battle, setBattle] = useState(null);

  const stats = useMemo(() => buildPlayerStats(gameState.allocation), [gameState.allocation]);
  const levelInfo = useMemo(() => levelFromXp(gameState.totalXp), [gameState.totalXp]);
  const totalPoints = useMemo(() => totalPointsThroughLevel(levelInfo.level), [levelInfo.level]);
  const allocatedPoints = useMemo(
    () => Object.values(gameState.allocation).reduce((sum, v) => sum + v, 0),
    [gameState.allocation]
  );
  const availablePoints = Math.max(0, totalPoints - allocatedPoints);

  /* ---------------- LOAD ---------------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await window.storage.get(STORAGE_KEY, false);
        if (!cancelled && res && res.value) {
          const parsed = JSON.parse(res.value);
          setGameState({
            ...defaultGameState(),
            ...parsed,
            allocation: { ...EMPTY_ALLOCATION, ...(parsed.allocation || {}) },
          });
          if (!parsed.tutorialSeen) setTutorialOpen(true);
        } else if (!cancelled) {
          setTutorialOpen(true);
        }
      } catch {
        if (!cancelled) setTutorialOpen(true);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /* ---------------- SAVE ---------------- */
  useEffect(() => {
    if (!hydrated) return;
    (async () => {
      try {
        await window.storage.set(STORAGE_KEY, JSON.stringify(gameState), false);
      } catch {
        // best-effort persistence
      }
    })();
  }, [gameState, hydrated]);

  /* ---------------- TOAST ---------------- */
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(t);
  }, [toast]);

  /* ---------------- ALLOCATION ---------------- */
  const allocate = useCallback((key, amount) => {
    setGameState((prev) => {
      const currentAllocated = Object.values(prev.allocation).reduce((s, v) => s + v, 0);
      const currentAvailable = Math.max(0, totalPointsThroughLevel(levelFromXp(prev.totalXp).level) - currentAllocated);
      const grant = Math.min(amount, currentAvailable);
      if (grant <= 0) return prev;
      return { ...prev, allocation: { ...prev.allocation, [key]: prev.allocation[key] + grant } };
    });
  }, []);

  const resetBuild = useCallback(() => {
    setGameState((prev) => ({ ...prev, allocation: { ...EMPTY_ALLOCATION } }));
    setToast("Build reset. Redistribute your points.");
  }, []);

  /* ---------------- TUTORIAL ---------------- */
  const closeTutorial = useCallback(() => {
    setTutorialOpen(false);
    setTutorialStep(0);
    setGameState((prev) => (prev.tutorialSeen ? prev : { ...prev, tutorialSeen: true }));
  }, []);

  const openTutorial = useCallback(() => {
    setTutorialStep(0);
    setTutorialOpen(true);
  }, []);

  /* ---------------- BATTLE ---------------- */
  const startBattle = useCallback(() => {
    const depth = gameState.runDepth + 1;
    const enemy = generateEnemy(depth, levelInfo.level);
    const intent = pickEnemyAction(enemy);
    const revealed = Math.random() * 100 < stats.insightChance;

    setBattle({
      enemy,
      depth,
      playerHp: stats.maxHp,
      enemyHp: enemy.maxHp,
      momentum: 0,
      round: 1,
      log: [],
      phase: "awaiting",
      enemyIntent: intent,
      intentRevealed: revealed,
      outcome: null,
      xpGained: 0,
    });
    setPhase("battle");
  }, [gameState.runDepth, levelInfo.level, stats]);

  const backToMenu = useCallback(() => {
    setPhase("menu");
    setBattle(null);
  }, []);

  const playCard = useCallback((cardKey) => {
    setBattle((prev) => {
      if (!prev || prev.phase === "ended") return prev;

      const result = resolveExchange({
        playerCard: cardKey,
        enemyCard: prev.enemyIntent,
        playerStats: stats,
        enemy: prev.enemy,
        momentum: prev.momentum,
      });

      const newPlayerHp = clamp(prev.playerHp - result.playerDamage + result.playerHeal, 0, stats.maxHp);
      const newEnemyHp = clamp(prev.enemyHp - result.enemyDamage + result.enemyHeal, 0, prev.enemy.maxHp);

      const roundHeader = { text: `— Round ${prev.round} · you played ${CARD_LABELS[cardKey]} —`, type: "system" };
      const mergedLog = [...prev.log, roundHeader, ...result.log];

      const enemyDefeated = newEnemyHp <= 0;
      const playerDefeated = newPlayerHp <= 0;
      const roundCap = prev.round >= 30;

      if (enemyDefeated || playerDefeated || roundCap) {
        const won = enemyDefeated || (roundCap && newPlayerHp / stats.maxHp >= newEnemyHp / prev.enemy.maxHp && !playerDefeated);
        const xpGained = won ? Math.round((18 + prev.depth * 6) * (0.9 + Math.random() * 0.2)) : 0;

        return {
          ...prev,
          playerHp: newPlayerHp,
          enemyHp: newEnemyHp,
          momentum: result.momentumAfter,
          round: prev.round + 1,
          log: mergedLog,
          phase: "ended",
          outcome: won ? "won" : "lost",
          xpGained,
        };
      }

      const nextIntent = pickEnemyAction(prev.enemy);
      const nextRevealed = Math.random() * 100 < stats.insightChance;

      return {
        ...prev,
        playerHp: newPlayerHp,
        enemyHp: newEnemyHp,
        momentum: result.momentumAfter,
        round: prev.round + 1,
        log: mergedLog,
        phase: "awaiting",
        enemyIntent: nextIntent,
        intentRevealed: nextRevealed,
      };
    });
  }, [stats]);

  // Apply battle outcome to persistent game state once, when it lands.
  const appliedOutcomeRef = useRef(null);
  useEffect(() => {
    if (!battle || battle.phase !== "ended" || !battle.outcome) return;
    if (appliedOutcomeRef.current === battle) return;
    appliedOutcomeRef.current = battle;

    setGameState((prev) => {
      if (battle.outcome === "won") {
        const newRunDepth = prev.runDepth + 1;
        const newCheckpoint = newRunDepth % CHECKPOINT_INTERVAL === 0 ? newRunDepth : prev.checkpoint;
        const oldLevel = levelFromXp(prev.totalXp).level;
        const newTotalXp = prev.totalXp + battle.xpGained;
        const newLevel = levelFromXp(newTotalXp).level;

        if (newLevel > oldLevel) {
          setToast(`LEVEL UP — now level ${newLevel}`);
        } else if (newCheckpoint > prev.checkpoint) {
          setToast(`Checkpoint ${newCheckpoint} secured`);
        } else {
          setToast(`+${battle.xpGained} XP`);
        }

        return {
          ...prev,
          runDepth: newRunDepth,
          checkpoint: Math.max(prev.checkpoint, newCheckpoint),
          highestDepth: Math.max(prev.highestDepth, newRunDepth),
          totalWins: prev.totalWins + 1,
          totalXp: newTotalXp,
        };
      }

      setToast(`Defeated — restored to checkpoint ${prev.checkpoint}`);
      return { ...prev, runDepth: prev.checkpoint };
    });
  }, [battle]);

  /* ---------------- RENDER ---------------- */

  if (!hydrated) {
    return (
      <div style={{ minHeight: 320, display: "flex", alignItems: "center", justifyContent: "center", background: COLORS.void }}>
        <style>{GLOBAL_CSS}</style>
        <div style={{ display: "flex", alignItems: "center", gap: 10, color: COLORS.textMuted, fontFamily: FONT_MONO, fontSize: 11 }}>
          <Dices className="af-spin" size={16} />
          Loading save data...
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        maxWidth: 460,
        margin: "0 auto",
        background: COLORS.void,
        padding: 14,
        borderRadius: 10,
        fontFamily: FONT_MONO,
        boxSizing: "border-box",
      }}
    >
      <style>{GLOBAL_CSS}</style>

      {phase === "menu" && (
        <MenuScreen
          levelInfo={levelInfo}
          stats={stats}
          gameState={gameState}
          availablePoints={availablePoints}
          allocatedPoints={allocatedPoints}
          onAllocate={allocate}
          onReset={resetBuild}
          onStart={startBattle}
          onOpenTutorial={openTutorial}
        />
      )}

      {phase === "battle" && battle && (
        <BattleScreen
          level={levelInfo.level}
          stats={stats}
          battle={battle}
          allocation={gameState.allocation}
          onPlayCard={playCard}
          onNext={startBattle}
          onBack={backToMenu}
        />
      )}

      {toast && (
        <div
          className="af-pop"
          style={{
            position: "fixed",
            left: "50%",
            bottom: 20,
            transform: "translateX(-50%)",
            background: COLORS.panel,
            border: `1px solid ${COLORS.chrome}55`,
            color: COLORS.text,
            padding: "9px 16px",
            borderRadius: 6,
            fontFamily: FONT_MONO,
            fontSize: 11,
            fontWeight: 700,
            zIndex: 50,
            boxShadow: "0 6px 24px rgba(0,0,0,0.4)",
          }}
        >
          {toast}
        </div>
      )}

      {tutorialOpen && <TutorialOverlay step={tutorialStep} onStep={setTutorialStep} onClose={closeTutorial} />}
    </div>
  );
}

/* ============================================================================
   TUTORIAL OVERLAY
   ========================================================================== */

function TutorialOverlay({ step, onStep, onClose }) {
  const total = TUTORIAL_STEPS.length;
  const current = TUTORIAL_STEPS[step];
  const isLast = step === total - 1;

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(6,6,10,0.82)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 100, padding: 18, boxSizing: "border-box",
      }}
    >
      <div
        className="af-pop"
        style={{
          width: "100%", maxWidth: 360, background: COLORS.panel,
          border: `1px solid ${COLORS.panelLine}`, borderRadius: 10, padding: 20,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div
            style={{
              width: 38, height: 38, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
              background: `${COLORS.chrome}18`, border: `1px solid ${COLORS.chrome}35`, flexShrink: 0,
            }}
          >
            <current.Icon size={18} color={COLORS.chrome} />
          </div>
          <button onClick={onClose} className="af-btn" style={iconButtonStyle}>
            <X size={14} color={COLORS.textMuted} />
          </button>
        </div>

        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: COLORS.text, marginTop: 12 }}>
          {current.title}
        </div>

        <div style={{ fontFamily: FONT_MONO, fontSize: 11.5, lineHeight: 1.6, color: COLORS.textMuted, marginTop: 8 }}>
          {current.body}
        </div>

        <div style={{ display: "flex", gap: 5, justifyContent: "center", marginTop: 18 }}>
          {TUTORIAL_STEPS.map((_, i) => (
            <div
              key={i}
              style={{
                width: i === step ? 16 : 6, height: 6, borderRadius: 3,
                background: i === step ? COLORS.chrome : COLORS.panelLine,
                transition: "width 200ms ease, background 200ms ease",
              }}
            />
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          {step > 0 && (
            <button
              onClick={() => onStep(step - 1)}
              className="af-btn"
              style={{ ...secondaryButtonStyle, flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}
            >
              <ChevronLeft size={13} /> Back
            </button>
          )}
          <button
            onClick={() => (isLast ? onClose() : onStep(step + 1))}
            className="af-btn"
            style={{ ...primaryButtonStyle, flex: 2, display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}
          >
            {isLast ? "Start playing" : "Next"}
            {!isLast && <ChevronRight size={13} />}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   MENU SCREEN
   ========================================================================== */

function MenuScreen({ levelInfo, stats, gameState, availablePoints, allocatedPoints, onAllocate, onReset, onStart, onOpenTutorial }) {
  const xpPct = levelInfo.xpForNextLevel > 0 ? levelInfo.xpIntoLevel / levelInfo.xpForNextLevel : 0;
  const nextDepth = gameState.runDepth + 1;

  return (
    <div className="af-fade">
      <div style={{ textAlign: "center", marginBottom: 12 }}>
        <div style={{ fontFamily: FONT_MONO, fontSize: 9.5, letterSpacing: 2, color: COLORS.textMuted, textTransform: "uppercase" }}>
          Card Combat Protocol
        </div>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 26, color: COLORS.text, letterSpacing: 1 }}>
          ASCENT
        </div>
      </div>

      {/* LEVEL CARD */}
      <div style={{ padding: "15px 15px 13px", borderRadius: 8, background: COLORS.panel, border: `1px solid ${COLORS.panelLine}`, marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Sparkles size={17} color={COLORS.chrome} />
            <div>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: COLORS.text }}>
                Level {levelInfo.level}
              </div>
              <div style={{ fontFamily: FONT_MONO, fontSize: 9, color: COLORS.textMuted, marginTop: 2 }}>
                {allocatedPoints} allocated · {availablePoints} available
              </div>
            </div>
          </div>
          <button onClick={onOpenTutorial} className="af-btn" style={iconButtonStyle} aria-label="How to play">
            <HelpCircle size={16} color={COLORS.textMuted} />
          </button>
        </div>

        <div style={{ height: 6, borderRadius: 3, background: COLORS.void, marginTop: 11, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${xpPct * 100}%`, background: COLORS.chrome, transition: "width 300ms ease" }} />
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5, fontFamily: FONT_MONO, fontSize: 8.5, color: COLORS.textMuted }}>
          <span>{levelInfo.xpIntoLevel}/{levelInfo.xpForNextLevel} XP</span>
          <span>+{pointsForLevel(levelInfo.level)} pts next level</span>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontFamily: FONT_MONO, fontSize: 8.5, color: COLORS.textMuted, borderTop: `1px solid ${COLORS.panelLine}`, paddingTop: 8 }}>
          <span>CP {gameState.checkpoint} · depth {gameState.runDepth}</span>
          <span>{gameState.totalWins} wins · best {gameState.highestDepth}</span>
        </div>
      </div>

      {/* LOADOUT (cards) PREVIEW */}
      <div style={{ padding: "10px 12px", borderRadius: 8, background: COLORS.panel, border: `1px solid ${COLORS.panelLine}`, marginBottom: 12 }}>
        <div style={{ fontFamily: FONT_MONO, fontSize: 9, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
          Your loadout
        </div>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          {CARD_DEFS.map((card) => {
            const unlocked = card.unlocked(gameState.allocation);
            return (
              <div
                key={card.key}
                title={unlocked ? card.name : `${card.name} — ${card.hint}`}
                style={{
                  display: "flex", alignItems: "center", gap: 5, padding: "6px 9px", borderRadius: 5,
                  background: unlocked ? `${COLORS.chrome}0f` : COLORS.void,
                  border: `1px solid ${unlocked ? `${COLORS.chrome}40` : COLORS.panelLine}`,
                  opacity: unlocked ? 1 : 0.55,
                }}
              >
                {unlocked ? <card.Icon size={12} color={COLORS.chrome} /> : <Lock size={11} color={COLORS.textMuted} />}
                <span style={{ fontFamily: FONT_MONO, fontSize: 9, color: unlocked ? COLORS.text : COLORS.textMuted }}>
                  {card.name}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* BUILD HEADER */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "4px 0 8px" }}>
        <div style={{ fontFamily: FONT_MONO, fontSize: 10, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 1.5 }}>
          Build your loadout
        </div>
        <button onClick={onReset} className="af-btn" style={{ ...secondaryButtonStyle, display: "flex", alignItems: "center", gap: 4, padding: "5px 8px", fontSize: 8.5 }}>
          <RotateCcw size={10} /> RESET
        </button>
      </div>

      {GROUP_ORDER.map((group) => (
        <div key={group} style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, margin: "2px 0 6px" }}>
            <div style={{ width: 6, height: 6, borderRadius: 2, background: GROUP_COLOR[group] }} />
            <span style={{ fontFamily: FONT_MONO, fontSize: 8.5, color: COLORS.textMuted, letterSpacing: 1.5 }}>{group}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
            {STAT_DEFINITIONS.filter((d) => d.group === group).map((def) => (
              <StatCard
                key={def.key}
                definition={def}
                amount={gameState.allocation[def.key]}
                stats={stats}
                availablePoints={availablePoints}
                onAllocate={onAllocate}
              />
            ))}
          </div>
        </div>
      ))}

      <button
        onClick={onStart}
        className="af-btn"
        style={{ ...primaryButtonStyle, width: "100%", marginTop: 10, padding: "14px 0", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}
      >
        <Swords size={15} />
        Fight depth {nextDepth}
      </button>

      <div style={{ marginTop: 8, textAlign: "center", fontFamily: FONT_MONO, fontSize: 8.5, color: COLORS.textMuted }}>
        Every {CHECKPOINT_INTERVAL} wins = checkpoint
      </div>
    </div>
  );
}

/* ============================================================================
   STAT CARD
   ========================================================================== */

function StatCard({ definition, amount, stats, availablePoints, onAllocate }) {
  const canAllocate = availablePoints > 0;
  const value = definition.getValue(stats);
  const groupColor = GROUP_COLOR[definition.group];

  return (
    <div
      style={{
        minWidth: 0, padding: "10px 10px 9px", borderRadius: 6,
        border: `1px solid ${amount > 0 ? `${groupColor}55` : COLORS.panelLine}`,
        background: amount > 0 ? `${groupColor}0c` : COLORS.panel,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: amount > 0 ? groupColor : COLORS.textMuted, display: "flex" }}>
          <definition.Icon size={14} />
        </span>
        <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 11, color: COLORS.text, flex: 1 }}>
          {definition.name}
        </span>
        <span style={{ fontFamily: FONT_MONO, fontSize: 10, color: amount > 0 ? groupColor : COLORS.textMuted, fontWeight: 700 }}>
          +{amount}
        </span>
      </div>

      <div style={{ fontFamily: FONT_MONO, fontSize: 7.5, color: COLORS.textMuted, marginTop: 4, lineHeight: 1.35, minHeight: 20 }}>
        {definition.blurb}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 7 }}>
        <div style={{ fontFamily: FONT_MONO, fontSize: 10, fontWeight: 700, color: COLORS.text }}>
          {definition.kind === "critical"
            ? `${pct(value)} · ${stats.critMultiplier.toFixed(2)}x`
            : definition.format(value)}
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <button
            onClick={() => onAllocate(definition.key, 1)}
            disabled={!canAllocate}
            className="af-btn"
            style={{ ...allocateButtonStyle, opacity: canAllocate ? 1 : 0.4 }}
          >
            +1
          </button>
          <button
            onClick={() => onAllocate(definition.key, 10)}
            disabled={!canAllocate}
            className="af-btn"
            style={{ ...allocateButtonStyle, opacity: canAllocate ? 1 : 0.4 }}
          >
            +10
          </button>
        </div>
      </div>

      {definition.kind === "asymptotic" && (
        <div style={{ marginTop: 6 }}>
          <div style={{ height: 4, borderRadius: 2, background: COLORS.void, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${clamp((value / definition.ceiling) * 100, 0, 100)}%`, background: groupColor, transition: "width 250ms ease" }} />
          </div>
          <div style={{ fontFamily: FONT_MONO, fontSize: 6.5, color: COLORS.textMuted, marginTop: 2 }}>
            → {definition.ceiling}% ceiling, never reached
          </div>
        </div>
      )}
      {definition.kind === "linear" && (
        <div style={{ fontFamily: FONT_MONO, fontSize: 6.5, color: COLORS.textMuted, marginTop: 6 }}>
          ∞ no limit
        </div>
      )}
      {definition.kind === "critical" && (
        <div style={{ fontFamily: FONT_MONO, fontSize: 6.5, color: COLORS.textMuted, marginTop: 6 }}>
          chance → 100% ceiling · damage ∞
        </div>
      )}
    </div>
  );
}

/* ============================================================================
   BATTLE SCREEN
   ========================================================================== */

function BattleScreen({ level, stats, battle, allocation, onPlayCard, onNext, onBack }) {
  const { enemy, playerHp, enemyHp, depth, momentum, phase, enemyIntent, intentRevealed, log, outcome, xpGained, round } = battle;

  const playerHpPct = clamp(playerHp / stats.maxHp, 0, 1);
  const enemyHpPct = clamp(enemyHp / enemy.maxHp, 0, 1);
  const ended = phase === "ended";

  return (
    <div className="af-fade">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <button onClick={onBack} className="af-btn" style={{ ...secondaryButtonStyle, display: "flex", alignItems: "center", gap: 5, padding: "6px 9px" }}>
          <ArrowLeft size={11} /> Loadout
        </button>
        <div style={{ textAlign: "center", fontFamily: FONT_MONO }}>
          <div style={{ fontSize: 9, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 1 }}>Depth {depth}</div>
          <div style={{ fontSize: 10, color: COLORS.chrome, marginTop: 2 }}>Round {round}</div>
        </div>
        <div style={{ fontFamily: FONT_MONO, fontSize: 9, color: COLORS.textMuted }}>Lv {level}</div>
      </div>

      {/* ENEMY PANEL */}
      <div style={{ padding: "14px 13px", borderRadius: 8, background: COLORS.panel, border: `1px solid ${COLORS.panelLine}`, marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 40, height: 40, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", background: `${COLORS.enemy}18`, border: `1px solid ${COLORS.enemy}35`, flexShrink: 0 }}>
            <Skull size={19} color={COLORS.enemy} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: COLORS.text }}>{enemy.name}</div>
            <div style={{ fontFamily: FONT_MONO, fontSize: 9, color: COLORS.textMuted, marginTop: 1 }}>
              Lv {enemy.level} · {enemy.archetypeName}
            </div>
          </div>
        </div>

        <HealthBar label="ENEMY" current={enemyHp} max={enemy.maxHp} percentage={enemyHpPct} tint={COLORS.enemy} />

        {!ended && (
          <div
            className={intentRevealed ? "af-pulse" : undefined}
            style={{
              display: "flex", alignItems: "center", gap: 6, marginTop: 9, padding: "6px 8px", borderRadius: 5,
              background: intentRevealed ? `${COLORS.gold}14` : COLORS.void,
              border: `1px solid ${intentRevealed ? `${COLORS.gold}45` : COLORS.panelLine}`,
            }}
          >
            {intentRevealed ? <Eye size={12} color={COLORS.gold} /> : <Lock size={11} color={COLORS.textMuted} />}
            <span style={{ fontFamily: FONT_MONO, fontSize: 9, color: intentRevealed ? COLORS.gold : COLORS.textMuted }}>
              {intentRevealed ? `Insight: preparing ${CARD_LABELS[enemyIntent]}` : "Intent unknown — invest in Insight"}
            </span>
          </div>
        )}
      </div>

      {/* PLAYER PANEL */}
      <div style={{ padding: "14px 13px", borderRadius: 8, background: COLORS.panel, border: `1px solid ${COLORS.chrome}30`, marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 40, height: 40, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", background: `${COLORS.chrome}18`, border: `1px solid ${COLORS.chrome}35` }}>
            <Trophy size={19} color={COLORS.chrome} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: COLORS.text }}>YOU</div>
            <div style={{ fontFamily: FONT_MONO, fontSize: 9, color: COLORS.textMuted, marginTop: 1 }}>
              {momentum > 0 ? `Combo x${momentum}` : "No combo"}
            </div>
          </div>
          {momentum > 0 && <Flame size={15} color={COLORS.offense} />}
        </div>

        <HealthBar label="YOU" current={playerHp} max={stats.maxHp} percentage={playerHpPct} tint={COLORS.chrome} />

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 5, marginTop: 9 }}>
          <MiniStat label="ATK" value={formatNumber(stats.attack)} />
          <MiniStat label="CRIT" value={pct(stats.critChance)} />
          <MiniStat label="DODGE" value={pct(stats.dodgeChance)} />
          <MiniStat label="BLOCK" value={pct(stats.blockPct)} />
        </div>
      </div>

      {!ended ? (
        <CardGrid allocation={allocation} onPlayCard={onPlayCard} />
      ) : (
        <BattleResult outcome={outcome} xpGained={xpGained} log={log} round={round} onNext={onNext} onBack={onBack} />
      )}
    </div>
  );
}

/* ============================================================================
   CARD GRID
   ========================================================================== */

function CardGrid({ allocation, onPlayCard }) {
  return (
    <div>
      <div style={{ fontFamily: FONT_MONO, fontSize: 9, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 1.5, margin: "2px 0 7px" }}>
        Choose your card
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
        {CARD_DEFS.map((card) => {
          const unlocked = card.unlocked(allocation);
          return (
            <button
              key={card.key}
              onClick={() => unlocked && onPlayCard(card.key)}
              disabled={!unlocked}
              className="af-btn"
              style={{
                textAlign: "left", padding: "11px 11px", borderRadius: 6,
                border: `1px solid ${unlocked ? `${COLORS.chrome}40` : COLORS.panelLine}`,
                background: unlocked ? COLORS.panel : COLORS.void,
                cursor: unlocked ? "pointer" : "not-allowed",
                opacity: unlocked ? 1 : 0.5,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {unlocked ? <card.Icon size={14} color={COLORS.chrome} /> : <Lock size={12} color={COLORS.textMuted} />}
                <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 11.5, color: COLORS.text }}>{card.name}</span>
              </div>
              <div style={{ fontFamily: FONT_MONO, fontSize: 7.5, color: COLORS.textMuted, marginTop: 4, lineHeight: 1.35 }}>
                {unlocked ? card.blurb : card.hint}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ============================================================================
   HEALTH BAR / MINI STAT
   ========================================================================== */

function HealthBar({ label, current, max, percentage, tint }) {
  return (
    <div style={{ marginTop: 11 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontFamily: FONT_MONO, fontSize: 8, color: COLORS.textMuted }}>
        <span>{label}</span>
        <span>{formatNumber(current)} / {formatNumber(max)}</span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: COLORS.void, border: `1px solid ${COLORS.panelLine}`, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${percentage * 100}%`, background: tint, transition: "width 320ms ease" }} />
      </div>
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div style={{ padding: "6px 5px", borderRadius: 4, background: COLORS.void, textAlign: "center" }}>
      <div style={{ fontFamily: FONT_MONO, fontSize: 7, color: COLORS.textMuted }}>{label}</div>
      <div style={{ fontFamily: FONT_MONO, fontSize: 9, fontWeight: 700, color: COLORS.text, marginTop: 2 }}>{value}</div>
    </div>
  );
}

/* ============================================================================
   BATTLE RESULT
   ========================================================================== */

function BattleResult({ outcome, xpGained, log, round, onNext, onBack }) {
  const won = outcome === "won";
  const visibleLog = log.slice(-9);

  return (
    <div className="af-pop" style={{ marginTop: 4 }}>
      <div style={{ padding: "14px 14px", borderRadius: 8, border: `1px solid ${won ? `${COLORS.chrome}55` : `${COLORS.enemy}44`}`, background: COLORS.panel }}>
        <div style={{ textAlign: "center", fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 19, color: won ? COLORS.chrome : COLORS.enemy }}>
          {won ? "VICTORY" : "DEFEATED"}
        </div>
        <div style={{ textAlign: "center", fontFamily: FONT_MONO, fontSize: 9, color: COLORS.textMuted, marginTop: 3 }}>
          {round} rounds{won ? ` · +${xpGained} XP` : ""}
        </div>

        <div className="af-scroll" style={{ marginTop: 11, display: "flex", flexDirection: "column", gap: 4, maxHeight: 150, overflowY: "auto" }}>
          {visibleLog.map((entry, i) => (
            <div
              key={i}
              style={{
                fontFamily: FONT_MONO, fontSize: 8.5, padding: "2px 0",
                color: entry.type === "critical" ? COLORS.chrome
                  : entry.type === "enemy" ? COLORS.enemy
                  : entry.type === "heal" ? COLORS.heal
                  : entry.type === "player" ? COLORS.text
                  : COLORS.textMuted,
                fontWeight: entry.text.startsWith("—") ? 700 : 400,
                opacity: entry.text.startsWith("—") ? 0.7 : 1,
              }}
            >
              {entry.text}
            </div>
          ))}
        </div>

        {won ? (
          <button onClick={onNext} className="af-btn" style={{ ...primaryButtonStyle, width: "100%", marginTop: 12, padding: "13px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <Dices size={14} /> Generate next enemy
          </button>
        ) : (
          <button onClick={onBack} className="af-btn" style={{ ...secondaryButtonStyle, width: "100%", marginTop: 12, padding: "13px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, color: COLORS.chrome, borderColor: `${COLORS.chrome}55`, background: `${COLORS.chrome}12` }}>
            <RotateCcw size={14} /> Rebuild at checkpoint
          </button>
        )}
      </div>
    </div>
  );
}

/* ============================================================================
   SHARED BUTTON STYLES
   ========================================================================== */

const primaryButtonStyle = {
  border: "none", background: COLORS.chrome, color: COLORS.void,
  fontFamily: FONT_DISPLAY, fontWeight: 700, letterSpacing: 0.8,
  textTransform: "uppercase", borderRadius: 6, cursor: "pointer", fontSize: 12,
};

const secondaryButtonStyle = {
  border: `1px solid ${COLORS.panelLine}`, background: COLORS.panel, color: COLORS.textMuted,
  fontFamily: FONT_MONO, fontSize: 9, borderRadius: 5, cursor: "pointer",
};

const iconButtonStyle = {
  border: `1px solid ${COLORS.panelLine}`, background: COLORS.panel, borderRadius: 6,
  width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
};

const allocateButtonStyle = {
  border: `1px solid ${COLORS.panelLine}`, background: COLORS.void, color: COLORS.text,
  fontFamily: FONT_MONO, fontSize: 8.5, fontWeight: 700, borderRadius: 4,
  padding: "3px 6px", cursor: "pointer",
};

