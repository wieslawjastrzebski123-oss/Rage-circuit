import { WEAPONS } from '../data/weapons';
import type { Car } from '../entities/Car';
import type { World } from '../systems/World';
import { Weapon } from './Weapon';

/** Three mini-missiles fanned out sideways; they curve back onto the locked target. */
export class SwarmLauncher extends Weapon {
  constructor() {
    super(WEAPONS.swarm);
  }

  protected fire(owner: Car, world: World): void {
    const st = this.stats;
    const n = st.count ?? 3;
    const a = owner.aimAngle;
    const m = this.muzzle(owner, 20);
    const target = world.combat.findTargetInCone(owner, a, 0.5, 1000);
    for (let i = 0; i < n; i++) {
      const off = ((i / (n - 1)) * 2 - 1) * st.spread;
      const p = world.combat.spawnProjectile('swarm', owner, m.x, m.y, a + off, st.projectileSpeed, st);
      if (p) p.target = target;
    }
    world.effects.muzzle(m.x, m.y, a, 0xffb040, 1.2);
    world.audio.shot('swarm', owner);
  }
}
