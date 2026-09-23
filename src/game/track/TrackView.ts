import * as THREE from 'three';
import type { PathSample, Track } from './Track';
import { textures } from '../render/Textures';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const WALL_H = 22;
const WALL_T = 12;

interface RibbonOpts {
  y0?: number;
  y1?: number;
  /** returns null to skip a quad, or a color for vertex-coloured ribbons */
  color?: (i: number) => number | null;
  skip?: (i: number) => boolean;
  uvScale?: number;
}

/**
 * Builds the static 3D world for a track: road, walls, markings, props and scenery.
 * World (x, y) maps to three (x, 0, y).
 */
export class TrackView {
  readonly group = new THREE.Group();
  /** factory chimney tops – the race session puffs smoke out of them */
  readonly chimneys: { x: number; y: number; h: number }[] = [];
  private track: Track;
  /** footprints already used by scenery (keeps props from overlapping) */
  private taken: { x: number; y: number; w: number; h: number }[] = [];
  private seed = 20240917;
  private rnd = (): number => {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  };

  constructor(track: Track, root: THREE.Object3D) {
    this.track = track;
    root.add(this.group);
    this.buildGround();
    this.buildRoad();
    this.buildWalls();
    this.buildStart();
    this.buildSigns();
    this.buildVerges();
    this.buildGrandstand();
    this.buildBillboards();
    this.buildScenery();
    this.buildIndustry();
    this.buildTrees();
    this.buildHills();
    this.buildLamps();
    this.buildGroundPatches();
    this.buildBushes();
    this.buildPylons();
  }

