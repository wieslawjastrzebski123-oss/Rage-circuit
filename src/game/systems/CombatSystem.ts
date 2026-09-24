import { RESPAWN_DELAY } from '../constants';
import type { WeaponStats } from '../data/weapons';
import type { Car } from '../entities/Car';
import { Mine, MINE_TRIGGER_RADIUS } from '../entities/Mine';
import { Projectile, type ProjectileKind } from '../entities/Projectile';
import { SHIELD_FACTOR } from '../abilities/Shield';
import { angleDiff, clamp, dist2, segmentCircleHit } from '../utils/math';
import type { World } from './World';

export type DamageKind = 'bullet' | 'shell' | 'explosion' | 'ram' | 'wall' | 'stomp';

const MAX_PROJECTILES = 220;
const MAX_MINES = 24;
const MINES_PER_OWNER = 4;
const ROCKET_TURN_RATE = 2.3; // rad/s – limited so hard turns can dodge
const ROCKET_MAX_SPEED = 860;
const KILL_BOOST_REWARD = 45;
const KILL_ENERGY_REWARD = 20;
const ASSIST_WINDOW = 4; // seconds a hit counts for kill credit
/** kills in a row without dying: name shown on screen (index = streak) */
const STREAK_NAMES = ['', '', 'DOUBLE KILL', 'TRIPLE KILL', 'RAMPAGE', 'UNSTOPPABLE'];
const STREAK_ENERGY_REWARD = 15;

/** Projectiles, mines, damage, explosions and kill rewards. */
export class CombatSystem {
  private world: World;
  private projectiles: Projectile[] = [];
  private mines: Mine[] = [];

  constructor(world: World) {
    this.world = world;
  }

  get activeProjectiles(): number {
    return this.projectiles.reduce((n, p) => n + (p.active ? 1 : 0), 0);
  }

  // ------------------------------------------------------------------ spawning
  spawnProjectile(kind: ProjectileKind, owner: Car, x: number, y: number, angle: number, speed: number, stats: WeaponStats, dmgMul = 1): Projectile | null {
    let p = this.projectiles.find((q) => !q.active);
    if (!p) {
      if (this.projectiles.length >= MAX_PROJECTILES) return null;
      p = new Projectile(this.world.gfx?.root ?? null);
      this.projectiles.push(p);
    }
    p.fire(kind, owner, x, y, angle, speed, stats, dmgMul);
    return p;
  }

  dropMine(owner: Car, x: number, y: number, vx: number, vy: number, stats: WeaponStats): void {
    // limit per owner: recycle the oldest
    const own = this.mines.filter((m) => m.active && m.owner === owner);
    if (own.length >= MINES_PER_OWNER) {
      own.sort((a, b) => b.age - a.age)[0].kill();
    }
    let m = this.mines.find((q) => !q.active);
    if (!m) {
      if (this.mines.length >= MAX_MINES) {
        m = this.mines.reduce((a, b) => (a.age > b.age ? a : b));
        m.kill();
      } else {
        m = new Mine(this.world.gfx?.root ?? null);
        this.mines.push(m);
      }
    }
    m.drop(owner, x, y, vx, vy, stats);
  }

