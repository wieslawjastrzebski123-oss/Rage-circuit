import * as THREE from 'three';
import type { Car } from '../entities/Car';
import type { Gfx } from '../render/Gfx';
import { Particles } from '../render/Particles';
import { textures } from '../render/Textures';
import { rand } from '../utils/math';
import { Storage } from '../utils/storage';

const SKID_POOL = 1800;
const SCORCH_POOL = 40;
const RING_POOL = 24;
const TEXT_POOL = 24;
const GHOST_POOL = 16;
const LIGHTS = 3;

interface Ring {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  t: number;
  dur: number;
  radius: number;
}

interface FloatText {
  el: HTMLDivElement;
  x: number;
  y: number;
  z: number;
  t: number;
}

interface Ghost {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  t: number;
}

interface Flash {
  light: THREE.PointLight;
  t: number;
  dur: number;
  peak: number;
}

/**
 * All the juice in 3D: particles, skid marks, shockwaves, flashes, floating
 * numbers, camera shake and hit-stop. Everything is pooled.
 */
export class Effects {
  private gfx: Gfx;
  /** remaining hit-stop in ms – consumed by the race loop */
  hitStop = 0;
  /** camera shake state (world units) read by the camera rig */
  shakeAmp = 0;
  private shakeTime = 0;
  private shakeDur = 1;
  /** world position the camera is looking at (for distance-scaled shakes) */
  focusX = 0;
  focusY = 0;

