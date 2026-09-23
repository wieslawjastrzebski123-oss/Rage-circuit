import { CombatAI } from '../ai/CombatAI';
import { PERSONALITIES } from '../ai/Personality';
import { RacingAI } from '../ai/RacingAI';
import type { CarStats } from '../data/cars';
import type { World } from '../systems/World';
import { Car } from './Car';

/**
 * Server-side car driven by a remote human's inputs.
 * After finishing (or if the player disconnects) an AI takes over the wheel.
 */
export class RemoteCar extends Car {
  /** player id of the human driver */
  readonly owner: number;
  /** last input sequence number applied */
  ack = 0;
  private racing: RacingAI | null = null;
  private fighting: CombatAI | null = null;

  constructor(world: World, stats: CarStats, name: string, owner: number) {
    super(world, stats, name, true);
    this.owner = owner;
  }

  get aiControlled(): boolean {
    return this.racing !== null;
  }

  /** Autopilot: drive only (after the finish line). */
  enableAutopilot(): void {
    if (!this.racing) this.racing = new RacingAI(this, this.world, PERSONALITIES.racer);
  }

  /** Full bot: drive and fight (player left mid-race). */
  becomeBot(): void {
    this.enableAutopilot();
    if (!this.fighting) this.fighting = new CombatAI(this, this.world, this.racing!, PERSONALITIES.balanced);
  }

  override think(dt: number): void {
    if (!this.racing) return; // controls are written by the network layer
    this.racing.update(dt);
    const c = this.controls;
    if (this.fighting) this.fighting.update(dt);
    else {
      c.firePrimary = c.fireSecondary = c.ability = c.reset = false;
      c.aimX = this.x + Math.cos(this.heading) * 100;
      c.aimY = this.y + Math.sin(this.heading) * 100;
    }
  }
}
