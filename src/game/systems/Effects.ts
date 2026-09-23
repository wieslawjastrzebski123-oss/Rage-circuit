import Phaser from 'phaser';
import { Depth } from '../constants';
import type { Car } from '../entities/Car';
import { CAR_TEX_SCALE } from '../Textures';
import { Storage } from '../utils/storage';

type Emitter = Phaser.GameObjects.Particles.ParticleEmitter;

const SKID_POOL = 1400;
const SCORCH_POOL = 40;
const RING_POOL = 24;
const TEXT_POOL = 24;
const GHOST_POOL = 16;

/**
 * All the juice: particles, skid marks, shockwaves, floating numbers,
 * camera shake and hit-stop. Everything is pooled.
 */
export class Effects {
  private scene: Phaser.Scene;
  /** remaining hit-stop in ms – read and consumed by the race scene */
  hitStop = 0;

  private smoke: Emitter;
  private driftPuff: Emitter;
  private sparks: Emitter;
  private fire: Emitter;
  private debris: Emitter;
  private flashSmall: Emitter;
  private flashBig: Emitter;
  private trail: Emitter;
  private electric: Emitter;

  private skids: Phaser.GameObjects.Image[] = [];
  private skidIdx = 0;
  private scorches: Phaser.GameObjects.Image[] = [];
  private scorchIdx = 0;
  private rings: Phaser.GameObjects.Image[] = [];
  private ringIdx = 0;
  private texts: Phaser.GameObjects.Text[] = [];
  private textIdx = 0;
  private ghosts: Phaser.GameObjects.Image[] = [];
  private ghostIdx = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    const add = (tex: string, cfg: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig, depth: number) =>
      scene.add.particles(0, 0, tex, { emitting: false, ...cfg }).setDepth(depth);

    this.smoke = add(
      'smoke',
      {
        lifespan: { min: 700, max: 1300 },
        speed: { min: 10, max: 60 },
        scale: { start: 0.5, end: 2.2 },
        alpha: { start: 0.55, end: 0 },
        tint: 0x55585f,
        rotate: { min: 0, max: 360 },
      },
      Depth.Effects,
    );
    this.driftPuff = add(
      'smoke',
      {
        lifespan: { min: 380, max: 650 },
        speed: { min: 5, max: 35 },
        scale: { start: 0.35, end: 1.25 },
        alpha: { start: 0.45, end: 0 },
      },
      Depth.CarFx,
    );
    this.sparks = add(
      'spark',
      {
        lifespan: { min: 140, max: 360 },
        speed: { min: 220, max: 620 },
        scale: { start: 1.1, end: 0.2 },
        alpha: { start: 1, end: 0 },
        blendMode: Phaser.BlendModes.ADD,
        rotate: {
          onEmit: (p?: Phaser.GameObjects.Particles.Particle) => (p ? Phaser.Math.RadToDeg(Math.atan2(p.velocityY, p.velocityX)) : 0),
        },
      },
      Depth.Effects + 1,
    );
    this.fire = add(
      'glow',
      {
        lifespan: { min: 280, max: 620 },
        speed: { min: 40, max: 260 },
        scale: { start: 1.3, end: 0.2 },
        alpha: { start: 1, end: 0 },
        color: [0xfff4c0, 0xffb040, 0xff4a10, 0x401008],
        colorEase: 'Quad.easeOut',
        blendMode: Phaser.BlendModes.ADD,
      },
      Depth.Effects + 2,
    );
    this.debris = add(
      'debris',
      {
        lifespan: { min: 500, max: 1000 },
        speed: { min: 180, max: 480 },
        scale: { start: 1.2, end: 0.4 },
        rotate: { min: 0, max: 360 },
        tint: [0x3a3f4a, 0x22252c, 0x8a5a30],
        alpha: { start: 1, end: 0.2 },
      },
      Depth.Effects,
    );
    this.flashSmall = add(
      'glow',
      { lifespan: 70, scale: { start: 0.7, end: 0.2 }, alpha: { start: 1, end: 0 }, blendMode: Phaser.BlendModes.ADD },
      Depth.Effects + 3,
    );
    this.flashBig = add(
      'glow',
      { lifespan: 180, scale: { start: 3.5, end: 1 }, alpha: { start: 0.9, end: 0 }, blendMode: Phaser.BlendModes.ADD },
      Depth.Effects + 3,
    );
    this.trail = add(
      'dot',
      { lifespan: 260, scale: { start: 1.3, end: 0 }, alpha: { start: 0.8, end: 0 }, blendMode: Phaser.BlendModes.ADD },
      Depth.CarFx,
    );
    this.electric = add(
      'spark',
      {
        lifespan: { min: 100, max: 260 },
        speed: { min: 80, max: 320 },
        scale: { start: 1.2, end: 0.3 },
        tint: [0x00e5ff, 0xb8f6ff, 0x5fb8ff],
        blendMode: Phaser.BlendModes.ADD,
        rotate: { min: 0, max: 360 },
      },
      Depth.Effects + 1,
    );

