import Phaser from 'phaser';
import { CARS, CAR_IDS, type CarStats } from './data/cars';

/**
 * All graphics are generated procedurally at boot – no image files needed.
 * Car textures are drawn at 2x and displayed at 0.5 scale for crispness.
 */
export const CAR_TEX_SCALE = 0.5;
export const CAR_TEX_W = 104;
export const CAR_TEX_H = 56;

type Ctx = CanvasRenderingContext2D;

function css(c: number, a = 1): string {
  const r = (c >> 16) & 255;
  const g = (c >> 8) & 255;
  const b = c & 255;
  return `rgba(${r},${g},${b},${a})`;
}

function shade(c: number, f: number): number {
  const r = Math.min(255, Math.max(0, ((c >> 16) & 255) * f));
  const g = Math.min(255, Math.max(0, ((c >> 8) & 255) * f));
  const b = Math.min(255, Math.max(0, (c & 255) * f));
  return (r << 16) | (g << 8) | b;
}

function canvas(scene: Phaser.Scene, key: string, w: number, h: number, draw: (ctx: Ctx) => void): void {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return;
  const ctx = tex.getContext();
  draw(ctx);
  tex.refresh();
}

function poly(ctx: Ctx, pts: number[][]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawCar(ctx: Ctx, car: CarStats, silhouette = false): void {
  const W = CAR_TEX_W;
  const H = CAR_TEX_H;
  const cy = H / 2;
  const body = silhouette ? '#000' : css(car.color);
  const dark = silhouette ? '#000' : css(shade(car.color, 0.45));
  const accent = css(car.accent);

  // wheels
  if (!silhouette) {
    ctx.fillStyle = '#0b0b0e';
    const wheel = (x: number, y: number, w = 18, h = 9) => roundRect(ctx, x, y, w, h, 3);
    wheel(14, 3);
    ctx.fill();
    wheel(14, H - 12);
    ctx.fill();
    wheel(68, 4);
    ctx.fill();
    wheel(68, H - 13);
    ctx.fill();
  }

  // body shape
  ctx.fillStyle = body;
  switch (car.shape) {
    case 'wedge':
      poly(ctx, [
        [6, 12],
        [30, 7],
        [78, 9],
        [100, 22],
        [100, 34],
        [78, 47],
        [30, 49],
        [6, 44],
      ]);
      break;
    case 'brick':
      roundRect(ctx, 4, 6, 94, 44, 6);
      break;
    case 'dart':
      poly(ctx, [
        [4, 8],
        [22, 14],
        [60, 10],
        [102, 26],
        [102, 30],
        [60, 46],
        [22, 42],
        [4, 48],
        [12, 28],
      ]);
      break;
    case 'coil':
      roundRect(ctx, 6, 8, 92, 40, 16);
      break;
  }
  ctx.fill();
  if (silhouette) return;
  ctx.lineWidth = 2;
  ctx.strokeStyle = dark;
  ctx.stroke();

  // shading gradient across the body for a bit of volume
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(255,255,255,0.28)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = grad;
  ctx.fill();

  // accent stripes / details
  ctx.fillStyle = accent;
  switch (car.shape) {
    case 'wedge':
      ctx.fillRect(10, cy - 3, 86, 6);
      break;
    case 'brick':
      ctx.fillRect(94, 8, 8, 40); // bull bar
      ctx.fillStyle = css(shade(car.color, 0.7));
      for (let i = 0; i < 4; i++) ctx.fillRect(12 + i * 8, 10, 4, 36);
      break;
    case 'dart':
      poly(ctx, [
        [4, 8],
        [20, 14],
        [16, 20],
      ]);
      ctx.fill();
      poly(ctx, [
        [4, 48],
        [20, 42],
        [16, 36],
      ]);
      ctx.fill();
      ctx.fillRect(40, cy - 2, 58, 4);
      break;
    case 'coil':
      ctx.strokeStyle = accent;
      ctx.lineWidth = 3;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(22 + i * 10, cy, 12, -1.2, 1.2);
        ctx.stroke();
      }
      break;
  }

  // cockpit glass
  const gx = car.shape === 'brick' ? 50 : 48;
  ctx.fillStyle = 'rgba(10,20,35,0.92)';
  roundRect(ctx, gx, cy - 12, 24, 24, 6);
  ctx.fill();
  ctx.fillStyle = 'rgba(120,200,255,0.35)';
  roundRect(ctx, gx + 14, cy - 10, 8, 20, 3);
  ctx.fill();

  // headlights & tail lights
  ctx.fillStyle = '#fffbe0';
  ctx.fillRect(W - 10, 13, 5, 7);
  ctx.fillRect(W - 10, H - 20, 5, 7);
  ctx.fillStyle = '#ff2030';
  ctx.fillRect(4, 10, 4, 9);
  ctx.fillRect(4, H - 19, 4, 9);
}

