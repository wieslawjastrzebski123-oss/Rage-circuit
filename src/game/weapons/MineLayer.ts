import { WEAPONS } from '../data/weapons';
import type { Car } from '../entities/Car';
import type { World } from '../systems/World';
import { Weapon } from './Weapon';

export class MineLayer extends Weapon {
  constructor() {
    super(WEAPONS.mine);
  }

  protected fire(owner: Car, world: World): void {
    const c = Math.cos(owner.heading);
    const s = Math.sin(owner.heading);
    const x = owner.x - c * 34;
    const y = owner.y - s * 34;
    world.combat.dropMine(owner, x, y, owner.vx * 0.25, owner.vy * 0.25, this.stats);
    world.audio.shot('mine', owner);
  }
}
