import Phaser from 'phaser';
import { CombatAI } from '../ai/CombatAI';
import type { Personality } from '../ai/Personality';
import { RacingAI } from '../ai/RacingAI';
import { Depth } from '../constants';
import type { CarStats } from '../data/cars';
import type { World } from '../systems/World';
import { Car } from './Car';

/** A bot: racing line driving + combat decisions. */
export class AICar extends Car {
  readonly racing: RacingAI;
  readonly fighting: CombatAI;
  readonly personality: Personality;
  readonly label: Phaser.GameObjects.Text;

  constructor(world: World, stats: CarStats, personality: Personality) {
    super(world, stats, stats.name, false);
    this.personality = personality;
    this.racing = new RacingAI(this, world, personality);
    this.fighting = new CombatAI(this, world, this.racing, personality);
    this.label = world.scene.add
      .text(0, 0, stats.name, {
        fontFamily: 'Rajdhani, sans-serif',
        fontSize: '13px',
        fontStyle: '700',
        color: '#' + stats.color.toString(16).padStart(6, '0'),
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setDepth(Depth.Labels);
  }

  override think(dt: number): void {
    this.racing.update(dt);
    this.fighting.update(dt);
  }

  override updateVisuals(dt: number): void {
    super.updateVisuals(dt);
    this.label.setPosition(this.x, this.y - 30).setVisible(this.alive);
  }

  override destroy(): void {
    super.destroy();
    this.label.destroy();
  }
}
