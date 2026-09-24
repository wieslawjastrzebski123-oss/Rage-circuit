import { WEAPONS } from '../data/weapons';
import type { Car } from '../entities/Car';
import type { World } from '../systems/World';
import { Weapon } from './Weapon';

/** A cone of pellets: each one a short-lived bullet. */
export class Shotgun extends Weapon {
  constructor() {
    super(WEAPONS.shotgun);
  }

  protected fire(owner: Car, world: World): void {
    const st = this.stats;
    const n = st.count ?? 8;
    const m = this.muzzle(owner, 22);
    for (let i = 0; i < n; i++) {
      // evenly fanned with a little jitter, so the pattern is readable but not a perfect grid
      const a = owner.aimAngle + ((i / (n - 1)) * 2 - 1) * st.spread + (Math.random() - 0.5) * st.spread * 0.25;
      const speed = st.projectileSpeed * (0.9 + Math.random() * 0.2);
      world.combat.spawnProjectile('bullet', owner, m.x, m.y, a, speed, st, this.damageMul(owner));
    }
    world.effects.muzzle(m.x, m.y, owner.aimAngle, 0xffc070, 1.6);
    owner.vx -= Math.cos(owner.aimAngle) * 22;
    owner.vy -= Math.sin(owner.aimAngle) * 22;
    world.view(owner)?.effects.shake(0.005, 100);
    world.audio.shot('shotgun', owner);
  }
}
