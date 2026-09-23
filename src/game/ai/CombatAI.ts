import { Blink } from '../abilities/Blink';
import { EMP_RADIUS } from '../abilities/EMP';
import type { Car } from '../entities/Car';
import type { World } from '../systems/World';
import { angleDiff, damp, rand } from '../utils/math';
import type { Personality } from './Personality';
import type { RacingAI } from './RacingAI';

const RETARGET = 0.35;

/** Picks targets, aims (imperfectly), fires weapons and uses the car's ability. */
export class CombatAI {
  private car: Car;
  private world: World;
  private racing: RacingAI;
  private p: Personality;
  target: Car | null = null;
  private retarget = 0;
  private burst = 0;
  private pause = 0;
  private aimWobble = 0;
  private aimWobbleTarget = 0;
  private wobbleTimer = 0;
  private secondaryDelay = rand(1, 3);
  private abilityDelay = rand(2, 5);
  private lastHp: number;
  private recentDamage = 0;

  constructor(car: Car, world: World, racing: RacingAI, p: Personality) {
    this.car = car;
    this.world = world;
    this.racing = racing;
    this.p = p;
    this.lastHp = car.hp;
  }

  private lineOfSight(x0: number, y0: number, x1: number, y1: number): boolean {
    const d = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.ceil(d / 40);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (!this.world.track.isDrivable(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false;
    }
    return true;
  }

  private pickTarget(): void {
    const car = this.car;
    const range = 460 + this.p.aggression * 220;
    let best: Car | null = null;
    let bestScore = Infinity;
    for (const o of this.world.cars) {
      if (o === car || !o.alive || o.isGhost || o.race.finished) continue;
      const d = Math.hypot(o.x - car.x, o.y - car.y);
      if (d > range) continue;
      if (!this.lineOfSight(car.x, car.y, o.x, o.y)) continue;
      // racers mostly shoot what is in front of them
      const ahead = (o.x - car.x) * Math.cos(car.heading) + (o.y - car.y) * Math.sin(car.heading) > 0;
      let score = d;
      if (!ahead) score *= 1.6 - this.p.aggression * 0.5;
      // bots fight each other too – the player isn't everyone's only target
      if (o.isPlayer) score *= 1.15;
      if (score < bestScore) {
        bestScore = score;
        best = o;
      }
    }
    this.target = best;
  }

  update(dt: number): void {
    const car = this.car;
    const c = car.controls;
    c.firePrimary = false;
    c.fireSecondary = false;
    c.ability = false;
    c.reset = false;
    if (!car.alive || car.race.finished || !this.world.raceStarted) {
      c.aimX = car.x + Math.cos(car.heading) * 100;
      c.aimY = car.y + Math.sin(car.heading) * 100;
      return;
    }

    if (car.hp < this.lastHp) this.recentDamage = 0.8;
    this.lastHp = car.hp;
    this.recentDamage = Math.max(0, this.recentDamage - dt);

    this.retarget -= dt;
    if (this.retarget <= 0) {
      this.retarget = RETARGET;
      this.pickTarget();
    }

    // imperfect aim: slowly wandering error
    this.wobbleTimer -= dt;
    if (this.wobbleTimer <= 0) {
      this.wobbleTimer = rand(0.25, 0.7);
      this.aimWobbleTarget = rand(-1, 1) * this.p.aimError;
    }
    this.aimWobble = damp(this.aimWobble, this.aimWobbleTarget, 5, dt);

    const t = this.target;
    if (!t) {
      c.aimX = car.x + Math.cos(car.heading) * 200;
      c.aimY = car.y + Math.sin(car.heading) * 200;
    } else {
      const d = Math.hypot(t.x - car.x, t.y - car.y);
      const speed = car.primary.stats.projectileSpeed;
      const lead = (d / speed) * 0.8;
      const px = t.x + (t.vx - car.vx * 0.6) * lead;
      const py = t.y + (t.vy - car.vy * 0.6) * lead;
      const a = Math.atan2(py - car.y, px - car.x) + this.aimWobble;
      c.aimX = car.x + Math.cos(a) * d;
      c.aimY = car.y + Math.sin(a) * d;

      // primary in bursts
      const reserve = this.p.energyReserve;
      if (this.pause > 0) this.pause -= dt;
      else if (car.energy > reserve) {
        c.firePrimary = true;
        this.burst += dt;
        if (this.burst > rand(0.35, 0.9) * (0.5 + this.p.aggression)) {
          this.burst = 0;
          this.pause = rand(0.6, 1.6) * (1.8 - this.p.aggression);
        }
      }

      // secondary
      this.secondaryDelay -= dt;
      if (this.secondaryDelay <= 0 && car.secondary.canFire(car) && car.energy > reserve * 0.6 + car.secondary.stats.energyCost) {
        const facing = Math.abs(angleDiff(car.heading, Math.atan2(t.y - car.y, t.x - car.x)));
        if (car.secondary.stats.id === 'rocket' && d < 560 && facing < 1.1) {
          c.fireSecondary = true;
          this.secondaryDelay = rand(1.5, 4) / (0.5 + this.p.aggression);
        }
      }
    }

    // mines: drop when someone is right behind
    if (car.secondary.stats.id === 'mine' && this.secondaryDelay <= 0 && car.secondary.canFire(car)) {
      for (const o of this.world.cars) {
        if (o === car || !o.alive) continue;
        const dx = o.x - car.x;
        const dy = o.y - car.y;
        const behind = dx * Math.cos(car.heading) + dy * Math.sin(car.heading) < -30;
        if (behind && dx * dx + dy * dy < 320 * 320) {
          c.fireSecondary = true;
          this.secondaryDelay = rand(1.2, 3.5);
          break;
        }
      }
    }

    this.useAbility(dt);
  }

  private useAbility(dt: number): void {
    const car = this.car;
    const c = car.controls;
    this.abilityDelay -= dt;
    if (this.abilityDelay > 0 || !car.ability.isReady(car)) return;
    const route = this.racing.route;
    const n = route.speed.length;
    let straight = true;
    for (let k = 1; k <= 10; k++) if (route.speed[(this.racing.idx + k) % n] < car.stats.maxSpeed * 1.1) straight = false;

    let use = false;
    switch (car.stats.ability) {
      case 'overcharge': {
        const t = this.target;
        use = !!t && Math.hypot(t.x - car.x, t.y - car.y) < 420 && car.primary.cooldownLeft < 0.2;
        break;
      }
      case 'shield':
        use = car.hp < car.maxHp * 0.75 && this.recentDamage > 0;
        break;
      case 'blink':
        use = straight && car.speed > 320 && Blink.reach(car, this.world).dist > 220;
        break;
      case 'emp': {
        let near = 0;
        for (const o of this.world.cars) {
          if (o !== car && o.alive && !o.isGhost && Math.hypot(o.x - car.x, o.y - car.y) < EMP_RADIUS * 0.85) near++;
        }
        use = near >= 1 && Math.random() < 0.4 + this.p.aggression * 0.5;
        break;
      }
    }
    if (use) {
      c.ability = true;
      this.abilityDelay = rand(1.5, 4);
    } else this.abilityDelay = 0.3;
  }
}
