import * as THREE from 'three';
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
  await Promise.all([
    bake,
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
