import type { Car } from '../entities/Car';
import { Barrel } from '../entities/Barrel';
import type { TrackHit } from '../track/Track';
import type { ObstacleDef } from '../track/TrackData';
import { clamp, dist2, segmentCircleHit } from '../utils/math';
import type { World } from './World';

interface OBB {
  cx: number;
  cy: number;
  hw: number;
  hh: number;
  cos: number;
  sin: number;
}

const WALL_MARGIN = 4; // lets the car body touch the barrier line before it is pushed back
const WALL_BOUNCE = 0.3;
const WALL_DAMAGE_THRESHOLD = 380;
const RAM_DAMAGE_THRESHOLD = 260;

export class CollisionSystem {
  private world: World;
  readonly containers: OBB[] = [];
  readonly barrels: Barrel[] = [];
  private hit = {} as TrackHit;
  private cp = { x: 0, y: 0, nx: 0, ny: 0, d: 0 };

  constructor(world: World, obstacles: ObstacleDef[]) {
    this.world = world;
    for (const o of obstacles) {
      if (o.kind === 'container') {
        const a = o.angle ?? 0;
        this.containers.push({ cx: o.x, cy: o.y, hw: (o.w ?? 100) / 2, hh: (o.h ?? 40) / 2, cos: Math.cos(a), sin: Math.sin(a) });
      } else {
        this.barrels.push(new Barrel(world.gfx?.root ?? null, o.x, o.y, o.kind === 'explosive'));
      }
    }
  }

