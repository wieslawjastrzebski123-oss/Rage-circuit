import { GHOST_TIME, RESET_PENALTY } from '../constants';
import type { Car } from '../entities/Car';
import type { RaceManager } from './RaceManager';
import type { World } from './World';

const STUCK_HINT_TIME = 2.2;
const STUCK_AUTO_RESET = 6;

/** Brings wrecked cars back and handles manual / automatic resets. */
export class RespawnSystem {
  private world: World;
  private race: RaceManager;
  private resetCooldown = new Map<Car, number>();
  private hintShown = new Set<Car>();

  constructor(world: World, race: RaceManager) {
    this.world = world;
    this.race = race;
  }

  update(dt: number): void {
    const w = this.world;
    for (const car of w.cars) {
      const cd = this.resetCooldown.get(car) ?? 0;
      if (cd > 0) this.resetCooldown.set(car, cd - dt);

      if (!car.alive) {
        car.respawnTimer -= dt;
        w.view(car)?.hud?.setRespawn(Math.max(0, car.respawnTimer));
        if (car.respawnTimer <= 0) this.respawn(car);
        continue;
      }
      if (!w.raceStarted || car.race.finished) {
        car.stuckTime = 0;
        continue;
      }
      if (car.controls.reset && car.frozenTime <= 0 && cd <= 0) {
        this.reset(car);
        continue;
      }
      const v = w.view(car);
      if (v) {
        const trying = Math.abs(car.controls.throttle) > 0.1;
        if (trying && car.speed < 35 && car.frozenTime <= 0) car.stuckTime += dt;
        else car.stuckTime = Math.max(0, car.stuckTime - dt * 2);
        const hint = car.stuckTime > STUCK_HINT_TIME || car.race.wrongWayTime > 4;
        if (hint !== this.hintShown.has(car)) {
          if (hint) this.hintShown.add(car);
          else this.hintShown.delete(car);
          v.hud?.setHint(hint ? 'STUCK? PRESS  R  TO RESET (2s penalty)' : null);
        }
        if (car.stuckTime > STUCK_AUTO_RESET) this.reset(car);
      }
    }
  }

  private place(car: Car): void {
    const pt = this.race.checkpoints.placeAtCheckpoint(car);
    // choose the lateral slot furthest from other cars
    let best = 0;
    let bestScore = -Infinity;
    for (const f of [0, -0.45, 0.45]) {
      const lat = f * pt.hw;
      const x = pt.x - Math.sin(pt.angle) * lat;
      const y = pt.y + Math.cos(pt.angle) * lat;
      let score = 0;
      for (const o of this.world.cars) {
        if (o === car || !o.alive) continue;
        score = Math.min(score, Math.hypot(o.x - x, o.y - y) - 200);
      }
      if (score > bestScore) {
        bestScore = score;
        best = lat;
      }
    }
    const x = pt.x - Math.sin(pt.angle) * best;
    const y = pt.y + Math.cos(pt.angle) * best;
    car.setPose(x, y, pt.angle);
    car.stuckTime = 0;
    car.race.wrongWayTime = 0;
  }

  respawn(car: Car): void {
    this.place(car);
    car.hp = car.maxHp;
    car.energy = Math.max(car.energy, car.maxEnergy * 0.5);
    car.setAlive(true);
    car.ghostTime = GHOST_TIME;
    this.world.effects.shockwave(car.x, car.y, 70, 0xffffff, 300);
    this.world.view(car)?.hud?.setRespawn(null);
  }

  /** Manual/automatic reset: back to the last checkpoint and held for a short penalty. */
  reset(car: Car): void {
    this.place(car);
    car.frozenTime = RESET_PENALTY;
    car.ghostTime = RESET_PENALTY + GHOST_TIME;
    this.resetCooldown.set(car, RESET_PENALTY + 1);
    this.world.effects.shockwave(car.x, car.y, 60, 0xffd23f, 300);
    const v = this.world.view(car);
    if (v) {
      this.hintShown.delete(car);
      v.hud?.setHint(null);
      v.hud?.announce('RESET  +2s', '#ffd23f');
    }
  }
}
