import Phaser from 'phaser';
import { Depth } from '../constants';
import type { WeaponStats } from '../data/weapons';
import type { Car } from './Car';

export const MINE_ARM_TIME = 0.7;
export const MINE_TRIGGER_RADIUS = 52;

/** Pooled proximity mine. */
export class Mine {
  active = false;
  owner!: Car;
  stats!: WeaponStats;
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  age = 0;
  readonly sprite: Phaser.GameObjects.Image;
  readonly light: Phaser.GameObjects.Image;

  constructor(scene: Phaser.Scene) {
    this.sprite = scene.add.image(0, 0, 'mine').setDepth(Depth.Mine).setVisible(false);
    this.light = scene.add.image(0, 0, 'glow').setBlendMode(Phaser.BlendModes.ADD).setScale(0.6).setDepth(Depth.Mine + 1).setVisible(false);
  }

  get armed(): boolean {
    return this.age >= MINE_ARM_TIME;
  }

  drop(owner: Car, x: number, y: number, vx: number, vy: number, stats: WeaponStats): void {
    this.active = true;
    this.owner = owner;
    this.stats = stats;
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.age = 0;
    this.sprite.setVisible(true).setScale(0.3).setTint(owner.stats.color);
    this.light.setVisible(true).setTint(0xffb000);
  }

  sync(time: number): void {
    this.sprite.setPosition(this.x, this.y).setScale(Math.min(1, 0.3 + this.age * 2.5));
    this.sprite.rotation += 0.02;
    const blinkRate = this.armed ? 4 : 14;
    const on = Math.sin(time * blinkRate * Math.PI) > 0;
    this.light.setPosition(this.x, this.y).setAlpha(on ? 0.9 : 0.2).setTint(this.armed ? 0xff2d2d : 0xffb000);
    // fade out during the last seconds
    const left = this.stats.ttl - this.age;
    this.sprite.setAlpha(left < 2 ? 0.4 + 0.3 * Math.sin(time * 20) : 1);
  }

  kill(): void {
    this.active = false;
    this.sprite.setVisible(false);
    this.light.setVisible(false);
  }
}
