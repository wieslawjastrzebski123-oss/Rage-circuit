import type { Car } from '../entities/Car';
import type { Route } from '../track/Track';
import { angleDiff, clamp, damp, rand } from '../utils/math';
import type { World } from '../systems/World';
import type { Personality } from './Personality';

const SEARCH_BACK = 4;
const SEARCH_AHEAD = 30;

/**
 * Drives a car along a pre-computed racing line:
 * look-ahead steering, speed limits from curvature, drifting,
 * boost on straights, overtaking offsets and stuck recovery.
 */
export class RacingAI {
  readonly car: Car;
  readonly world: World;
  readonly personality: Personality;
  route: Route;
  idx = 0;
  /** lateral offset from the racing line (px, + = left) */
  offset = 0;
  private desiredOffset = 0;
  private reverseTimer = 0;
  private stuckTimer = 0;
  private longStuck = 0;
  private wantDrift = false;
  private noise = 0;
  private noiseTarget = 0;
  private noiseTimer = 0;
  private lastLapSeen = -1;
  /** the target point (for debug drawing) */
  targetX = 0;
  targetY = 0;
  /** callback for resets (set by the owner) */
  requestReset: (() => void) | null = null;

  constructor(car: Car, world: World, personality: Personality) {
    this.car = car;
    this.world = world;
    this.personality = personality;
    this.route = world.track.routes.main;
    this.idx = this.nearestIndex(0, this.route.points.length);
  }

