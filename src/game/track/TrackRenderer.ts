import Phaser from 'phaser';
import type { PathSample, Track } from './Track';
import { Depth } from '../constants';

const CHUNK = 1024;

interface Chunk {
  g: Phaser.GameObjects.Graphics;
  x: number;
  y: number;
}

/** A pseudo-3D box (building, container, crate stack). */
export interface Prop3D {
  /** corners in world space (clockwise) */
  corners: { x: number; y: number }[];
  cx: number;
  cy: number;
  height: number;
  roof: number;
  wall: number;
  trim: number;
  kind: 'building' | 'container';
  /** radius for view culling */
  r: number;
}

/**
 * Draws the static track into camera-culled chunks, plus pseudo-3D props
 * whose roofs are re-projected every frame relative to the camera.
 */
export class TrackRenderer {
  private scene: Phaser.Scene;
  private track: Track;
  private chunks: Chunk[] = [];
  private chunkMap = new Map<string, Chunk>();
  private props: Prop3D[] = [];
  private propGfx: Phaser.GameObjects.Graphics;
  private tmpPts: Phaser.Math.Vector2[] = [0, 1, 2, 3].map(() => new Phaser.Math.Vector2());

  constructor(scene: Phaser.Scene, track: Track) {
    this.scene = scene;
    this.track = track;

    const margin = 1600;
    scene.add
      .tileSprite(-margin, -margin, track.width + margin * 2, track.height + margin * 2, 'ground')
      .setOrigin(0, 0)
      .setDepth(Depth.Ground);

    this.drawRoad();
    this.propGfx = scene.add.graphics().setDepth(Depth.Props);
    this.generateProps();
    this.addLamps();
  }

  addProp(p: Prop3D): void {
    this.props.push(p);
  }

  private chunkFor(layer: number, x: number, y: number): Phaser.GameObjects.Graphics {
    const cx = Math.floor(x / CHUNK);
    const cy = Math.floor(y / CHUNK);
    const key = `${layer}:${cx}:${cy}`;
    let c = this.chunkMap.get(key);
    if (!c) {
      const g = this.scene.add.graphics().setDepth(Depth.Road + layer * 0.1);
      c = { g, x: cx * CHUNK, y: cy * CHUNK };
      this.chunkMap.set(key, c);
      this.chunks.push(c);
    }
    return c.g;
  }

  private quad(layer: number, a: Pt, b: Pt, c: Pt, d: Pt, color: number, alpha = 1): void {
    const g = this.chunkFor(layer, (a.x + c.x) / 2, (a.y + c.y) / 2);
    g.fillStyle(color, alpha);
    g.fillTriangle(a.x, a.y, b.x, b.y, c.x, c.y);
    g.fillTriangle(a.x, a.y, c.x, c.y, d.x, d.y);
  }

