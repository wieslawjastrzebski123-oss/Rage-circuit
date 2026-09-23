import * as THREE from 'three';
import type { WeaponStats } from '../data/weapons';
import { textures } from '../render/Textures';
import type { Car } from './Car';

export type ProjectileKind = 'bullet' | 'shell' | 'rocket';

const HEIGHT = 18;

function shared<T extends THREE.BufferGeometry | THREE.Material>(o: T): T {
  o.userData.shared = true;
  return o;
}

const GEO = {
  bullet: shared(new THREE.BoxGeometry(16, 1.6, 1.6)),
  shell: shared(new THREE.SphereGeometry(3.4, 10, 8)),
  rocket: shared(new THREE.CylinderGeometry(2.2, 2.2, 16, 8).rotateZ(Math.PI / 2)),
};
const MAT = {
  bullet: shared(new THREE.MeshBasicMaterial({ color: 0xfff0b0 })),
  shell: shared(new THREE.MeshBasicMaterial({ color: 0xffb060 })),
  rocket: shared(new THREE.MeshStandardMaterial({ color: 0xd0d4da, roughness: 0.4, metalness: 0.6 })),
};
const GLOW_COLOR: Record<ProjectileKind, number> = { bullet: 0xffd070, shell: 0xff8a30, rocket: 0xff5030 };

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
  /** damage multiplier (Overcharge) */
  dmgMul = 1;
  // visuals are absent when simulating headless
  private mesh: THREE.Mesh | null = null;
  private glow: THREE.Sprite | null = null;

  constructor(root: THREE.Object3D | null) {
    if (!root) return;
    this.mesh = new THREE.Mesh(GEO.bullet, MAT.bullet);
    this.mesh.visible = false;
    this.glow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: textures().soft, color: 0xffd070, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
    );
    this.glow.visible = false;
    root.add(this.mesh, this.glow);
  }

  fire(kind: ProjectileKind, owner: Car, x: number, y: number, angle: number, speed: number, stats: WeaponStats, dmgMul = 1): void {
    this.active = true;
    this.dmgMul = dmgMul;
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
    if (!this.mesh || !this.glow) return;
    this.mesh.geometry = GEO[kind];
    this.mesh.material = MAT[kind];
    this.mesh.visible = true;
    const g = this.glow;
    g.material.color.setHex(GLOW_COLOR[kind]);
    const s = kind === 'bullet' ? 14 : kind === 'shell' ? 30 : 34;
    g.scale.set(s, s, 1);
    g.visible = true;
    this.sync();
  }

  /** Network display: position the visuals from a server snapshot (no game logic). */
  show(kind: ProjectileKind, x: number, y: number, vx: number, vy: number): void {
    if (!this.mesh || !this.glow) return;
    if (this.kind !== kind || !this.mesh.visible) {
      this.kind = kind;
      this.mesh.geometry = GEO[kind];
      this.mesh.material = MAT[kind];
      this.glow.material.color.setHex(GLOW_COLOR[kind]);
      const s = kind === 'bullet' ? 14 : kind === 'shell' ? 30 : 34;
      this.glow.scale.set(s, s, 1);
    }
    this.mesh.visible = this.glow.visible = true;
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.sync();
  }

  sync(): void {
    if (!this.mesh || !this.glow) return;
    this.mesh.position.set(this.x, HEIGHT, this.y);
    this.mesh.rotation.y = -Math.atan2(this.vy, this.vx);
    this.glow.position.set(this.x, HEIGHT, this.y);
  }

  kill(): void {
    this.active = false;
    if (this.mesh) this.mesh.visible = false;
    if (this.glow) this.glow.visible = false;
    this.target = null;
  }
}
