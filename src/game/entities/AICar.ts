import * as THREE from 'three';
import { CombatAI } from '../ai/CombatAI';
import type { Personality } from '../ai/Personality';
import { RacingAI } from '../ai/RacingAI';
import type { CarStats } from '../data/cars';
import { labelTexture } from '../render/Textures';
import type { World } from '../systems/World';
import { Car } from './Car';

const BAR_W = 34;

/** A bot: racing line driving + combat decisions. Shows a name tag and HP bar. */
export class AICar extends Car {
  readonly racing: RacingAI;
  readonly fighting: CombatAI;
  readonly personality: Personality;
  private label: THREE.Sprite;
  private barBg: THREE.Sprite;
  private barFill: THREE.Sprite;

  constructor(world: World, stats: CarStats, personality: Personality) {
    super(world, stats, stats.name, false);
    this.personality = personality;
    this.racing = new RacingAI(this, world, personality);
    this.fighting = new CombatAI(this, world, this.racing, personality);
    const col = '#' + stats.color.toString(16).padStart(6, '0');
    this.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(stats.name, col), depthWrite: false, transparent: true }));
    this.label.scale.set(48, 12, 1);
    this.barBg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x000000, opacity: 0.7, transparent: true, depthWrite: false }));
    this.barBg.scale.set(BAR_W + 2, 3.4, 1);
    this.barFill = new THREE.Sprite(new THREE.SpriteMaterial({ color: stats.color, depthWrite: false, transparent: true }));
    this.barFill.center.set(0, 0.5);
    world.gfx.root.add(this.label, this.barBg, this.barFill);
  }

  override think(dt: number): void {
    this.racing.update(dt);
    this.fighting.update(dt);
  }

  override updateVisuals(dt: number): void {
    super.updateVisuals(dt);
    const vis = this.alive;
    this.label.visible = this.barBg.visible = this.barFill.visible = vis;
    if (!vis) return;
    this.label.position.set(this.x, 46, this.y);
    this.barBg.position.set(this.x, 38, this.y);
    const r = Math.max(0, this.hp / this.maxHp);
    this.barFill.scale.set(Math.max(0.01, BAR_W * r), 2.4, 1);
    this.barFill.position.set(this.x, 38, this.y);
    // left-align the fill in screen space: shift along the camera's right vector
    const cam = this.world.gfx.camera;
    const right = _v.set(1, 0, 0).applyQuaternion(cam.quaternion);
    this.barFill.position.addScaledVector(right, -BAR_W / 2);
    this.barFill.material.color.setHex(r < 0.3 ? 0xff3030 : this.stats.color);
  }

  override destroy(): void {
    super.destroy();
    this.label.removeFromParent();
    this.barBg.removeFromParent();
    this.barFill.removeFromParent();
  }
}

const _v = new THREE.Vector3();
