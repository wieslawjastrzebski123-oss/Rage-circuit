import * as THREE from 'three';
import type { Car } from '../entities/Car';
import { labelTexture } from '../render/Textures';

const BAR_W = 34;
const _v = new THREE.Vector3();

/** Floating name + HP bar above a rival's car. */
export class NameTag {
  private label: THREE.Sprite;
  private barBg: THREE.Sprite;
  private barFill: THREE.Sprite;
  private car: Car;

  constructor(car: Car, root: THREE.Object3D) {
    this.car = car;
    const col = '#' + car.stats.color.toString(16).padStart(6, '0');
    this.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(car.name, col), depthWrite: false, transparent: true }));
    this.label.scale.set(48, 12, 1);
    this.barBg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x000000, opacity: 0.7, transparent: true, depthWrite: false }));
    this.barBg.scale.set(BAR_W + 2, 3.4, 1);
    this.barFill = new THREE.Sprite(new THREE.SpriteMaterial({ color: car.stats.color, depthWrite: false, transparent: true }));
    this.barFill.center.set(0, 0.5);
    root.add(this.label, this.barBg, this.barFill);
  }

  update(camera: THREE.Camera): void {
    const c = this.car;
    const vis = c.alive;
    this.label.visible = this.barBg.visible = this.barFill.visible = vis;
    if (!vis) return;
    this.label.position.set(c.x, 46, c.y);
    this.barBg.position.set(c.x, 38, c.y);
    const r = Math.max(0, c.hp / c.maxHp);
    this.barFill.scale.set(Math.max(0.01, BAR_W * r), 2.4, 1);
    this.barFill.position.set(c.x, 38, c.y);
    // left-align the fill in screen space: shift along the camera's right vector
    this.barFill.position.addScaledVector(_v.set(1, 0, 0).applyQuaternion(camera.quaternion), -BAR_W / 2);
    this.barFill.material.color.setHex(r < 0.3 ? 0xff3030 : c.stats.color);
  }

  destroy(): void {
    this.label.removeFromParent();
    this.barBg.removeFromParent();
    this.barFill.removeFromParent();
  }
}