  private add: Particles;
  private norm: Particles;
  private skids: THREE.InstancedMesh;
  private skidIdx = 0;
  private scorches: THREE.InstancedMesh;
  private scorchIdx = 0;
  private rings: Ring[] = [];
  private ringIdx = 0;
  private texts: FloatText[] = [];
  private textIdx = 0;
  private textLayer: HTMLDivElement;
  /** hit marker that sticks to the car you just hit */
  private marker: HTMLDivElement;
  private markerTarget: { x: number; y: number } | null = null;
  private markerT = 1;
  private ghosts: Ghost[] = [];
  private ghostIdx = 0;
  private flashes: Flash[] = [];
  private flashIdx = 0;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private sc = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(gfx: Gfx) {
    this.gfx = gfx;
    const root = gfx.root;
    const tx = textures();
    this.add = new Particles(1600, tx.soft, true);
    this.norm = new Particles(900, tx.smoke, false);
    this.norm.points.renderOrder = 1;
    this.add.points.renderOrder = 2;
    root.add(this.norm.points, this.add.points);

    const skidMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const skidGeo = new THREE.PlaneGeometry(8, 3.4);
    skidGeo.rotateX(-Math.PI / 2);
    this.skids = new THREE.InstancedMesh(skidGeo, skidMat, SKID_POOL);
    this.skids.frustumCulled = false;
    for (let i = 0; i < SKID_POOL; i++) this.skids.setMatrixAt(i, this.hidden);
    this.skids.position.y = 0.25;
    root.add(this.skids);

    const scorchMat = new THREE.MeshBasicMaterial({
      map: tx.smoke,
      color: 0x000000,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    const scorchGeo = new THREE.PlaneGeometry(90, 90);
    scorchGeo.rotateX(-Math.PI / 2);
    this.scorches = new THREE.InstancedMesh(scorchGeo, scorchMat, SCORCH_POOL);
    this.scorches.frustumCulled = false;
    for (let i = 0; i < SCORCH_POOL; i++) this.scorches.setMatrixAt(i, this.hidden);
    this.scorches.position.y = 0.3;
    root.add(this.scorches);

    const ringGeo = new THREE.PlaneGeometry(120, 120);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < RING_POOL; i++) {
      const mat = new THREE.MeshBasicMaterial({ map: tx.ring, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.visible = false;
      mesh.position.y = 2;
      root.add(mesh);
      this.rings.push({ mesh, mat, t: 1, dur: 1, radius: 1 });
    }
    const ghostGeo = new THREE.BoxGeometry(52, 12, 26);
    for (let i = 0; i < GHOST_POOL; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xb04dff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      const mesh = new THREE.Mesh(ghostGeo, mat);
      mesh.visible = false;
      root.add(mesh);
      this.ghosts.push({ mesh, mat, t: 1 });
    }
    for (let i = 0; i < LIGHTS; i++) {
      const light = new THREE.PointLight(0xffa040, 0, 520, 1.1);
      light.position.y = 40;
      root.add(light);
      this.flashes.push({ light, t: 1, dur: 1, peak: 0 });
    }
    this.textLayer = document.createElement('div');
    this.textLayer.className = 'float-layer';
    document.getElementById('ui')!.appendChild(this.textLayer);
    this.marker = document.createElement('div');
    this.marker.className = 'hitmark';
    this.textLayer.appendChild(this.marker);
  }

  // --------------------------------------------------------------- camera
  shake(intensity: number, duration: number): void {
    const k = Storage.getSettings().cameraShake;
    if (k <= 0) return;
    const amp = intensity * 700 * k;
    if (amp < this.shakeAmp * (1 - this.shakeTime / this.shakeDur)) return;
    this.shakeAmp = amp;
    this.shakeTime = 0;
    this.shakeDur = duration / 1000;
  }

  /** Shake scaled by distance from the camera focus. */
  shakeAt(x: number, y: number, intensity: number, duration: number): void {
    const d = Math.hypot(x - this.focusX, y - this.focusY);
    const f = Math.max(0, 1 - d / 1000);
    if (f > 0.05) this.shake(intensity * f, duration);
  }

  /** Current shake offset magnitude (decays over the duration). */
  get shakeNow(): number {
    return this.shakeTime < this.shakeDur ? this.shakeAmp * (1 - this.shakeTime / this.shakeDur) : 0;
  }

  freeze(ms: number): void {
    this.hitStop = Math.max(this.hitStop, ms);
  }

  private flash(x: number, y: number, color: number, peak: number, dur: number): void {
    const f = this.flashes[this.flashIdx];
    this.flashIdx = (this.flashIdx + 1) % LIGHTS;
    f.light.position.set(x, 30, y);
    f.light.color.setHex(color);
    f.t = 0;
    f.dur = dur;
    f.peak = peak;
  }

  // --------------------------------------------------------------- driving
  skid(x: number, y: number, angle: number, alpha: number): void {
    this.q.setFromAxisAngle(this.up, -angle);
    this.sc.set(1, 1, alpha > 0.35 ? 1.1 : 0.9);
    this.m4.compose(this.v.set(x, 0, y), this.q, this.sc);
    this.skids.setMatrixAt(this.skidIdx, this.m4);
    this.skidIdx = (this.skidIdx + 1) % SKID_POOL;
    this.skids.instanceMatrix.needsUpdate = true;
  }

  driftSmoke(x: number, y: number, tint: number, charged: boolean, vx = 0, vy = 0): void {
    this.norm.emit({
      x: x + rand(-4, 4),
      y: 3,
      z: y + rand(-4, 4),
      vx: vx * 0.25 + rand(-18, 18),
      vy: rand(12, 30),
      vz: vy * 0.25 + rand(-18, 18),
      life: rand(0.8, 1.4),
      size0: 12,
      size1: rand(55, 75),
      alpha0: 0.5,
      alpha1: 0,
      color0: 0xd4d7de,
      color1: 0xaeb2ba,
      drag: 1.8,
      spin: rand(0.4, 1.4),
    });
    if (charged) {
      this.add.emit({
        x,
        y: 2,
        z: y,
        vx: rand(-120, 120),
        vy: rand(60, 160),
        vz: rand(-120, 120),
        life: rand(0.15, 0.35),
        size0: 5,
        size1: 1,
        color0: tint,
        gravity: -500,
        glow: 4,
      });
      this.add.emit({ x, y: 2, z: y, life: 0.12, size0: 16, size1: 4, alpha0: 0.8, color0: tint, glow: 2 });
    }
  }

  boostTrail(x: number, y: number, color: number): void {
    this.add.emit({ x, y: 7, z: y, vy: 4, life: 0.28, size0: 14, size1: 0, alpha0: 0.9, color0: 0xffffff, color1: color, glow: 3 });
  }

  /** Hot sparks spat out of the exhaust while boosting. */
  exhaustSparks(x: number, y: number, dirX: number, dirY: number, color: number): void {
    const sp = rand(80, 220);
    this.add.emit({
      x,
      y: 7,
      z: y,
      vx: -dirX * sp + rand(-50, 50),
      vy: rand(20, 110),
      vz: -dirY * sp + rand(-50, 50),
      life: rand(0.15, 0.35),
      size0: 4,
      size1: 1,
      color0: 0xffffff,
      color1: color,
      gravity: -500,
      glow: 5,
    });
  }

  driftRelease(car: Car, color: number, level: number): void {
    const bx = car.x - Math.cos(car.heading) * 22;
    const by = car.y - Math.sin(car.heading) * 22;
    this.shockwave(bx, by, 40 + level * 18, color, 260);
    for (let i = 0; i < 6 + level * 5; i++) {
      this.add.emit({ x: bx, y: 5, z: by, vx: rand(-260, 260), vy: rand(40, 220), vz: rand(-260, 260), life: rand(0.2, 0.45), size0: 6, size1: 1, color0: color, gravity: -600, glow: 4 });
    }
    if (car.isPlayer) {
      const labels = ['', 'BOOST', 'SUPER BOOST', 'ULTRA BOOST', 'MAX BOOST!'];
      this.floatText(car.x, car.y, labels[level], color, 16 + level * 2);
    }
  }

  wallSparks(x: number, y: number, nx: number, ny: number, strength: number): void {
    const n = Math.min(28, 5 + Math.floor(strength / 30));
    this.add.emit({ x, y: 6, z: y, life: 0.08, size0: 22, size1: 6, color0: 0xffe8c0, glow: 3 });
    for (let i = 0; i < n; i++) {
      const s = rand(150, 420);
      this.add.emit({
        x,
        y: 6,
        z: y,
        vx: -nx * s + rand(-150, 150),
        vy: rand(40, 220),
        vz: -ny * s + rand(-150, 150),
        life: rand(0.15, 0.4),
        size0: 5,
        size1: 1,
        color0: 0xffe0a0,
        color1: 0xff7020,
        gravity: -700,
        glow: 5,
      });
    }
  }

  // --------------------------------------------------------------- combat
  muzzle(x: number, y: number, angle: number, color: number, size: number): void {
    const h = 20;
    this.add.emit({ x, y: h, z: y, life: size > 1 ? 0.12 : 0.06, size0: size > 1 ? 44 : 18, size1: 6, color0: 0xffffff, color1: color, glow: 4 });
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const n = size > 1 ? 6 : 1;
    for (let i = 0; i < n; i++) {
      const sp = rand(200, 500);
      this.add.emit({ x, y: h, z: y, vx: c * sp + rand(-60, 60), vy: rand(0, 60), vz: s * sp + rand(-60, 60), life: rand(0.06, 0.16), size0: 4, size1: 1, color0: color, glow: 4 });
    }
    if (size > 1) {
      this.norm.emit({ x, y: h, z: y, vx: c * 60, vy: 20, vz: s * 60, life: 0.6, size0: 16, size1: 40, alpha0: 0.45, color0: 0x6a6d75, drag: 2 });
      this.flash(x, y, color, 3, 0.1);
    }
  }

  impact(x: number, y: number, angle: number, color: number, big: boolean): void {
    const c = Math.cos(angle + Math.PI);
    const s = Math.sin(angle + Math.PI);
    const n = big ? 12 : 4;
    for (let i = 0; i < n; i++) {
      const sp = rand(120, 380);
      this.add.emit({ x, y: 10, z: y, vx: c * sp + rand(-160, 160), vy: rand(20, 200), vz: s * sp + rand(-160, 160), life: rand(0.12, 0.35), size0: 5, size1: 1, color0: color, gravity: -600, glow: 4 });
    }
    this.add.emit({ x, y: 10, z: y, life: 0.08, size0: big ? 36 : 16, size1: 4, color0: color, glow: 3 });
    if (big) {
      for (let i = 0; i < 5; i++) this.fireball(x, y, 0.6);
      for (let i = 0; i < 4; i++) this.debris(x, y);
      this.flash(x, y, 0xffa040, 2.5, 0.15);
    }
  }

  private fireball(x: number, y: number, size: number): void {
    const a = rand(0, Math.PI * 2);
    const sp = rand(30, 200) * size;
    this.add.emit({
      x: x + rand(-8, 8),
      y: rand(6, 18),
      z: y + rand(-8, 8),
      vx: Math.cos(a) * sp,
      vy: rand(40, 160) * size,
      vz: Math.sin(a) * sp,
      life: rand(0.3, 0.65),
      size0: rand(30, 55) * size,
      size1: 8,
      alpha0: 1,
      color0: 0xfff0b0,
      color1: 0xff3a10,
      drag: 2.5,
      glow: 2.5,
      spin: rand(1, 3),
    });
  }

  private debris(x: number, y: number): void {
    const a = rand(0, Math.PI * 2);
    const sp = rand(150, 420);
    this.norm.emit({ x, y: 10, z: y, vx: Math.cos(a) * sp, vy: rand(150, 380), vz: Math.sin(a) * sp, life: rand(0.6, 1.1), size0: 6, size1: 4, alpha0: 1, alpha1: 0.6, color0: 0x2a2d35, gravity: -900 });
  }

  explosion(x: number, y: number, size: number): void {
    this.add.emit({ x, y: 14, z: y, life: 0.12, size0: 130 * size, size1: 60 * size, color0: 0xfff6e0, glow: 3 });
    const n = Math.round(16 * size);
    for (let i = 0; i < n; i++) this.fireball(x, y, size);
    for (let i = 0; i < Math.round(12 * size); i++) {
      this.norm.emit({
        x: x + rand(-15, 15),
        y: rand(8, 25),
        z: y + rand(-15, 15),
        vx: rand(-60, 60),
        vy: rand(30, 90),
        vz: rand(-60, 60),
        life: rand(1.0, 1.8),
        size0: rand(30, 50) * size,
        size1: rand(90, 140) * size,
        alpha0: 0.6,
        alpha1: 0,
        color0: 0x2e3036,
        drag: 1.2,
        spin: rand(0.3, 1),
      });
    }
    for (let i = 0; i < Math.round(12 * size); i++) this.debris(x, y);
    for (let i = 0; i < Math.round(16 * size); i++) {
      this.add.emit({ x, y: 10, z: y, vx: rand(-420, 420), vy: rand(60, 360), vz: rand(-420, 420), life: rand(0.2, 0.5), size0: 6, size1: 1, color0: 0xffc060, gravity: -700, glow: 5 });
    }
    // embers: slow, glowing, drifting down after the blast
    for (let i = 0; i < Math.round(14 * size); i++) {
      this.add.emit({ x: x + rand(-30, 30), y: rand(20, 60), z: y + rand(-30, 30), vx: rand(-90, 90), vy: rand(60, 180), vz: rand(-90, 90), life: rand(1.2, 2.2), size0: 4, size1: 2, alpha0: 1, alpha1: 0, color0: 0xffb040, color1: 0xff3000, drag: 1.6, gravity: -60, glow: 4 });
    }
    this.shockwave(x, y, 90 * size, 0xffa040, 320);
    this.flash(x, y, 0xff9a40, 6 * size, 0.35);
    this.q.setFromAxisAngle(this.up, rand(0, 6));
    const s = 1.1 * size;
    this.m4.compose(this.v.set(x, 0, y), this.q, this.sc.set(s, 1, s));
    this.scorches.setMatrixAt(this.scorchIdx, this.m4);
    this.scorchIdx = (this.scorchIdx + 1) % SCORCH_POOL;
    this.scorches.instanceMatrix.needsUpdate = true;
  }

  shockwave(x: number, y: number, radius: number, color: number, duration = 300): void {
    const r = this.rings[this.ringIdx];
    this.ringIdx = (this.ringIdx + 1) % RING_POOL;
    r.mesh.position.set(x, 2, y);
    r.mat.color.setHex(color);
    r.t = 0;
    r.dur = duration / 1000;
    r.radius = radius;
    r.mesh.visible = true;
  }

  empBurst(x: number, y: number): void {
    for (let i = 0; i < 50; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(150, 520);
      this.add.emit({ x, y: 8, z: y, vx: Math.cos(a) * sp, vy: rand(-20, 120), vz: Math.sin(a) * sp, life: rand(0.15, 0.4), size0: 7, size1: 1, color0: 0xb8f6ff, color1: 0x00a0ff, glow: 4 });
    }
    this.flash(x, y, 0x00e5ff, 5, 0.3);
  }

  empHit(x: number, y: number): void {
    for (let i = 0; i < 16; i++) {
      this.add.emit({ x: x + rand(-15, 15), y: rand(4, 20), z: y + rand(-15, 15), vx: rand(-80, 80), vy: rand(-40, 80), vz: rand(-80, 80), life: rand(0.1, 0.3), size0: 6, size1: 1, color0: 0x00e5ff, glow: 4 });
    }
  }

  blink(fromX: number, fromY: number, toX: number, toY: number, heading: number): void {
    const steps = 5;
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const g = this.ghosts[this.ghostIdx];
      this.ghostIdx = (this.ghostIdx + 1) % GHOST_POOL;
      g.mesh.position.set(fromX + (toX - fromX) * t, 9, fromY + (toY - fromY) * t);
      g.mesh.rotation.y = -heading;
      g.t = -t * 0.08;
      g.mesh.visible = true;
    }
    this.empHit(fromX, fromY);
    this.empHit(toX, toY);
    this.shockwave(toX, toY, 55, 0xb04dff, 250);
    this.flash(toX, toY, 0xb04dff, 3, 0.2);
  }

  pickup(x: number, y: number, color: number): void {
    this.shockwave(x, y, 60, color, 300);
    for (let i = 0; i < 14; i++) {
      this.add.emit({ x, y: 12, z: y, vx: rand(-200, 200), vy: rand(50, 250), vz: rand(-200, 200), life: rand(0.2, 0.45), size0: 7, size1: 1, color0: color, gravity: -500, glow: 4 });
    }
  }

  /** Slow industrial smoke drifting from a chimney top. */
  chimneySmoke(x: number, y: number, h: number): void {
    this.norm.emit({
      x: x + rand(-6, 6),
      y: h + 5,
      z: y + rand(-6, 6),
      vx: 18 + rand(-6, 6),
      vy: rand(25, 40),
      vz: 8 + rand(-6, 6),
      life: rand(5, 7),
      size0: 50,
      size1: 220,
      alpha0: 0.45,
      alpha1: 0,
      color0: 0x8d9096,
      color1: 0xb8bcc2,
      drag: 0.1,
    });
  }

  // --------------------------------------------------------------- text
  floatText(x: number, y: number, text: string, color: number, size = 16): void {
    let ft = this.texts[this.textIdx];
    if (!ft) {
      const el = document.createElement('div');
      el.className = 'float-text';
      this.textLayer.appendChild(el);
      ft = { el, x: 0, y: 0, z: 0, t: 1 };
      this.texts[this.textIdx] = ft;
    }
    this.textIdx = (this.textIdx + 1) % TEXT_POOL;
    ft.el.textContent = text;
    ft.el.style.color = '#' + color.toString(16).padStart(6, '0');
    ft.el.style.fontSize = `${size + 4}px`;
    ft.x = x + rand(-8, 8);
    ft.z = y;
    ft.y = 38;
    ft.t = 0;
  }

  damageNumber(x: number, y: number, amount: number, toPlayer: boolean): void {
    const big = amount >= 20;
    this.floatText(x, y, `${Math.round(amount)}`, toPlayer ? 0xff5a5a : big ? 0xffd23f : 0xffffff, big ? 20 : 14);
  }

  /** ✕ over the car your shot hit – red and larger for the killing blow. */
  hitMarker(target: { x: number; y: number }, kill: boolean): void {
    this.markerTarget = target;
    this.markerT = 0;
    this.marker.classList.toggle('kill', kill);
  }

  // --------------------------------------------------------------- update
  update(dt: number): void {
    const cam = this.gfx.camera;
    const h = this.gfx.renderer.domElement.height;
    this.add.update(dt, cam, h);
    this.norm.update(dt, cam, h);
    this.shakeTime += dt;

    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      r.t += dt;
      const k = Math.min(1, r.t / r.dur);
      const e = 1 - (1 - k) ** 3;
      const s = Math.max(0.01, (r.radius / 56) * e);
      r.mesh.scale.set(s, 1, s);
      r.mat.opacity = 0.9 * (1 - k);
      if (k >= 1) r.mesh.visible = false;
    }
    for (const g of this.ghosts) {
      if (!g.mesh.visible) continue;
      g.t += dt;
      const k = Math.max(0, g.t) / 0.38;
      g.mat.opacity = 0.55 * (1 - k);
      if (k >= 1) g.mesh.visible = false;
    }
    for (const f of this.flashes) {
      if (f.t >= f.dur) {
        f.light.intensity = 0;
        continue;
      }
      f.t += dt;
      f.light.intensity = f.peak * Math.max(0, 1 - f.t / f.dur);
    }
    const p = this.v;
    if (this.markerTarget && this.markerT < 1) {
      const kill = this.marker.classList.contains('kill');
      this.markerT += dt / (kill ? 0.5 : 0.22);
      const k = Math.min(1, this.markerT);
      this.gfx.project(this.markerTarget.x, 12, this.markerTarget.y, p);
      if (k >= 1 || p.z > 1) this.marker.style.opacity = '0';
      else {
        this.marker.style.opacity = String(1 - k * k);
        this.marker.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%) rotate(45deg) scale(${(kill ? 1.5 : 1.15) - 0.3 * k})`;
      }
    }
    for (const ft of this.texts) {
      if (!ft || ft.t >= 1) continue;
      ft.t += dt / 0.8;
      const k = Math.min(1, ft.t);
      this.gfx.project(ft.x, ft.y + k * 26, ft.z, p);
      if (k >= 1 || p.z > 1) {
        ft.el.style.opacity = '0';
        continue;
      }
      ft.el.style.opacity = String(1 - k * k);
      ft.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%) scale(${1.25 - 0.25 * k})`;
    }
  }

  destroy(): void {
    this.textLayer.remove();
  }
}
