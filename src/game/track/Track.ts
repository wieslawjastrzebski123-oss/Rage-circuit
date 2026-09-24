import { catmullRom, clamp, closestOnSegment, type Vec } from '../utils/math';
import type { ControlPoint, JumpDef, TrackDef } from './TrackData';

/** One straight piece of drivable road (a capsule of radius hw around a→b). */
export interface Seg {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  hw: number;
  /** race distance along the main loop at a and b (shortcut values are interpolated) */
  sA: number;
  sB: number;
  /** 0 = main loop, 1 = shortcut */
  path: 0 | 1;
  tx: number;
  ty: number;
  len: number;
}

export interface TrackHit {
  seg: Seg;
  /** distance from centre line */
  dist: number;
  /** dist - halfWidth (negative = inside the road) */
  pen: number;
  s: number;
  /** closest centre-line point */
  cx: number;
  cy: number;
  /** unit vector from centre line toward the query point */
  nx: number;
  ny: number;
}

export interface PathSample {
  x: number;
  y: number;
  hw: number;
  s: number;
  tx: number;
  ty: number;
}

/** A driving route for the AI (main loop, or main loop with the shortcut spliced in). */
export interface Route {
  points: Vec[];
  /** racing speed limit per point, px/s (for a car with good grip) */
  speed: number[];
  /** half-width available around each point (for overtaking offsets) */
  room: number[];
  /** main-loop race distance at each point */
  s: number[];
  usesShortcut: boolean;
}

const SAMPLE_SPACING = 36;
const BUCKET = 200;
const GRID = 16;
// race-distance window used to keep a car on the same part of the track as last frame
const HINT_WINDOW = 600;

export class Track {
  readonly def: TrackDef;
  readonly width: number;
  readonly height: number;
  readonly main: PathSample[] = [];
  readonly shortcut: PathSample[] = [];
  readonly segs: Seg[] = [];
  readonly length: number;
  readonly checkpoints: number[] = [];
  readonly shortcutRange: [number, number];
  readonly routes: { main: Route; shortcut: Route };
  /** kicker ramps with their direction pre-computed */
  readonly ramps: (JumpDef & { cos: number; sin: number })[];

  private buckets: Seg[][];
  private bucketCols: number;
  private bucketRows: number;
  private grid: Uint8Array;
  private gridCols: number;
  private gridRows: number;
  private tmp = { x: 0, y: 0, t: 0, d2: 0 };

