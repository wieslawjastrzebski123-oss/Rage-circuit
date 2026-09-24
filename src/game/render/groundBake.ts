import * as THREE from 'three';

/**
 * Lighting baked in Blender for the (single) track, stored in one image seen from above:
 *   R = ambient occlusion (dark where walls, containers, buildings and trees shelter the ground)
 *   G = sun shadow (used where the live shadow map doesn't reach, and everywhere on low quality)
 *   B = large-scale colour variation and rubber laid down along the racing line (0.5 = neutral)
 * Rebuild with `npm run art:ground` whenever the scenery layout in TrackView changes.
 */
export const BAKE_AREA = { x0: -1000, z0: -1000, width: 9900, height: 7600, px: 3072, py: 2358 };

/** The live shadow map covers about this far around the camera target (see Gfx SHADOW_RANGE). */
const LIVE_SHADOW_FADE: [number, number] = [600, 720];

const uniforms = {
  uBake: { value: null as THREE.Texture | null },
  uLiveShadow: { value: 0 },
  uSunCentre: { value: new THREE.Vector2() },
};

export function setBakeTexture(t: THREE.Texture): void {
  uniforms.uBake.value = t;
}

export function hasBake(): boolean {
  return uniforms.uBake.value !== null;
}

/** Called by Gfx: whether live shadows are on, and where they are centred. */
export function setLiveShadow(on: boolean, x: number, z: number): void {
  uniforms.uLiveShadow.value = on ? 1 : 0;
  uniforms.uSunCentre.value.set(x, z);
}

const f = (n: number) => n.toFixed(1);

/**
 * 'ground' – flat surfaces: full occlusion, baked sun shadow and colour variation.
 * 'upright' – walls, buildings, props: occlusion only, fading out within a few metres above the ground.
 */
export function applyBake(mat: THREE.Material, mode: 'ground' | 'upright'): void {
  if (!hasBake() || mat.userData.bake || !(mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) return;
  mat.userData.bake = mode;
  const { x0, z0, width, height } = BAKE_AREA;
  // keep any shader tweak the material already has (e.g. foliage normals)
  const prev = mat.onBeforeCompile.bind(mat);
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (sh, renderer) => {
    prev(sh, renderer);
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBakeWorld;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
  vec4 bakeW = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    bakeW = instanceMatrix * bakeW;
  #endif
  vBakeWorld = ( modelMatrix * bakeW ).xyz;`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vBakeWorld;
uniform sampler2D uBake;
uniform float uLiveShadow;
uniform vec2 uSunCentre;`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
  vec4 bake = texture2D( uBake, vec2( ( vBakeWorld.x - ${f(x0)} ) / ${f(width)}, 1.0 - ( vBakeWorld.z - ${f(z0)} ) / ${f(height)} ) );
  ${mode === 'ground' ? 'diffuseColor.rgb *= 0.6 + 0.8 * bake.b;' : ''}`,
      )
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
  ${
    mode === 'ground'
      ? `float bakeAo = bake.r;
  float sunMix = mix( 1.0, smoothstep( ${f(LIVE_SHADOW_FADE[0])}, ${f(LIVE_SHADOW_FADE[1])}, distance( vBakeWorld.xz, uSunCentre ) ), uLiveShadow );
  float bakeSun = mix( 1.0, bake.g, sunMix );`
      : `float bakeAo = mix( bake.r, 1.0, smoothstep( 0.0, 24.0, vBakeWorld.y ) );
  float bakeSun = 1.0;`
  }
  reflectedLight.indirectDiffuse *= bakeAo;
  reflectedLight.indirectSpecular *= bakeAo;
  reflectedLight.directDiffuse *= bakeSun * mix( 1.0, bakeAo, 0.35 );
  reflectedLight.directSpecular *= bakeSun;`,
      );
  };
  mat.customProgramCacheKey = () => `${prevKey()}|bake-${mode}`;
  mat.needsUpdate = true;
}