  private nearestIndex(from: number, count: number): number {
    const pts = this.route.points;
    const n = pts.length;
    let best = this.idx;
    let bd = Infinity;
    for (let k = 0; k < count; k++) {
      const i = (((from + k) % n) + n) % n;
      const d = (pts[i].x - this.car.x) ** 2 + (pts[i].y - this.car.y) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  private chooseRoute(): void {
    const routes = this.world.track.routes;
    const next = Math.random() < this.personality.shortcutChance ? routes.shortcut : routes.main;
    if (next !== this.route) {
      this.route = next;
      this.idx = this.nearestIndex(0, next.points.length);
    }
  }

  update(dt: number): void {
    const car = this.car;
    const c = car.controls;
    const pts = this.route.points;
    const n = pts.length;

    // pick a route once per lap while on the start straight (both routes share it)
    const lap = car.race.lapsDone;
    if (lap !== this.lastLapSeen && car.race.progress > lap * this.world.track.length + 50) {
      this.lastLapSeen = lap;
      this.chooseRoute();
    }

    // track position on route
    this.idx = this.nearestIndex(this.idx - SEARCH_BACK, SEARCH_BACK + SEARCH_AHEAD);
    const spd = car.speed;

    // steering wobble (bots aren't perfect)
    this.noiseTimer -= dt;
    if (this.noiseTimer <= 0) {
      this.noiseTimer = rand(0.4, 1.2);
      this.noiseTarget = rand(-1, 1) * (1 - this.personality.pace) * 180;
    }
    this.noise = damp(this.noise, this.noiseTarget, 2, dt);

    // look-ahead target
    const look = 80 + spd * 0.34;
    let acc = 0;
    let j = this.idx;
    while (acc < look) {
      const a = pts[j];
      const b = pts[(j + 1) % n];
      acc += Math.hypot(b.x - a.x, b.y - a.y);
      j = (j + 1) % n;
    }
    this.updateOffset(dt, j);
    const tp = pts[j];
    const tn = pts[(j + 1) % n];
    const tl = Math.hypot(tn.x - tp.x, tn.y - tp.y) || 1;
    const nx = (tn.y - tp.y) / tl;
    const ny = -(tn.x - tp.x) / tl;
    const off = this.offset + this.personality.lineBias + this.noise * 0.3;
    this.targetX = tp.x + nx * off;
    this.targetY = tp.y + ny * off;

    const desired = Math.atan2(this.targetY - car.y, this.targetX - car.x);
    const diff = angleDiff(car.heading, desired);

    // speed target from upcoming route limits
    let limit = Infinity;
    const brakeLook = Math.ceil(4 + spd / 70);
    for (let k = 1; k <= brakeLook; k++) limit = Math.min(limit, this.route.speed[(this.idx + k) % n]);
    const grip = clamp(car.stats.handling / 3.1, 0.88, 1.08);
    let target = limit * this.personality.pace * grip;
    // big heading error → slow down to make the turn
    if (Math.abs(diff) > 0.7) target = Math.min(target, 260);

    // ---------------- stuck recovery
    if (this.reverseTimer > 0) {
      this.reverseTimer -= dt;
      c.throttle = -1;
      c.steer = -Math.sign(diff) || 1;
      c.drift = false;
      c.boost = false;
      return;
    }
    if (this.world.raceStarted && car.frozenTime <= 0 && spd < 40 && car.alive) {
      this.stuckTimer += dt;
      this.longStuck += dt;
    } else {
      this.stuckTimer = 0;
      this.longStuck = Math.max(0, this.longStuck - dt);
    }
    if (this.stuckTimer > 0.9) {
      this.stuckTimer = 0;
      this.reverseTimer = 0.8;
    }
    if (this.longStuck > 5 || car.race.wrongWayTime > 5) {
      this.longStuck = 0;
      this.requestReset?.();
    }

    // ---------------- throttle
    if (spd > target + 90) c.throttle = -1;
    else if (spd > target + 25) c.throttle = 0;
    else c.throttle = 1;
    if (car.forwardSpeed < 0 && Math.abs(diff) < 1.2) c.throttle = 1;

    // ---------------- steering & drift
    let steer = clamp(diff * 2.6, -1, 1);
    const sharp = limit < car.stats.maxSpeed * 0.9;
    if (!car.drifting) {
      this.wantDrift = false;
      if (sharp && spd > 330 && Math.abs(diff) > 0.3 && Math.random() < this.personality.driftChance * dt * 6) {
        this.wantDrift = true;
      }
    } else {
      // release on the exit, or bail out if the corner changes direction
      const exit = Math.abs(diff) < 0.1 && car.driftTime > 0.55;
      const flip = Math.sign(diff) !== car.driftDir && Math.abs(diff) > 0.2;
      const tooLong = car.driftTime > 2.3 + this.personality.pace;
      if (exit || flip || tooLong) this.wantDrift = false;
      else this.wantDrift = true;
      steer = clamp(diff * 3.5, -1, 1);
    }
    c.steer = steer;
    c.drift = this.wantDrift;

    // ---------------- boost on straights
    let straight = true;
    for (let k = 1; k <= 14; k++) {
      if (this.route.speed[(this.idx + k) % n] < car.stats.maxSpeed * 1.15) {
        straight = false;
        break;
      }
    }
    c.boost = straight && Math.abs(diff) < 0.15 && car.boostMeter > (car.boosting ? 5 : 40);
  }

  /** Overtaking & obstacle avoidance: adjust the lateral offset. */
  private updateOffset(dt: number, targetIdx: number): void {
    const car = this.car;
    const w = this.world;
    const pts = this.route.points;
    const n = pts.length;
    const p = pts[this.idx];
    const q = pts[(this.idx + 1) % n];
    const l = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    const tx = (q.x - p.x) / l;
    const ty = (q.y - p.y) / l;
    const nx = ty;
    const ny = -tx;
    const room = Math.max(0, this.route.room[targetIdx] * 0.6 - 20);
    let want = 0;
    let urgent = false;

    const avoid = (ox: number, oy: number, radius: number, range: number) => {
      const dx = ox - car.x;
      const dy = oy - car.y;
      const ahead = dx * tx + dy * ty;
      if (ahead < 0 || ahead > range) return;
      const lat = dx * nx + dy * ny - this.offset;
      const clearance = radius + car.radius + 12;
      if (Math.abs(lat) > clearance) return;
      // steer to the side with more space
      const side = lat > 0 ? -1 : 1;
      const cand = this.offset + side * (clearance - Math.abs(lat) + 10);
      if (Math.abs(cand) <= room) want = cand;
      else want = this.offset - side * (clearance + Math.abs(lat));
      urgent = true;
    };

    for (const o of w.cars) {
      if (o === car || !o.alive || o.isGhost) continue;
      const rel = (o.vx - car.vx) * tx + (o.vy - car.vy) * ty;
      if (rel < -30 || Math.hypot(o.x - car.x, o.y - car.y) < 60) avoid(o.x, o.y, o.radius, 190);
    }
    for (const b of w.collisions.barrels) if (b.alive) avoid(b.x, b.y, b.radius, 230);
    for (const box of w.collisions.containers) avoid(box.cx, box.cy, Math.max(box.hw, box.hh), 320);
    w.combat.forEachArmedMine((m) => {
      if (m.owner !== car) avoid(m.x, m.y, 50, 220);
    });

    if (urgent) this.desiredOffset = clamp(want, -room, room);
    else this.desiredOffset = damp(this.desiredOffset, 0, 0.8, dt);
    this.offset = damp(this.offset, this.desiredOffset, urgent ? 4 : 1.5, dt);
  }
}
