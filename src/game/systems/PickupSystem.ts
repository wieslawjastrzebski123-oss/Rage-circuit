import * as THREE from 'three';
import type { Car } from '../entities/Car';
import { textures } from '../render/Textures';
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

const GEO = {
  energy: new THREE.OctahedronGeometry(9, 0),
  boost: new THREE.ConeGeometry(8, 16, 4),
  repair: new THREE.BoxGeometry(12, 12, 12),
};
for (const g of Object.values(GEO)) g.userData.shared = true;

interface Pickup {
  def: PickupDef;
  group: THREE.Group;
  gem: THREE.Mesh;
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
      const group = new THREE.Group();
      const gem = new THREE.Mesh(GEO[def.kind], new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.3, metalness: 0.2 }));
      gem.castShadow = true;
      gem.position.y = 16;
      group.add(gem);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: textures().soft, color, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.3 }));
      glow.position.y = 16;
      glow.scale.set(40, 40, 1);
      group.add(glow);
      // small plinth so it reads as an object on the road
      const base = new THREE.Mesh(new THREE.CylinderGeometry(12, 14, 3, 16), new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.6, metalness: 0.5 }));
      base.position.y = 1.5;
      base.receiveShadow = true;
      group.add(base);
      group.position.set(def.x, 0, def.y);
      world.gfx.root.add(group);
      this.pickups.push({ def, group, gem, timer: 0 });
    }
  }

  update(dt: number): void {
    const w = this.world;
    const t = w.time;
    for (const p of this.pickups) {
      if (p.timer > 0) {
        p.timer -= dt;
        const back = p.timer <= 0;
        p.group.visible = back;
        if (back) w.effects.shockwave(p.def.x, p.def.y, 40, INFO[p.def.kind].color, 250);
        continue;
      }
      p.gem.rotation.y = t * 2 + p.def.x;
      p.gem.position.y = 16 + Math.sin(t * 3 + p.def.x) * 3;
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
    p.group.visible = false;
    const info = INFO[p.def.kind];
    w.effects.pickup(p.def.x, p.def.y, info.color);
    if (c.isPlayer) {
      w.effects.floatText(c.x, c.y, info.label, info.color, 15);
      w.audio.pickup();
    }
  }
}