  /** Point on the normal of sample i at lateral offset `off` (positive = left side of travel). */
  private offset(samples: PathSample[], i: number, off: number, closed: boolean): Pt {
    const n = samples.length;
    const p = samples[i];
    const prev = samples[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
    const next = samples[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    const l = Math.hypot(tx, ty) || 1;
    tx /= l;
    ty /= l;
    return { x: p.x + ty * off, y: p.y - tx * off };
  }

  /** Band between two lateral offsets, expressed relative to the local half width. */
  private band(
    layer: number,
    samples: PathSample[],
    closed: boolean,
    inner: (p: PathSample) => number,
    outer: (p: PathSample) => number,
    color: (i: number) => number | null,
    alpha = 1,
    skip?: (i: number) => boolean,
  ): void {
    const n = samples.length;
    const count = closed ? n : n - 1;
    for (let i = 0; i < count; i++) {
      if (skip && skip(i)) continue;
      const j = (i + 1) % n;
      const col = color(i);
      if (col === null) continue;
      const a = this.offset(samples, i, inner(samples[i]), closed);
      const b = this.offset(samples, j, inner(samples[j]), closed);
      const c = this.offset(samples, j, outer(samples[j]), closed);
      const d = this.offset(samples, i, outer(samples[i]), closed);
      this.quad(layer, a, b, c, d, col, alpha);
    }
  }

  private drawRoad(): void {
    const t = this.track;
    const paths: { s: PathSample[]; closed: boolean }[] = [
      { s: t.main, closed: true },
      { s: t.shortcut, closed: false },
    ];
    const BARRIER = 20;
    // near the junctions, main-loop edge decorations would be drawn across the shortcut mouth
    const junctions = [t.shortcut[0], t.shortcut[t.shortcut.length - 1]];
    const nearJunction = (p: PathSample, r: number) => junctions.some((j) => Math.hypot(p.x - j.x, p.y - j.y) < r);

    // layer 0: barrier walls (both sides)
    for (const { s, closed } of paths) {
      for (const side of [1, -1]) {
        this.band(0, s, closed, (p) => side * (p.hw - 2), (p) => side * (p.hw + BARRIER), () => 0x3b404c);
        this.band(0, s, closed, (p) => side * (p.hw + BARRIER - 5), (p) => side * (p.hw + BARRIER), () => 0x1a1c22);
      }
    }
    // layer 1: neon strip on barrier tops
    for (const { s, closed } of paths) {
      const neon = closed ? 0xff2d6f : 0xffb000;
      for (const side of [1, -1]) {
        this.band(1, s, closed, (p) => side * (p.hw + 6), (p) => side * (p.hw + 9), () => neon, 0.9);
        this.band(1, s, closed, (p) => side * (p.hw + 2), (p) => side * (p.hw + 13), () => neon, 0.12);
      }
    }
    // layer 2: asphalt
    for (const { s, closed } of paths) {
      this.band(2, s, closed, (p) => -p.hw, (p) => p.hw, (i) => (i % 2 === 0 ? 0x262930 : 0x24272e));
    }
    // layer 3: markings – curbs on corners, edge lines, centre dashes, start grid
    const main = t.main;
    const n = main.length;
    const curvature = main.map((_, i) => {
      const a = main[(i - 2 + n) % n];
      const b = main[(i + 2) % n];
      let d = Math.atan2(b.ty, b.tx) - Math.atan2(a.ty, a.tx);
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      return d;
    });
    for (const side of [1, -1]) {
      this.band(
        3,
        main,
        true,
        (p) => side * (p.hw - 14),
        (p) => side * (p.hw - 2),
        (i) => {
          const k = curvature[i];
          // curbs on the inside of corners
          const inside = (k < 0 && side > 0) || (k > 0 && side < 0);
          if (Math.abs(k) < 0.12 || !inside) return null;
          return i % 2 === 0 ? 0xe8e8ee : 0xd6283c;
        },
        1,
        (i) => nearJunction(main[i], 220),
      );
      this.band(
        3,
        main,
        true,
        (p) => side * (p.hw - 20),
        (p) => side * (p.hw - 17),
        () => 0x9aa0ad,
        0.35,
        (i) => nearJunction(main[i], 220),
      );
    }
    this.band(3, main, true, () => -2, () => 2, (i) => (i % 3 === 0 ? 0xc9ccd6 : null), 0.25);
    // shortcut: hazard stripes on its edges
    for (const side of [1, -1]) {
      this.band(
        3,
        t.shortcut,
        false,
        (p) => side * (p.hw - 8),
        (p) => side * (p.hw - 1),
        (i) => (i % 2 === 0 ? 0xffb000 : 0x151515),
        0.9,
        (i) => i < 3 || i > t.shortcut.length - 5,
      );
    }

    // start / finish line (checkerboard)
    const st = t.pointAt(0);
    const g = this.chunkFor(4, st.x, st.y);
    const ca = Math.cos(st.angle);
    const sa = Math.sin(st.angle);
    const cell = 12;
    const rows = Math.ceil((st.hw * 2) / cell);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < 3; c++) {
        const lat = -st.hw + r * cell;
        const lon = -cell * 1.5 + c * cell;
        const x = st.x + ca * lon - sa * lat;
        const y = st.y + sa * lon + ca * lat;
        g.fillStyle((r + c) % 2 === 0 ? 0xf2f2f2 : 0x111111, 0.95);
        g.fillPoints(
          [
            { x, y },
            { x: x + ca * cell, y: y + sa * cell },
            { x: x + ca * cell - sa * cell, y: y + sa * cell + ca * cell },
            { x: x - sa * cell, y: y + ca * cell },
          ] as Phaser.Types.Math.Vector2Like[],
          true,
        );
      }
    }
    // grid boxes behind the line
    for (let k = 0; k < 4; k++) {
      const s = -120 - k * 90;
      const p = t.pointAt(s);
      const lat = (k % 2 === 0 ? -1 : 1) * p.hw * 0.42;
      const cxp = p.x - Math.sin(p.angle) * lat;
      const cyp = p.y + Math.cos(p.angle) * lat;
      const gg = this.chunkFor(4, cxp, cyp);
      gg.lineStyle(3, 0xd0d4de, 0.5);
      const hw = 22;
      const hl = 34;
      const cA = Math.cos(p.angle);
      const sA = Math.sin(p.angle);
      const pt = (lo: number, la: number) => ({ x: cxp + cA * lo - sA * la, y: cyp + sA * lo + cA * la });
      const a = pt(hl, -hw);
      const b = pt(-hl, -hw);
      const c = pt(-hl, hw);
      const d = pt(hl, hw);
      gg.beginPath();
      gg.moveTo(a.x, a.y);
      gg.lineTo(b.x, b.y);
      gg.lineTo(c.x, c.y);
      gg.lineTo(d.x, d.y);
      gg.strokePath();
    }

    // direction chevrons painted before the hairpin & junction corners
    for (let i = 0; i < n; i += 1) {
      if (Math.abs(curvature[i]) < 0.32 || i % 6 !== 0) continue;
      const p = main[i];
      const dir = curvature[i] > 0 ? 1 : -1;
      const ang = Math.atan2(p.ty, p.tx);
      // outside wall of the corner gets arrows pointing in turn direction
      const lat = -dir * (p.hw + 10);
      const x = p.x - Math.sin(ang) * lat;
      const y = p.y + Math.cos(ang) * lat;
      const gg = this.chunkFor(4, x, y);
      gg.fillStyle(0xffd23f, 0.95);
      const f = 10;
      const ca2 = Math.cos(ang);
      const sa2 = Math.sin(ang);
      const P = (lo: number, la: number) => ({ x: x + ca2 * lo - sa2 * la, y: y + sa2 * lo + ca2 * la });
      const t1 = P(f, 0);
      const t2 = P(-f, -f * 0.8);
      const t3 = P(-f * 0.3, 0);
      const t4 = P(-f, f * 0.8);
      gg.fillTriangle(t1.x, t1.y, t2.x, t2.y, t3.x, t3.y);
      gg.fillTriangle(t1.x, t1.y, t3.x, t3.y, t4.x, t4.y);
    }
  }

