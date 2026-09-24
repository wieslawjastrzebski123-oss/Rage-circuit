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
/** an irregular puddle, unit radius */
const OIL_GEO = (() => {
  const g = new THREE.CircleGeometry(1, 28);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 1; i < pos.count; i++) {
    const a = Math.atan2(pos.getY(i), pos.getX(i));
    const k = 0.82 + 0.12 * Math.sin(a * 3 + 1) + 0.06 * Math.sin(a * 7 + 2);
    pos.setXY(i, pos.getX(i) * k, pos.getY(i) * k);
  }
  g.rotateX(-Math.PI / 2);
  g.userData.shared = true;
  return g;
})();

export type MineKind = 'mine' | 'oil';

/** Pooled proximity mine – or an oil slick, which never explodes but makes cars spin. */
export class Mine {
  active = false;
  kind: MineKind = 'mine';
  owner!: Car;
  stats!: WeaponStats;
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  age = 0;
  private group = new THREE.Group();
  private mat: THREE.MeshStandardMaterial;
  private light: THREE.Sprite | null = null;
  private mineParts = new THREE.Group();
  private oil: THREE.Mesh;
  private oilMat: THREE.MeshStandardMaterial;

  constructor(root: THREE.Object3D | null) {
    this.mat = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.5, metalness: 0.6 });
    const body = new THREE.Mesh(GEO, this.mat);
    body.position.y = 2;
    this.mineParts.add(body);
    this.group.add(this.mineParts);
    // glossy black film: low roughness picks up the sky as an oily sheen
    this.oilMat = new THREE.MeshStandardMaterial({
      color: 0x050506,
      roughness: 0.08,
      metalness: 0.9,
      transparent: true,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.oil = new THREE.Mesh(OIL_GEO, this.oilMat);
    this.oil.position.y = 0.6;
    this.oil.visible = false;
    this.group.add(this.oil);
    const spikeMat = new THREE.MeshBasicMaterial({ color: 0xffb000 });
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Mesh(SPIKE_GEO, spikeMat);
      const a = (i / 6) * Math.PI * 2;
      s.position.set(Math.cos(a) * 11, 3, Math.sin(a) * 11);
      this.mineParts.add(s);
    }
    if (!root) return; // headless: logic only
    this.light = new THREE.Sprite(new THREE.SpriteMaterial({ map: textures().soft, color: 0xffb000, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.light.position.y = 6;
    this.light.scale.set(22, 22, 1);
    this.mineParts.add(this.light);
    this.group.visible = false;
    root.add(this.group);
  }

  get armed(): boolean {
    return this.age >= MINE_ARM_TIME;
  }

  /** oil: radius of the slick */
  get radius(): number {
    return this.stats.splash;
  }

  private setKind(kind: MineKind): void {
    this.kind = kind;
    this.mineParts.visible = kind === 'mine';
    this.oil.visible = kind === 'oil';
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
    this.setKind(stats.id === 'oil' ? 'oil' : 'mine');
    this.mat.emissive.setHex(owner.stats.color).multiplyScalar(0.25);
    this.group.visible = true;
  }

  sync(time: number): void {
    if (!this.light) return;
    this.group.position.set(this.x, 0, this.y);
    if (this.kind === 'oil') {
      // spreads out as it lands, fades away at the end
      this.group.rotation.y = this.x * 0.01;
      this.group.scale.setScalar(1);
      const r = this.radius * Math.min(1, 0.35 + this.age * 2.2);
      this.oil.scale.set(r, 1, r);
      this.oilMat.opacity = Math.min(0.92, (this.stats.ttl - this.age) / 1.5);
      return;
    }
    this.group.rotation.y += 0.02;
    this.group.scale.setScalar(Math.min(1, 0.3 + this.age * 2.5));
    const blinkRate = this.armed ? 4 : 14;
    const on = Math.sin(time * blinkRate * Math.PI) > 0;
    const m = this.light.material;
    m.color.setHex(this.armed ? 0xff2d2d : 0xffb000);
    const left = this.stats.ttl - this.age;
    m.opacity = (on ? 1 : 0.2) * (left < 2 ? 0.5 : 1);
  }

  /** Network display: position from a snapshot. */
  show(x: number, y: number, age: number, armed: boolean, color: number, time: number, kind: MineKind = 'mine'): void {
    this.x = x;
    this.y = y;
    this.age = armed ? Math.max(age, MINE_ARM_TIME) : age;
    this.group.visible = true;
    if (kind !== this.kind || !this.stats) {
      this.setKind(kind);
      this.stats = (kind === 'oil' ? { ttl: 10, splash: 58 } : { ttl: 20, splash: 120 }) as WeaponStats;
    }
    this.mat.emissive.setHex(color).multiplyScalar(0.25);
    this.sync(time);
  }

  kill(): void {
    this.active = false;
    this.group.visible = false;
  }
}
