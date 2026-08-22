import Phaser from "phaser";
import {
  getDifficultyParams,
  MATCH_DURATION_MS,
} from "./shooterProgression";
import type { CombatStats } from "./shooterProgression";

// ============================================================================
// TYPES / CALLBACKS
//
// The scene never touches React state directly. It reports snapshots
// upward through a callback so React can re-render its HUD/pause/results
// overlays without ever fighting Phaser for the same frame.
// ============================================================================

export interface ShooterHudSnapshot {
  hp: number;
  maxHp: number;
  kills: number;
  shotsFired: number;
  shotsHit: number;
  elapsedMs: number;
  remainingMs: number;
}

export interface ShooterEndResult {
  kills: number;
  shotsFired: number;
  shotsHit: number;
  durationMs: number;
  survived: boolean;
}

export interface ShooterSceneConfig {
  combatStats: CombatStats;
  onHudUpdate: (snapshot: ShooterHudSnapshot) => void;
  onMatchEnd: (result: ShooterEndResult) => void;
  /** Fires once per fatal hit so the wrapper can trigger a screen-shake or similar. */
  onPlayerHit: () => void;
}

const PLAYER_SPEED = 190;
const BULLET_SPEED = 520;
const BASE_FIRE_COOLDOWN_MS = 260;
const BULLET_DAMAGE = 1;
const PLAYER_INVULN_MS = 500;
const WORLD_MARGIN = 28;

type BotSprite = Phaser.Physics.Arcade.Sprite & {
  hp?: number;
  maxHp?: number;
};

export class ShooterScene extends Phaser.Scene {
  private config!: ShooterSceneConfig;

  private player!: Phaser.Physics.Arcade.Sprite;
  private bullets!: Phaser.Physics.Arcade.Group;
  private bots!: Phaser.Physics.Arcade.Group;
  private muzzleParticles!: Phaser.GameObjects.Particles.ParticleEmitter;
  private hitParticles!: Phaser.GameObjects.Particles.ParticleEmitter;

  private hp = 100;
  private maxHp = 100;
  private kills = 0;
  private shotsFired = 0;
  private shotsHit = 0;
  private matchStartTime = 0;
  private lastHudPush = 0;
  private lastFireTime = 0;
  private lastHitTime = 0;
  private lastSpawnTime = 0;
  private isGameOver = false;
  private isPaused = false;

  // Input state — populated by the React wrapper via public methods,
  // since touch joysticks/aim pads live outside the canvas' own input plugin.
  private moveVector = { x: 0, y: 0 };
  private aimVector: { x: number; y: number } | null = null;
  private wantsToFire = false;

  constructor() {
    super({ key: "ShooterScene" });
  }

  init(config: ShooterSceneConfig) {
    this.config = config;
    this.hp = config.combatStats.maxHp;
    this.maxHp = config.combatStats.maxHp;
    this.kills = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.matchStartTime = 0;
    this.lastFireTime = 0;
    this.lastHitTime = 0;
    this.lastSpawnTime = 0;
    this.isGameOver = false;
    this.isPaused = false;
    this.moveVector = { x: 0, y: 0 };
    this.aimVector = null;
    this.wantsToFire = false;
  }

  preload() {
    // Everything is drawn procedurally with Graphics -> texture so there are
    // no external image assets to manage or fail to load on mobile networks.
    this.generateCircleTexture("tex-player", 16, 0xe7ecec, 0x9fb3ad);
    this.generateCircleTexture("tex-bot", 14, 0xd6453d, 0x7a201c);
    this.generateCircleTexture("tex-bullet", 4, 0xf5d76e, 0xb89b2e);
    this.generateCircleTexture("tex-particle", 3, 0xffffff, 0xffffff);
  }

  private generateCircleTexture(
    key: string,
    radius: number,
    fill: number,
    stroke: number
  ) {
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    const size = radius * 2 + 4;

    g.lineStyle(2, stroke, 1);
    g.fillStyle(fill, 1);
    g.fillCircle(size / 2, size / 2, radius);
    g.strokeCircle(size / 2, size / 2, radius);
    g.generateTexture(key, size, size);
    g.destroy();
  }