  step(dt: number): void {
    const cars = this.world.cars;
    for (const car of cars) {
      this.carVsWalls(car);
      for (const box of this.containers) this.circleVsBox(car, box, true);
    }
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) this.carVsCar(cars[i], cars[j]);
    }
    this.updateBarrels(dt);
  }

  /** Walls and containers only – used by the client to predict its own car. */
  resolveStatic(car: Car): void {
    this.carVsWalls(car);
    for (const box of this.containers) this.circleVsBox(car, box, true);
  }

  // ------------------------------------------------------------------ walls
  private carVsWalls(car: Car): void {
    // purely geometric: the road is the union of all pieces, so no progress hint here
    // (a stale hint once produced invisible walls at the shortcut exit)
    const h = this.world.track.query(car.x, car.y, undefined, this.hit);
    if (!h) return;
    const limit = h.seg.hw - car.radius + WALL_MARGIN;
    if (h.dist <= limit) return;
    const push = h.dist - limit;
    car.x -= h.nx * push;
    car.y -= h.ny * push;
    const vn = car.vx * h.nx + car.vy * h.ny;
    if (vn <= 0) return;
    // reflect the normal component, scrub some tangential speed
    car.vx -= h.nx * vn * (1 + WALL_BOUNCE);
    car.vy -= h.ny * vn * (1 + WALL_BOUNCE);
    const scrub = 1 - clamp(vn / 1400, 0, 0.45);
    car.vx *= scrub;
    car.vy *= scrub;
    // a glancing hit twists the car along the wall
    const tx = -h.ny;
    const ty = h.nx;
    const fx = Math.cos(car.heading);
    const fy = Math.sin(car.heading);
    const along = fx * tx + fy * ty;
    const into = fx * h.nx + fy * h.ny;
    car.angVel += clamp(into * Math.sign(along) * vn * 0.004, -2.5, 2.5);
    this.onCarImpact(car, vn, car.x + h.nx * car.radius, car.y + h.ny * car.radius, h.nx, h.ny);
  }

  private onCarImpact(car: Car, strength: number, px: number, py: number, nx: number, ny: number): void {
    car.onImpact(strength);
    const w = this.world;
    if (strength > 110) {
      w.effects.wallSparks(px, py, nx, ny, strength);
      if (strength > 170) w.audio.wallHit(car, strength);
    }
    if (strength > 200) w.view(car)?.effects.shake(Math.min(0.012, strength / 60000), 120);
    if (strength > WALL_DAMAGE_THRESHOLD) w.combat.applyDamage(car, (strength - WALL_DAMAGE_THRESHOLD) * 0.04, null, 'wall');
  }

  // ------------------------------------------------------------------ boxes
  private closestOnBox(x: number, y: number, b: OBB): typeof this.cp {
    const dx = x - b.cx;
    const dy = y - b.cy;
    const lx = dx * b.cos + dy * b.sin;
    const ly = -dx * b.sin + dy * b.cos;
    const inside = Math.abs(lx) < b.hw && Math.abs(ly) < b.hh;
    let qx = clamp(lx, -b.hw, b.hw);
    let qy = clamp(ly, -b.hh, b.hh);
    let nlx: number;
    let nly: number;
    let d: number;
    if (inside) {
      // push out along the axis of least penetration
      const px = b.hw - Math.abs(lx);
      const py = b.hh - Math.abs(ly);
      if (px < py) {
        qx = Math.sign(lx) * b.hw;
        nlx = Math.sign(lx) || 1;
        nly = 0;
        d = -px;
      } else {
        qy = Math.sign(ly) * b.hh;
        nlx = 0;
        nly = Math.sign(ly) || 1;
        d = -py;
      }
    } else {
      const ex = lx - qx;
      const ey = ly - qy;
      d = Math.hypot(ex, ey);
      nlx = ex / (d || 1);
      nly = ey / (d || 1);
    }
    this.cp.x = b.cx + qx * b.cos - qy * b.sin;
    this.cp.y = b.cy + qx * b.sin + qy * b.cos;
    this.cp.nx = nlx * b.cos - nly * b.sin;
    this.cp.ny = nlx * b.sin + nly * b.cos;
    this.cp.d = d;
    return this.cp;
  }

  private circleVsBox(obj: { x: number; y: number; vx: number; vy: number; radius: number }, b: OBB, isCar: boolean): void {
    if (dist2(obj.x, obj.y, b.cx, b.cy) > (b.hw + b.hh + obj.radius + 10) ** 2) return;
    const c = this.closestOnBox(obj.x, obj.y, b);
    if (c.d >= obj.radius) return;
    const push = obj.radius - c.d;
    obj.x += c.nx * push;
    obj.y += c.ny * push;
    const vn = -(obj.vx * c.nx + obj.vy * c.ny);
    if (vn <= 0) return;
    obj.vx += c.nx * vn * (1 + WALL_BOUNCE);
    obj.vy += c.ny * vn * (1 + WALL_BOUNCE);
    if (isCar) {
      const car = obj as Car;
      car.vx *= 0.85;
      car.vy *= 0.85;
      this.onCarImpact(car, vn, c.x, c.y, -c.nx, -c.ny);
    }
  }

  /** True if a circle at (x, y) would overlap a container or live barrel. */
  blockedByProp(x: number, y: number, r: number): boolean {
    for (const b of this.containers) if (this.closestOnBox(x, y, b).d < r) return true;
    for (const b of this.barrels) if (b.alive && dist2(x, y, b.x, b.y) < (r + b.radius) ** 2) return true;
    return false;
  }

  /** Checks a projectile path against props. Returns the barrel hit, 'box', or null. */
  projectileVsProps(x0: number, y0: number, x1: number, y1: number): Barrel | 'box' | null {
    for (const b of this.barrels) {
      if (b.alive && segmentCircleHit(x0, y0, x1, y1, b.x, b.y, b.radius + 2) >= 0) return b;
    }
    for (const b of this.containers) {
      if (dist2(x1, y1, b.cx, b.cy) > (b.hw + b.hh + 30) ** 2) continue;
      if (this.closestOnBox(x1, y1, b).d < 2) return 'box';
    }
    return null;
  }

  // ------------------------------------------------------------------ cars
  private carVsCar(a: Car, b: Car): void {
    if (a.isGhost || b.isGhost) return;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const rr = a.radius + b.radius + 2;
    const d2 = dx * dx + dy * dy;
    if (d2 >= rr * rr || d2 === 0) return;
    const d = Math.sqrt(d2);
    const nx = dx / d;
    const ny = dy / d;
    const overlap = rr - d;
    const ima = 1 / a.mass;
    const imb = 1 / b.mass;
    const sum = ima + imb;
    a.x -= nx * overlap * (ima / sum);
    a.y -= ny * overlap * (ima / sum);
    b.x += nx * overlap * (imb / sum);
    b.y += ny * overlap * (imb / sum);
    const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (rel >= 0) return;
    const e = 0.45;
    const j = (-(1 + e) * rel) / sum;
    a.vx -= (j * ima) * nx;
    a.vy -= (j * ima) * ny;
    b.vx += (j * imb) * nx;
    b.vy += (j * imb) * ny;
    // spin from off-centre hits
    a.angVel += (Math.random() - 0.5) * Math.min(2, -rel / 250) * ima;
    b.angVel += (Math.random() - 0.5) * Math.min(2, -rel / 250) * imb;

    const impact = -rel;
    const w = this.world;
    if (impact > 120) {
      const px = a.x + nx * a.radius;
      const py = a.y + ny * a.radius;
      w.effects.wallSparks(px, py, nx, ny, impact);
      w.audio.carHit(a.isPlayer ? a : b, impact);
      a.onImpact(impact * 0.7);
      b.onImpact(impact * 0.7);
      w.view(a)?.effects.shake(Math.min(0.012, impact / 50000), 130);
      w.view(b)?.effects.shake(Math.min(0.012, impact / 50000), 130);
    }
    if (impact > RAM_DAMAGE_THRESHOLD) {
      const base = (impact - RAM_DAMAGE_THRESHOLD) * 0.04;
      // heavier car deals more and takes less
      w.combat.applyDamage(a, base * Math.sqrt(b.mass / a.mass), b, 'ram');
      w.combat.applyDamage(b, base * Math.sqrt(a.mass / b.mass), a, 'ram');
    }
  }

  // ------------------------------------------------------------------ barrels
  private updateBarrels(dt: number): void {
    const w = this.world;
    for (const b of this.barrels) {
      if (!b.alive) {
        b.respawnTimer -= dt;
        if (b.respawnTimer <= 0 && !w.cars.some((c) => dist2(c.x, c.y, b.homeX, b.homeY) < 90 * 90)) {
          b.reset();
        }
        b.sync();
        continue;
      }
      if (b.fuse >= 0) {
        b.fuse -= dt;
        if (b.fuse < 0) {
          this.explodeBarrel(b);
          continue;
        }
      }
      const fr = Math.exp(-2.8 * dt);
      b.vx *= fr;
      b.vy *= fr;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.spin *= fr;
      b.rot += b.spin * dt;
      // keep inside the road
      const h = w.track.query(b.x, b.y, undefined, this.hit);
      if (h) {
        const limit = h.seg.hw - b.radius + 10;
        if (h.dist > limit) {
          b.x -= h.nx * (h.dist - limit);
          b.y -= h.ny * (h.dist - limit);
          const vn = b.vx * h.nx + b.vy * h.ny;
          if (vn > 0) {
            b.vx -= h.nx * vn * 1.4;
            b.vy -= h.ny * vn * 1.4;
          }
        }
      }
      for (const box of this.containers) this.circleVsBox(b, box, false);
      for (const car of w.cars) {
        if (car.isGhost) continue;
        const dx = b.x - car.x;
        const dy = b.y - car.y;
        const rr = b.radius + car.radius;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const ny = dy / d;
        b.x += nx * (rr - d) * 0.85;
        b.y += ny * (rr - d) * 0.85;
        car.x -= nx * (rr - d) * 0.15;
        car.y -= ny * (rr - d) * 0.15;
        const rel = (b.vx - car.vx) * nx + (b.vy - car.vy) * ny;
        if (rel >= 0) continue;
        const j = (-(1.5 * rel)) / (1 / b.mass + 1 / car.mass);
        b.vx += (j / b.mass) * nx;
        b.vy += (j / b.mass) * ny;
        car.vx -= (j / car.mass) * nx;
        car.vy -= (j / car.mass) * ny;
        b.spin += (Math.random() - 0.5) * 20;
        if (-rel > 120) w.audio.wallHit(b, -rel * 0.5);
        if (b.explosive && -rel > 260 && b.fuse < 0) {
          b.fuse = 0.12;
          b.lastToucher = car;
        }
      }
      b.sync();
    }
  }

  damageBarrel(b: Barrel, amount: number, source: Car | null, pushX: number, pushY: number): void {
    if (!b.alive) return;
    b.vx += pushX;
    b.vy += pushY;
    b.spin += (Math.random() - 0.5) * 10;
    if (!b.explosive) return;
    b.hp -= amount;
    if (b.hp <= 0 && b.fuse < 0) {
      b.fuse = 0.08;
      b.lastToucher = source;
    }
  }

  private explodeBarrel(b: Barrel): void {
    b.alive = false;
    b.fuse = -1;
    b.respawnTimer = 25;
    b.sync();
    this.world.combat.explode(b.x, b.y, 140, 32, b.lastToucher, null, 1.2);
  }
}
