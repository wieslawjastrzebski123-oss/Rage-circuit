import { WEAPONS } from '../data/weapons';
import type { Car } from '../entities/Car';
import type { World } from '../systems/World';
import { Weapon } from './Weapon';

/** One very fast slug that passes through every car on its line (walls stop it). */
export class Railgun extends Weapon {
  constructor() {
    super(WEAPONS.railgun);
  }

  protected fire(owner: Car, world: World): void {
    const st = this.stats;
    const a = owner.aimAngle;
    const m = this.muzzle(owner, 24);
    world.combat.spawnProjectile('rail', owner, m.x, m.y, a, st.projectileSpeed, st, this.damageMul(owner));
    world.effects.muzzle(m.x, m.y, a, 0x60e8ff, 1.8);
    owner.vx -= Math.cos(a) * 45;
    owner.vy -= Math.sin(a) * 45;
    world.view(owner)?.effects.shake(0.006, 120);
    world.audio.shot('rail', owner);
  }
}
