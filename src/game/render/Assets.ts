import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { setBakeTexture } from './groundBake';
import { TRACK_IDS } from '../track/tracks';

/**
 * Image assets made in Blender (see art/blender/*.py), loaded once before the game starts.
 * Everything here is optional: if a file fails to load, the game falls back to its procedural look.
 */

/** Surface material set: colour, normal and ORM (R = ambient occlusion, G = roughness, B = metalness). */
export interface SurfaceSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  orm: THREE.Texture;
}

export type SurfaceName = 'asphalt' | 'concrete' | 'yard' | 'grass' | 'gravel' | 'corrugated' | 'sand' | 'sandstone';
const SURFACES: SurfaceName[] = ['asphalt', 'concrete', 'yard', 'grass', 'gravel', 'corrugated', 'sand', 'sandstone'];

const surfaces = new Map<SurfaceName, SurfaceSet>();
/** prop name → material name → geometry */
const props = new Map<string, Map<string, THREE.BufferGeometry>>();

/**
 * A Blender-made object with its parts by material, plus the glTF extras stored with it
 * (cars: roofY, hoodY, hoodSlope, frontX, rearX, exhaustY, track, wheelR; pumpjack parts: pivot).
 */
export interface ModelAsset {
  parts: Map<string, THREE.BufferGeometry>;
  info: Record<string, number>;
}
const cars = new Map<string, ModelAsset>();
const desert = new Map<string, ModelAsset>();
let foliage: THREE.Texture | null = null;

// not under /assets/: the server caches that folder forever, while these keep fixed names
const url = (path: string) => `${import.meta.env.BASE_URL}gfx/${path}`;

function loadTexture(loader: THREE.TextureLoader, path: string, color: boolean): Promise<THREE.Texture | null> {
  return new Promise((resolve) => {
    loader.load(
      url(path),
      (t) => {
        t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = 8;
        resolve(t);
      },
      undefined,
      () => {
        console.warn(`asset missing: ${path}`);
        resolve(null);
      },
    );
  });
}

/** Loads everything; onProgress gets the fraction of files done (0..1). */
export async function loadAssets(onProgress?: (done: number) => void): Promise<void> {
  const loader = new THREE.TextureLoader();
  let total = 0;
  let done = 0;
  const track = <T>(p: Promise<T>): Promise<T> => {
    total++;
    return p.finally(() => onProgress?.(++done / total));
  };
  const bake = TRACK_IDS.map((id) =>
    track(loadTexture(loader, `tex/bake_${id}.webp`, false)).then((t) => {
      if (!t) return;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      setBakeTexture(id, t);
    }),
  );
  const models = track(new GLTFLoader().loadAsync(url('models/props.glb')))
    .then((gltf) => useProps(gltf.scene))
    .catch(() => console.warn('asset missing: models/props.glb'));
  const collection = (file: string, into: Map<string, ModelAsset>) =>
    track(new GLTFLoader().loadAsync(url(`models/${file}`)))
      .then((gltf) => {
        for (const node of gltf.scene.children) into.set(node.name, { parts: partsOf(node), info: node.userData as Record<string, number> });
      })
      .catch(() => console.warn(`asset missing: models/${file}`));
  const carModels = collection('cars.glb', cars);
  const desertModels = collection('desert.glb', desert);
  const leaves = track(loadTexture(loader, 'tex/foliage.webp', true)).then((t) => {
    if (!t) return;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    useFoliage(t);
  });
  await Promise.all([
    ...bake,
    models,
    carModels,
    desertModels,
    leaves,
    ...SURFACES.map(async (name) => {
      const [map, normalMap, orm] = await Promise.all([
        track(loadTexture(loader, `tex/${name}_color.webp`, true)),
        track(loadTexture(loader, `tex/${name}_normal.webp`, false)),
        track(loadTexture(loader, `tex/${name}_orm.webp`, false)),
      ]);
      if (map && normalMap && orm) surfaces.set(name, { map, normalMap, orm });
    }),
  ]);
}

/**
 * A physically based material using a Blender surface set, or null when the set isn't available.
 * `repeat` scales the tiling (for meshes whose UVs don't already carry world units).
 */
export function surfaceMaterial(
  name: SurfaceName,
  params: THREE.MeshStandardMaterialParameters = {},
  repeat?: [number, number],
  normalStrength = 1,
): THREE.MeshStandardMaterial | null {
  const set = surfaces.get(name);
  if (!set) return null;
  const tex = (t: THREE.Texture) => {
    if (!repeat) return t;
    const c = t.clone();
    c.repeat.set(repeat[0], repeat[1]);
    c.needsUpdate = true;
    return c;
  };
  const orm = tex(set.orm);
  return new THREE.MeshStandardMaterial({
    roughness: 1,
    metalness: 1,
    ...params,
    map: tex(set.map),
    normalMap: tex(set.normalMap),
    normalScale: new THREE.Vector2(normalStrength, normalStrength),
    aoMap: orm,
    aoMapIntensity: 1,
    roughnessMap: orm,
    metalnessMap: orm,
  });
}

/** Registers the objects of props.glb (also used by the art export script, which reads the file itself). */
export function useProps(scene: THREE.Object3D): void {
  for (const node of scene.children) props.set(node.name, partsOf(node));
}

/** Geometries of an exported object keyed by material name (glTF splits multi-material meshes into one primitive each). */
function partsOf(node: THREE.Object3D): Map<string, THREE.BufferGeometry> {
  const parts = new Map<string, THREE.BufferGeometry>();
  node.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.userData.shared = true;
    parts.set((mesh.material as THREE.Material).name, mesh.geometry);
  });
  return parts;
}

export function carAsset(name: string): ModelAsset | null {
  return cars.get(name) ?? null;
}

export function desertModel(name: string): ModelAsset | null {
  return desert.get(name) ?? null;
}

/** desert.glb, for the art export script (the game loads it in loadAssets). */
export function useDesertModels(scene: THREE.Object3D): void {
  for (const node of scene.children) desert.set(node.name, { parts: partsOf(node), info: node.userData as Record<string, number> });
}

export function useFoliage(t: THREE.Texture): void {
  foliage = t;
}

/** Parts of a Blender-made prop keyed by material name (e.g. tree → bark, leaves), or null if it didn't load. */
export function prop(name: string): Map<string, THREE.BufferGeometry> | null {
  return props.get(name) ?? null;
}

/**
 * Alpha-tested leaf / needle cards. Both faces keep the same outward-pointing normal (baked in Blender)
 * so a crown shades like one soft volume instead of a pile of flat cards.
 */
export function foliageMaterial(): THREE.MeshStandardMaterial | null {
  if (!foliage) return null;
  const m = new THREE.MeshStandardMaterial({ map: foliage, alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true, roughness: 0.85 });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n  normal = normalize( vNormal );');
  };
  m.customProgramCacheKey = () => 'foliage';
  return m;
}
