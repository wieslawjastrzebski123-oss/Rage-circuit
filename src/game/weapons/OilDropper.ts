import { WEAPONS } from '../data/weapons';
import type { Car } from '../entities/Car';
import type { World } from '../systems/World';
import { Weapon } from './Weapon';

/** Leaves an oil slick behind the car (handled like a mine that never explodes). */
export class OilDropper extends Weapon {
  constructor() {
    super(WEAPONS.oil);
  }

  protected fire(owner: Car, world: World): void {
    const c = Math.cos(owner.heading);
    const s = Math.sin(owner.heading);
    world.combat.dropMine(owner, owner.x - c * 40, owner.y - s * 40, owner.vx * 0.15, owner.vy * 0.15, this.stats);
    world.audio.shot('oil', owner);
  }
}
