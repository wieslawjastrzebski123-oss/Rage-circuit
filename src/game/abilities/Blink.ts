import { ABILITIES } from '../data/cars';
import type { Car } from '../entities/Car';
import type { World } from '../systems/World';
import { Ability } from './Ability';

export const BLINK_DISTANCE = 270;
const STEP = 10;

export class Blink extends Ability {
  constructor() {
    super(ABILITIES.blink);
  }

  /** How far the car can blink along its travel direction without clipping walls/obstacles. */
  static reach(owner: Car, world: World): { dist: number; dx: number; dy: number } {
    let dx = Math.cos(owner.heading);
    let dy = Math.sin(owner.heading);
    const spd = owner.speed;
    if (spd > 120 && owner.forwardSpeed > 0) {
      dx = owner.vx / spd;
      dy = owner.vy / spd;
    }
    const r = owner.radius;
    let ok = 0;
    for (let d = STEP; d <= BLINK_DISTANCE; d += STEP) {
      const x = owner.x + dx * d;
      const y = owner.y + dy * d;
      // the whole car footprint must stay on the road
      if (
        !world.track.isDrivable(x, y) ||
        !world.track.isDrivable(x - dy * r, y + dx * r) ||
        !world.track.isDrivable(x + dy * r, y - dx * r) ||
        !world.track.isDrivable(x + dx * r, y + dy * r) ||
        world.collisions.blockedByProp(x, y, r)
      ) {
        break;
      }
      ok = d;
    }
    return { dist: ok, dx, dy };
  }

  protected activate(owner: Car, world: World): boolean {
    const { dist, dx, dy } = Blink.reach(owner, world);
    if (dist < 60) {
      world.view(owner)?.hud?.flash('BLINK BLOCKED', '#ff5a5a', 600);
      return false;
    }
    const fromX = owner.x;
    const fromY = owner.y;
    owner.x += dx * dist;
    owner.y += dy * dist;
    // small exit burst so the dash feels like a dash
    owner.vx += dx * 80;
    owner.vy += dy * 80;
    world.effects.blink(fromX, fromY, owner.x, owner.y, owner.heading);
    world.audio.blink(owner);
    return true;
  }
}