  constructor(def: TrackDef) {
    this.def = def;
    this.width = def.worldWidth;
    this.height = def.worldHeight;
    this.ramps = def.jumps.map((j) => ({ ...j, cos: Math.cos(j.angle), sin: Math.sin(j.angle) }));

    // ---- sample main loop, re-index so s = 0 is at the start line ----
    let mainPts = sampleSpline(def.main, true);
    let startIdx = 0;
    let best = Infinity;
    mainPts.forEach((p, i) => {
      const d = (p.x - def.start[0]) ** 2 + (p.y - def.start[1]) ** 2;
      if (d < best) {
        best = d;
        startIdx = i;
      }
    });
    mainPts = mainPts.slice(startIdx).concat(mainPts.slice(0, startIdx));
    let s = 0;
    for (let i = 0; i < mainPts.length; i++) {
      const p = mainPts[i];
      const n = mainPts[(i + 1) % mainPts.length];
      const len = Math.hypot(n.x - p.x, n.y - p.y);
      this.main.push({ x: p.x, y: p.y, hw: p.hw, s, tx: (n.x - p.x) / len, ty: (n.y - p.y) / len });
      s += len;
    }
    this.length = s;

    // ---- shortcut: map its arc length onto the main-loop distance range it bypasses ----
    const scPts = sampleSpline(def.shortcut, false);
    const entry = this.nearestMainIndex(scPts[0].x, scPts[0].y);
    const exit = this.nearestMainIndex(scPts[scPts.length - 1].x, scPts[scPts.length - 1].y);
    const sEntry = this.main[entry].s;
    let sExit = this.main[exit].s;
    if (sExit < sEntry) sExit += this.length;
    this.shortcutRange = [sEntry, sExit];
    let scLen = 0;
    const scCum: number[] = [0];
    for (let i = 1; i < scPts.length; i++) {
      scLen += Math.hypot(scPts[i].x - scPts[i - 1].x, scPts[i].y - scPts[i - 1].y);
      scCum.push(scLen);
    }
    for (let i = 0; i < scPts.length; i++) {
      const p = scPts[i];
      const n = scPts[Math.min(i + 1, scPts.length - 1)];
      const pr = scPts[Math.max(i - 1, 0)];
      const dx = n.x - pr.x;
      const dy = n.y - pr.y;
      const l = Math.hypot(dx, dy) || 1;
      const sv = sEntry + (sExit - sEntry) * (scCum[i] / scLen);
      this.shortcut.push({ x: p.x, y: p.y, hw: p.hw, s: sv % this.length, tx: dx / l, ty: dy / l });
    }

    // ---- segments ----
    for (let i = 0; i < this.main.length; i++) {
      const a = this.main[i];
      const b = this.main[(i + 1) % this.main.length];
      this.segs.push(makeSeg(a, b, a.s, i + 1 === this.main.length ? this.length : b.s, 0));
    }
    for (let i = 0; i < this.shortcut.length - 1; i++) {
      const a = this.shortcut[i];
      const b = this.shortcut[i + 1];
      const sA = sEntry + (sExit - sEntry) * (scCum[i] / scLen);
      const sB = sEntry + (sExit - sEntry) * (scCum[i + 1] / scLen);
      this.segs.push(makeSeg(a, b, sA, sB, 1));
    }

    // ---- spatial buckets ----
    this.bucketCols = Math.ceil(this.width / BUCKET);
    this.bucketRows = Math.ceil(this.height / BUCKET);
    this.buckets = Array.from({ length: this.bucketCols * this.bucketRows }, () => []);
    for (const seg of this.segs) {
      const m = seg.hw + 80;
      const x0 = clamp(Math.floor((Math.min(seg.ax, seg.bx) - m) / BUCKET), 0, this.bucketCols - 1);
      const x1 = clamp(Math.floor((Math.max(seg.ax, seg.bx) + m) / BUCKET), 0, this.bucketCols - 1);
      const y0 = clamp(Math.floor((Math.min(seg.ay, seg.by) - m) / BUCKET), 0, this.bucketRows - 1);
      const y1 = clamp(Math.floor((Math.max(seg.ay, seg.by) + m) / BUCKET), 0, this.bucketRows - 1);
      for (let by = y0; by <= y1; by++) for (let bx = x0; bx <= x1; bx++) this.buckets[by * this.bucketCols + bx].push(seg);
    }

    // ---- drivable grid (fast point tests for projectiles, blink, spawning) ----
    this.gridCols = Math.ceil(this.width / GRID);
    this.gridRows = Math.ceil(this.height / GRID);
    this.grid = new Uint8Array(this.gridCols * this.gridRows);
    for (let gy = 0; gy < this.gridRows; gy++) {
      for (let gx = 0; gx < this.gridCols; gx++) {
        const h = this.query((gx + 0.5) * GRID, (gy + 0.5) * GRID);
        if (h && h.pen <= 0) this.grid[gy * this.gridCols + gx] = 1;
      }
    }

    // ---- checkpoints (evenly spaced main-loop distances, 0 = start/finish line) ----
    for (let i = 0; i < def.checkpointCount; i++) this.checkpoints.push((this.length * i) / def.checkpointCount);

    // ---- AI routes ----
    const racing = racingLine(this.main);
    this.routeAroundObstacles(racing);
    const mainRoute = buildRoute(
      racing,
      this.main.map((p) => p.hw),
      this.main.map((p) => p.s),
      true,
      false,
    );
    const pre = racing.slice(0, entry + 1);
    const post = racing.slice(exit);
    const scMid = this.shortcut.slice(2, -2).map((p) => ({ x: p.x, y: p.y }));
    this.routeAroundObstacles(scMid);
    const scRoom = this.main
      .slice(0, entry + 1)
      .map((p) => p.hw)
      .concat(this.shortcut.slice(2, -2).map((p) => p.hw))
      .concat(this.main.slice(exit).map((p) => p.hw));
    const scS = this.main
      .slice(0, entry + 1)
      .map((p) => p.s)
      .concat(this.shortcut.slice(2, -2).map((p) => p.s))
      .concat(this.main.slice(exit).map((p) => p.s));
    const shortcutRoute = buildRoute(pre.concat(scMid, post), scRoom, scS, true, true);
    this.routes = { main: mainRoute, shortcut: shortcutRoute };
  }

