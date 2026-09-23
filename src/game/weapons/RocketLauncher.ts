import { WEAPONS } from '../data/weapons';
import type { Car } from '../entities/Car';
import type { World } from '../systems/World';
import { Weapon } from './Weapon';

export class RocketLauncher extends Weapon {
  constructor() {
    super(WEAPONS.rocket);
  }

  protected fire(owner: Car, world: World): void {
    const st = this.stats;
    const a = owner.aimAngle;
    const m = this.muzzle(owner, 22);
    // lock onto the enemy closest to the aiming line
    const target = world.combat.findTargetInCone(owner, a, 0.35, 950);
    const p = world.combat.spawnProjectile('rocket', owner, m.x, m.y, a, st.projectileSpeed, st);
    if (p) p.target = target;
    world.effects.muzzle(m.x, m.y, a, 0xff6a2d, 1.1);
    world.audio.shot('rocket', owner);
  }
}