  /** Seeded building placement in the off-road areas. */
  private generateProps(): void {
    let seed = 20240917;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const t = this.track;
    const clear = (x: number, y: number, w: number, h: number, pad: number) => {
      for (let yy = y - pad; yy <= y + h + pad; yy += 24) {
        for (let xx = x - pad; xx <= x + w + pad; xx += 24) {
          if (t.isDrivable(xx, yy)) return false;
        }
      }
      return true;
    };
    const taken: { x: number; y: number; w: number; h: number }[] = [];
    const overlaps = (x: number, y: number, w: number, h: number) =>
      taken.some((r) => x < r.x + r.w + 30 && x + w + 30 > r.x && y < r.y + r.h + 30 && y + h + 30 > r.y);

    const palettes = [
      { roof: 0x2a2f3a, wall: 0x1a1d25, trim: 0x00e5ff },
      { roof: 0x33302c, wall: 0x1e1c19, trim: 0xffb000 },
      { roof: 0x2c2733, wall: 0x1b1720, trim: 0xff2d6f },
      { roof: 0x283230, wall: 0x18201e, trim: 0x7dff4a },
    ];
    const containerCols = [0xc2562b, 0x2b6fc2, 0x3f8f45, 0x9a9da6, 0xb8912a];

    // big buildings
    for (let attempt = 0; attempt < 900 && taken.length < 70; attempt++) {
      const w = 160 + rnd() * 260;
      const h = 140 + rnd() * 240;
      const x = -400 + rnd() * (t.width + 800 - w);
      const y = -400 + rnd() * (t.height + 800 - h);
      if (!clear(x, y, w, h, 70) || overlaps(x, y, w, h)) continue;
      taken.push({ x, y, w, h });
      const pal = palettes[Math.floor(rnd() * palettes.length)];
      this.props.push(box(x, y, w, h, 60 + rnd() * 110, pal.roof, pal.wall, pal.trim, 'building'));
    }
    // container stacks
    for (let attempt = 0; attempt < 1400 && taken.length < 190; attempt++) {
      const horiz = rnd() > 0.5;
      const w = horiz ? 110 : 40;
      const h = horiz ? 40 : 110;
      const x = rnd() * (t.width - w);
      const y = rnd() * (t.height - h);
      if (!clear(x, y, w, h, 40) || overlaps(x, y, w, h)) continue;
      taken.push({ x, y, w, h });
      const col = containerCols[Math.floor(rnd() * containerCols.length)];
      this.props.push(box(x, y, w, h, 26 + Math.floor(rnd() * 3) * 22, col, shadeC(col, 0.55), shadeC(col, 1.25), 'container'));
    }
  }