  /**
   * Bends a route sideways around static containers so bots don't plough into them.
   * The push peaks at the obstacle and fades out over a few hundred pixels.
   */
  private routeAroundObstacles(pts: Vec[]): void {
    const n = pts.length;
    for (const o of this.def.obstacles) {
      if (o.kind !== 'container') continue;
      const half = Math.hypot(o.w ?? 100, o.h ?? 40) / 2;
      const clearance = half + 42;
      // closest route point
      let ci = 0;
      let cd = Infinity;
      for (let i = 0; i < n; i++) {
        const d = (pts[i].x - o.x) ** 2 + (pts[i].y - o.y) ** 2;
        if (d < cd) {
          cd = d;
          ci = i;
        }
      }
      if (Math.sqrt(cd) > clearance + 40) continue;
      // which side of the road has more room? use the centre line at that point
      const h = this.query(o.x, o.y);
      if (!h) continue;
      const nx = -h.seg.ty;
      const ny = h.seg.tx;
      const obsLat = (o.x - h.cx) * nx + (o.y - h.cy) * ny;
      const side = obsLat > 0 ? -1 : 1;
      const targetLat = obsLat + side * clearance;
      const maxLat = h.seg.hw - 26;
      const lat = Math.max(-maxLat, Math.min(maxLat, targetLat));
      const SPAN = 9; // points either side (~330 px)
      for (let k = -SPAN; k <= SPAN; k++) {
        const i = (((ci + k) % n) + n) % n;
        const p = pts[i];
        const hp = this.query(p.x, p.y);
        if (!hp) continue;
        const pnx = -hp.seg.ty;
        const pny = hp.seg.tx;
        const curLat = (p.x - hp.cx) * pnx + (p.y - hp.cy) * pny;
        const w = 0.5 + 0.5 * Math.cos((k / (SPAN + 1)) * Math.PI);
        const newLat = curLat + (lat - curLat) * w;
        p.x = hp.cx + pnx * newLat;
        p.y = hp.cy + pny * newLat;
      }
    }
  }

