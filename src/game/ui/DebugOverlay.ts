import Phaser from 'phaser';
import { Depth } from '../constants';
import { AICar } from '../entities/AICar';
import type { RaceManager } from '../systems/RaceManager';
import type { World } from '../systems/World';
import { h, uiRoot } from './dom';

/**
 * ?debug=true – FPS, AI routes & targets, checkpoints, collision shapes, speed.
 */
export class DebugOverlay {
  private scene: Phaser.Scene;
  private world: World;
  private race: RaceManager;
  private staticG: Phaser.GameObjects.Graphics;
  private g: Phaser.GameObjects.Graphics;
  private text: HTMLElement;
  private acc = 0;

  constructor(scene: Phaser.Scene, world: World, race: RaceManager) {
    this.scene = scene;
    this.world = world;
    this.race = race;
    this.staticG = scene.add.graphics().setDepth(Depth.Debug);
    this.g = scene.add.graphics().setDepth(Depth.Debug + 1);
    this.text = h('pre', 'debug-panel', '', uiRoot());
    this.drawStatic();
  }

  private drawStatic(): void {
    const g = this.staticG;
    const t = this.world.track;
    // road segments (collision capsules' centre lines)
    g.lineStyle(1, 0xffffff, 0.25);
    for (const s of t.segs) g.lineBetween(s.ax, s.ay, s.bx, s.by);
    // AI routes
    const drawRoute = (pts: { x: number; y: number }[], color: number) => {
      g.lineStyle(2, color, 0.7);
      g.beginPath();
      pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.closePath();
      g.strokePath();
      g.fillStyle(color, 0.9);
      pts.forEach((p, i) => i % 4 === 0 && g.fillCircle(p.x, p.y, 3));
    };
    drawRoute(t.routes.shortcut.points, 0xffb000);
    drawRoute(t.routes.main.points, 0x00e5ff);
    // checkpoints
    t.checkpoints.forEach((s, i) => {
      const p = t.pointAt(s);
      const nx = -Math.sin(p.angle);
      const ny = Math.cos(p.angle);
      g.lineStyle(4, i === 0 ? 0xffffff : 0x7dff4a, 0.8);
      g.lineBetween(p.x - nx * p.hw, p.y - ny * p.hw, p.x + nx * p.hw, p.y + ny * p.hw);
    });
    // containers
    g.lineStyle(2, 0xff00ff, 0.9);
    for (const b of this.world.collisions.containers) {
      const c = [
        [-b.hw, -b.hh],
        [b.hw, -b.hh],
        [b.hw, b.hh],
        [-b.hw, b.hh],
      ].map(([x, y]) => new Phaser.Math.Vector2(b.cx + x * b.cos - y * b.sin, b.cy + x * b.sin + y * b.cos));
      g.strokePoints(c, true, true);
    }
  }

  update(dt: number): void {
    const g = this.g;
    g.clear();
    for (const c of this.world.cars) {
      g.lineStyle(2, c.isGhost ? 0x888888 : 0xff00ff, 1);
      g.strokeCircle(c.x, c.y, c.radius);
      g.lineStyle(1, 0xffffff, 0.8);
      g.lineBetween(c.x, c.y, c.x + c.vx * 0.2, c.y + c.vy * 0.2);
      if (c instanceof AICar) {
        g.lineStyle(1, 0xffd23f, 0.9);
        g.lineBetween(c.x, c.y, c.racing.targetX, c.racing.targetY);
        g.fillStyle(0xffd23f, 1);
        g.fillCircle(c.racing.targetX, c.racing.targetY, 5);
        if (c.fighting.target) {
          g.lineStyle(1, 0xff2d2d, 0.6);
          g.lineBetween(c.x, c.y, c.controls.aimX, c.controls.aimY);
        }
      }
    }
    for (const b of this.world.collisions.barrels) {
      if (!b.alive) continue;
      g.lineStyle(1, 0xff00ff, 0.8);
      g.strokeCircle(b.x, b.y, b.radius);
    }

    this.acc += dt;
    if (this.acc < 0.2) return;
    this.acc = 0;
    const fps = this.scene.game.loop.actualFps.toFixed(0);
    const lines = [`FPS ${fps}`, `projectiles ${this.world.combat.activeProjectiles}`, `time ${this.race.raceTime.toFixed(1)}`];
    for (const c of this.race.standings) {
      const ai = c instanceof AICar ? ` ${c.personality.kind}${c.racing.route.usesShortcut ? ' SC' : ''}` : '';
      lines.push(
        `${c.name.padEnd(7)} spd ${c.speed.toFixed(0).padStart(3)} prog ${c.race.progress.toFixed(0).padStart(6)} cp ${c.race.cpPassed} lap ${c.race.lapsDone} hp ${c.hp.toFixed(0)} en ${c.energy.toFixed(0)}${ai}`,
      );
    }
    this.text.textContent = lines.join('\n');
  }

  destroy(): void {
    this.text.remove();
  }
}
