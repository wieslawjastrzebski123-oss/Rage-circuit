/**
 * Builds the track scenery exactly as the game does and writes it out for the Blender lighting bake:
 *   art/.cache/track_layout.obj   – every solid object that can shade the ground
 *   art/.cache/track_layout.json  – bake area and image size
 *   art/.cache/track_rubber.f32   – distance to the AI racing line per pixel (for rubbered-in tarmac)
 *
 * Run with: npm run art:ground (this script is its first step)
 */
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// --- the scenery code draws canvas textures; a do-nothing canvas is enough here
const gradient = { addColorStop() {} };
const ctx = new Proxy({} as Record<string | symbol, unknown>, {
  get: (t, k) => (k in t ? t[k] : () => gradient),
  set: (t, k, v) => ((t[k] = v), true),
});
(globalThis as unknown as { document: unknown }).document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
};

const THREE = await import('three');
const { Track } = await import('../src/game/track/Track');
const { INDUSTRIAL_DISTRICT } = await import('../src/game/track/TrackData');
const { TrackView } = await import('../src/game/track/TrackView');
const { BAKE_AREA } = await import('../src/game/render/groundBake');

const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
const { useProps, useFoliage } = await import('../src/game/render/Assets');

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '.cache');
mkdirSync(out, { recursive: true });

// the Blender props shade the ground too: load them the way the game does (leaf texture not needed here)
const glb = readFileSync(join(here, '..', 'public', 'assets', 'models', 'props.glb'));
const gltf = await new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '');
useProps(gltf.scene);
useFoliage(new THREE.Texture());

const track = new Track(INDUSTRIAL_DISTRICT);
const root = new THREE.Group();
new TrackView(track, root);
root.updateMatrixWorld(true);

const { x0, z0, width, height, px, py } = BAKE_AREA;
const obj = createWriteStream(join(out, 'track_layout.obj'));
let vBase = 1;
let tris = 0;
const v = new THREE.Vector3();
const m = new THREE.Matrix4();
const im = new THREE.Matrix4();
const box = new THREE.Box3();

function emit(geo: THREE.BufferGeometry, matrix: THREE.Matrix4): void {
  // ignore flat things lying on the ground (road, paint, verges) and anything outside the bake area
  if (!geo.boundingBox) geo.computeBoundingBox();
  box.copy(geo.boundingBox!).applyMatrix4(matrix);
  if (box.max.y - box.min.y < 3) return;
  if (box.max.x < x0 || box.min.x > x0 + width || box.max.z < z0 || box.min.z > z0 + height) return;
  const pos = geo.attributes.position;
  const lines: string[] = [];
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
    lines.push(`v ${v.x.toFixed(2)} ${v.y.toFixed(2)} ${v.z.toFixed(2)}`);
  }
  const idx = geo.index;
  const n = idx ? idx.count : pos.count;
  for (let i = 0; i < n; i += 3) {
    const a = idx ? idx.getX(i) : i;
    const b = idx ? idx.getX(i + 1) : i + 1;
    const c = idx ? idx.getX(i + 2) : i + 2;
    lines.push(`f ${a + vBase} ${b + vBase} ${c + vBase}`);
    tris++;
  }
  vBase += pos.count;
  obj.write(lines.join('\n') + '\n');
}

root.traverse((o) => {
  const mesh = o as THREE.Mesh;
  if (!mesh.isMesh) return;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  // see-through fences, transparent decals and the horizon hills (whose shadows would end abruptly
  // at the edge of the baked area) are left out; leaf cards do count
  if (mats.every((mm) => mm.userData.bakeIgnore || mm.transparent)) return;
  if ((mesh as THREE.InstancedMesh).isInstancedMesh) {
    const inst = mesh as THREE.InstancedMesh;
    for (let i = 0; i < inst.count; i++) {
      inst.getMatrixAt(i, im);
      if (Math.abs(im.determinant()) < 1e-9) continue; // hidden instance
      emit(inst.geometry, m.multiplyMatrices(inst.matrixWorld, im));
    }
  } else emit(mesh.geometry, mesh.matrixWorld);
});
obj.end();

// --- distance (world units) from each bake pixel to the AI racing line, capped at 255
const rubber = new Float32Array(px * py).fill(255);
const pts = track.routes.main.points;
const R = 60;
for (let i = 0; i < pts.length; i++) {
  const a = pts[i];
  const b = pts[(i + 1) % pts.length];
  const minX = Math.floor(((Math.min(a.x, b.x) - R - x0) / width) * px);
  const maxX = Math.ceil(((Math.max(a.x, b.x) + R - x0) / width) * px);
  const minY = Math.floor(((Math.min(a.y, b.y) - R - z0) / height) * py);
  const maxY = Math.ceil(((Math.max(a.y, b.y) + R - z0) / height) * py);
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const l2 = abx * abx + aby * aby || 1;
  for (let yy = Math.max(0, minY); yy <= Math.min(py - 1, maxY); yy++) {
    const wz = z0 + ((yy + 0.5) / py) * height;
    for (let xx = Math.max(0, minX); xx <= Math.min(px - 1, maxX); xx++) {
      const wx = x0 + ((xx + 0.5) / px) * width;
      const t = Math.max(0, Math.min(1, ((wx - a.x) * abx + (wz - a.y) * aby) / l2));
      const d = Math.hypot(wx - (a.x + abx * t), wz - (a.y + aby * t));
      // rows are stored bottom-up (Blender's pixel order): row 0 = far edge (z0 + height)
      const k = (py - 1 - yy) * px + xx;
      if (d < rubber[k]) rubber[k] = d;
    }
  }
}
writeFileSync(join(out, 'track_rubber.f32'), Buffer.from(rubber.buffer));
writeFileSync(join(out, 'track_layout.json'), JSON.stringify(BAKE_AREA));
console.log(`exported ${tris} triangles, bake area ${width}×${height} → ${px}×${py} px`);
