import * as THREE from 'three';
import type { Car } from '../entities/Car';
import { textures } from '../render/Textures';
import type { PickupDef } from '../track/TrackData';
import { dist2 } from '../utils/math';
import type { World } from './World';

const RESPAWN = 12;
/** the hunter is rarer */
const HUNTER_RESPAWN = 28;
const RADIUS = 34;

const INFO = {
  energy: { color: 0x00e5ff, label: '+40 ENERGY' },
  boost: { color: 0xffb000, label: '+50 BOOST' },
  repair: { color: 0x7dff4a, label: '+35 REPAIR' },
  hunter: { color: 0xff1a6a, label: 'HUNTER LAUNCHED' },
} as const;

const GEO = {
  energy: new THREE.OctahedronGeometry(9, 0),
  boost: new THREE.ConeGeometry(8, 16, 4),
  repair: new THREE.BoxGeometry(12, 12, 12),
  // a spiky star
  hunter: new THREE.IcosahedronGeometry(10, 0),
};
for (const g of Object.values(GEO)) g.userData.shared = true;

interface Pickup {
  def: PickupDef;
  /** null when running headless */
  group: THREE.Group | null;
  gem: THREE.Mesh | null;
  timer: number;
}

/** Energy / boost / repair pickups that respawn after a short delay. */
export class PickupSystem {
  private world: World;
  readonly pickups: Pickup[] = [];

  constructor(world: World, defs: PickupDef[]) {
    this.world = world;
    for (const def of defs) {
      if (!world.gfx) {
        this.pickups.push({ def, group: null, gem: null, timer: 0 });
        continue;
      }
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
        if (p.group) p.group.visible = back;
        if (back) w.effects.shockwave(p.def.x, p.def.y, 40, INFO[p.def.kind].color, 250);
        continue;
      }
      if (p.gem) {
        p.gem.rotation.y = t * 2 + p.def.x;
        p.gem.position.y = 16 + Math.sin(t * 3 + p.def.x) * 3;
      }
      for (const c of w.cars) {
        if (!c.alive || dist2(c.x, c.y, p.def.x, p.def.y) > (RADIUS + c.radius) ** 2) continue;
        this.collect(p, c);
        break;
      }
    }
  }

  /** Network display: availability from a snapshot + idle animation. */
  showState(available: number[], t: number): void {
    this.pickups.forEach((p, i) => {
      const on = available[i] === 1;
      if (p.group && p.group.visible !== on) {
        p.group.visible = on;
        if (on) this.world.effects.shockwave(p.def.x, p.def.y, 40, INFO[p.def.kind].color, 250);
      }
      if (p.gem) {
        p.gem.rotation.y = t * 2 + p.def.x;
        p.gem.position.y = 16 + Math.sin(t * 3 + p.def.x) * 3;
      }
    });
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
      case 'hunter': {
        const leader = w.leader;
        p.timer = HUNTER_RESPAWN;
        if (p.group) p.group.visible = false;
        w.effects.pickup(p.def.x, p.def.y, INFO.hunter.color);
        if (!leader || leader === c) {
          // nobody to hunt: the leader just gets a boost refill
          c.boostMeter = Math.min(100, c.boostMeter + 50);
          w.view(c)?.effects.floatText(c.x, c.y, '+50 BOOST', INFO.boost.color, 15);
          w.view(c)?.audio.pickup();
          return;
        }
        w.combat.launchHunter(c, leader);
        w.view(c)?.hud?.flash(`HUNTER → ${leader.name}`, '#ff1a6a', 1600);
        w.view(leader)?.hud?.announce('HUNTER INCOMING!', '#ff1a6a', 1600);
        w.hud?.feed(`🎯 ${c.name} launched a HUNTER at ${leader.name}`);
        return;
      }
    }
    p.timer = RESPAWN + Math.random() * 3;
    if (p.group) p.group.visible = false;
    const info = INFO[p.def.kind];
    w.effects.pickup(p.def.x, p.def.y, info.color);
    const v = w.view(c);
    if (v) {
      v.effects.floatText(c.x, c.y, info.label, info.color, 15);
      v.audio.pickup();
    }
  }
}