  private addLamps(): void {
    const t = this.track;
    for (let i = 0; i < t.main.length; i += 11) {
      const p = t.main[i];
      const side = i % 22 === 0 ? 1 : -1;
      const x = p.x + p.ty * side * (p.hw + 26);
      const y = p.y - p.tx * side * (p.hw + 26);
      this.scene.add
        .image(x, y, 'glow')
        .setDepth(Depth.Lights)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setScale(3.2)
        .setAlpha(0.12)
        .setTint(i % 3 === 0 ? 0xff2d6f : 0x5fb8ff);
      this.scene.add.image(x, y, 'dot').setDepth(Depth.Props + 1).setScale(0.8).setTint(0xfff4d0);
    }
  }

  /** Called every frame: chunk culling + pseudo-3D prop projection. */
  update(cam: Phaser.Cameras.Scene2D.Camera): void {
    const v = cam.worldView;
    const m = 120;
    for (const c of this.chunks) {
      const vis = c.x < v.right + m && c.x + CHUNK > v.x - m && c.y < v.bottom + m && c.y + CHUNK > v.y - m;
      c.g.setVisible(vis);
    }

    const g = this.propGfx;
    g.clear();
    const camX = v.centerX;
    const camY = v.centerY;
    // perspective strength scales with view size so zoom doesn't change the look
    const persp = 1 / Math.max(900, v.height * 1.25);
    const roof = this.tmpPts;
    for (const p of this.props) {
      if (p.cx + p.r < v.x - 200 || p.cx - p.r > v.right + 200 || p.cy + p.r < v.y - 200 || p.cy - p.r > v.bottom + 200) continue;
      const k = p.height * persp;
      for (let i = 0; i < 4; i++) {
        const c = p.corners[i];
        roof[i].set(c.x + (c.x - camX) * k, c.y + (c.y - camY) * k);
      }
      // walls facing the camera
      for (let i = 0; i < 4; i++) {
        const a = p.corners[i];
        const b = p.corners[(i + 1) % 4];
        const nx = b.y - a.y;
        const ny = -(b.x - a.x);
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        if (nx * (camX - mx) + ny * (camY - my) <= 0) continue;
        const ra = roof[i];
        const rb = roof[(i + 1) % 4];
        const lit = Math.abs(nx) > Math.abs(ny) ? 1.0 : 0.8;
        g.fillStyle(shadeC(p.wall, lit), 1);
        g.fillTriangle(a.x, a.y, b.x, b.y, rb.x, rb.y);
        g.fillTriangle(a.x, a.y, rb.x, rb.y, ra.x, ra.y);
        if (p.kind === 'building') {
          // window strip
          g.fillStyle(p.trim, 0.35);
          const t0 = 0.45;
          const t1 = 0.55;
          const w0a = { x: a.x + (ra.x - a.x) * t0, y: a.y + (ra.y - a.y) * t0 };
          const w0b = { x: b.x + (rb.x - b.x) * t0, y: b.y + (rb.y - b.y) * t0 };
          const w1a = { x: a.x + (ra.x - a.x) * t1, y: a.y + (ra.y - a.y) * t1 };
          const w1b = { x: b.x + (rb.x - b.x) * t1, y: b.y + (rb.y - b.y) * t1 };
          g.fillTriangle(w0a.x, w0a.y, w0b.x, w0b.y, w1b.x, w1b.y);
          g.fillTriangle(w0a.x, w0a.y, w1b.x, w1b.y, w1a.x, w1a.y);
        }
      }
      g.fillStyle(p.roof, 1);
      g.fillTriangle(roof[0].x, roof[0].y, roof[1].x, roof[1].y, roof[2].x, roof[2].y);
      g.fillTriangle(roof[0].x, roof[0].y, roof[2].x, roof[2].y, roof[3].x, roof[3].y);
      if (p.kind === 'building') {
        g.lineStyle(2, p.trim, 0.8);
        g.strokePoints(roof, true, true);
        // rooftop unit
        const cx = (roof[0].x + roof[2].x) / 2;
        const cy = (roof[0].y + roof[2].y) / 2;
        g.fillStyle(shadeC(p.roof, 1.4), 1);
        g.fillRect(cx - 14, cy - 10, 28, 20);
      } else {
        // container ribs
        g.lineStyle(1, p.trim, 0.5);
        for (let r = 1; r < 6; r++) {
          const f = r / 6;
          const long01 = Math.hypot(roof[1].x - roof[0].x, roof[1].y - roof[0].y) > Math.hypot(roof[2].x - roof[1].x, roof[2].y - roof[1].y);
          const [p0, p1, p2, p3] = long01 ? [roof[0], roof[1], roof[3], roof[2]] : [roof[1], roof[2], roof[0], roof[3]];
          g.lineBetween(p0.x + (p1.x - p0.x) * f, p0.y + (p1.y - p0.y) * f, p2.x + (p3.x - p2.x) * f, p2.y + (p3.y - p2.y) * f);
        }
      }
    }
  }
}

