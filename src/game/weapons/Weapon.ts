import type { WeaponStats } from '../data/weapons';
import type { Car } from '../entities/Car';
import type { World } from '../systems/World';

/** Base class: handles cooldown + energy; subclasses spawn the actual projectiles. */
export abstract class Weapon {
  readonly stats: WeaponStats;
  cooldownLeft = 0;

  constructor(stats: WeaponStats) {
    this.stats = stats;
  }

  get name(): string {
    return this.stats.name;
  }

  /** 0 = ready, 1 = just fired */
  get cooldownRatio(): number {
    return this.stats.cooldown > 0 ? this.cooldownLeft / this.stats.cooldown : 0;
  }

  update(dt: number): void {
    if (this.cooldownLeft > 0) this.cooldownLeft = Math.max(0, this.cooldownLeft - dt);
  }

  canFire(owner: Car): boolean {
    return this.cooldownLeft <= 0 && owner.energy >= this.stats.energyCost && owner.canAct;
  }

  tryFire(owner: Car, world: World): boolean {
    if (!this.canFire(owner)) return false;
    owner.energy -= this.stats.energyCost;
    this.cooldownLeft = this.stats.cooldown;
    this.fire(owner, world);
    return true;
  }

  /** Muzzle position at the tip of the turret. */
  protected muzzle(owner: Car, dist = 22): { x: number; y: number } {
    return { x: owner.x + Math.cos(owner.aimAngle) * dist, y: owner.y + Math.sin(owner.aimAngle) * dist };
  }

  protected abstract fire(owner: Car, world: World): void;
}