  create() {
    const { width, height } = this.scale;

    this.physics.world.setBounds(0, 0, width, height);

    this.player = this.physics.add.sprite(width / 2, height / 2, "tex-player");
    this.player.setCollideWorldBounds(true);
    this.player.setDamping(true);
    this.player.setDrag(0.85);
    this.player.setCircle(16);

    this.bullets = this.physics.add.group({
      classType: Phaser.Physics.Arcade.Image,
      maxSize: 120,
      runChildUpdate: false,
    });

    this.bots = this.physics.add.group();

    this.hitParticles = this.add.particles(0, 0, "tex-particle", {
      lifespan: 260,
      speed: { min: 40, max: 140 },
      scale: { start: 1.4, end: 0 },
      quantity: 8,
      emitting: false,
    });

    this.muzzleParticles = this.add.particles(0, 0, "tex-particle", {
      lifespan: 120,
      speed: { min: 20, max: 60 },
      scale: { start: 0.8, end: 0 },
      quantity: 3,
      emitting: false,
    });

    this.physics.add.overlap(
      this.bullets,
      this.bots,
      this.handleBulletHitsBot,
      undefined,
      this
    );

    this.physics.add.overlap(
      this.player,
      this.bots,
      this.handleBotHitsPlayer,
      undefined,
      this
    );

    this.matchStartTime = this.time.now;
  }

  // ==========================================================================
  // PUBLIC API — called by the React wrapper (joystick / aim pad / buttons)
  // ==========================================================================

  setMoveVector(x: number, y: number) {
    this.moveVector = { x, y };
  }

  setAimVector(x: number, y: number) {
    const len = Math.hypot(x, y);
    if (len < 0.001) {
      this.aimVector = null;
      return;
    }
    this.aimVector = { x: x / len, y: y / len };
  }

  setFiring(firing: boolean) {
    this.wantsToFire = firing;
  }

  setPaused(paused: boolean) {
    this.isPaused = paused;
    if (paused) {
      this.physics.pause();
    } else {
      this.physics.resume();
    }
  }

  // ==========================================================================
  // UPDATE LOOP
  // ==========================================================================

  update(time: number) {
    if (this.isGameOver || this.isPaused) return;

    const elapsedMs = time - this.matchStartTime;

    if (elapsedMs >= MATCH_DURATION_MS) {
      this.endMatch(true);
      return;
    }

    this.updatePlayerMovement();
    this.updateAimingAndFiring(time);
    this.updateBotSpawning(time, elapsedMs);
    this.updateBotChase();
    this.cullOffscreenBullets();
    this.pushHudSnapshot(time, elapsedMs);
  }

  private updatePlayerMovement() {
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const { x, y } = this.moveVector;
    const len = Math.hypot(x, y);

    if (len > 0.05) {
      const nx = x / Math.max(len, 1);
      const ny = y / Math.max(len, 1);
      body.setVelocity(nx * PLAYER_SPEED, ny * PLAYER_SPEED);
    } else {
      body.setVelocity(0, 0);
    }
  }

  private updateAimingAndFiring(time: number) {
    if (!this.aimVector || !this.wantsToFire) return;

    const cooldown =
      BASE_FIRE_COOLDOWN_MS * this.config.combatStats.fireRateMultiplier;

    if (time - this.lastFireTime < cooldown) return;

    this.lastFireTime = time;
    this.fireBullet(this.aimVector.x, this.aimVector.y);
  }

  private fireBullet(dirX: number, dirY: number) {
    const bullet = this.bullets.get(
      this.player.x,
      this.player.y,
      "tex-bullet"
    ) as Phaser.Physics.Arcade.Image | null;

    if (!bullet) return;

    bullet.setActive(true);
    bullet.setVisible(true);
    bullet.enableBody(true, this.player.x, this.player.y, true, true);
    bullet.setVelocity(dirX * BULLET_SPEED, dirY * BULLET_SPEED);

    this.shotsFired += 1;

    this.muzzleParticles.setPosition(
      this.player.x + dirX * 20,
      this.player.y + dirY * 20
    );
    this.muzzleParticles.explode(3);

    // Auto-deactivate after 1.2s in case it never leaves world bounds
    // (belt-and-suspenders alongside cullOffscreenBullets).
    this.time.delayedCall(1200, () => {
      if (bullet.active) {
        bullet.setActive(false);
        bullet.setVisible(false);
        bullet.disableBody(true, true);
      }
    });
  }

  private cullOffscreenBullets() {
    const { width, height } = this.scale;

    this.bullets.children.each((child) => {
      const b = child as Phaser.Physics.Arcade.Image;
      if (!b.active) return true;

      if (
        b.x < -20 ||
        b.x > width + 20 ||
        b.y < -20 ||
        b.y > height + 20
      ) {
        b.setActive(false);
        b.setVisible(false);
        b.disableBody(true, true);
      }
      return true;
    });
  }