interface Pt {
  x: number;
  y: number;
}

export function box(x: number, y: number, w: number, h: number, height: number, roof: number, wall: number, trim: number, kind: Prop3D['kind']): Prop3D {
  return {
    corners: [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ],
    cx: x + w / 2,
    cy: y + h / 2,
    height,
    roof,
    wall,
    trim,
    kind,
    r: Math.hypot(w, h) / 2 + height,
  };
}

/** Rotated box centred at (cx, cy). */
export function orientedBox(cx: number, cy: number, w: number, h: number, angle: number, height: number, roof: number, wall: number, trim: number): Prop3D {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const hw = w / 2;
  const hh = h / 2;
  const pts = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([lx, ly]) => ({ x: cx + c * lx - s * ly, y: cy + s * lx + c * ly }));
  return { corners: pts, cx, cy, height, roof, wall, trim, kind: 'container', r: Math.hypot(w, h) / 2 + height };
}

export function shadeC(c: number, f: number): number {
  const r = Math.min(255, Math.max(0, Math.round(((c >> 16) & 255) * f)));
  const g = Math.min(255, Math.max(0, Math.round(((c >> 8) & 255) * f)));
  const b = Math.min(255, Math.max(0, Math.round((c & 255) * f)));
  return (r << 16) | (g << 8) | b;
}
