import * as THREE from 'three';
import type { WeaponStats } from '../data/weapons';
import { textures } from '../render/Textures';
import type { Car } from './Car';

export const MINE_ARM_TIME = 0.7;
export const MINE_TRIGGER_RADIUS = 52;

const GEO = new THREE.CylinderGeometry(10, 12, 4, 12);
GEO.userData.shared = true;
const SPIKE_GEO = new THREE.BoxGeometry(3, 3, 3);
SPIKE_GEO.userData.shared = true;

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
  private group = new THREE.Group();
  private mat: THREE.MeshStandardMaterial;
  private light: THREE.Sprite;

  constructor(root: THREE.Object3D) {
    this.mat = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.5, metalness: 0.6 });
    const body = new THREE.Mesh(GEO, this.mat);
    body.position.y = 2;
    this.group.add(body);
    const spikeMat = new THREE.MeshBasicMaterial({ color: 0xffb000 });
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Mesh(SPIKE_GEO, spikeMat);
      const a = (i / 6) * Math.PI * 2;
      s.position.set(Math.cos(a) * 11, 3, Math.sin(a) * 11);
      this.group.add(s);
    }
    this.light = new THREE.Sprite(new THREE.SpriteMaterial({ map: textures().soft, color: 0xffb000, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.light.position.y = 6;
    this.light.scale.set(22, 22, 1);
    this.group.add(this.light);
    this.group.visible = false;
    root.add(this.group);
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
    this.mat.emissive.setHex(owner.stats.color).multiplyScalar(0.25);
    this.group.visible = true;
  }

  sync(time: number): void {
    this.group.position.set(this.x, 0, this.y);
    this.group.rotation.y += 0.02;
    this.group.scale.setScalar(Math.min(1, 0.3 + this.age * 2.5));
    const blinkRate = this.armed ? 4 : 14;
    const on = Math.sin(time * blinkRate * Math.PI) > 0;
    const m = this.light.material;
    m.color.setHex(this.armed ? 0xff2d2d : 0xffb000);
    const left = this.stats.ttl - this.age;
    m.opacity = (on ? 1 : 0.2) * (left < 2 ? 0.5 : 1);
  }

  kill(): void {
    this.active = false;
    this.group.visible = false;
  }
}
