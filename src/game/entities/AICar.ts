import { CombatAI } from '../ai/CombatAI';
import type { Personality } from '../ai/Personality';
import { RacingAI } from '../ai/RacingAI';
import type { CarStats } from '../data/cars';
import type { World } from '../systems/World';
import { NameTag } from '../ui/NameTag';
import { Car } from './Car';

/** A bot: racing line driving + combat decisions. Shows a name tag and HP bar. */
export class AICar extends Car {
  readonly racing: RacingAI;
  readonly fighting: CombatAI;
  readonly personality: Personality;
  private tag: NameTag | null;

  constructor(world: World, stats: CarStats, personality: Personality, name = stats.name) {
    super(world, stats, name, false);
    this.personality = personality;
    this.racing = new RacingAI(this, world, personality);
    this.fighting = new CombatAI(this, world, this.racing, personality);
    this.tag = world.gfx ? new NameTag(this, world.gfx.root) : null;
  }

  override think(dt: number): void {
    this.racing.update(dt);
    this.fighting.update(dt);
  }

  override updateVisuals(dt: number): void {
    super.updateVisuals(dt);
    if (this.tag) this.tag.update(this.world.gfx!.camera);
  }

  override destroy(): void {
    super.destroy();
    this.tag?.destroy();
  }
}
