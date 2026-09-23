import type { WeaponStats } from '../data/weapons';
import type { Car } from '../entities/Car';
import type { World } from '../systems/World';
import { OVERCHARGE_DAMAGE, OVERCHARGE_RATE } from '../abilities/Overcharge';

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

  /** Viper's Overcharge boosts the primary weapon. */
  protected overcharged(owner: Car): boolean {
    return this.stats.slot === 'primary' && owner.overchargeTime > 0;
  }

  /** Damage multiplier for projectiles fired right now. */
  protected damageMul(owner: Car): number {
    return this.overcharged(owner) ? OVERCHARGE_DAMAGE : 1;
  }

  energyCost(owner: Car): number {
    return this.overcharged(owner) ? 0 : this.stats.energyCost;
  }

  canFire(owner: Car): boolean {
    return this.cooldownLeft <= 0 && owner.isUnlocked(this.stats.slot) && owner.energy >= this.energyCost(owner) && owner.canAct;
  }

  tryFire(owner: Car, world: World): boolean {
    if (!this.canFire(owner)) return false;
    owner.energy -= this.energyCost(owner);
    this.cooldownLeft = this.stats.cooldown * (this.overcharged(owner) ? OVERCHARGE_RATE : 1);
    this.fire(owner, world);
    return true;
  }

  /** Muzzle position at the tip of the turret. */
  protected muzzle(owner: Car, dist = 22): { x: number; y: number } {
    return { x: owner.x + Math.cos(owner.aimAngle) * dist, y: owner.y + Math.sin(owner.aimAngle) * dist };
  }

  protected abstract fire(owner: Car, world: World): void;
}