  private nearestMainIndex(x: number, y: number): number {
    let bi = 0;
    let bd = Infinity;
    this.main.forEach((p, i) => {
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bd) {
        bd = d;
        bi = i;
      }
    });
    return bi;
  }

  private candidates(x: number, y: number): Seg[] {
    const bx = Math.floor(x / BUCKET);
    const by = Math.floor(y / BUCKET);
    if (bx < 0 || by < 0 || bx >= this.bucketCols || by >= this.bucketRows) return this.segs;
    const list = this.buckets[by * this.bucketCols + bx];
    return list.length ? list : this.segs;
  }

  /**
   * Finds the road piece a point belongs to.
   * With `sHint` (the car's previous race distance) overlapping candidates are
   * disambiguated by continuity, which prevents progress jumping across the map.
   */
  query(x: number, y: number, sHint?: number, out?: TrackHit): TrackHit | null {
    const list = this.candidates(x, y);
    const L = this.length;
    // best overall (smallest penetration) and best among pieces continuous with the hint
    let best: Seg | null = null;
    let bestPen = Infinity;
    let bt = 0;
    let bcx = 0;
    let bcy = 0;
    let bd = 0;
    let near: Seg | null = null;
    let nearPen = Infinity;
    let nt = 0;
    let ncx = 0;
    let ncy = 0;
    let nd = 0;
    for (let i = 0; i < list.length; i++) {
      const seg = list[i];
      closestOnSegment(x, y, seg.ax, seg.ay, seg.bx, seg.by, this.tmp);
      const d = Math.sqrt(this.tmp.d2);
      const pen = d - seg.hw;
      if (pen < bestPen) {
        bestPen = pen;
        best = seg;
        bt = this.tmp.t;
        bcx = this.tmp.x;
        bcy = this.tmp.y;
        bd = d;
      }
      if (sHint !== undefined && pen < nearPen) {
        const sv = seg.sA + (seg.sB - seg.sA) * this.tmp.t;
        let ds = Math.abs(sv - sHint) % L;
        if (ds > L / 2) ds = L - ds;
        if (ds < HINT_WINDOW) {
          nearPen = pen;
          near = seg;
          nt = this.tmp.t;
          ncx = this.tmp.x;
          ncy = this.tmp.y;
          nd = d;
        }
      }
    }
    // prefer the piece continuous with the previous position, but only while the car is
    // actually on it – otherwise trust geometry (e.g. cutting a junction corner)
    if (near && nearPen <= 5 && nearPen <= bestPen + 30) {
      best = near;
      bestPen = nearPen;
      bt = nt;
      bcx = ncx;
      bcy = ncy;
      bd = nd;
    }
    if (!best) return null;
    const o = out ?? ({} as TrackHit);
    o.seg = best;
    o.dist = bd;
    o.pen = bestPen;
    o.s = (best.sA + (best.sB - best.sA) * bt) % L;
    o.cx = bcx;
    o.cy = bcy;
    if (bd > 1e-4) {
      o.nx = (x - bcx) / bd;
      o.ny = (y - bcy) / bd;
    } else {
      o.nx = -best.ty;
      o.ny = best.tx;
    }
    return o;
  }

  /**
   * Height of the drivable surface: 0 on the road, up to a ramp's lip height on a kicker.
   * The ramp rises with the square of the distance up it, so it launches steeper than it looks.
   */
  groundHeight(x: number, y: number): number {
    let h = 0;
    for (const r of this.ramps) {
      const dx = x - r.x;
      const dy = y - r.y;
      const u = dx * r.cos + dy * r.sin;
      if (u > 0 || u < -r.length) continue;
      const v = -dx * r.sin + dy * r.cos;
      if (Math.abs(v) > r.width / 2) continue;
      const t = (u + r.length) / r.length;
      h = Math.max(h, r.height * t * t);
    }
    return h;
  }

  isDrivable(x: number, y: number): boolean {
    const gx = Math.floor(x / GRID);
    const gy = Math.floor(y / GRID);
    if (gx < 0 || gy < 0 || gx >= this.gridCols || gy >= this.gridRows) return false;
    return this.grid[gy * this.gridCols + gx] === 1;
  }

  /** Main-loop point and direction at race distance s. */
  pointAt(s: number): { x: number; y: number; angle: number; hw: number } {
    const L = this.length;
    s = ((s % L) + L) % L;
    let lo = 0;
    let hi = this.main.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.main[mid].s <= s) lo = mid;
      else hi = mid - 1;
    }
    const a = this.main[lo];
    const b = this.main[(lo + 1) % this.main.length];
    const segLen = (lo + 1 === this.main.length ? L : b.s) - a.s;
    const t = segLen > 0 ? (s - a.s) / segLen : 0;
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      angle: Math.atan2(a.ty, a.tx),
      hw: a.hw + (b.hw - a.hw) * t,
    };
  }
}

function makeSeg(a: { x: number; y: number; hw: number }, b: { x: number; y: number; hw: number }, sA: number, sB: number, path: 0 | 1): Seg {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return {
    ax: a.x,
    ay: a.y,
    bx: b.x,
    by: b.y,
    hw: Math.min(a.hw, b.hw),
    sA,
    sB,
    path,
    tx: (b.x - a.x) / len,
    ty: (b.y - a.y) / len,
    len,
  };
}

