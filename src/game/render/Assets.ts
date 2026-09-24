import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { setBakeTexture } from './groundBake';

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

export type SurfaceName = 'asphalt' | 'concrete' | 'yard' | 'grass' | 'gravel' | 'corrugated';
const SURFACES: SurfaceName[] = ['asphalt', 'concrete', 'yard', 'grass', 'gravel', 'corrugated'];

const surfaces = new Map<SurfaceName, SurfaceSet>();
/** prop name → material name → geometry */
const props = new Map<string, Map<string, THREE.BufferGeometry>>();
let foliage: THREE.Texture | null = null;

const url = (path: string) => `${import.meta.env.BASE_URL}assets/${path}`;

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

export async function loadAssets(): Promise<void> {
  const loader = new THREE.TextureLoader();
  const bake = loadTexture(loader, 'tex/track_bake.webp', false).then((t) => {
    if (!t) return;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    setBakeTexture(t);
  });
  const models = new GLTFLoader()
    .loadAsync(url('models/props.glb'))
    .then((gltf) => useProps(gltf.scene))
    .catch(() => console.warn('asset missing: models/props.glb'));
  const leaves = loadTexture(loader, 'tex/foliage.webp', true).then((t) => {
    if (!t) return;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    useFoliage(t);
  });
  await Promise.all([
    bake,
    models,
    leaves,
    ...SURFACES.map(async (name) => {
      const [map, normalMap, orm] = await Promise.all([
        loadTexture(loader, `tex/${name}_color.webp`, true),
        loadTexture(loader, `tex/${name}_normal.webp`, false),
        loadTexture(loader, `tex/${name}_orm.webp`, false),
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
  for (const node of scene.children) {
    const parts = new Map<string, THREE.BufferGeometry>();
    node.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.userData.shared = true;
      parts.set((mesh.material as THREE.Material).name, mesh.geometry);
    });
    props.set(node.name, parts);
  }
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
