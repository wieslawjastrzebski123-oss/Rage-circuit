import Phaser from 'phaser';
import { ABILITIES, type CarStats } from '../data/cars';
import { CAR_TEX_SCALE } from '../Textures';
import { CAR_RADIUS, Depth } from '../constants';
import { clamp, damp, wrapAngle } from '../utils/math';
import type { Weapon } from '../weapons/Weapon';
import type { Ability } from '../abilities/Ability';
import type { World } from '../systems/World';

export interface Controls {
  throttle: number; // -1..1
  steer: number; // -1..1
  drift: boolean;
  boost: boolean;
  firePrimary: boolean;
  fireSecondary: boolean;
  ability: boolean;
  reset: boolean;
  aimX: number;
  aimY: number;
}

/** Drift charge thresholds (seconds) and the boost each level gives. */
export const DRIFT_LEVELS = [
  { time: 0.5, power: 0.55, duration: 0.45, color: 0x5fb8ff },
  { time: 1.0, power: 0.8, duration: 0.65, color: 0xffd23f },
  { time: 2.0, power: 1.05, duration: 0.9, color: 0xff8a00 },
  { time: 3.0, power: 1.3, duration: 1.15, color: 0xff2d6f },
];

const DRIFT_MIN_SPEED = 250;
const DRIFT_KEEP_SPEED = 150;
const BOOST_DRAIN = 36;
const BOOST_PASSIVE = 2.5;
const BOOST_FROM_DRIFT = 11;

export interface RaceState {
  s: number;
  progress: number;
  cpPassed: number;
  lapsDone: number;
  finished: boolean;
  finishTime: number;
  finishOrder: number;
  lapStart: number;
  lapTimes: number[];
  wrongWayTime: number;
  usingShortcut: boolean;
}

export interface CombatStats {
  kills: number;
  deaths: number;
  damageDealt: number;
  damageTaken: number;
}

let nextId = 1;

export class Car {
  readonly id = nextId++;
  readonly stats: CarStats;
  readonly name: string;
  readonly isPlayer: boolean;
  readonly world: World;

  // physics
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  heading = 0;
  angVel = 0;
  readonly radius = CAR_RADIUS;

  // resources
  hp: number;
  energy: number;
  boostMeter = 30;

  // drift & boost
  drifting = false;
  driftDir = 0;
  driftTime = 0;
  driftBoostTime = 0;
  driftBoostPower = 0;
  driftBoostColor = 0x5fb8ff;
  boosting = false;
  boostPower = 0;
  /** extra visual yaw applied while drifting */
  bodyYaw = 0;

  // status effects (seconds remaining)
  nitroTime = 0;
  shieldTime = 0;
  empTime = 0;
  ghostTime = 0;
  frozenTime = 0;
  hitFlash = 0;

  alive = true;
  respawnTimer = 0;
  stuckTime = 0;
  /** tiny acceleration bonus when far behind (set by RaceManager) */
  rubberBand = 1;

  primary!: Weapon;
  secondary!: Weapon;
  ability!: Ability;

  readonly controls: Controls = {
    throttle: 0,
    steer: 0,
    drift: false,
    boost: false,
    firePrimary: false,
    fireSecondary: false,
    ability: false,
    reset: false,
    aimX: 0,
    aimY: 0,
  };

  readonly race: RaceState = {
    s: 0,
    progress: 0,
    cpPassed: 0,
    lapsDone: 0,
    finished: false,
    finishTime: 0,
    finishOrder: 0,
    lapStart: 0,
    lapTimes: [],
    wrongWayTime: 0,
    usingShortcut: false,
  };

  readonly combat: CombatStats = { kills: 0, deaths: 0, damageDealt: 0, damageTaken: 0 };
  lastHitBy: Car | null = null;
  lastHitTime = -99;

  // visuals
  readonly sprite: Phaser.GameObjects.Image;
  readonly shadow: Phaser.GameObjects.Image;
  readonly turret: Phaser.GameObjects.Image;
  readonly headlight: Phaser.GameObjects.Image;
  readonly flame: Phaser.GameObjects.Image;
  readonly shield: Phaser.GameObjects.Image;
  readonly glow: Phaser.GameObjects.Image;
  aimAngle = 0;
  private skidAcc = 0;
  private smokeAcc = 0;
  private trailAcc = 0;

