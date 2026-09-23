import Phaser from 'phaser';
import { Depth } from '../constants';
import type { Car } from './Car';

/** Pushable barrel. Explosive (red) ones blow up when shot or rammed hard. */
export class Barrel {
  readonly explosive: boolean;
  readonly homeX: number;
  readonly homeY: number;
  readonly radius = 15;
  readonly mass = 0.3;
  x: number;
  y: number;
  vx = 0;
  vy = 0;
  rot = 0;
  spin = 0;
  hp = 12;
  alive = true;
  /** countdown to explosion once triggered (-1 = not triggered) */
  fuse = -1;
  respawnTimer = 0;
  /** who triggered it – gets credit for kills */
  lastToucher: Car | null = null;
  sprite: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;

  constructor(scene: Phaser.Scene, x: number, y: number, explosive: boolean) {
    this.x = this.homeX = x;
    this.y = this.homeY = y;
    this.explosive = explosive;
    this.shadow = scene.add.image(x + 4, y + 5, 'smoke').setTint(0x000000).setAlpha(0.5).setScale(0.55).setDepth(Depth.Shadow);
    this.sprite = scene.add.image(x, y, explosive ? 'barrel_x' : 'barrel').setDepth(Depth.Barrel);
  }

  sync(): void {
    this.sprite.setPosition(this.x, this.y).setRotation(this.rot).setVisible(this.alive);
    this.shadow.setPosition(this.x + 4, this.y + 5).setVisible(this.alive);
    if (this.fuse >= 0) this.sprite.setTint(Math.sin(this.fuse * 60) > 0 ? 0xffffff : 0xff4020);
    else this.sprite.clearTint();
  }

  reset(): void {
    this.x = this.homeX;
    this.y = this.homeY;
    this.vx = this.vy = 0;
    this.hp = 12;
    this.fuse = -1;
    this.lastToucher = null;
    this.alive = true;
  }
}