  /** The enemy closest to the aiming line within a cone (rocket lock-on, crosshair). */
  findTargetInCone(owner: Car, angle: number, cone: number, range: number): Car | null {
    let best: Car | null = null;
    let bestScore = Infinity;
    for (const c of this.world.cars) {
      if (c === owner || !c.alive || c.isGhost) continue;
      const dx = c.x - owner.x;
      const dy = c.y - owner.y;
      const d = Math.hypot(dx, dy);
      if (d > range || d < 1) continue;
      const off = Math.abs(angleDiff(angle, Math.atan2(dy, dx)));
      if (off > cone) continue;
      const score = off * 600 + d * 0.3;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best;
  }

  /** Mines near a position (AI avoidance). */
  forEachArmedMine(cb: (m: Mine) => void): void {
    for (const m of this.mines) if (m.active && m.armed) cb(m);
  }

  // ------------------------------------------------------------------ update
  update(dt: number): void {
    const w = this.world;
    for (const p of this.projectiles) {
      if (!p.active) continue;
      p.age += dt;
      if (p.age >= p.ttl) {
        if (p.kind === 'rocket') this.rocketExplode(p);
        else p.kill();
        continue;
      }
      if (p.kind === 'rocket') this.steerRocket(p, dt);
      const x0 = p.x;
      const y0 = p.y;
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      // cars
      let hitCar: Car | null = null;
      let bestT = 2;
      const pad = p.kind === 'bullet' ? 3 : 6;
      for (const c of w.cars) {
        if (c === p.owner || !c.alive || c.ghostTime > 0) continue;
        const t = segmentCircleHit(x0, y0, p.x, p.y, c.x, c.y, c.radius + pad);
        if (t >= 0 && t < bestT) {
          bestT = t;
          hitCar = c;
        }
      }
      if (hitCar) {
        p.x = x0 + (p.x - x0) * bestT;
        p.y = y0 + (p.y - y0) * bestT;
        this.projectileHitCar(p, hitCar);
        continue;
      }
      // mines can be shot
      let mineHit = false;
      for (const m of this.mines) {
        if (!m.active || m.owner === p.owner) continue;
        if (segmentCircleHit(x0, y0, p.x, p.y, m.x, m.y, 14) >= 0) {
          this.detonateMine(m, p.owner);
          p.kind === 'rocket' ? this.rocketExplode(p) : p.kill();
          mineHit = true;
          break;
        }
      }
      if (mineHit) continue;
      // props
      const prop = w.collisions.projectileVsProps(x0, y0, p.x, p.y);
      if (prop) {
        if (prop !== 'box') {
          const k = p.stats.knockback * 0.8 + 60;
          const len = Math.hypot(p.vx, p.vy) || 1;
          w.collisions.damageBarrel(prop, p.stats.damage, p.owner, (p.vx / len) * k, (p.vy / len) * k);
        }
        if (p.kind === 'rocket') this.rocketExplode(p);
        else {
          w.effects.impact(p.x, p.y, Math.atan2(p.vy, p.vx), 0xffc860, p.kind === 'shell');
          p.kill();
        }
        continue;
      }
      // walls
      if (!w.track.isDrivable(p.x, p.y)) {
        if (p.kind === 'rocket') this.rocketExplode(p);
        else {
          w.effects.impact(p.x, p.y, Math.atan2(p.vy, p.vx), 0xffc860, p.kind === 'shell');
          p.kill();
        }
        continue;
      }
      if (p.kind === 'rocket') {
        p.trailAcc += dt;
        if (p.trailAcc > 0.02) {
          p.trailAcc = 0;
          w.effects.boostTrail(p.x - Math.cos(p.angle) * 12, p.y - Math.sin(p.angle) * 12, 0xff8040);
        }
      }
      p.sync();
    }

    for (const m of this.mines) {
      if (!m.active) continue;
      m.age += dt;
      if (m.age >= m.stats.ttl) {
        w.effects.impact(m.x, m.y, 0, 0xffb000, false);
        m.kill();
        continue;
      }
      const fr = Math.exp(-4 * dt);
      m.vx *= fr;
      m.vy *= fr;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      if (!w.track.isDrivable(m.x, m.y)) {
        m.x -= m.vx * dt;
        m.y -= m.vy * dt;
        m.vx = m.vy = 0;
      }
      if (m.armed) {
        for (const c of w.cars) {
          // a car in the air flies over it
          if (c === m.owner || !c.alive || c.ghostTime > 0 || c.z > 6) continue;
          if (dist2(c.x, c.y, m.x, m.y) < (MINE_TRIGGER_RADIUS + c.radius) ** 2) {
            this.detonateMine(m, m.owner);
            break;
          }
        }
      }
      if (m.active) m.sync(w.time);
    }
  }

  private steerRocket(p: Projectile, dt: number): void {
    p.speed = Math.min(ROCKET_MAX_SPEED, p.speed + 500 * dt);
    const t = p.target;
    if (t && t.alive && !t.isGhost) {
      const desired = Math.atan2(t.y - p.y, t.x - p.x);
      const diff = angleDiff(p.angle, desired);
      // lose lock if the target gets behind the rocket
      if (Math.abs(diff) > 1.9) p.target = null;
      else p.angle += clamp(diff, -ROCKET_TURN_RATE * dt, ROCKET_TURN_RATE * dt);
    }
    p.vx = Math.cos(p.angle) * p.speed;
    p.vy = Math.sin(p.angle) * p.speed;
  }

  private projectileHitCar(p: Projectile, c: Car): void {
    const w = this.world;
    const len = Math.hypot(p.vx, p.vy) || 1;
    const dirX = p.vx / len;
    const dirY = p.vy / len;
    if (p.kind === 'rocket') {
      this.rocketExplode(p, c);
      return;
    }
    const heavy = p.kind === 'shell';
    const k = p.stats.knockback / c.mass;
    c.vx += dirX * k;
    c.vy += dirY * k;
    if (heavy) c.angVel += (Math.random() - 0.5) * 2.5;
    this.applyDamage(c, p.stats.damage * p.dmgMul, p.owner, heavy ? 'shell' : 'bullet');
    w.effects.impact(p.x, p.y, Math.atan2(dirY, dirX), heavy ? 0xff9a40 : 0xfff0b0, heavy);
    w.audio.hit(c, heavy);
    if (heavy && (p.owner.isPlayer || c.isPlayer)) {
      w.effects.shake(0.006, 110);
      w.effects.freeze(35);
    }
    p.kill();
  }

  private rocketExplode(p: Projectile, direct?: Car): void {
    const st = p.stats;
    if (direct) this.applyDamage(direct, st.damage * 0.35, p.owner, 'explosion');
    this.explode(p.x, p.y, st.splash, direct ? st.damage * 0.65 : st.damage, p.owner, p.owner, 0.9, st.knockback);
    p.kill();
  }

  private detonateMine(m: Mine, credit: Car): void {
    const st = m.stats;
    m.kill();
    this.explode(m.x, m.y, st.splash, st.damage, credit, m.owner, 1.0, st.knockback);
  }

  /**
   * Area damage with falloff. `immune` (usually the shooter) takes no damage.
   */
  explode(x: number, y: number, radius: number, damage: number, source: Car | null, immune: Car | null, size = 1, knock = 320): void {
    const w = this.world;
    w.effects.explosion(x, y, size);
    w.effects.shakeAt(x, y, 0.012 * size, 260);
    w.audio.explosion({ x, y }, size);
    for (const c of w.cars) {
      if (c === immune || !c.alive) continue;
      const d = Math.hypot(c.x - x, c.y - y);
      if (d > radius + c.radius) continue;
      const f = 1 - 0.5 * clamp(d / radius, 0, 1);
      const nx = d > 1 ? (c.x - x) / d : Math.cos(c.heading);
      const ny = d > 1 ? (c.y - y) / d : Math.sin(c.heading);
      if (c.ghostTime <= 0) {
        c.vx += (nx * knock * f) / c.mass;
        c.vy += (ny * knock * f) / c.mass;
        c.angVel += (Math.random() - 0.5) * 4 * f;
      }
      this.applyDamage(c, damage * f, source, 'explosion');
    }
    // chain reactions
    for (const b of w.collisions.barrels) {
      if (!b.alive) continue;
      const d = Math.hypot(b.x - x, b.y - y);
      if (d > radius + b.radius || d < 1) continue;
      const f = 1 - d / (radius + b.radius);
      w.collisions.damageBarrel(b, 20 * f + 1, source, ((b.x - x) / d) * 500 * f, ((b.y - y) / d) * 500 * f);
    }
    for (const m of this.mines) {
      if (m.active && dist2(m.x, m.y, x, y) < (radius * 0.6) ** 2) this.detonateMine(m, source ?? m.owner);
    }
  }

  // ------------------------------------------------------------------ damage
  applyDamage(target: Car, amount: number, source: Car | null, kind: DamageKind): number {
    const w = this.world;
    if (!target.alive || target.ghostTime > 0 || !w.raceStarted || amount <= 0 || target.race.finished) return 0;
    if (target.shieldTime > 0) amount *= SHIELD_FACTOR;
    amount = Math.min(amount, target.hp);
    target.hp -= amount;
    target.combat.damageTaken += amount;
    target.hitFlash = 0.12;
    const killed = target.hp <= 0.01;
    if (source && source !== target) {
      source.combat.damageDealt += amount;
      target.lastHitBy = source;
      target.lastHitTime = w.time;
    }
    if (kind !== 'wall' && amount >= 1) {
      w.view(target)?.effects.damageNumber(target.x, target.y, amount, true);
      if (source && source !== target) {
        const sv = w.view(source);
        sv?.effects.damageNumber(target.x, target.y, amount, false);
        // hit confirmation for the shooter: a marker on the victim and a crisp tick
        sv?.effects.hitMarker(target, killed);
        sv?.audio.hitConfirm(killed);
      }
    }
    if (amount >= 3) w.view(target)?.hud?.damageFlash(Math.min(1, amount / 30));
    if (killed) this.kill(target, source);
    return amount;
  }

  private kill(target: Car, source: Car | null): void {
    const w = this.world;
    target.hp = 0;
    target.endDrift(false);
    target.setAlive(false);
    target.respawnTimer = RESPAWN_DELAY;
    target.combat.deaths++;
    target.combat.streak = 0;
    target.overchargeTime = target.shieldTime = target.empTime = 0;
    target.angVel = (Math.random() - 0.5) * 8;

    let killer = source && source !== target ? source : null;
    if (!killer && target.lastHitBy && w.time - target.lastHitTime < ASSIST_WINDOW) killer = target.lastHitBy;

    w.effects.explosion(target.x, target.y, 1.5);
    w.effects.shakeAt(target.x, target.y, 0.02, 380);
    w.audio.explosion(target, 1.5);
    const tv = w.view(target);
    const kv = killer ? w.view(killer) : null;
    tv?.effects.freeze(90);
    if (kv !== tv) kv?.effects.freeze(90);

    if (killer) {
      killer.combat.kills++;
      const streak = ++killer.combat.streak;
      killer.boostMeter = Math.min(100, killer.boostMeter + KILL_BOOST_REWARD);
      killer.energy = Math.min(killer.maxEnergy, killer.energy + KILL_ENERGY_REWARD);
      if (streak >= 2) {
        // kill streak: full boost tank and extra energy
        const name = STREAK_NAMES[Math.min(streak, STREAK_NAMES.length - 1)];
        killer.boostMeter = 100;
        killer.energy = Math.min(killer.maxEnergy, killer.energy + STREAK_ENERGY_REWARD * (streak - 1));
        kv?.hud?.announce(name, '#ff8a00', 2000);
        kv?.hud?.flash(`DESTROYED ${target.name} · BOOST FULL`, '#ffd23f', 1800);
        kv?.audio.streak(streak);
      } else {
        kv?.hud?.announce(`DESTROYED ${target.name}`, '#ffd23f');
        kv?.audio.kill();
      }
    }
    tv?.hud?.announce(killer ? `WRECKED BY ${killer.name}` : 'WRECKED', '#ff5a5a');
    // everyone sees the kill feed; each HUD shows its own name as YOU
    w.hud?.feed(killer ? `${killer.name} ✖ ${target.name}` : `${target.name} crashed`);
    if (killer && killer.combat.streak >= 2) w.hud?.feed(`${killer.name} · ${STREAK_NAMES[Math.min(killer.combat.streak, STREAK_NAMES.length - 1)]}`);
  }

  // ------------------------------------------------------------------ network
  /** [kind(0 bullet, 1 shell, 2 rocket), x, y, vx, vy] for every live projectile */
  snapshotProjectiles(): number[][] {
    const kinds = { bullet: 0, shell: 1, rocket: 2 } as const;
    const out: number[][] = [];
    for (const p of this.projectiles) {
      if (p.active) out.push([kinds[p.kind], Math.round(p.x), Math.round(p.y), Math.round(p.vx), Math.round(p.vy)]);
    }
    return out;
  }

  /** [x, y, age, armed, ownerCarId] for every live mine */
  snapshotMines(): number[][] {
    const out: number[][] = [];
    for (const m of this.mines) {
      if (m.active) out.push([Math.round(m.x), Math.round(m.y), Math.round(m.age * 100) / 100, m.armed ? 1 : 0, m.owner.id]);
    }
    return out;
  }

  clear(): void {
    for (const p of this.projectiles) p.kill();
    for (const m of this.mines) m.kill();
  }
}