  constructor(world: World, stats: CarStats, name: string, isPlayer: boolean) {
    this.world = world;
    this.stats = stats;
    this.name = name;
    this.isPlayer = isPlayer;
    this.hp = stats.hp;
    this.energy = stats.energy;

    const scene = world.scene;
    this.shadow = scene.add
      .image(0, 0, `car_${stats.id}_shadow`)
      .setScale(CAR_TEX_SCALE * 1.04)
      .setAlpha(0.45)
      .setDepth(Depth.Shadow);
    this.headlight = scene.add
      .image(0, 0, 'headlight')
      .setOrigin(0, 0.5)
      .setScale(1.6, 1.3)
      .setAlpha(0.55)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(Depth.CarFx);
    this.glow = scene.add
      .image(0, 0, 'glow')
      .setScale(1.6)
      .setAlpha(0.22)
      .setTint(stats.color)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(Depth.CarFx);
    this.flame = scene.add
      .image(0, 0, 'flame')
      .setOrigin(1, 0.5)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(Depth.CarFx + 1)
      .setVisible(false);
    this.sprite = scene.add.image(0, 0, `car_${stats.id}`).setScale(CAR_TEX_SCALE).setDepth(Depth.Car);
    this.turret = scene.add.image(0, 0, 'turret').setOrigin(0.3, 0.5).setScale(0.8).setDepth(Depth.Turret);
    this.shield = scene.add
      .image(0, 0, 'ring')
      .setScale(0.5)
      .setTint(0x7dff4a)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(Depth.Turret + 1)
      .setVisible(false);
  }

  // ---------------------------------------------------------------- helpers
  get speed(): number {
    return Math.hypot(this.vx, this.vy);
  }
  get forwardSpeed(): number {
    return this.vx * Math.cos(this.heading) + this.vy * Math.sin(this.heading);
  }
  get maxHp(): number {
    return this.stats.hp;
  }
  get maxEnergy(): number {
    return this.stats.energy;
  }
  get mass(): number {
    return this.stats.mass;
  }
  get isGhost(): boolean {
    return this.ghostTime > 0 || !this.alive;
  }
  get canAct(): boolean {
    return this.alive && this.empTime <= 0 && this.frozenTime <= 0 && this.world.raceStarted;
  }
  get driftLevel(): number {
    let lvl = 0;
    for (let i = 0; i < DRIFT_LEVELS.length; i++) if (this.driftTime >= DRIFT_LEVELS[i].time) lvl = i + 1;
    return lvl;
  }
  get abilityName(): string {
    return ABILITIES[this.stats.ability].name;
  }

  setPose(x: number, y: number, heading: number): void {
    this.x = x;
    this.y = y;
    this.heading = heading;
    this.vx = 0;
    this.vy = 0;
    this.angVel = 0;
    this.drifting = false;
    this.driftTime = 0;
    this.bodyYaw = 0;
    this.aimAngle = heading;
  }

  /** Controllers (player input / AI) fill `controls` here. */
  think(_dt: number): void {}