export function generateTextures(scene: Phaser.Scene): void {
  // ---- cars ----
  for (const id of CAR_IDS) {
    const car = CARS[id];
    canvas(scene, `car_${id}`, CAR_TEX_W, CAR_TEX_H, (ctx) => drawCar(ctx, car));
    canvas(scene, `car_${id}_shadow`, CAR_TEX_W, CAR_TEX_H, (ctx) => drawCar(ctx, car, true));
    // burnt wreck
    canvas(scene, `car_${id}_wreck`, CAR_TEX_W, CAR_TEX_H, (ctx) => {
      drawCar(ctx, { ...car, color: 0x2a2522, accent: 0x151210 });
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, 0, CAR_TEX_W, CAR_TEX_H);
    });
  }

  // turret (points along +x)
  canvas(scene, 'turret', 40, 20, (ctx) => {
    ctx.fillStyle = '#1b1e25';
    ctx.fillRect(14, 7, 24, 6);
    ctx.fillStyle = '#c8d0dc';
    ctx.fillRect(16, 8, 22, 4);
    ctx.beginPath();
    ctx.arc(12, 10, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#20242c';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#9aa4b5';
    ctx.stroke();
  });

  // ---- soft glow / particles ----
  canvas(scene, 'glow', 64, 64, (ctx) => {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  });
  canvas(scene, 'dot', 16, 16, (ctx) => {
    const g = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.8)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 16, 16);
  });
  canvas(scene, 'smoke', 64, 64, (ctx) => {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.22)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  });
  canvas(scene, 'spark', 16, 4, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 16, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(255,255,255,1)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 16, 4);
  });
  canvas(scene, 'debris', 8, 6, (ctx) => {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 8, 6);
  });
  canvas(scene, 'ring', 128, 128, (ctx) => {
    ctx.strokeStyle = 'rgba(255,255,255,1)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(64, 64, 58, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 14;
    ctx.stroke();
  });
  canvas(scene, 'headlight', 128, 64, (ctx) => {
    const g = ctx.createRadialGradient(0, 32, 0, 0, 32, 128);
    g.addColorStop(0, 'rgba(255,250,220,0.55)');
    g.addColorStop(1, 'rgba(255,250,220,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 26);
    ctx.lineTo(128, 0);
    ctx.lineTo(128, 64);
    ctx.lineTo(0, 38);
    ctx.closePath();
    ctx.fill();
  });
  canvas(scene, 'skid', 8, 8, (ctx) => {
    ctx.fillStyle = 'rgba(0,0,0,1)';
    ctx.fillRect(0, 0, 8, 8);
  });
  canvas(scene, 'flame', 48, 20, (ctx) => {
    const g = ctx.createLinearGradient(48, 0, 0, 0);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.3, 'rgba(120,220,255,0.9)');
    g.addColorStop(1, 'rgba(60,80,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(48, 4);
    ctx.quadraticCurveTo(10, 6, 0, 10);
    ctx.quadraticCurveTo(10, 14, 48, 16);
    ctx.closePath();
    ctx.fill();
  });

  // ---- projectiles ----
  canvas(scene, 'bullet', 18, 6, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 18, 0);
    g.addColorStop(0, 'rgba(255,220,120,0)');
    g.addColorStop(1, 'rgba(255,250,210,1)');
    ctx.fillStyle = g;
    roundRect(ctx, 0, 1, 18, 4, 2);
    ctx.fill();
  });
  canvas(scene, 'shell', 22, 12, (ctx) => {
    ctx.fillStyle = 'rgba(255,140,40,0.5)';
    roundRect(ctx, 0, 1, 22, 10, 5);
    ctx.fill();
    ctx.fillStyle = '#ffe0a0';
    roundRect(ctx, 8, 3, 13, 6, 3);
    ctx.fill();
  });
  canvas(scene, 'rocket', 28, 12, (ctx) => {
    ctx.fillStyle = '#d8dde6';
    roundRect(ctx, 4, 3, 20, 6, 3);
    ctx.fill();
    ctx.fillStyle = '#ff2d55';
    poly(ctx, [
      [22, 3],
      [28, 6],
      [22, 9],
    ]);
    ctx.fill();
    ctx.fillStyle = '#6b7280';
    poly(ctx, [
      [4, 3],
      [0, 0],
      [8, 3],
    ]);
    ctx.fill();
    poly(ctx, [
      [4, 9],
      [0, 12],
      [8, 9],
    ]);
    ctx.fill();
  });
  canvas(scene, 'mine', 32, 32, (ctx) => {
    ctx.fillStyle = '#23262e';
    ctx.beginPath();
    ctx.arc(16, 16, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffb000';
    ctx.lineWidth = 3;
    ctx.stroke();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.fillStyle = '#ffb000';
      ctx.fillRect(16 + Math.cos(a) * 12 - 2, 16 + Math.sin(a) * 12 - 2, 4, 4);
    }
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(16, 16, 4, 0, Math.PI * 2);
    ctx.fill();
  });

  // ---- props ----
  canvas(scene, 'barrel', 36, 36, (ctx) => {
    const g = ctx.createRadialGradient(14, 14, 2, 18, 18, 17);
    g.addColorStop(0, '#6ea3c8');
    g.addColorStop(1, '#1f3d57');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(18, 18, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0d1b27';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(18, 18, 10, 0, Math.PI * 2);
    ctx.stroke();
  });
  canvas(scene, 'barrel_x', 36, 36, (ctx) => {
    const g = ctx.createRadialGradient(14, 14, 2, 18, 18, 17);
    g.addColorStop(0, '#ff6a4d');
    g.addColorStop(1, '#6d0f0a');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(18, 18, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2a0503';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#ffd23f';
    poly(ctx, [
      [18, 7],
      [28, 25],
      [8, 25],
    ]);
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.fillRect(17, 13, 2, 7);
    ctx.fillRect(17, 21, 2, 2);
  });

  // ---- pickups ----
  const pickup = (key: string, color: string, icon: (ctx: Ctx) => void) =>
    canvas(scene, key, 48, 48, (ctx) => {
      ctx.save();
      ctx.translate(24, 24);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = 'rgba(8,10,16,0.85)';
      roundRect(ctx, -15, -15, 30, 30, 5);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = color;
      icon(ctx);
    });
  pickup('pickup_energy', '#00e5ff', (ctx) => {
    poly(ctx, [
      [27, 12],
      [17, 26],
      [23, 26],
      [20, 36],
      [31, 21],
      [25, 21],
    ]);
    ctx.fill();
  });
  pickup('pickup_boost', '#ffb000', (ctx) => {
    poly(ctx, [
      [16, 16],
      [24, 24],
      [16, 32],
      [16, 28],
      [20, 24],
      [16, 20],
    ]);
    ctx.fill();
    poly(ctx, [
      [24, 16],
      [32, 24],
      [24, 32],
      [24, 28],
      [28, 24],
      [24, 20],
    ]);
    ctx.fill();
  });
  pickup('pickup_repair', '#7dff4a', (ctx) => {
    ctx.fillRect(21, 14, 6, 20);
    ctx.fillRect(14, 21, 20, 6);
  });

  // ---- ground tile (concrete with faint grid & stains) ----
  canvas(scene, 'ground', 256, 256, (ctx) => {
    ctx.fillStyle = '#15171d';
    ctx.fillRect(0, 0, 256, 256);
    // noise speckles (deterministic)
    let seed = 1337;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 900; i++) {
      const v = 18 + Math.floor(rnd() * 14);
      ctx.fillStyle = `rgba(${v + 10},${v + 12},${v + 18},${0.35 + rnd() * 0.4})`;
      ctx.fillRect(rnd() * 256, rnd() * 256, 1 + rnd() * 2, 1 + rnd() * 2);
    }
    for (let i = 0; i < 5; i++) {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 40);
      g.addColorStop(0, 'rgba(0,0,0,0.25)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.save();
      ctx.translate(rnd() * 256, rnd() * 256);
      ctx.scale(1 + rnd(), 0.6 + rnd() * 0.5);
      ctx.fillStyle = g;
      ctx.fillRect(-40, -40, 80, 80);
      ctx.restore();
    }
    ctx.strokeStyle = 'rgba(80,90,110,0.18)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, 254, 254);
    ctx.strokeStyle = 'rgba(80,90,110,0.08)';
    ctx.beginPath();
    ctx.moveTo(128, 0);
    ctx.lineTo(128, 256);
    ctx.moveTo(0, 128);
    ctx.lineTo(256, 128);
    ctx.stroke();
  });
}