    for (let i = 0; i < SKID_POOL; i++) {
      this.skids.push(scene.add.image(-9999, -9999, 'skid').setDepth(Depth.Skid).setScale(1.1, 0.55).setTint(0x000000).setVisible(false));
    }
    for (let i = 0; i < SCORCH_POOL; i++) {
      this.scorches.push(scene.add.image(-9999, -9999, 'smoke').setDepth(Depth.Skid).setTint(0x000000).setVisible(false));
    }
    for (let i = 0; i < RING_POOL; i++) {
      this.rings.push(scene.add.image(0, 0, 'ring').setDepth(Depth.Effects).setBlendMode(Phaser.BlendModes.ADD).setVisible(false));
    }
    for (let i = 0; i < GHOST_POOL; i++) {
      this.ghosts.push(scene.add.image(0, 0, 'car_viper').setDepth(Depth.CarFx).setBlendMode(Phaser.BlendModes.ADD).setVisible(false));
    }
  }

  // --------------------------------------------------------------- camera
  shake(intensity: number, duration: number): void {
    const k = Storage.getSettings().cameraShake;
    if (k <= 0) return;
    const cam = this.scene.cameras.main;
    // don't let a small shake override a bigger one in progress
    const cur = cam.shakeEffect;
    if (cur.isRunning && cur.intensity.x > intensity * k) return;
    cam.shake(duration, intensity * k, true);
  }

  /** Shake scaled by distance from the camera centre. */
  shakeAt(x: number, y: number, intensity: number, duration: number): void {
    const v = this.scene.cameras.main.worldView;
    const d = Math.hypot(x - v.centerX, y - v.centerY);
    const f = Phaser.Math.Clamp(1 - d / 1100, 0, 1);
    if (f > 0.05) this.shake(intensity * f, duration);
  }

  freeze(ms: number): void {
    this.hitStop = Math.max(this.hitStop, ms);
  }

  // --------------------------------------------------------------- driving
  skid(x: number, y: number, angle: number, alpha: number): void {
    const s = this.skids[this.skidIdx];
    this.skidIdx = (this.skidIdx + 1) % SKID_POOL;
    s.setPosition(x, y).setRotation(angle).setAlpha(alpha).setVisible(true);
  }

  driftSmoke(x: number, y: number, tint: number, charged: boolean): void {
    this.driftPuff.setParticleTint(tint);
    this.driftPuff.emitParticleAt(x + Phaser.Math.Between(-6, 6), y + Phaser.Math.Between(-6, 6), 1);
    if (charged && Math.random() < 0.5) {
      this.sparks.setParticleTint(tint);
      this.sparks.setEmitterAngle({ min: 0, max: 360 });
      this.sparks.explode(1, x, y);
    }
  }

  boostTrail(x: number, y: number, color: number): void {
    this.trail.setParticleTint(color);
    this.trail.emitParticleAt(x, y, 1);
  }

  driftRelease(car: Car, color: number, level: number): void {
    const bx = car.x - Math.cos(car.heading) * 22;
    const by = car.y - Math.sin(car.heading) * 22;
    this.shockwave(bx, by, 40 + level * 18, color, 260);
    this.sparks.setParticleTint(color);
    this.sparks.setEmitterAngle({ min: 0, max: 360 });
    this.sparks.explode(6 + level * 4, bx, by);
    if (car.isPlayer) {
      const labels = ['', 'BOOST', 'SUPER BOOST', 'ULTRA BOOST', 'MAX BOOST!'];
      this.floatText(car.x, car.y - 36, labels[level], color, 16 + level * 2);
    }
  }

  wallSparks(x: number, y: number, nx: number, ny: number, strength: number): void {
    const a = Phaser.Math.RadToDeg(Math.atan2(-ny, -nx));
    this.sparks.setParticleTint(0xffc860);
    this.sparks.setEmitterAngle({ min: a - 70, max: a + 70 });
    this.sparks.explode(Math.min(18, 3 + Math.floor(strength / 40)), x, y);
  }

  // --------------------------------------------------------------- combat
  muzzle(x: number, y: number, angle: number, color: number, size: number): void {
    const em = size > 1 ? this.flashBig : this.flashSmall;
    em.setParticleTint(color);
    em.emitParticleAt(x, y, 1);
    const a = Phaser.Math.RadToDeg(angle);
    this.sparks.setParticleTint(color);
    this.sparks.setEmitterAngle({ min: a - 18, max: a + 18 });
    this.sparks.explode(size > 1 ? 5 : 1, x, y);
    if (size > 1) {
      this.smoke.setParticleTint(0x6a6d75);
      this.smoke.emitParticleAt(x, y, 2);
    }
  }

  impact(x: number, y: number, angle: number, color: number, big: boolean): void {
    const a = Phaser.Math.RadToDeg(angle + Math.PI);
    this.sparks.setParticleTint(color);
    this.sparks.setEmitterAngle({ min: a - 60, max: a + 60 });
    this.sparks.explode(big ? 12 : 4, x, y);
    this.flashSmall.setParticleTint(color);
    this.flashSmall.emitParticleAt(x, y, 1);
    if (big) {
      this.fire.explode(5, x, y);
      this.debris.setEmitterAngle({ min: 0, max: 360 });
      this.debris.explode(4, x, y);
    }
  }

  explosion(x: number, y: number, size: number): void {
    this.flashBig.setParticleTint(0xffe0a0);
    this.flashBig.emitParticleAt(x, y, 2);
    this.fire.explode(Math.round(16 * size), x, y);
    this.smoke.setParticleTint(0x3a3c42);
    this.smoke.explode(Math.round(10 * size), x, y);
    this.debris.setEmitterAngle({ min: 0, max: 360 });
    this.debris.explode(Math.round(12 * size), x, y);
    this.sparks.setParticleTint(0xffb040);
    this.sparks.setEmitterAngle({ min: 0, max: 360 });
    this.sparks.explode(Math.round(16 * size), x, y);
    this.shockwave(x, y, 90 * size, 0xffa040, 320);
    const sc = this.scorches[this.scorchIdx];
    this.scorchIdx = (this.scorchIdx + 1) % SCORCH_POOL;
    sc.setPosition(x, y).setScale(1.4 * size).setAlpha(0.6).setRotation(Math.random() * 6).setVisible(true);
  }

  shockwave(x: number, y: number, radius: number, color: number, duration = 300): void {
    const r = this.rings[this.ringIdx];
    this.ringIdx = (this.ringIdx + 1) % RING_POOL;
    this.scene.tweens.killTweensOf(r);
    r.setPosition(x, y).setTint(color).setAlpha(0.9).setScale(0.1).setVisible(true);
    this.scene.tweens.add({
      targets: r,
      scale: radius / 60,
      alpha: 0,
      duration,
      ease: 'Cubic.easeOut',
      onComplete: () => r.setVisible(false),
    });
  }

  empBurst(x: number, y: number): void {
    this.electric.setEmitterAngle({ min: 0, max: 360 });
    this.electric.explode(40, x, y);
    this.flashBig.setParticleTint(0x00e5ff);
    this.flashBig.emitParticleAt(x, y, 1);
  }

  empHit(x: number, y: number): void {
    this.electric.explode(14, x, y);
  }

  blink(fromX: number, fromY: number, toX: number, toY: number, heading: number, carId: string): void {
    const steps = 5;
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const g = this.ghosts[this.ghostIdx];
      this.ghostIdx = (this.ghostIdx + 1) % GHOST_POOL;
      this.scene.tweens.killTweensOf(g);
      g.setTexture(`car_${carId}`)
        .setPosition(fromX + (toX - fromX) * t, fromY + (toY - fromY) * t)
        .setRotation(heading)
        .setScale(CAR_TEX_SCALE)
        .setTint(0xb04dff)
        .setAlpha(0.15 + 0.5 * t)
        .setVisible(true);
      this.scene.tweens.add({ targets: g, alpha: 0, duration: 380, onComplete: () => g.setVisible(false) });
    }
    this.electric.explode(16, fromX, fromY);
    this.electric.explode(16, toX, toY);
    this.shockwave(toX, toY, 55, 0xb04dff, 250);
  }

  pickup(x: number, y: number, color: number): void {
    this.shockwave(x, y, 60, color, 300);
    this.sparks.setParticleTint(color);
    this.sparks.setEmitterAngle({ min: 0, max: 360 });
    this.sparks.explode(12, x, y);
  }

  // --------------------------------------------------------------- text
  floatText(x: number, y: number, text: string, color: number, size = 16): void {
    let t = this.texts[this.textIdx];
    if (!t) {
      t = this.scene.add
        .text(0, 0, '', {
          fontFamily: 'Orbitron, Rajdhani, sans-serif',
          fontSize: '16px',
          fontStyle: '700',
          color: '#ffffff',
          stroke: '#000000',
          strokeThickness: 4,
        })
        .setOrigin(0.5)
        .setDepth(Depth.Labels + 1);
      this.texts[this.textIdx] = t;
    }
    this.textIdx = (this.textIdx + 1) % TEXT_POOL;
    this.scene.tweens.killTweensOf(t);
    t.setText(text)
      .setFontSize(size)
      .setColor('#' + color.toString(16).padStart(6, '0'))
      .setPosition(x + Phaser.Math.Between(-8, 8), y)
      .setAlpha(1)
      .setScale(1.25)
      .setVisible(true);
    this.scene.tweens.add({
      targets: t,
      y: y - 42,
      scale: 1,
      alpha: 0,
      duration: 750,
      ease: 'Cubic.easeOut',
      onComplete: () => t.setVisible(false),
    });
  }

  damageNumber(x: number, y: number, amount: number, toPlayer: boolean): void {
    const big = amount >= 20;
    this.floatText(x, y - 24, `${Math.round(amount)}`, toPlayer ? 0xff5a5a : big ? 0xffd23f : 0xffffff, big ? 20 : 14);
  }
}
