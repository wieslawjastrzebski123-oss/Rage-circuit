import { WEAPONS } from '../data/weapons';
import type { Car } from '../entities/Car';
import type { World } from '../systems/World';
import { Weapon } from './Weapon';

export class Cannon extends Weapon {
  constructor() {
    super(WEAPONS.cannon);
  }

  protected fire(owner: Car, world: World): void {
    const st = this.stats;
    const a = owner.aimAngle + (Math.random() - 0.5) * 2 * st.spread;
    const m = this.muzzle(owner, 24);
    world.combat.spawnProjectile('shell', owner, m.x, m.y, a, st.projectileSpeed, st, this.damageMul(owner));
    world.effects.muzzle(m.x, m.y, a, 0xffa040, 1.4);
    // recoil
    owner.vx -= Math.cos(a) * 30;
    owner.vy -= Math.sin(a) * 30;
    if (owner.isPlayer) world.effects.shake(0.004, 90);
    world.audio.shot('cannon', owner);
  }
}
