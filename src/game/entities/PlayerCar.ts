import { PERSONALITIES } from '../ai/Personality';
import { RacingAI } from '../ai/RacingAI';
import type { CarStats } from '../data/cars';
import type { InputManager } from '../systems/InputManager';
import type { World } from '../systems/World';
import { Car } from './Car';

/** The human-controlled car. After finishing, an autopilot takes over. */
export class PlayerCar extends Car {
  private input: InputManager;
  private autopilot: RacingAI | null = null;

  constructor(world: World, stats: CarStats, input: InputManager) {
    super(world, stats, 'PLAYER', true);
    this.input = input;
  }

  enableAutopilot(): void {
    this.autopilot = new RacingAI(this, this.world, PERSONALITIES.racer);
  }

  override think(dt: number): void {
    if (this.autopilot) {
      this.autopilot.update(dt);
      const c = this.controls;
      c.firePrimary = c.fireSecondary = c.ability = c.reset = false;
      c.aimX = this.x + Math.cos(this.heading) * 100;
      c.aimY = this.y + Math.sin(this.heading) * 100;
      return;
    }
    this.input.read(this.controls, this.x, this.y);
  }
}
