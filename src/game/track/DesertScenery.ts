import * as THREE from 'three';
import { desertModel, prop, surfaceMaterial, foliageMaterial, type ModelAsset } from '../render/Assets';
import type { Track } from './Track';

/**
 * Canyon Run's surroundings: dunes, sandstone canyon walls along the S, mesas and buttes
 * (Blender models, art/blender/desert.py), the stone arch over the top straight, the RAGE CIRCUIT
 * letters in the infield, saguaros, boulders, dry scrub and a few nodding oil pumpjacks.
 */

// ------------------------------------------------------------------ noise
function hash(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, seed);
  const b = hash(ix + 1, iy, seed);
  const c = hash(ix, iy + 1, seed);
  const d = hash(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm(x: number, y: number, seed: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(x, y, seed + o * 17) * amp;
    norm += amp;
    x *= 2.03;
    y *= 2.03;
    amp *= 0.5;
  }
  return sum / norm;
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** rock formations: [model, x, y, scale, rotation] (world x/y), checked clear of the road */
const FORMATIONS: [string, number, number, number, number][] = [
  // the infield
  ['mesa_a', 5050, 3750, 1.15, 0.4],
  ['butte_a', 6150, 2250, 1.0, 1.1],
  ['butte_b', 5400, 2000, 0.9, 2.3],
  ['spire', 4250, 2350, 1.0, 0.2],
  // just outside the loop
  ['mesa_c', 3600, 9300, 1.2, 1.9],
  ['mesa_b', 9900, 3900, 1.35, 0.8],
  ['butte_a', 8800, 900, 1.3, 2.9],
  ['spire', 8600, 7900, 1.3, 1.4],
  ['mesa_b', -1800, 2700, 1.3, 2.2],
  ['butte_b', -1000, 6600, 1.4, 0.5],
  ['mesa_a', 1600, -2300, 1.2, 1.2],
  ['butte_a', 5600, -1700, 1.6, 0.9],
  // the horizon (fades violet in the sunset haze)
  ['mesa_c', -5400, -2800, 2.4, 0.3],
  ['mesa_a', 3000, -6400, 2.8, 2.0],
  ['butte_a', 9800, -4800, 2.6, 1.0],
  ['mesa_c', 14800, 2600, 2.6, 2.6],
  ['mesa_b', 13600, 9800, 2.5, 0.7],
  ['mesa_a', 5600, 14200, 3.0, 1.7],
  ['spire', 800, 13200, 2.6, 0.2],
  ['mesa_c', -6000, 8800, 2.8, 1.1],
  ['butte_b', -7000, 3200, 2.8, 2.2],
];
/** footprint radius of each model at scale 1 (base radius × talus flare × outline wobble) */
const FOOTPRINT: Record<string, number> = { mesa_a: 1220, mesa_b: 900, mesa_c: 1570, butte_a: 480, butte_b: 370, spire: 270 };

const PUMPJACKS: [number, number, number][] = [
  [8150, 5700, 0.6],
  [8450, 6250, 2.1],
  [7950, 6650, 1.2],
  [8700, 5300, 2.8],
  [6000, 5500, 0.3],
  [6300, 5150, 1.8],
];

export class DesertScenery {
  private track: Track;
  private group: THREE.Group;
  private seed = 777;
  private rnd = (): number => {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  };
  private rock: THREE.MeshStandardMaterial;
  private talus: THREE.MeshStandardMaterial;
  private jacks: { beam: THREE.Object3D; crank: THREE.Object3D; phase: number }[] = [];
  private canyonRubble: { x: number; y: number; h: number }[] = [];

  constructor(track: Track, group: THREE.Group) {
    this.track = track;
    this.group = group;
    this.rock = surfaceMaterial('sandstone', { vertexColors: true }) ?? new THREE.MeshStandardMaterial({ color: 0xb2552f, roughness: 0.95, vertexColors: true });
    this.talus = surfaceMaterial('sand', { vertexColors: true }) ?? new THREE.MeshStandardMaterial({ color: 0xd4a877, roughness: 1, vertexColors: true });
    this.buildDunes();
    this.buildCanyon();
    this.buildFormations();
    this.buildArch();
    this.buildSign();
    this.buildPlants();
    this.buildPumpjacks();
  }

  /** Rock the pumpjack beams and turn their cranks. */
  update(time: number): void {
    for (const j of this.jacks) {
      const a = time * 1.5 + j.phase;
      j.crank.rotation.z = -a;
      j.beam.rotation.z = Math.sin(a) * 0.3;
    }
  }

  // ------------------------------------------------------------------ helpers
  /** How far outside the road (both paths) a point is; negative on the road. */
  private clearance(x: number, y: number): number {
    const h = this.track.query(x, y);
    return h ? h.pen : 1e9;
  }

  private insideFormation(x: number, y: number, pad: number): boolean {
    return FORMATIONS.some(([m, fx, fy, s]) => Math.hypot(x - fx, y - fy) < FOOTPRINT[m] * s * 0.85 + pad);
  }

  /** Dune height at a point: flat (just under the road) near the circuit, rolling ridges further out. */
  terrainHeight(x: number, y: number, clearance = this.clearance(x, y)): number {
    const mask = smoothstep(260, 1400, clearance);
    if (mask <= 0) return -1;
    const n = fbm(x / 1100, y / 800, 3, 4);
    const ridge = (1 - Math.abs(2 * n - 1)) ** 2;
    const swell = fbm(x / 3200, y / 3200, 9, 2);
    return -1 + mask * (ridge * 150 * (0.5 + swell) + swell * 40);
  }

  private meshes(model: ModelAsset, mats: Record<string, THREE.Material>, fallback: THREE.Material): THREE.Mesh[] {
    return [...model.parts].map(([name, geo]) => new THREE.Mesh(geo, mats[name] ?? fallback));
  }

  // ------------------------------------------------------------------ ground
  private buildDunes(): void {
    const X0 = -3600;
    const Y0 = -3600;
    const X1 = 11600;
    const Y1 = 10600;
    const cell = 100;
    const nx = Math.ceil((X1 - X0) / cell) + 1;
    const ny = Math.ceil((Y1 - Y0) / cell) + 1;
    const pos = new Float32Array(nx * ny * 3);
    const uv = new Float32Array(nx * ny * 2);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const x = X0 + i * cell;
        const y = Y0 + j * cell;
        const k = j * nx + i;
        pos[k * 3] = x;
        pos[k * 3 + 1] = this.terrainHeight(x, y);
        pos[k * 3 + 2] = y;
        uv[k * 2] = x / 400;
        uv[k * 2 + 1] = y / 400;
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i;
        idx.push(a, a + nx, a + 1, a + 1, a + nx, a + nx + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mat = surfaceMaterial('sand') ?? new THREE.MeshStandardMaterial({ color: 0xd4a877, roughness: 1 });
    const dunes = new THREE.Mesh(g, mat);
    dunes.receiveShadow = true;
    // the baked lighting treats the whole dune field as ground (sun shadows of the mesas land on it)
    dunes.userData.bakeMode = 'ground';
    mat.userData.bakeIgnore = true;
    this.group.add(dunes);
  }

  /**
   * Sandstone cliffs either side of the canyon S: a rough vertical face set back from the barriers,
   * a flat top and a back face, broken wherever another stretch of road comes close.
   */
  private buildCanyon(): void {
    const t = this.track;
    const main = t.main;
    const n = main.length;
    const near = (x: number, y: number) => main.reduce((b, p, i) => ((p.x - x) ** 2 + (p.y - y) ** 2 < (main[b].x - x) ** 2 + (main[b].y - y) ** 2 ? i : b), 0);
    const from = near(2600, 900);
    const to = near(1400, 4400);
    const idx: number[] = [];
    for (let i = from; i !== to; i = (i + 1) % n) idx.push(i);
    // the cliffs are built here, not in Blender, so they have no baked occlusion colours
    const mat = this.rock.clone();
    mat.side = THREE.DoubleSide;
    mat.vertexColors = false;
    mat.color.setHex(0xe8cdb8);
    const ROWS = 10;
    for (const side of [1, -1]) {
      let strip: { x: number; y: number; nx: number; ny: number; h: number; depth: number; s: number }[] = [];
      const flush = () => {
        if (strip.length > 2) this.cliffStrip(strip, ROWS, mat);
        strip = [];
      };
      for (const i of idx) {
        const p = main[i];
        const prev = main[(i - 1 + n) % n];
        const next = main[(i + 1) % n];
        let tx = next.x - prev.x;
        let ty = next.y - prev.y;
        const l = Math.hypot(tx, ty) || 1;
        tx /= l;
        ty /= l;
        const nx = ty * side;
        const ny = -tx * side;
        const off = p.hw + 105;
        const x = p.x + nx * off;
        const y = p.y + ny * off;
        // don't wall off the shortcut or crowd the road on the other side of a bend
        if (this.clearance(x, y) < 70) {
          flush();
          continue;
        }
        let depth = 60;
        while (depth < 360 && this.clearance(x + nx * (depth + 40), y + ny * (depth + 40)) > 90) depth += 40;
        const h = 220 + 260 * fbm(p.s / 600, side * 3.3, 41, 3) ** 1.4;
        // rubble at the foot of the cliff
        if (this.rnd() < 0.18) this.canyonRubble.push({ x: x - nx * (10 + this.rnd() * 40), y: y - ny * (10 + this.rnd() * 40), h: -1 });
        strip.push({ x, y, nx, ny, h, depth, s: p.s });
      }
      flush();
    }
  }

  private cliffStrip(pts: { x: number; y: number; nx: number; ny: number; h: number; depth: number; s: number }[], rows: number, mat: THREE.Material): void {
    // ends slope down to the sand instead of stopping in a sheer slab
    const TAPER = 7;
    pts = pts.map((p, i) => {
      const e = Math.min(i, pts.length - 1 - i) / TAPER;
      return e >= 1 ? p : { ...p, h: p.h * (0.25 + 0.75 * e * e), depth: Math.max(40, p.depth * e) };
    });
    // columns across the profile: ROWS+1 points up the face, then the top's back edge and the back foot
    const cols = rows + 3;
    const pos: number[] = [];
    const uv: number[] = [];
    for (const p of pts) {
      for (let r = 0; r <= rows; r++) {
        const f = r / rows;
        const y = p.h * f;
        // rough face that leans back towards the top, blocky ledges and buttresses from layered noise
        // (s-scaled noise gives buttresses and gullies running up the face)
        const out = 34 * (fbm(p.s / 80, f * 5, 5, 3) - 0.5) + f * f * 60 + 110 * (fbm(p.s / 180, f * 0.8, 8, 3) - 0.5) + (f > 0.9 ? (f - 0.9) * 180 : 0);
        pos.push(p.x + p.nx * out, y - (r === 0 ? 4 : 0), p.y + p.ny * out);
        uv.push(p.s / 600, y / 600);
      }
      const back = p.depth;
      pos.push(p.x + p.nx * back, p.h * (0.96 + 0.04 * fbm(p.s / 150, 2, 12, 2)), p.y + p.ny * back);
      uv.push(p.s / 600, (p.h + back) / 600);
      pos.push(p.x + p.nx * (back + 40), -4, p.y + p.ny * (back + 40));
      uv.push(p.s / 600, (p.h * 2 + back) / 600);
    }
    const idx: number[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = i * cols + c;
        const b = (i + 1) * cols + c;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  // ------------------------------------------------------------------ landmarks
  private buildFormations(): void {
    const mats = { rock: this.rock, talus: this.talus };
    for (const [name, x, y, s, rot] of FORMATIONS) {
      const model = desertModel(name);
      if (!model) continue;
      const far = Math.hypot(x - this.track.width / 2, y - this.track.height / 2) > 7000;
      for (const m of this.meshes(model, mats, this.rock)) {
        m.position.set(x, -2, y);
        m.scale.setScalar(s);
        m.rotation.y = rot;
        // distant silhouettes don't need to cast (they're outside the shadow map anyway)
        m.castShadow = !far;
        m.receiveShadow = true;
        this.group.add(m);
      }
    }
  }

  /** The natural arch over the top straight – the jump there flies you straight through it. */
  private buildArch(): void {
    const model = desertModel('arch');
    if (!model) return;
    for (const m of this.meshes(model, { rock: this.rock }, this.rock)) {
      m.position.set(4150, -4, 815);
      m.rotation.y = Math.PI / 2;
      m.castShadow = m.receiveShadow = true;
      this.group.add(m);
    }
  }

  /** Hollywood-style letters on the sand in front of the big infield mesa, facing the start straight. */
  private buildSign(): void {
    const model = desertModel('sign');
    if (!model) return;
    const mat = new THREE.MeshStandardMaterial({ color: 0xf6f1e8, roughness: 0.45, emissive: 0x2a1c14, vertexColors: true });
    const x = 5000;
    const y = 5160;
    for (const m of this.meshes(model, {}, mat)) {
      m.position.set(x, this.terrainHeight(x, y) - 10, y);
      m.rotation.set(-0.16, 0.08, 0);
      m.scale.setScalar(2.2);
      m.castShadow = true;
      this.group.add(m);
    }
  }

  // ------------------------------------------------------------------ scatter
  private scatter(count: number, minClear: number, pad: number, tries = 30): { x: number; y: number; h: number }[] {
    const out: { x: number; y: number; h: number }[] = [];
    for (let a = 0; a < count * tries && out.length < count; a++) {
      const x = -2500 + this.rnd() * 13000;
      const y = -2500 + this.rnd() * 12000;
      const c = this.clearance(x, y);
      if (c < minClear || this.insideFormation(x, y, pad)) continue;
      out.push({ x, y, h: this.terrainHeight(x, y, c) });
    }
    return out;
  }

  private instanced(geo: THREE.BufferGeometry, mat: THREE.Material, spots: { x: number; y: number; h: number }[], scale: () => number, tint?: number[], cast = true): void {
    if (!spots.length) return;
    const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const c = new THREE.Color();
    spots.forEach((p, i) => {
      const s = scale();
      q.setFromAxisAngle(up, this.rnd() * Math.PI * 2);
      mesh.setMatrixAt(i, m4.compose(v.set(p.x, p.h, p.y), q, sc.set(s, s * (0.85 + this.rnd() * 0.3), s)));
      if (tint) mesh.setColorAt(i, c.setHex(tint[i % tint.length]));
    });
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  private buildPlants(): void {
    const cactusMat = new THREE.MeshStandardMaterial({ color: 0x5d7a3a, roughness: 0.75, vertexColors: true });
    for (const name of ['saguaro_a', 'saguaro_b']) {
      const geo = desertModel(name)?.parts.get('cactus');
      if (geo) this.instanced(geo, cactusMat, this.scatter(85, 90, 80), () => 0.8 + this.rnd() * 0.5, [0xffffff, 0xe8f0d8, 0xf0e8c8]);
    }
    for (let k = 0; k < 3; k++) {
      const geo = desertModel(`boulder_${k}`)?.parts.get('rock');
      const rubble = this.canyonRubble.filter((_, i) => i % 3 === k);
      if (geo) this.instanced(geo, this.rock, this.scatter(30, 60, 40).concat(rubble), () => 10 + this.rnd() ** 2 * 45);
    }
    // dry scrub: the leafy bush tinted to dead-grass colours
    const bush = prop('bush')?.get('leaves');
    const leaves = foliageMaterial();
    if (bush && leaves) this.instanced(bush, leaves, this.scatter(380, 40, 20), () => 0.7 + this.rnd() * 0.9, [0xc9a86a, 0xb89458, 0xd8bc84, 0xa89060], false);
  }

  private buildPumpjacks(): void {
    const base = desertModel('pumpjack_base');
    const beam = desertModel('pumpjack_beam');
    const crank = desertModel('pumpjack_crank');
    if (!base || !beam || !crank) return;
    const paint = new THREE.MeshStandardMaterial({ color: 0xd9a21e, roughness: 0.55, metalness: 0.3, vertexColors: true });
    const dark = new THREE.MeshStandardMaterial({ color: 0x35312d, roughness: 0.7, metalness: 0.4, vertexColors: true });
    const weight = new THREE.MeshStandardMaterial({ color: 0x5c5650, roughness: 0.6, metalness: 0.5, vertexColors: true });
    const mats = { steel: paint, steel_dark: dark, weight };
    const pivot = (m: ModelAsset) => (m.info.pivot as unknown as number[]) ?? [0, 0, 0];
    for (const [x, y, rot] of PUMPJACKS) {
      const g = new THREE.Group();
      g.position.set(x, this.terrainHeight(x, y), y);
      g.rotation.y = rot;
      for (const m of this.meshes(base, mats, dark)) g.add(m);
      const bp = pivot(beam);
      const beamPivot = new THREE.Group();
      beamPivot.position.set(bp[0], bp[1], bp[2]);
      for (const m of this.meshes(beam, mats, paint)) beamPivot.add(m);
      const cp = pivot(crank);
      const crankPivot = new THREE.Group();
      crankPivot.position.set(cp[0], cp[1], cp[2]);
      for (const m of this.meshes(crank, mats, dark)) crankPivot.add(m);
      g.add(beamPivot, crankPivot);
      g.scale.setScalar(1.6);
      g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
      this.group.add(g);
      this.jacks.push({ beam: beamPivot, crank: crankPivot, phase: x * 0.01 });
    }
  }
}
