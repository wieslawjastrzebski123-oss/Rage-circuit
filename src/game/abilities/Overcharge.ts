import { ABILITIES } from '../data/cars';
import type { Car } from '../entities/Car';
import type { World } from '../systems/World';
import { Ability } from './Ability';

export const OVERCHARGE_TIME = 3;
/** primary weapon modifiers while overcharged */
export const OVERCHARGE_DAMAGE = 1.3;
export const OVERCHARGE_RATE = 0.6; // cooldown multiplier

/** Viper: a short, lethal burst window for hit-and-run attacks. */
export class Overcharge extends Ability {
  constructor() {
    super(ABILITIES.overcharge);
  }

  protected activate(owner: Car, world: World): boolean {
    owner.overchargeTime = OVERCHARGE_TIME;
    world.effects.shockwave(owner.x, owner.y, 70, 0xff7a2d, 250);
    world.audio.shield(owner);
    world.view(owner)?.hud?.flash('OVERCHARGE', '#ff7a2d', 900);
    return true;
  }
}