  // ------------------------------------------------------------ helpers
  /** Lateral offset point (positive = left side of travel), like the 2D renderer. */
  private off(samples: PathSample[], i: number, off: number, closed: boolean): { x: number; y: number } {
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

  /**
   * Strip between two lateral offsets. If y0 !== y1 and inner === outer the strip is a vertical wall.
   */
  private ribbon(
    samples: PathSample[],
    closed: boolean,
    inner: (p: PathSample) => number,
    outer: (p: PathSample) => number,
    mat: THREE.Material,
    o: RibbonOpts = {},
  ): THREE.Mesh {
    const pos: number[] = [];
    const uv: number[] = [];
    const col: number[] = [];
    const n = samples.length;
    const count = closed ? n : n - 1;
    const y0 = o.y0 ?? 0;
    const y1 = o.y1 ?? y0;
    const us = o.uvScale ?? 256;
    const c = new THREE.Color();
    let acc = 0;
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % n;
      const segLen = Math.hypot(samples[j].x - samples[i].x, samples[j].y - samples[i].y);
      if (o.skip?.(i)) {
        acc += segLen;
        continue;
      }
      let colr: number | null = 0xffffff;
      if (o.color) {
        colr = o.color(i);
        if (colr === null) {
          acc += segLen;
          continue;
        }
      }
      const ai = inner(samples[i]);
      const aj = inner(samples[j]);
      const bi = outer(samples[i]);
      const bj = outer(samples[j]);
      const A = this.off(samples, i, ai, closed);
      const B = this.off(samples, j, aj, closed);
      const C = this.off(samples, j, bj, closed);
      const D = this.off(samples, i, bi, closed);
      const quad = [
        [A.x, y0, A.y, acc / us, ai / us],
        [B.x, y0, B.y, (acc + segLen) / us, aj / us],
        [C.x, y1, C.y, (acc + segLen) / us, bj / us + (y1 - y0) / us],
        [D.x, y1, D.y, acc / us, bi / us + (y1 - y0) / us],
      ];
      for (const k of [0, 1, 2, 0, 2, 3]) {
        const q = quad[k];
        pos.push(q[0], q[1], q[2]);
        uv.push(q[3], q[4]);
        if (o.color) {
          c.setHex(colr);
          col.push(c.r, c.g, c.b);
        }
      }
      acc += segLen;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    if (o.color) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    this.group.add(m);
    return m;
  }

  /** True if a point lies on the road of the *other* path (junction mouths). */
  private insideOther(x: number, y: number, path: 0 | 1): boolean {
    for (const s of this.track.segs) {
      if (s.path === path) continue;
      const abx = s.bx - s.ax;
      const aby = s.by - s.ay;
      const t = Math.max(0, Math.min(1, ((x - s.ax) * abx + (y - s.ay) * aby) / (abx * abx + aby * aby || 1)));
      const d = Math.hypot(x - (s.ax + abx * t), y - (s.ay + aby * t));
      if (d < s.hw - 4) return true;
    }
    return false;
  }

  // ------------------------------------------------------------ ground & road
  private buildGround(): void {
    const t = this.track;
    const m = 5000;
    const tex = textures().ground.clone();
    tex.needsUpdate = true;
    tex.repeat.set((t.width + m * 2) / 600, (t.height + m * 2) / 600);
    const g = new THREE.PlaneGeometry(t.width + m * 2, t.height + m * 2);
    g.rotateX(-Math.PI / 2);
    const ground = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 }));
    ground.position.set(t.width / 2, -0.5, t.height / 2);
    ground.receiveShadow = true;
    this.group.add(ground);
  }

  private buildRoad(): void {
    const t = this.track;
    const asphalt = new THREE.MeshStandardMaterial({ map: textures().asphalt, roughness: 0.92, metalness: 0 });
    const asphalt2 = new THREE.MeshStandardMaterial({
      map: textures().asphalt,
      color: 0xd8d0c4,
      roughness: 0.95,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.ribbon(t.main, true, (p) => -p.hw - 4, (p) => p.hw + 4, asphalt, { y0: 0.1, uvScale: 320 }).receiveShadow = true;
    this.ribbon(t.shortcut, false, (p) => -p.hw - 3, (p) => p.hw + 3, asphalt2, { y0: 0.12, uvScale: 320 }).receiveShadow = true;

    const paint = (color: number, opacity = 1) =>
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.7,
        transparent: opacity < 1,
        opacity,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        side: THREE.DoubleSide, // ribbons on the right side are wound the other way
      });
    const vc = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.6,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
      side: THREE.DoubleSide,
    });

    const main = t.main;
    const junctions = [t.shortcut[0], t.shortcut[t.shortcut.length - 1]];
    const nearJunction = (i: number) => junctions.some((j) => Math.hypot(main[i].x - j.x, main[i].y - j.y) < 280);
    const curvature = this.curvature();

    for (const side of [1, -1]) {
      // white edge lines
      this.ribbon(main, true, (p) => side * (p.hw - 22), (p) => side * (p.hw - 17), paint(0xe6e6e0, 0.85), { y0: 0.3, skip: nearJunction }).receiveShadow = true;
      // raised red/white kerbs on the inside of corners
      this.ribbon(main, true, (p) => side * (p.hw - 16), (p) => side * (p.hw - 1), vc, {
        y0: 0.9,
        skip: nearJunction,
        color: (i) => {
          const k = curvature[i];
          const inside = (k < 0 && side > 0) || (k > 0 && side < 0);
          if (Math.abs(k) < 0.12 || !inside) return null;
          return i % 2 === 0 ? 0xeeeeea : 0xc41f2e;
        },
      }).receiveShadow = true;
      // shortcut: yellow/black hazard edges
      this.ribbon(t.shortcut, false, (p) => side * (p.hw - 9), (p) => side * (p.hw - 1), vc, {
        y0: 0.9,
        color: (i) => (i < 3 || i > t.shortcut.length - 5 ? null : i % 2 === 0 ? 0xe0a800 : 0x1a1a1a),
      }).receiveShadow = true;
    }
    // centre dashes
    this.ribbon(main, true, () => -2.5, () => 2.5, paint(0xe6e6e0, 0.8), { y0: 0.3, color: (i) => (i % 3 === 0 ? 0xffffff : null) });
  }

  private curvature(): number[] {
    const main = this.track.main;
    const n = main.length;
    return main.map((_, i) => {
      const a = main[(i - 2 + n) % n];
      const b = main[(i + 2) % n];
      let d = Math.atan2(b.ty, b.tx) - Math.atan2(a.ty, a.tx);
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      return d;
    });
  }

  private buildWalls(): void {
    const t = this.track;
    const tex = textures().concrete;
    // walls are single strips, visible from both sides
    const concrete = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, side: THREE.DoubleSide });
    const concreteTop = new THREE.MeshStandardMaterial({ map: tex, color: 0xd8d6d0, roughness: 0.95, side: THREE.DoubleSide });
    const stripes = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.7,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const curvature = this.curvature();
    const fenceMat = new THREE.MeshStandardMaterial({ map: textures().fence, alphaTest: 0.5, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.5 });
    const tyreSpots: { x: number; y: number }[] = [];
    const postSpots: { x: number; y: number }[] = [];
    const paths: { s: PathSample[]; closed: boolean; path: 0 | 1 }[] = [
      { s: t.main, closed: true, path: 0 },
      { s: t.shortcut, closed: false, path: 1 },
    ];
    for (const { s, closed, path } of paths) {
      for (const side of [1, -1]) {
        const skip = (i: number) => {
          const j = closed ? (i + 1) % s.length : Math.min(i + 1, s.length - 1);
          const a = this.off(s, i, side * (s[i].hw + 8), closed);
          const b = this.off(s, j, side * (s[j].hw + 8), closed);
          return this.insideOther((a.x + b.x) / 2, (a.y + b.y) / 2, path);
        };
        // outside of sharp corners: a tyre wall replaces the concrete face
        const tyres = (i: number) => {
          if (path !== 0) return false;
          const k = curvature[i];
          return Math.abs(k) >= 0.3 && ((k > 0 && side > 0) || (k < 0 && side < 0));
        };
        const walls = [
          this.ribbon(s, closed, (p) => side * (p.hw + 2), (p) => side * (p.hw + 2), concrete, { y0: 0, y1: WALL_H, skip: (i) => skip(i) || tyres(i), uvScale: 110 }),
          this.ribbon(s, closed, (p) => side * (p.hw + 2), (p) => side * (p.hw + 2 + WALL_T), concreteTop, { y0: WALL_H, y1: WALL_H, skip, uvScale: 110 }),
          this.ribbon(s, closed, (p) => side * (p.hw + 2 + WALL_T), (p) => side * (p.hw + 2 + WALL_T), concrete, { y0: 0, y1: WALL_H, skip, uvScale: 110 }),
        ];
        for (const w of walls) {
          w.castShadow = true;
          w.receiveShadow = true;
        }
        // red/white painted barrier faces on the outside of main-loop corners
        if (path === 0) {
          this.ribbon(s, closed, (p) => side * (p.hw + 1.7), (p) => side * (p.hw + 1.7), stripes, {
            y0: 3,
            y1: WALL_H - 3,
            skip: (i) => skip(i) || tyres(i),
            color: (i) => {
              const k = curvature[i];
              const outside = (k > 0 && side > 0) || (k < 0 && side < 0);
              if (Math.abs(k) < 0.14 || !outside) return null;
              return i % 2 === 0 ? 0xeeeeea : 0xc41f2e;
            },
          });
          for (let i = 0; i < s.length; i++) {
            if (!tyres(i) || skip(i)) continue;
            const j = (i + 1) % s.length;
            for (let f = 0; f < 1; f += 0.34) {
              const a = this.off(s, i, side * (s[i].hw + 8), true);
              const b = this.off(s, j, side * (s[j].hw + 8), true);
              tyreSpots.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
            }
          }
          // catch fence on top of the outer edge
          this.ribbon(s, closed, (p) => side * (p.hw + 2 + WALL_T), (p) => side * (p.hw + 2 + WALL_T), fenceMat, {
            y0: WALL_H,
            y1: WALL_H + 42,
            skip,
            uvScale: 42,
          });
          for (let i = 0; i < s.length; i += 2) {
            if (skip(i)) continue;
            const a = this.off(s, i, side * (s[i].hw + 2 + WALL_T), true);
            postSpots.push(a);
          }
        }
      }
    }
    this.buildTyres(tyreSpots);
    // fence posts
    const post = new THREE.CylinderGeometry(0.9, 0.9, 44, 6);
    post.translate(0, WALL_H + 22, 0);
    const posts = new THREE.InstancedMesh(post, new THREE.MeshStandardMaterial({ color: 0x8a8e94, roughness: 0.5, metalness: 0.7 }), postSpots.length);
    const m4 = new THREE.Matrix4();
    postSpots.forEach((p, i) => posts.setMatrixAt(i, m4.makeTranslation(p.x, 0, p.y)));
    this.group.add(posts);
  }

  /** Stacks of old tyres (three high) with painted bands. */
  private buildTyres(spots: { x: number; y: number }[]): void {
    const geo = new THREE.CylinderGeometry(6.5, 6.5, 7, 12);
    geo.translate(0, 3.5, 0);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), spots.length * 3);
    const m4 = new THREE.Matrix4();
    const c = new THREE.Color();
    let k = 0;
    spots.forEach((p, i) => {
      for (let lvl = 0; lvl < 3; lvl++) {
        m4.makeTranslation(p.x, lvl * 7, p.y);
        mesh.setMatrixAt(k, m4);
        c.setHex(lvl === 1 ? (Math.floor(i / 2) % 2 === 0 ? 0xc41f2e : 0xe8e8e4) : 0x1c1c1e);
        mesh.setColorAt(k, c);
        k++;
      }
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  private buildStart(): void {
    const t = this.track;
    const st = t.pointAt(0);
    const tex = textures().checker.clone();
    tex.needsUpdate = true;
    tex.repeat.set(1, (st.hw * 2) / 24);
    const g = new THREE.PlaneGeometry(36, st.hw * 2);
    g.rotateX(-Math.PI / 2);
    const line = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    line.position.set(st.x, 0.4, st.y);
    line.rotation.y = -st.angle;
    line.receiveShadow = true;
    this.group.add(line);

    // steel gantry over the line
    const gantry = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: 0x8c9097, roughness: 0.45, metalness: 0.8 });
    for (const z of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(10, 110, 10), steel);
      pillar.position.set(0, 55, z * (st.hw + 24));
      gantry.add(pillar);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(12, 26, st.hw * 2 + 58), steel);
    beam.position.set(0, 110, 0);
    gantry.add(beam);
    const bannerMat = new THREE.MeshStandardMaterial({ map: textures().banner, roughness: 0.6 });
    for (const x of [-6.2, 6.2]) {
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(st.hw * 2 + 40, 22), bannerMat);
      banner.position.set(x, 110, 0);
      banner.rotation.y = x < 0 ? -Math.PI / 2 : Math.PI / 2;
      gantry.add(banner);
    }
    gantry.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    gantry.position.set(st.x, 0, st.y);
    gantry.rotation.y = -st.angle;
    this.group.add(gantry);
  }

  /** Chevron boards on the outside wall of sharp corners. */
  private buildSigns(): void {
    const t = this.track;
    const main = t.main;
    const n = main.length;
    const curvature = this.curvature();
    const mat = new THREE.MeshStandardMaterial({ map: textures().chevron, roughness: 0.5, side: THREE.DoubleSide });
    const postMat = new THREE.MeshStandardMaterial({ color: 0x55585e, roughness: 0.6, metalness: 0.6 });
    const geo = new THREE.PlaneGeometry(44, 22);
    const postGeo = new THREE.BoxGeometry(2, 14, 2);
    for (let i = 0; i < n; i += 5) {
      const k = curvature[i];
      if (Math.abs(k) < 0.3) continue;
      const dir = k > 0 ? 1 : -1;
      const p = main[i];
      const pos = this.off(main, i, dir * (p.hw + 8), true);
      if (this.insideOther(pos.x, pos.y, 0)) continue;
      const sign = new THREE.Mesh(geo, mat);
      sign.position.set(pos.x, WALL_H + 20, pos.y);
      // face the road; arrows point toward the turn direction
      const ang = Math.atan2(p.ty, p.tx);
      sign.rotation.y = -ang + (dir < 0 ? Math.PI : 0);
      sign.castShadow = true;
      this.group.add(sign);
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(pos.x, WALL_H + 5, pos.y);
      this.group.add(post);
    }
  }

  // ------------------------------------------------------------ scenery
  private clear(x: number, y: number, w: number, h: number, pad: number): boolean {
    for (let yy = y - pad; yy <= y + h + pad; yy += 24) {
      for (let xx = x - pad; xx <= x + w + pad; xx += 24) {
        if (this.track.isDrivable(xx, yy)) return false;
      }
    }
    return true;
  }

  private overlaps(x: number, y: number, w: number, h: number, gap = 30): boolean {
    return this.taken.some((r) => x < r.x + r.w + gap && x + w + gap > r.x && y < r.y + r.h + gap && y + h + gap > r.y);
  }

  private buildScenery(): void {
    const t = this.track;
    const rnd = this.rnd;
    const clear = (x: number, y: number, w: number, h: number, pad: number) => this.clear(x, y, w, h, pad);
    const taken = this.taken;
    const overlaps = (x: number, y: number, w: number, h: number) => this.overlaps(x, y, w, h);

    type B = { x: number; y: number; w: number; h: number; ht: number; v: number; far: boolean };
    const buildings: B[] = [];
    const facades = textures().facades;
    for (let attempt = 0; attempt < 1200 && buildings.length < 80; attempt++) {
      const w = 160 + rnd() * 260;
      const h = 140 + rnd() * 240;
      const x = -600 + rnd() * (t.width + 1200 - w);
      const y = -600 + rnd() * (t.height + 1200 - h);
      if (!clear(x, y, w, h, 90) || overlaps(x, y, w, h)) continue;
      taken.push({ x, y, w, h });
      buildings.push({ x, y, w, h, ht: 60 + rnd() * 150, v: Math.floor(rnd() * facades.length), far: false });
    }
    // distant skyline ring beyond the playfield
    for (let i = 0; i < 70; i++) {
      const a = (i / 70) * Math.PI * 2;
      const rx = t.width / 2 + Math.cos(a) * (t.width * 0.5 + 1500 + rnd() * 900);
      const ry = t.height / 2 + Math.sin(a) * (t.height * 0.5 + 1500 + rnd() * 900);
      const w = 200 + rnd() * 300;
      buildings.push({ x: rx - w / 2, y: ry - w / 2, w, h: w, ht: 200 + rnd() * 450, v: Math.floor(rnd() * facades.length), far: true });
    }

    // merged geometry per facade variant, UVs in world units so windows keep their size
    const TILE = 90;
    const roofMat = new THREE.MeshStandardMaterial({ map: textures().gravel, roughness: 1 });
    const roofPos: number[] = [];
    const roofUv: number[] = [];
    const roofNor: number[] = [];
    facades.forEach((tex, v) => {
      const pos: number[] = [];
      const uv: number[] = [];
      const nor: number[] = [];
      for (const b of buildings) {
        if (b.v !== v) continue;
        const x0 = b.x;
        const x1 = b.x + b.w;
        const z0 = b.y;
        const z1 = b.y + b.h;
        const H = b.ht;
        const faces: [number, number, number, number, number, number, number][] = [
          // ax, az, bx, bz, nx, nz, width
          [x0, z1, x1, z1, 0, 1, b.w],
          [x1, z1, x1, z0, 1, 0, b.h],
          [x1, z0, x0, z0, 0, -1, b.w],
          [x0, z0, x0, z1, -1, 0, b.h],
        ];
        for (const [ax, az, bx, bz, nx, nz, wdt] of faces) {
          const u1 = wdt / TILE;
          const v1 = H / TILE;
          const quad = [
            [ax, 0, az, 0, 0],
            [bx, 0, bz, u1, 0],
            [bx, H, bz, u1, v1],
            [ax, H, az, 0, v1],
          ];
          for (const k of [0, 1, 2, 0, 2, 3]) {
            const q = quad[k];
            pos.push(q[0], q[1], q[2]);
            uv.push(q[3], q[4]);
            nor.push(nx, 0, nz);
          }
        }
        const roof = [
          [x0, H, z0],
          [x0, H, z1],
          [x1, H, z1],
          [x1, H, z0],
        ];
        for (const k of [0, 1, 2, 0, 2, 3]) {
          const q = roof[k];
          roofPos.push(q[0], q[1], q[2]);
          roofUv.push(q[0] / 200, q[2] / 200);
          roofNor.push(0, 1, 0);
        }
      }
      if (!pos.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0.05 }));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    });
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(roofPos, 3));
    rg.setAttribute('uv', new THREE.Float32BufferAttribute(roofUv, 2));
    rg.setAttribute('normal', new THREE.Float32BufferAttribute(roofNor, 3));
    const roofs = new THREE.Mesh(rg, roofMat);
    roofs.receiveShadow = true;
    this.group.add(roofs);

    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    const m4 = new THREE.Matrix4();
    const col = new THREE.Color();

    // rooftop plant: AC units, vents, water tanks
    const near = buildings.filter((b) => !b.far);
    const units = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: 0x9a9c9e, roughness: 0.6, metalness: 0.5 }), near.length * 3);
    let u = 0;
    for (const b of near) {
      for (let k = 0; k < 3; k++) {
        const w = 18 + rnd() * 30;
        const d = 14 + rnd() * 24;
        const hh = 8 + rnd() * 14;
        m4.makeScale(w, hh, d).setPosition(b.x + 20 + rnd() * (b.w - 40), b.ht, b.y + 20 + rnd() * (b.h - 40));
        units.setMatrixAt(u++, m4);
      }
    }
    units.castShadow = true;
    this.group.add(units);

    // antennas and masts on roughly a third of the roofs (near and skyline) – breaks up flat roof lines
    const masts = buildings.filter(() => rnd() < 0.35);
    const mastGeo = new THREE.CylinderGeometry(0.8, 1.4, 1, 5);
    mastGeo.translate(0, 0.5, 0);
    const mastMesh = new THREE.InstancedMesh(mastGeo, new THREE.MeshStandardMaterial({ color: 0x5c5f64, roughness: 0.5, metalness: 0.7 }), masts.length * 2);
    let mi = 0;
    for (const b of masts) {
      for (let k = 0; k < 2; k++) {
        const hh = (b.far ? 40 : 20) + rnd() * (b.far ? 70 : 40);
        const sw = b.far ? 3 : 1.5;
        m4.makeScale(sw, hh, sw).setPosition(b.x + b.w * (0.2 + rnd() * 0.6), b.ht, b.y + b.h * (0.2 + rnd() * 0.6));
        mastMesh.setMatrixAt(mi++, m4);
      }
    }
    mastMesh.count = mi;
    this.group.add(mastMesh);

    // container stacks
    const containerCols = [0xa8472a, 0x2d5f96, 0x3c7340, 0x8d9096, 0xa07c26];
    const cont: { x: number; y: number; w: number; h: number; stack: number; col: number }[] = [];
    for (let attempt = 0; attempt < 1600 && cont.length < 170; attempt++) {
      const horiz = rnd() > 0.5;
      const w = horiz ? 110 : 40;
      const h = horiz ? 40 : 110;
      const x = rnd() * (t.width - w);
      const y = rnd() * (t.height - h);
      if (!clear(x, y, w, h, 40) || overlaps(x, y, w, h)) continue;
      taken.push({ x, y, w, h });
      cont.push({ x, y, w, h, stack: 1 + Math.floor(rnd() * 3), col: containerCols[Math.floor(rnd() * containerCols.length)] });
    }
    const total = cont.reduce((n, c) => n + c.stack, 0);
    const cmesh = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.35 }), total);
    let k = 0;
    for (const c of cont) {
      for (let s = 0; s < c.stack; s++) {
        m4.makeScale(c.w, 26, c.h).setPosition(c.x + c.w / 2, s * 27, c.y + c.h / 2);
        cmesh.setMatrixAt(k, m4);
        col.setHex(c.col).multiplyScalar(0.75 + ((s * 37 + k) % 5) * 0.06);
        cmesh.setColorAt(k, col);
        k++;
      }
    }
    cmesh.castShadow = true;
    cmesh.receiveShadow = true;
    this.group.add(cmesh);
    this.buildYardClutter(cont);

    // on-track obstacle containers
    for (const o of t.def.obstacles) {
      if (o.kind !== 'container') continue;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(o.w ?? 100, 34, o.h ?? 40), new THREE.MeshStandardMaterial({ color: 0xc0501f, roughness: 0.55, metalness: 0.35 }));
      mesh.position.set(o.x, 17, o.y);
      mesh.rotation.y = -(o.angle ?? 0);
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry((o.w ?? 100) + 1, 4, (o.h ?? 40) + 1), new THREE.MeshStandardMaterial({ color: 0xe0a800, roughness: 0.6 }));
      stripe.position.set(o.x, 28, o.y);
      stripe.rotation.y = mesh.rotation.y;
      this.group.add(stripe);
    }
  }

  /** Oil drums, pallets and crates scattered at the foot of container stacks. */
  private buildYardClutter(cont: { x: number; y: number; w: number; h: number }[]): void {
    const rnd = this.rnd;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    type P = { x: number; y: number; kind: 0 | 1 | 2; a: number };
    const props: P[] = [];
    for (const c of cont) {
      if (rnd() > 0.55) continue;
      const n = 1 + Math.floor(rnd() * 4);
      for (let i = 0; i < n; i++) {
        // along one of the long sides, just outside the container
        const alongX = c.w > c.h;
        const off = (rnd() < 0.5 ? -1 : 1) * ((alongX ? c.h : c.w) / 2 + 8 + rnd() * 10);
        const cx = c.x + c.w / 2;
        const cy = c.y + c.h / 2;
        const x = alongX ? cx + (rnd() - 0.5) * c.w : cx + off;
        const y = alongX ? cy + off : cy + (rnd() - 0.5) * c.h;
        if (this.track.isDrivable(x, y) || !this.clear(x - 6, y - 6, 12, 12, 30)) continue;
        props.push({ x, y, kind: Math.floor(rnd() * 3) as 0 | 1 | 2, a: rnd() * 6 });
      }
    }
    const drumGeo = new THREE.CylinderGeometry(4, 4, 11, 10);
    drumGeo.translate(0, 5.5, 0);
    const palletGeo = new THREE.BoxGeometry(14, 2.5, 12);
    palletGeo.translate(0, 1.25, 0);
    const crateGeo = new THREE.BoxGeometry(10, 10, 10);
    crateGeo.translate(0, 5, 0);
    const kinds = [
      { geo: drumGeo, mat: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0.6 }), cols: [0x2d5f96, 0xa8472a, 0x3c7340, 0x8a8e94] },
      { geo: palletGeo, mat: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 }), cols: [0x9a7a52, 0x86683f] },
      { geo: crateGeo, mat: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), cols: [0xa7864f, 0x8f7040, 0xb59460] },
    ];
    kinds.forEach((k, ki) => {
      const list = props.filter((p) => p.kind === ki);
      if (!list.length) return;
      const mesh = new THREE.InstancedMesh(k.geo, k.mat, ki === 0 ? list.length * 3 : list.length * 2);
      let n = 0;
      for (const p of list) {
        // drums come in little clusters, pallets and crates in small stacks
        const count = ki === 0 ? 1 + Math.floor(rnd() * 3) : 1 + Math.floor(rnd() * 2);
        for (let i = 0; i < count; i++) {
          q.setFromAxisAngle(up, p.a + i * 0.7);
          const pos = ki === 0 ? v.set(p.x + (i % 2) * 8.5, 0, p.y + Math.floor(i / 2) * 8.5) : v.set(p.x, i * (ki === 1 ? 2.6 : 10), p.y);
          m4.compose(pos, q, sc.set(1, 1, 1));
          mesh.setMatrixAt(n, m4);
          mesh.setColorAt(n, col.setHex(k.cols[Math.floor(rnd() * k.cols.length)]).multiplyScalar(0.85 + rnd() * 0.2));
          n++;
        }
      }
      mesh.count = n;
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
    });
  }

  /** Grass / gravel verge between the barrier and the industrial yard. */
  private buildVerges(): void {
    const t = this.track;
    const tex = textures().grass;
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const gravel = new THREE.MeshStandardMaterial({ map: textures().gravel, color: 0xb0a590, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const curv = this.curvature();
    for (const side of [1, -1]) {
      const skip = (i: number) => {
        const p = this.off(t.main, i, side * (t.main[i].hw + 45), true);
        return t.isDrivable(p.x, p.y);
      };
      // gravel run-off on the outside of corners, grass elsewhere
      const outside = (i: number) => {
        const k = curv[i];
        return Math.abs(k) >= 0.14 && ((k > 0 && side > 0) || (k < 0 && side < 0));
      };
      this.ribbon(t.main, true, (p) => side * (p.hw + 14), (p) => side * (p.hw + 80), mat, { y0: -0.3, uvScale: 200, skip: (i) => skip(i) || outside(i) }).receiveShadow = true;
      this.ribbon(t.main, true, (p) => side * (p.hw + 14), (p) => side * (p.hw + 80), gravel, { y0: -0.3, uvScale: 150, skip: (i) => skip(i) || !outside(i) }).receiveShadow = true;
    }
  }

  /** Covered grandstand full of spectators along the start straight. */
  private buildGrandstand(): void {
    const t = this.track;
    const st = t.pointAt(-200);
    const len = 700;
    const depth = 120;
    const lat = -(st.hw + 130); // right-hand side of the start straight
    const cx = st.x - Math.sin(st.angle) * lat;
    const cy = st.y + Math.cos(st.angle) * lat;
    const g = new THREE.Group();
    const concrete = new THREE.MeshStandardMaterial({ map: textures().concrete, roughness: 0.9 });
    const crowdTex = textures().crowd.clone();
    crowdTex.needsUpdate = true;
    crowdTex.repeat.set(len / 180, 1);
    const crowd = new THREE.MeshStandardMaterial({ map: crowdTex, roughness: 0.9 });
    // stepped seating: local +z points toward the track
    const steps = 6;
    for (let k = 0; k < steps; k++) {
      const h = 8 + k * 9;
      const d = depth / steps;
      const box = new THREE.Mesh(new THREE.BoxGeometry(len, h, d), [concrete, concrete, concrete, concrete, crowd, concrete]);
      box.position.set(0, h / 2, depth / 2 - d * (k + 0.5));
      box.castShadow = box.receiveShadow = true;
      g.add(box);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(len + 20, 4, depth + 30), new THREE.MeshStandardMaterial({ color: 0xd8dadc, roughness: 0.4, metalness: 0.6 }));
    roof.position.set(0, 110, 0);
    roof.rotation.x = 0.06;
    roof.castShadow = true;
    g.add(roof);
    const steel = new THREE.MeshStandardMaterial({ color: 0x6d7076, roughness: 0.5, metalness: 0.7 });
    for (let x = -len / 2; x <= len / 2; x += len / 5) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(5, 110, 5), steel);
      pillar.position.set(x, 55, -depth / 2 + 4);
      pillar.castShadow = true;
      g.add(pillar);
    }
    g.position.set(cx, 0, cy);
    // face the track: local +z → toward the road centre
    g.rotation.y = -st.angle;
    this.group.add(g);
    const r = Math.max(len, depth) / 2 + 40;
    this.taken.push({ x: cx - r, y: cy - r, w: r * 2, h: r * 2 });
  }

  /** Sponsor boards on the straights. */
  private buildBillboards(): void {
    const t = this.track;
    const curv = this.curvature();
    const boards = textures().billboards;
    const back = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.7 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x6d7076, roughness: 0.5, metalness: 0.7 });
    let n = 0;
    for (let i = 20; i < t.main.length; i += 23) {
      let straight = true;
      for (let k = -4; k <= 4; k++) if (Math.abs(curv[(i + k + t.main.length) % t.main.length]) > 0.06) straight = false;
      if (!straight) continue;
      const side = n % 2 === 0 ? 1 : -1;
      const p = t.main[i];
      const pos = this.off(t.main, i, side * (p.hw + 70), true);
      if (!this.clear(pos.x - 90, pos.y - 90, 180, 180, 0)) continue;
      const g = new THREE.Group();
      const face = new THREE.Mesh(new THREE.PlaneGeometry(170, 42), new THREE.MeshStandardMaterial({ map: boards[n % boards.length], roughness: 0.5 }));
      face.position.set(0, 70, 1.5);
      const panel = new THREE.Mesh(new THREE.BoxGeometry(174, 46, 2.5), back);
      panel.position.set(0, 70, 0);
      g.add(panel, face);
      for (const x of [-60, 60]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(4, 50, 4), steel);
        leg.position.set(x, 25, 0);
        g.add(leg);
      }
      g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
      g.position.set(pos.x, 0, pos.y);
      // plane faces local +z; turn it toward the road
      const ang = Math.atan2(p.ty, p.tx);
      g.rotation.y = -ang + (side > 0 ? 0 : Math.PI);
      this.group.add(g);
      this.taken.push({ x: pos.x - 95, y: pos.y - 95, w: 190, h: 190 });
      n++;
    }
  }

  /** Smokestacks and tower cranes – industrial landmarks you can see from the track. */
  private buildIndustry(): void {
    const t = this.track;
    const rnd = this.rnd;
    const brick = new THREE.MeshStandardMaterial({ map: textures().facades[1], roughness: 0.9 });
    const white = new THREE.MeshStandardMaterial({ color: 0xe8e8e4, roughness: 0.7 });
    const red = new THREE.MeshStandardMaterial({ color: 0xb8231f, roughness: 0.7 });
    for (let attempt = 0; attempt < 400 && this.chimneys.length < 4; attempt++) {
      const x = rnd() * t.width;
      const y = rnd() * t.height;
      if (!this.clear(x - 40, y - 40, 80, 80, 120) || this.overlaps(x - 40, y - 40, 80, 80)) continue;
      const h = 260 + rnd() * 120;
      const stack = new THREE.Mesh(new THREE.CylinderGeometry(14, 24, h, 16), brick);
      stack.position.set(x, h / 2, y);
      stack.castShadow = true;
      this.group.add(stack);
      for (const [yy, m] of [
        [h - 20, red],
        [h - 36, white],
        [h - 52, red],
      ] as [number, THREE.Material][]) {
        const band = new THREE.Mesh(new THREE.CylinderGeometry(15.5, 16, 14, 16), m);
        band.position.set(x, yy, y);
        this.group.add(band);
      }
      this.chimneys.push({ x, y, h });
      this.taken.push({ x: x - 50, y: y - 50, w: 100, h: 100 });
    }
    const yellow = new THREE.MeshStandardMaterial({ color: 0xe0a800, roughness: 0.6, metalness: 0.4 });
    const grey = new THREE.MeshStandardMaterial({ color: 0x55585e, roughness: 0.7 });
    let cranes = 0;
    for (let attempt = 0; attempt < 400 && cranes < 3; attempt++) {
      const x = rnd() * t.width;
      const y = rnd() * t.height;
      if (!this.clear(x - 30, y - 30, 60, 60, 110) || this.overlaps(x - 30, y - 30, 60, 60)) continue;
      const h = 330 + rnd() * 80;
      const g = new THREE.Group();
      const mast = new THREE.Mesh(new THREE.BoxGeometry(14, h, 14), yellow);
      mast.position.y = h / 2;
      const jib = new THREE.Mesh(new THREE.BoxGeometry(300, 9, 9), yellow);
      jib.position.set(100, h + 8, 0);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(16, 12, 16), grey);
      cab.position.set(0, h - 4, 12);
      const weight = new THREE.Mesh(new THREE.BoxGeometry(30, 18, 16), grey);
      weight.position.set(-45, h + 4, 0);
      const cable = new THREE.Mesh(new THREE.BoxGeometry(1, 150, 1), grey);
      cable.position.set(180, h - 70, 0);
      g.add(mast, jib, cab, weight, cable);
      g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
      g.position.set(x, 0, y);
      g.rotation.y = rnd() * Math.PI * 2;
      this.group.add(g);
      this.taken.push({ x: x - 40, y: y - 40, w: 80, h: 80 });
      cranes++;
    }
  }

  private buildTrees(): void {
    const t = this.track;
    const rnd = this.rnd;
    const spots: { x: number; y: number; s: number }[] = [];
    for (let attempt = 0; attempt < 3000 && spots.length < 220; attempt++) {
      const x = -300 + rnd() * (t.width + 600);
      const y = -300 + rnd() * (t.height + 600);
      if (!this.clear(x - 12, y - 12, 24, 24, 70) || this.overlaps(x - 12, y - 12, 24, 24, 20)) continue;
      spots.push({ x, y, s: 0.8 + rnd() * 0.7 });
      this.taken.push({ x: x - 12, y: y - 12, w: 24, h: 24 });
    }
    const trunkGeo = new THREE.CylinderGeometry(2.5, 3.5, 30, 6);
    trunkGeo.translate(0, 15, 0);
    const leafGeo = new THREE.IcosahedronGeometry(22, 1);
    leafGeo.translate(0, 44, 0);
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x5a4330, roughness: 1 }), spots.length);
    const leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), spots.length);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const c = new THREE.Color();
    const greens = [0x4d6b34, 0x5b7a3a, 0x3f5a2c, 0x6b7f3c];
    spots.forEach((p, i) => {
      q.setFromAxisAngle(v.set(0, 1, 0), rnd() * 6);
      m4.compose(v.set(p.x, 0, p.y), q, sc.set(p.s, p.s * (0.9 + rnd() * 0.3), p.s));
      trunks.setMatrixAt(i, m4);
      leaves.setMatrixAt(i, m4);
      leaves.setColorAt(i, c.setHex(greens[i % greens.length]));
    });
    trunks.castShadow = leaves.castShadow = true;
    this.group.add(trunks, leaves);

    // every third tree becomes a conifer: two stacked cones over the same trunk
    const firs = spots.filter((_, i) => i % 3 === 1);
    const coneA = new THREE.ConeGeometry(20, 42, 7);
    coneA.translate(0, 46, 0);
    const coneB = new THREE.ConeGeometry(14, 32, 7);
    coneB.translate(0, 66, 0);
    const firGeo = mergeGeometries([coneA, coneB]);
    const firs3 = new THREE.InstancedMesh(firGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), firs.length);
    const firGreens = [0x2f4a2a, 0x36532e, 0x2a4226];
    firs.forEach((p, i) => {
      q.setFromAxisAngle(v.set(0, 1, 0), rnd() * 6);
      m4.compose(v.set(p.x, 0, p.y), q, sc.set(p.s, p.s * (1 + rnd() * 0.3), p.s));
      firs3.setMatrixAt(i, m4);
      firs3.setColorAt(i, c.setHex(firGreens[i % firGreens.length]));
      // hide the round crown this conifer replaces
      leaves.setMatrixAt(spots.indexOf(p), new THREE.Matrix4().makeScale(0, 0, 0));
    });
    firs3.castShadow = true;
    this.group.add(firs3);
  }

  /** Irregular patches of grass, dirt and gravel breaking up the flat concrete yard. */
  private buildGroundPatches(): void {
    const t = this.track;
    const rnd = this.rnd;
    // a lumpy disc: radius wobbles around the rim so patches don't read as circles
    const geo = new THREE.CircleGeometry(1, 24);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 1; i < pos.count; i++) {
      const a = Math.atan2(pos.getY(i), pos.getX(i));
      const k = 0.85 + 0.12 * Math.sin(a * 2 + 0.6) + 0.08 * Math.sin(a * 3 + 2.1) + 0.04 * Math.sin(a * 5);
      pos.setXY(i, pos.getX(i) * k, pos.getY(i) * k);
    }
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ map: textures().grass, color: 0xffffff, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const n = 260;
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const c = new THREE.Color();
    // tints over the grass texture: lush, dry, dirt, gravel-grey
    const tints = [0xe4ecd0, 0xfff0c0, 0xd8b890, 0xe0dcd4];
    let k = 0;
    for (let attempt = 0; attempt < 4000 && k < n; attempt++) {
      const r = 40 + rnd() * 140;
      const x = -800 + rnd() * (t.width + 1600);
      const y = -800 + rnd() * (t.height + 1600);
      if (!this.clear(x - r, y - r, r * 2, r * 2, 20)) continue;
      q.setFromAxisAngle(up, rnd() * 6);
      m4.compose(v.set(x, 0.15, y), q, sc.set(r, 1, r * (0.5 + rnd() * 0.6)));
      mesh.setMatrixAt(k, m4);
      mesh.setColorAt(k, c.setHex(tints[Math.floor(rnd() * tints.length)]));
      k++;
    }
    mesh.count = k;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  /** Low shrubs dotted along the verges and around trees. */
  private buildBushes(): void {
    const t = this.track;
    const rnd = this.rnd;
    const spots: { x: number; y: number; s: number }[] = [];
    for (let attempt = 0; attempt < 5000 && spots.length < 420; attempt++) {
      const x = -200 + rnd() * (t.width + 400);
      const y = -200 + rnd() * (t.height + 400);
      if (!this.clear(x - 8, y - 8, 16, 16, 45) || this.overlaps(x - 8, y - 8, 16, 16, 4)) continue;
      spots.push({ x, y, s: 0.6 + rnd() * 0.8 });
    }
    const geo = new THREE.IcosahedronGeometry(9, 0);
    geo.scale(1.8, 1.05, 1.5);
    geo.translate(0, 4, 0);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }), spots.length);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const c = new THREE.Color();
    const cols = [0x55733a, 0x4a6633, 0x677f3f, 0x7a8546];
    spots.forEach((p, i) => {
      q.setFromAxisAngle(v.set(0, 1, 0), rnd() * 6);
      m4.compose(v.set(p.x, 0, p.y), q, sc.set(p.s, p.s * (0.8 + rnd() * 0.5), p.s));
      mesh.setMatrixAt(i, m4);
      mesh.setColorAt(i, c.setHex(cols[Math.floor(rnd() * cols.length)]));
    });
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  /** A line of high-voltage pylons with sagging cables crossing the far landscape. */
  private buildPylons(): void {
    const t = this.track;
    const rnd = this.rnd;
    const cx = t.width / 2;
    const cy = t.height / 2;
    const steel = new THREE.MeshStandardMaterial({ color: 0x7a7e84, roughness: 0.6, metalness: 0.6 });
    const cableMat = new THREE.LineBasicMaterial({ color: 0x2a2c30 });
    // elliptical ring between the yard (<= +600) and the distant skyline (>= +1500)
    const RX = t.width * 0.5 + 1050;
    const RY = t.height * 0.5 + 1050;
    const a0 = rnd() * Math.PI * 2;
    const n = 16;
    const tops: THREE.Vector3[] = [];
    // tapered four-sided tower (reads as a lattice pylon at distance) + 2 cross arms
    const H = 230;
    const towerGeo = new THREE.CylinderGeometry(2.5, 17, H + 25, 4, 1);
    towerGeo.rotateY(Math.PI / 4);
    towerGeo.translate(0, (H + 25) / 2, 0);
    const towers = new THREE.InstancedMesh(towerGeo, steel, n);
    const arms = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), steel, n * 2);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < n; i++) {
      // an arc sweeping part of the way round the circuit
      const a = a0 + (i / (n - 1)) * Math.PI * 1.1;
      const px = cx + Math.cos(a) * RX;
      const pz = cy + Math.sin(a) * RY;
      // face along the local tangent of the ellipse
      const yaw = -Math.atan2(Math.cos(a) * RY, -Math.sin(a) * RX);
      q.setFromAxisAngle(up, yaw);
      m4.compose(v.set(px, 0, pz), q, sc.set(1, 1, 1));
      towers.setMatrixAt(i, m4);
      for (let k = 0; k < 2; k++) {
        m4.compose(v.set(px, H * (0.72 + k * 0.2), pz), q, sc.set(4, 4, k ? 70 : 100));
        arms.setMatrixAt(i * 2 + k, m4);
      }
      tops.push(new THREE.Vector3(px, H * 0.72, pz));
    }
    towers.castShadow = arms.castShadow = true;
    this.group.add(towers, arms);
    // three sagging cables per span, hung from the lower arm tips
    const pts: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const A = tops[i];
      const B = tops[i + 1];
      const dir = new THREE.Vector3().subVectors(B, A).setY(0).normalize();
      const side = new THREE.Vector3(-dir.z, 0, dir.x);
      for (const o of [-46, 0, 46]) {
        let prev: THREE.Vector3 | null = null;
        for (let s = 0; s <= 12; s++) {
          const k = s / 12;
          const p = new THREE.Vector3().lerpVectors(A, B, k).addScaledVector(side, o);
          p.y -= Math.sin(k * Math.PI) * 45;
          if (prev) pts.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
          prev = p;
        }
      }
    }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.group.add(new THREE.LineSegments(cg, cableMat));
  }

  /** Low-poly hills on the horizon (softened by fog). */
  private buildHills(): void {
    const t = this.track;
    const rnd = this.rnd;
    const mat = new THREE.MeshStandardMaterial({ color: 0x6f7a62, roughness: 1, flatShading: true });
    const cx = t.width / 2;
    const cy = t.height / 2;
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2 + rnd() * 0.2;
      const d = 7200 + rnd() * 1500;
      const r = 1300 + rnd() * 1400;
      const h = 450 + rnd() * 650;
      const hill = new THREE.Mesh(new THREE.ConeGeometry(r, h, 7, 1), mat);
      hill.position.set(cx + Math.cos(a) * d, h / 2 - 20, cy + Math.sin(a) * d);
      hill.rotation.y = rnd() * 6;
      this.group.add(hill);
    }
  }

  private buildLamps(): void {
    const t = this.track;
    const spots: { x: number; y: number; a: number }[] = [];
    for (let i = 0; i < t.main.length; i += 11) {
      const p = t.main[i];
      const side = i % 22 === 0 ? 1 : -1;
      const pos = this.off(t.main, i, side * (p.hw + 30), true);
      if (t.isDrivable(pos.x, pos.y)) continue;
      // arm points back over the road
      spots.push({ x: pos.x, y: pos.y, a: Math.atan2(p.y - pos.y, p.x - pos.x) });
    }
    const metal = new THREE.MeshStandardMaterial({ color: 0x6d7076, roughness: 0.5, metalness: 0.7 });
    const pole = new THREE.CylinderGeometry(1.6, 2.4, 100, 8);
    pole.translate(0, 50, 0);
    const arm = new THREE.BoxGeometry(34, 2, 2);
    arm.translate(17, 0, 0);
    const head = new THREE.BoxGeometry(14, 3, 8);
    head.translate(32, -2, 0);
    const poles = new THREE.InstancedMesh(pole, metal, spots.length);
    const arms = new THREE.InstancedMesh(arm, metal, spots.length);
    const heads = new THREE.InstancedMesh(head, new THREE.MeshStandardMaterial({ color: 0xd8d8d0, roughness: 0.3 }), spots.length);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0);
    spots.forEach((s, i) => {
      m4.makeTranslation(s.x, 0, s.y);
      poles.setMatrixAt(i, m4);
      q.setFromAxisAngle(up, -s.a);
      m4.compose(new THREE.Vector3(s.x, 98, s.y), q, one);
      arms.setMatrixAt(i, m4);
      heads.setMatrixAt(i, m4);
    });
    for (const m of [poles, arms, heads]) m.castShadow = true;
    this.group.add(poles, arms, heads);
  }
}
