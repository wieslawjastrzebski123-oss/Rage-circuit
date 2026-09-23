import Phaser from 'phaser';
import { Depth } from '../constants';
import type { Car } from '../entities/Car';
import type { PickupDef } from '../track/TrackData';
import { dist2 } from '../utils/math';
import type { World } from './World';

const RESPAWN = 12;
const RADIUS = 34;

const INFO = {
  energy: { color: 0x00e5ff, label: '+40 ENERGY' },
  boost: { color: 0xffb000, label: '+50 BOOST' },
  repair: { color: 0x7dff4a, label: '+35 REPAIR' },
} as const;

interface Pickup {
  def: PickupDef;
  sprite: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Image;
  timer: number;
}

/** Energy / boost / repair pickups that respawn after a short delay. */
export class PickupSystem {
  private world: World;
  readonly pickups: Pickup[] = [];

  constructor(world: World, defs: PickupDef[]) {
    this.world = world;
    for (const def of defs) {
      const color = INFO[def.kind].color;
      const glow = world.scene.add
        .image(def.x, def.y, 'glow')
        .setTint(color)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setScale(1.4)
        .setAlpha(0.5)
        .setDepth(Depth.Pickup);
      const sprite = world.scene.add.image(def.x, def.y, `pickup_${def.kind}`).setDepth(Depth.Pickup + 1);
      this.pickups.push({ def, sprite, glow, timer: 0 });
    }
  }

  update(dt: number): void {
    const w = this.world;
    const t = w.time;
    for (const p of this.pickups) {
      if (p.timer > 0) {
        p.timer -= dt;
        const back = p.timer <= 0;
        p.sprite.setVisible(back);
        p.glow.setVisible(back);
        if (back) w.effects.shockwave(p.def.x, p.def.y, 40, INFO[p.def.kind].color, 250);
        continue;
      }
      const bob = Math.sin(t * 3 + p.def.x) * 0.08;
      p.sprite.setScale(0.9 + bob);
      p.glow.setAlpha(0.35 + 0.2 * Math.sin(t * 4 + p.def.y));
      for (const c of w.cars) {
        if (!c.alive || dist2(c.x, c.y, p.def.x, p.def.y) > (RADIUS + c.radius) ** 2) continue;
        this.collect(p, c);
        break;
      }
    }
  }

  private collect(p: Pickup, c: Car): void {
    const w = this.world;
    switch (p.def.kind) {
      case 'energy':
        c.energy = Math.min(c.maxEnergy, c.energy + 40);
        break;
      case 'boost':
        c.boostMeter = Math.min(100, c.boostMeter + 50);
        break;
      case 'repair':
        c.hp = Math.min(c.maxHp, c.hp + 35);
        break;
    }
    p.timer = RESPAWN + Math.random() * 3;
    p.sprite.setVisible(false);
    p.glow.setVisible(false);
    const info = INFO[p.def.kind];
    w.effects.pickup(p.def.x, p.def.y, info.color);
    if (c.isPlayer) {
      w.effects.floatText(c.x, c.y - 30, info.label, info.color, 15);
      w.audio.pickup();
    }
  }
}
