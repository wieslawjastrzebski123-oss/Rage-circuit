import Phaser from 'phaser';
import { Depth } from '../constants';
import type { WeaponStats } from '../data/weapons';
import type { Car } from './Car';

export type ProjectileKind = 'bullet' | 'shell' | 'rocket';

/** Pooled projectile – re-used instead of created/destroyed per shot. */
export class Projectile {
  active = false;
  kind: ProjectileKind = 'bullet';
  owner!: Car;
  stats!: WeaponStats;
  target: Car | null = null;
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  speed = 0;
  angle = 0;
  ttl = 0;
  age = 0;
  trailAcc = 0;
  readonly sprite: Phaser.GameObjects.Image;
  readonly glow: Phaser.GameObjects.Image;

  constructor(scene: Phaser.Scene) {
    this.glow = scene.add.image(0, 0, 'glow').setBlendMode(Phaser.BlendModes.ADD).setDepth(Depth.Projectile - 1).setVisible(false);
    this.sprite = scene.add.image(0, 0, 'bullet').setDepth(Depth.Projectile).setVisible(false);
  }

  fire(kind: ProjectileKind, owner: Car, x: number, y: number, angle: number, speed: number, stats: WeaponStats): void {
    this.active = true;
    this.kind = kind;
    this.owner = owner;
    this.stats = stats;
    this.target = null;
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.speed = speed;
    // inherit part of the shooter's velocity so shots feel attached to the car
    this.vx = Math.cos(angle) * speed + owner.vx * 0.6;
    this.vy = Math.sin(angle) * speed + owner.vy * 0.6;
    this.ttl = stats.ttl;
    this.age = 0;
    this.trailAcc = 0;
    this.sprite.setTexture(kind).setVisible(true).setScale(kind === 'bullet' ? 1 : 1.1);
    const glowColor = kind === 'bullet' ? 0xffd070 : kind === 'shell' ? 0xff8a30 : 0xff5030;
    this.glow
      .setTint(glowColor)
      .setScale(kind === 'bullet' ? 0.45 : 0.9)
      .setAlpha(kind === 'bullet' ? 0.5 : 0.8)
      .setVisible(true);
    this.sync();
  }

  sync(): void {
    const a = Math.atan2(this.vy, this.vx);
    this.sprite.setPosition(this.x, this.y).setRotation(a);
    this.glow.setPosition(this.x, this.y);
  }

  kill(): void {
    this.active = false;
    this.sprite.setVisible(false);
    this.glow.setVisible(false);
    this.target = null;
  }
}
