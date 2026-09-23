import type { AbilityInfo } from '../data/cars';
import type { Car } from '../entities/Car';
import type { World } from '../systems/World';

export abstract class Ability {
  readonly info: AbilityInfo;
  cooldownLeft = 0;

  constructor(info: AbilityInfo) {
    this.info = info;
  }

  get name(): string {
    return this.info.name;
  }

  get cooldownRatio(): number {
    return this.cooldownLeft / this.info.cooldown;
  }

  isReady(owner: Car): boolean {
    return this.cooldownLeft <= 0 && owner.energy >= this.info.energyCost && owner.canAct;
  }

  update(dt: number, _owner: Car): void {
    if (this.cooldownLeft > 0) this.cooldownLeft = Math.max(0, this.cooldownLeft - dt);
  }

  tryActivate(owner: Car, world: World): boolean {
    if (!this.isReady(owner)) return false;
    if (!this.activate(owner, world)) return false;
    owner.energy -= this.info.energyCost;
    this.cooldownLeft = this.info.cooldown;
    return true;
  }

  /** Returns false if the ability could not be used right now (no cost is paid). */
  protected abstract activate(owner: Car, world: World): boolean;
}
