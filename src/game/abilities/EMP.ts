import { ABILITIES } from '../data/cars';
import type { Car } from '../entities/Car';
import type { World } from '../systems/World';
import { Ability } from './Ability';

export const EMP_RADIUS = 290;
export const EMP_TIME = 1.35;

export class EMP extends Ability {
  constructor() {
    super(ABILITIES.emp);
  }

  protected activate(owner: Car, world: World): boolean {
    world.effects.shockwave(owner.x, owner.y, EMP_RADIUS, 0x00e5ff, 380);
    world.effects.empBurst(owner.x, owner.y);
    world.audio.emp(owner);
    let hits = 0;
    for (const c of world.cars) {
      if (c === owner || !c.alive || c.isGhost) continue;
      const d = Math.hypot(c.x - owner.x, c.y - owner.y);
      if (d > EMP_RADIUS + c.radius) continue;
      c.empTime = EMP_TIME;
      c.boosting = false;
      if (c.drifting) c.endDrift(false);
      world.effects.empHit(c.x, c.y);
      hits++;
      if (c.isPlayer) world.hud?.flash('EMP – SYSTEMS JAMMED', '#00e5ff', 1100);
    }
    if (owner.isPlayer) {
      world.effects.shake(0.005, 150);
      if (hits > 0) world.hud?.flash(`EMP HIT ×${hits}`, '#00e5ff', 800);
    }
    return true;
  }
}