/** Catmull-Rom through control points, resampled at even arc-length spacing. */
function sampleSpline(cps: ControlPoint[], closed: boolean): { x: number; y: number; hw: number }[] {
  const n = cps.length;
  const get = (i: number): ControlPoint => {
    if (closed) return cps[((i % n) + n) % n];
    return cps[clamp(i, 0, n - 1)];
  };
  const dense: { x: number; y: number; hw: number }[] = [];
  const spans = closed ? n : n - 1;
  for (let i = 0; i < spans; i++) {
    const p0 = get(i - 1);
    const p1 = get(i);
    const p2 = get(i + 1);
    const p3 = get(i + 2);
    for (let k = 0; k < 40; k++) {
      const t = k / 40;
      dense.push({
        x: catmullRom(p0[0], p1[0], p2[0], p3[0], t),
        y: catmullRom(p0[1], p1[1], p2[1], p3[1], t),
        hw: p1[2] + (p2[2] - p1[2]) * t,
      });
    }
  }
  if (!closed) dense.push({ x: cps[n - 1][0], y: cps[n - 1][1], hw: cps[n - 1][2] });

  // resample
  const out: { x: number; y: number; hw: number }[] = [dense[0]];
  let acc = 0;
  for (let i = 1; i < dense.length + (closed ? 1 : 0); i++) {
    const a = dense[i - 1];
    const b = dense[i % dense.length];
    let segLen = Math.hypot(b.x - a.x, b.y - a.y);
    let ax = a.x;
    let ay = a.y;
    let ahw = a.hw;
    while (acc + segLen >= SAMPLE_SPACING) {
      const need = SAMPLE_SPACING - acc;
      const t = need / segLen;
      ax = ax + (b.x - ax) * t;
      ay = ay + (b.y - ay) * t;
      ahw = ahw + (b.hw - ahw) * t;
      out.push({ x: ax, y: ay, hw: ahw });
      segLen -= need;
      acc = 0;
    }
    acc += segLen;
  }
  if (closed) {
    // drop a final point that nearly duplicates the first
    const f = out[0];
    const l = out[out.length - 1];
    if (Math.hypot(f.x - l.x, f.y - l.y) < SAMPLE_SPACING * 0.5) out.pop();
  } else {
    const last = cps[n - 1];
    const l = out[out.length - 1];
    if (Math.hypot(l.x - last[0], l.y - last[1]) > 4) out.push({ x: last[0], y: last[1], hw: last[2] });
  }
  return out;
}

/** Relaxes the centre line so it cuts toward the inside of corners, kept within the road. */
function racingLine(main: PathSample[]): Vec[] {
  const n = main.length;
  let pts = main.map((p) => ({ x: p.x, y: p.y }));
  for (let iter = 0; iter < 60; iter++) {
    const next = pts.map((p, i) => {
      const a = pts[(i - 1 + n) % n];
      const b = pts[(i + 1) % n];
      return { x: p.x * 0.5 + (a.x + b.x) * 0.25, y: p.y * 0.5 + (a.y + b.y) * 0.25 };
    });
    // clamp lateral offset
    for (let i = 0; i < n; i++) {
      const c = main[i];
      const dx = next[i].x - c.x;
      const dy = next[i].y - c.y;
      const d = Math.hypot(dx, dy);
      const max = c.hw * 0.55;
      if (d > max) {
        next[i].x = c.x + (dx / d) * max;
        next[i].y = c.y + (dy / d) * max;
      }
    }
    pts = next;
  }
  return pts;
}

function buildRoute(points: Vec[], room: number[], s: number[], closed: boolean, usesShortcut: boolean): Route {
  const n = points.length;
  const at = (i: number) => points[closed ? ((i % n) + n) % n : clamp(i, 0, n - 1)];
  const speed: number[] = new Array(n);
  const W = 3;
  const LAT_ACC = 1000;
  for (let i = 0; i < n; i++) {
    const a = at(i - W);
    const b = at(i);
    const c = at(i + W);
    const a1 = Math.atan2(b.y - a.y, b.x - a.x);
    const a2 = Math.atan2(c.y - b.y, c.x - b.x);
    let da = Math.abs(a2 - a1);
    if (da > Math.PI) da = Math.PI * 2 - da;
    const arc = Math.hypot(b.x - a.x, b.y - a.y) + Math.hypot(c.x - b.x, c.y - b.y);
    const curvature = da / Math.max(arc, 1);
    speed[i] = curvature < 1e-5 ? 2000 : Math.sqrt(LAT_ACC / curvature);
  }
  // braking pass (run twice around the loop so wrap-around is handled)
  const BRAKE = 750;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = n - 1; i >= 0; i--) {
      const j = (i + 1) % n;
      const ds = Math.hypot(points[j].x - points[i].x, points[j].y - points[i].y);
      speed[i] = Math.min(speed[i], Math.sqrt(speed[j] * speed[j] + 2 * BRAKE * ds));
    }
  }
  return { points, speed, room, s, usesShortcut };
}
