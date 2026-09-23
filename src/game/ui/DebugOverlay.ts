import * as THREE from 'three';
import { AICar } from '../entities/AICar';
import type { RaceManager } from '../systems/RaceManager';
import type { World } from '../systems/World';
import { h, uiRoot } from './dom';

const Y = 3;
const MAX_DYN = 4000;

/**
 * ?debug=true – FPS, AI routes & targets, checkpoints, collision shapes, speed.
 */
export class DebugOverlay {
  private world: World;
  private race: RaceManager;
  private text: HTMLElement;
  private dyn: THREE.LineSegments;
  private dynPos = new Float32Array(MAX_DYN * 3);
  private dynCol = new Float32Array(MAX_DYN * 3);
  private acc = 0;
  private frames = 0;
  private fps = 0;

  constructor(world: World, race: RaceManager) {
    this.world = world;
    this.race = race;
    this.text = h('pre', 'debug-panel', '', uiRoot());
    this.buildStatic();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.dynPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.dynCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.dyn = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false }));
    this.dyn.frustumCulled = false;
    this.dyn.renderOrder = 10;
    world.gfx.root.add(this.dyn);
  }

  private buildStatic(): void {
    const t = this.world.track;
    const pos: number[] = [];
    const col: number[] = [];
    const c = new THREE.Color();
    const line = (x0: number, y0: number, x1: number, y1: number, color: number, y = Y) => {
      pos.push(x0, y, y0, x1, y, y1);
      c.setHex(color);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    };
    for (const s of t.segs) line(s.ax, s.ay, s.bx, s.by, 0x666666);
    const route = (pts: { x: number; y: number }[], color: number, y: number) => {
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        line(a.x, a.y, b.x, b.y, color, y);
      }
    };
    route(t.routes.shortcut.points, 0xffb000, Y + 1);
    route(t.routes.main.points, 0x00e5ff, Y + 2);
    t.checkpoints.forEach((s, i) => {
      const p = t.pointAt(s);
      const nx = -Math.sin(p.angle);
      const ny = Math.cos(p.angle);
      line(p.x - nx * p.hw, p.y - ny * p.hw, p.x + nx * p.hw, p.y + ny * p.hw, i === 0 ? 0xffffff : 0x7dff4a, 8);
    });
    for (const b of this.world.collisions.containers) {
      const pts = [
        [-b.hw, -b.hh],
        [b.hw, -b.hh],
        [b.hw, b.hh],
        [-b.hw, b.hh],
      ].map(([x, y]) => [b.cx + x * b.cos - y * b.sin, b.cy + x * b.sin + y * b.cos]);
      for (let i = 0; i < 4; i++) line(pts[i][0], pts[i][1], pts[(i + 1) % 4][0], pts[(i + 1) % 4][1], 0xff00ff, 36);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.8 }));
    lines.renderOrder = 10;
    this.world.gfx.root.add(lines);
  }

  update(dt: number): void {
    let n = 0;
    const c = new THREE.Color();
    const seg = (x0: number, y0: number, x1: number, y1: number, color: number, y = 12) => {
      if (n >= MAX_DYN - 2) return;
      c.setHex(color);
      this.dynPos.set([x0, y, y0, x1, y, y1], n * 3);
      this.dynCol.set([c.r, c.g, c.b, c.r, c.g, c.b], n * 3);
      n += 2;
    };
    const circle = (x: number, y: number, r: number, color: number) => {
      for (let i = 0; i < 16; i++) {
        const a0 = (i / 16) * Math.PI * 2;
        const a1 = ((i + 1) / 16) * Math.PI * 2;
        seg(x + Math.cos(a0) * r, y + Math.sin(a0) * r, x + Math.cos(a1) * r, y + Math.sin(a1) * r, color);
      }
    };
    for (const car of this.world.cars) {
      circle(car.x, car.y, car.radius, car.isGhost ? 0x888888 : 0xff00ff);
      seg(car.x, car.y, car.x + car.vx * 0.2, car.y + car.vy * 0.2, 0xffffff);
      if (car instanceof AICar) {
        seg(car.x, car.y, car.racing.targetX, car.racing.targetY, 0xffd23f);
        if (car.fighting.target) seg(car.x, car.y, car.controls.aimX, car.controls.aimY, 0xff2d2d);
      }
    }
    for (const b of this.world.collisions.barrels) if (b.alive) circle(b.x, b.y, b.radius, 0xff00ff);
    this.dyn.geometry.setDrawRange(0, n);
    (this.dyn.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.dyn.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;

    this.frames++;
    this.acc += dt;
    if (this.acc < 0.25) return;
    this.fps = this.frames / this.acc;
    this.frames = 0;
    this.acc = 0;
    const lines = [`FPS ${this.fps.toFixed(0)}`, `projectiles ${this.world.combat.activeProjectiles}`, `time ${this.race.raceTime.toFixed(1)}`];
    for (const car of this.race.standings) {
      const ai = car instanceof AICar ? ` ${car.personality.kind}${car.racing.route.usesShortcut ? ' SC' : ''}` : '';
      lines.push(
        `${car.name.padEnd(7)} spd ${car.speed.toFixed(0).padStart(3)} prog ${car.race.progress.toFixed(0).padStart(6)} cp ${car.race.cpPassed} lap ${car.race.lapsDone} hp ${car.hp.toFixed(0)} en ${car.energy.toFixed(0)}${ai}`,
      );
    }
    this.text.textContent = lines.join('\n');
  }

  destroy(): void {
    this.text.remove();
  }
}