  private updateBotSpawning(time: number, elapsedMs: number) {
    const params = getDifficultyParams(elapsedMs);
    const aliveBots = this.bots.countActive(true);

    if (aliveBots >= params.maxConcurrentBots) return;
    if (time - this.lastSpawnTime < params.spawnIntervalMs) return;

    this.lastSpawnTime = time;
    this.spawnBot(params.botSpeed, params.botHp);
  }

  private spawnBot(speed: number, hp: number) {
    const { width, height } = this.scale;
    const edge = Phaser.Math.Between(0, 3);
    let x = 0;
    let y = 0;

    if (edge === 0) {
      x = Phaser.Math.Between(0, width);
      y = -WORLD_MARGIN;
    } else if (edge === 1) {
      x = width + WORLD_MARGIN;
      y = Phaser.Math.Between(0, height);
    } else if (edge === 2) {
      x = Phaser.Math.Between(0, width);
      y = height + WORLD_MARGIN;
    } else {
      x = -WORLD_MARGIN;
      y = Phaser.Math.Between(0, height);
    }

    const bot = this.bots.create(x, y, "tex-bot") as BotSprite;
    bot.setCircle(14);
    bot.hp = hp;
    bot.maxHp = hp;
    bot.setData("speed", speed);
  }

  private updateBotChase() {
    this.bots.children.each((child) => {
      const bot = child as BotSprite;
      if (!bot.active) return true;

      const body = bot.body as Phaser.Physics.Arcade.Body;
      const speed = (bot.getData("speed") as number) ?? 70;

      const dx = this.player.x - bot.x;
      const dy = this.player.y - bot.y;
      const len = Math.hypot(dx, dy) || 1;

      body.setVelocity((dx / len) * speed, (dy / len) * speed);
      return true;
    });
  }

  private handleBulletHitsBot: Phaser.Types.Physics.Arcade.ArcadePhysicsCallback =
    (bulletObj, botObj) => {
      const bullet = bulletObj as Phaser.Physics.Arcade.Image;
      const bot = botObj as BotSprite;

      if (!bullet.active || !bot.active) return;

      bullet.setActive(false);
      bullet.setVisible(false);
      bullet.disableBody(true, true);

      this.shotsHit += 1;
      bot.hp = (bot.hp ?? 1) - BULLET_DAMAGE;

      this.hitParticles.setPosition(bot.x, bot.y);
      this.hitParticles.explode(6);

      if ((bot.hp ?? 0) <= 0) {
        this.kills += 1;
        bot.setActive(false);
        bot.setVisible(false);
        bot.disableBody(true, true);
        bot.destroy();
      }
    };

  private handleBotHitsPlayer: Phaser.Types.Physics.Arcade.ArcadePhysicsCallback =
    (_playerObj, botObj) => {
      const bot = botObj as BotSprite;
      if (!bot.active || this.isGameOver) return;

      const time = this.time.now;
      if (time - this.lastHitTime < PLAYER_INVULN_MS) return;

      this.lastHitTime = time;
      this.hp -= 10;

      this.config.onPlayerHit();
      this.player.setTintFill(0xff4d4d);
      this.time.delayedCall(120, () => this.player.clearTint());

      // Knock the bot away so it doesn't chain-hit instantly, without
      // applying any force to the player (player takes HP loss only).
      const dx = bot.x - this.player.x;
      const dy = bot.y - this.player.y;
      const len = Math.hypot(dx, dy) || 1;
      bot.setVelocity((dx / len) * 200, (dy / len) * 200);

      if (this.hp <= 0) {
        this.hp = 0;
        this.endMatch(false);
      }
    };

  private pushHudSnapshot(time: number, elapsedMs: number) {
    if (time - this.lastHudPush < 100) return;
    this.lastHudPush = time;

    this.config.onHudUpdate({
      hp: this.hp,
      maxHp: this.maxHp,
      kills: this.kills,
      shotsFired: this.shotsFired,
      shotsHit: this.shotsHit,
      elapsedMs,
      remainingMs: Math.max(0, MATCH_DURATION_MS - elapsedMs),
    });
  }

  private endMatch(survived: boolean) {
    if (this.isGameOver) return;
    this.isGameOver = true;

    const elapsedMs = Math.min(
      this.time.now - this.matchStartTime,
      MATCH_DURATION_MS
    );

    this.physics.pause();

    this.config.onMatchEnd({
      kills: this.kills,
      shotsFired: this.shotsFired,
      shotsHit: this.shotsHit,
      durationMs: elapsedMs,
      survived,
    });
  }
}

