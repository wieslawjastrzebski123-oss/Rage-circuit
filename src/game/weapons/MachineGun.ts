import { WEAPONS } from '../data/weapons';
import type { Car } from '../entities/Car';
import type { World } from '../systems/World';
import { Weapon } from './Weapon';

export class MachineGun extends Weapon {
  private alt = false;

  constructor() {
    super(WEAPONS.machinegun);
  }

  protected fire(owner: Car, world: World): void {
    const st = this.stats;
    const a = owner.aimAngle + (Math.random() - 0.5) * 2 * st.spread;
    // alternate between two barrels
    this.alt = !this.alt;
    const side = this.alt ? 4 : -4;
    const m = this.muzzle(owner, 20);
    const x = m.x - Math.sin(a) * side;
    const y = m.y + Math.cos(a) * side;
    world.combat.spawnProjectile('bullet', owner, x, y, a, st.projectileSpeed, st);
    world.effects.muzzle(x, y, a, 0xffe08a, 0.6);
    world.audio.shot('mg', owner);
  }
}
