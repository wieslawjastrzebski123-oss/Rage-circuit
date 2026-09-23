import type { CarStats } from '../data/cars';
import type { World } from '../systems/World';
import { NameTag } from '../ui/NameTag';
import { Car } from './Car';

/** A car in an online race, positioned from server snapshots (no local physics). */
export class NetCar extends Car {
  private tag: NameTag | null;

  constructor(world: World, stats: CarStats, name: string, isMe: boolean) {
    super(world, stats, name, isMe);
    this.tag = !isMe && world.gfx ? new NameTag(this, world.gfx.root) : null;
  }

  override updateVisuals(dt: number): void {
    super.updateVisuals(dt);
    this.tag?.update(this.world.gfx!.camera);
  }

  override destroy(): void {
    super.destroy();
    this.tag?.destroy();
  }
}
