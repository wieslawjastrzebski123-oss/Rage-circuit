import * as THREE from 'three';
import type { Car } from './Car';

const GEO = new THREE.CylinderGeometry(14, 14, 26, 14);
GEO.userData.shared = true;
const BAND_GEO = new THREE.CylinderGeometry(14.6, 14.6, 4, 14);
BAND_GEO.userData.shared = true;

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
  private group = new THREE.Group();
  private mat: THREE.MeshStandardMaterial;
  private tilt = 0;

  constructor(root: THREE.Object3D, x: number, y: number, explosive: boolean) {
    this.x = this.homeX = x;
    this.y = this.homeY = y;
    this.explosive = explosive;
    this.mat = new THREE.MeshStandardMaterial({ color: explosive ? 0xb3261a : 0x2f5f86, roughness: 0.5, metalness: 0.4 });
    const body = new THREE.Mesh(GEO, this.mat);
    body.position.y = 13;
    this.group.add(body);
    const bandMat = new THREE.MeshStandardMaterial({ color: explosive ? 0xe0b030 : 0x1a2c3c, roughness: 0.5, metalness: 0.4 });
    for (const yy of [6, 20]) {
      const band = new THREE.Mesh(BAND_GEO, bandMat);
      band.position.y = yy;
      this.group.add(band);
    }
    this.group.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    root.add(this.group);
    this.sync();
  }

  sync(): void {
    this.group.visible = this.alive;
    this.group.position.set(this.x, 0, this.y);
    this.group.rotation.y = -this.rot;
    // wobble when knocked around
    this.tilt = Math.min(0.5, Math.hypot(this.vx, this.vy) / 600);
    this.group.rotation.z = this.tilt;
    if (this.fuse >= 0) this.mat.emissive.setHex(Math.sin(this.fuse * 60) > 0 ? 0xffffff : 0x401000);
    else this.mat.emissive.setHex(0x000000);
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
