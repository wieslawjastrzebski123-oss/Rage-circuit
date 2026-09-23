import { ABILITIES } from '../data/cars';
import type { Car } from '../entities/Car';
import type { World } from '../systems/World';
import { Ability } from './Ability';

export const SHIELD_TIME = 2.2;
/** fraction of damage that still gets through */
export const SHIELD_FACTOR = 0.2;

export class Shield extends Ability {
  constructor() {
    super(ABILITIES.shield);
  }

  protected activate(owner: Car, world: World): boolean {
    owner.shieldTime = SHIELD_TIME;
    world.effects.shockwave(owner.x, owner.y, 70, 0x7dff4a);
    world.audio.shield(owner);
    return true;
  }
}