  // ---------------------------------------------------------------- simulation
  update(dt: number): void {
    const c = this.controls;
    this.primary.update(dt);
    this.secondary.update(dt);
    this.ability.update(dt, this);

    this.nitroTime = Math.max(0, this.nitroTime - dt);
    this.shieldTime = Math.max(0, this.shieldTime - dt);
    this.empTime = Math.max(0, this.empTime - dt);
    this.ghostTime = Math.max(0, this.ghostTime - dt);
    this.frozenTime = Math.max(0, this.frozenTime - dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.driftBoostTime = Math.max(0, this.driftBoostTime - dt);

    if (!this.alive) {
      // wreck coasts to a stop
      this.vx *= Math.exp(-2.5 * dt);
      this.vy *= Math.exp(-2.5 * dt);
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.angVel *= Math.exp(-2 * dt);
      this.heading += this.angVel * dt;
      return;
    }

    const started = this.world.raceStarted && this.frozenTime <= 0;
    const throttle = started ? c.throttle : 0;
    const steer = started ? c.steer : 0;

    // energy regen scales with speed – camping is not rewarded
    const spd = this.speed;
    const regen = 1.5 + 13 * clamp(spd / this.stats.maxSpeed, 0, 1);
    this.energy = Math.min(this.maxEnergy, this.energy + regen * dt);
    this.boostMeter = Math.min(100, this.boostMeter + BOOST_PASSIVE * dt);

    // combat input
    if (started && this.canAct) {
      this.aimAngle = Math.atan2(c.aimY - this.y, c.aimX - this.x);
      if (c.firePrimary) this.primary.tryFire(this, this.world);
      if (c.fireSecondary) this.secondary.tryFire(this, this.world);
      if (c.ability) this.ability.tryActivate(this, this.world);
    } else if (started) {
      this.aimAngle = Math.atan2(c.aimY - this.y, c.aimX - this.x);
    }

    const st = this.stats;
    // forward speed in the current frame (used for steering & drift checks)
    let vF = this.vx * Math.cos(this.heading) + this.vy * Math.sin(this.heading);

    // -------- boost sources
    const wantBoost = started && c.boost && this.boostMeter > (this.boosting ? 0 : 8);
    this.boosting = wantBoost;
    if (this.boosting) this.boostMeter = Math.max(0, this.boostMeter - BOOST_DRAIN * dt);
    let bp = 0;
    if (this.nitroTime > 0) bp = Math.max(bp, 1.35);
    if (this.driftBoostTime > 0) bp = Math.max(bp, this.driftBoostPower);
    if (this.boosting) bp = Math.max(bp, 0.95);
    if (this.empTime > 0) bp *= 0.4;
    this.boostPower = bp;
    const speedCap = st.maxSpeed * (1 + 0.3 * bp);
    const accel = st.acceleration * (1 + 1.3 * bp) * this.rubberBand;

    // -------- drift state machine
    let kick = 0;
    if (!this.drifting) {
      if (started && c.drift && vF > DRIFT_MIN_SPEED && Math.abs(steer) > 0.3) {
        this.drifting = true;
        this.driftDir = Math.sign(steer);
        this.driftTime = 0;
        // kick the tail out
        this.angVel += this.driftDir * 1.0;
        kick = this.driftDir * 40;
      }
    } else if (!c.drift || vF < DRIFT_KEEP_SPEED || !started) {
      this.endDrift(true);
    }

    // -------- steering (yaw)
    const absF = Math.abs(vF);
    const lowSpeed = clamp(absF / 170, 0, 1);
    const highSpeed = 1 - 0.42 * clamp((absF - 250) / 420, 0, 1);
    let targetAng: number;
    if (this.drifting) {
      this.driftTime += dt;
      // locked into the drift direction; steering only tightens or widens the arc
      const tighten = steer * this.driftDir; // -1..1
      // neutral ≈ medium arc, steering into the drift tightens it, away widens it
      const turn = tighten > 0 ? 0.3 + 0.55 * tighten : 0.3 + 0.18 * tighten;
      targetAng = this.driftDir * st.handling * turn;
      this.boostMeter = Math.min(100, this.boostMeter + BOOST_FROM_DRIFT * dt);
    } else {
      targetAng = steer * st.handling * lowSpeed * highSpeed * (vF < 0 ? -1 : 1);
    }
    this.angVel = damp(this.angVel, targetAng, this.drifting ? 7 : 11, dt);
    const dYaw = this.angVel * dt;
    this.heading = wrapAngle(this.heading + dYaw);

    // Momentum: the velocity only partly follows the new heading. The rest shows up
    // as sideways velocity that the tyres then scrub off – less so while drifting,
    // which is what lets the tail swing out.
    const follow = this.drifting ? 0.72 : 0.97 - 0.1 * clamp((absF - 380) / 300, 0, 1);
    const rot = dYaw * follow;
    const rc = Math.cos(rot);
    const rs = Math.sin(rot);
    const rvx = this.vx * rc - this.vy * rs;
    const rvy = this.vx * rs + this.vy * rc;

    const cos = Math.cos(this.heading);
    const sin = Math.sin(this.heading);
    vF = rvx * cos + rvy * sin;
    let vR = -rvx * sin + rvy * cos - kick;

    // -------- throttle / brake
    if (throttle > 0) {
      if (vF < 0) vF += 1100 * throttle * dt; // braking out of reverse
      else {
        const ratio = clamp(vF / speedCap, 0, 1);
        vF += accel * throttle * (1 - ratio * ratio) * dt;
      }
    } else if (throttle < 0) {
      if (vF > 20) vF -= 1000 * -throttle * dt;
      else vF = Math.max(-st.reverseSpeed, vF - st.acceleration * 0.7 * -throttle * dt);
    } else {
      // engine braking / rolling resistance
      const roll = 170 * dt;
      vF = Math.abs(vF) <= roll ? 0 : vF - Math.sign(vF) * roll;
    }
    if (bp > 0 && vF > 0 && vF < speedCap) vF += st.acceleration * 0.35 * bp * dt; // extra punch
    vF -= vF * (this.drifting ? 0.2 : 0.12) * dt; // air drag (+ drift scrub)
    if (vF > speedCap) vF = damp(vF, speedCap, 2.2, dt);

    // -------- lateral grip
    let grip = st.grip * (1 - 0.3 * clamp((absF - 380) / 300, 0, 1));
    if (this.drifting) grip = st.driftGrip;
    else if (throttle < 0 && vF > 200) grip *= 0.8;
    // sideways speed isn't lost entirely – part of it is redirected forward (arcade feel)
    const lost = vR * (1 - Math.exp(-grip * dt));
    vR -= lost;
    if (vF > 0) vF += Math.abs(lost) * (this.drifting ? 0.55 : 0.35);

    this.vx = cos * vF - sin * vR;
    this.vy = sin * vF + cos * vR;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    this.bodyYaw = damp(this.bodyYaw, this.drifting ? this.driftDir * 0.28 : 0, 8, dt);
  }

  /** Ends a drift; a clean one converts the charge into a boost. */
  endDrift(clean: boolean): void {
    if (!this.drifting) return;
    const lvl = this.driftLevel;
    this.drifting = false;
    if (clean && lvl > 0) {
      const L = DRIFT_LEVELS[lvl - 1];
      this.driftBoostPower = L.power;
      this.driftBoostTime = L.duration;
      this.driftBoostColor = L.color;
      // instant kick
      const c = Math.cos(this.heading);
      const s = Math.sin(this.heading);
      this.vx += c * 70 * L.power;
      this.vy += s * 70 * L.power;
      this.world.effects.driftRelease(this, L.color, lvl);
      if (this.isPlayer) this.world.audio.boost(0.5 + lvl * 0.15);
    } else if (!clean && lvl > 0 && this.isPlayer) {
      this.world.hud?.flash('DRIFT LOST', '#ff5a5a', 700);
    }
    this.driftTime = 0;
  }

  /** Called by the collision system on wall / heavy impacts. */
  onImpact(strength: number): void {
    if (this.drifting && strength > 180) this.endDrift(false);
  }

  // ---------------------------------------------------------------- visuals
  updateVisuals(dt: number): void {
    const x = this.x;
    const y = this.y;
    const h = this.heading + this.bodyYaw;
    const alive = this.alive;

    this.sprite.setPosition(x, y).setRotation(h);
    this.shadow.setPosition(x + 5, y + 8).setRotation(h);
    this.glow.setPosition(x, y).setVisible(alive);
    // the underglow doubles as the drift-charge indicator
    const lvl = this.drifting ? this.driftLevel : 0;
    if (lvl > 0) {
      const pulse = 0.5 + 0.2 * Math.sin(this.world.time * 25);
      this.glow.setTint(DRIFT_LEVELS[lvl - 1].color).setAlpha(pulse).setScale(1.9 + lvl * 0.25);
    } else {
      this.glow.setTint(this.stats.color).setAlpha(0.22).setScale(1.6);
    }
    this.turret.setPosition(x - Math.cos(h) * 2, y - Math.sin(h) * 2).setRotation(this.aimAngle).setVisible(alive);
    const noseX = x + Math.cos(h) * 24;
    const noseY = y + Math.sin(h) * 24;
    this.headlight.setPosition(noseX, noseY).setRotation(h).setVisible(alive);

    // ghost flicker / hit flash
    if (this.ghostTime > 0 && alive) this.sprite.setAlpha(0.35 + 0.3 * Math.sin(this.world.time * 30));
    else this.sprite.setAlpha(1);
    if (this.hitFlash > 0 && alive) this.sprite.setTintFill(0xffffff);
    else if (this.empTime > 0 && alive) {
      this.sprite.clearTint();
      this.sprite.setTint(Math.sin(this.world.time * 40) > 0 ? 0x88c8ff : 0xffffff);
    } else this.sprite.clearTint();

    // shield bubble
    this.shield.setVisible(this.shieldTime > 0 && alive);
    if (this.shieldTime > 0) this.shield.setPosition(x, y).setAlpha(0.55 + 0.25 * Math.sin(this.world.time * 18)).setScale(0.52 + 0.03 * Math.sin(this.world.time * 9));

    // boost flame
    const showFlame = alive && this.boostPower > 0.05;
    this.flame.setVisible(showFlame);
    if (showFlame) {
      const rearX = x - Math.cos(h) * 25;
      const rearY = y - Math.sin(h) * 25;
      const flick = 0.8 + Math.random() * 0.4;
      this.flame.setPosition(rearX, rearY).setRotation(h).setScale((0.7 + 0.5 * this.boostPower) * flick, 1.1);
      this.flame.setTint(this.nitroTime > 0 ? 0xff7a2d : this.driftBoostTime > 0 ? this.driftBoostColor : 0x5fb8ff);
      this.trailAcc += dt;
      if (this.trailAcc > 0.03) {
        this.trailAcc = 0;
        this.world.effects.boostTrail(rearX, rearY, this.nitroTime > 0 ? 0xff7a2d : 0x5fb8ff);
      }
    }

    if (!alive) return;

    // tyre marks & smoke from rear wheels
    const cos = Math.cos(this.heading);
    const sin = Math.sin(this.heading);
    const vR = -this.vx * sin + this.vy * cos;
    const spd = this.speed;
    const sliding = this.drifting || (Math.abs(vR) > 110 && spd > 150) || (this.controls.throttle < 0 && this.forwardSpeed > 260);
    if (sliding) {
      this.skidAcc += spd * dt;
      if (this.skidAcc > 7) {
        this.skidAcc = 0;
        const rx = x - cos * 16;
        const ry = y - sin * 16;
        const ox = -sin * 10;
        const oy = cos * 10;
        const a = Math.atan2(this.vy, this.vx);
        this.world.effects.skid(rx + ox, ry + oy, a, this.drifting ? 0.42 : 0.3);
        this.world.effects.skid(rx - ox, ry - oy, a, this.drifting ? 0.42 : 0.3);
      }
      this.smokeAcc += dt;
      if (this.smokeAcc > (this.drifting ? 0.035 : 0.07)) {
        this.smokeAcc = 0;
        const lvl = this.driftLevel;
        const tint = this.drifting && lvl > 0 ? DRIFT_LEVELS[lvl - 1].color : 0xbfc3cc;
        this.world.effects.driftSmoke(x - cos * 20, y - sin * 20, tint, this.drifting && lvl > 0);
      }
    }
  }

  setAlive(alive: boolean): void {
    this.alive = alive;
    this.sprite.setTexture(alive ? `car_${this.stats.id}` : `car_${this.stats.id}_wreck`);
    if (!alive) {
      this.flame.setVisible(false);
      this.shield.setVisible(false);
    }
  }

  destroy(): void {
    this.sprite.destroy();
    this.shadow.destroy();
    this.turret.destroy();
    this.headlight.destroy();
    this.flame.destroy();
    this.shield.destroy();
    this.glow.destroy();
  }
}
