import { ABILITIES } from '../data/cars';
import type { Car } from '../entities/Car';
import type { World } from '../systems/World';
import { Ability } from './Ability';

export const NITRO_TIME = 1.4;

export class Nitro extends Ability {
  constructor() {
    super(ABILITIES.nitro);
  }

  protected activate(owner: Car, world: World): boolean {
    owner.nitroTime = NITRO_TIME;
    const c = Math.cos(owner.heading);
    const s = Math.sin(owner.heading);
    owner.vx += c * 120;
    owner.vy += s * 120;
    world.effects.shockwave(owner.x - c * 20, owner.y - s * 20, 90, 0xff7a2d);
    world.audio.boost(1.2, owner);
    if (owner.isPlayer) world.effects.shake(0.004, 160);
    return true;
  }
}
