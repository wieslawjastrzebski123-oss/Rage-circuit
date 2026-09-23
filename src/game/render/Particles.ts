import * as THREE from 'three';

export interface EmitOptions {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  life: number;
  size0: number;
  size1: number;
  alpha0?: number;
  alpha1?: number;
  color0: number;
  color1?: number;
  drag?: number;
  gravity?: number;
}

const VERT = `
attribute float psize;
attribute float palpha;
attribute vec3 pcolor;
uniform float uScale;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = psize * uScale / max(1.0, -mv.z);
  gl_Position = projectionMatrix * mv;
  vAlpha = palpha;
  vColor = pcolor;
}`;

const FRAG = `
uniform sampler2D map;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec4 t = texture2D(map, gl_PointCoord);
  gl_FragColor = vec4(vColor * t.rgb, t.a * vAlpha);
  if (gl_FragColor.a < 0.004) discard;
}`;

/**
 * Pooled GPU point particles. One draw call for the whole pool.
 * All per-particle state lives in typed arrays – nothing is allocated per emit.
 */
export class Particles {
  readonly points: THREE.Points;
  private material: THREE.ShaderMaterial;
  private n: number;
  private next = 0;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private s0: Float32Array;
  private s1: Float32Array;
  private a0: Float32Array;
  private a1: Float32Array;
  private c0: Float32Array;
  private c1: Float32Array;
  private drag: Float32Array;
  private grav: Float32Array;
  private aSize: Float32Array;
  private aAlpha: Float32Array;
  private aColor: Float32Array;
  private geo: THREE.BufferGeometry;
  private tmp = new THREE.Color();
  private tmp2 = new THREE.Color();

  constructor(count: number, map: THREE.Texture, additive: boolean) {
    this.n = count;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count);
    this.s0 = new Float32Array(count);
    this.s1 = new Float32Array(count);
    this.a0 = new Float32Array(count);
    this.a1 = new Float32Array(count);
    this.c0 = new Float32Array(count * 3);
    this.c1 = new Float32Array(count * 3);
    this.drag = new Float32Array(count);
    this.grav = new Float32Array(count);
    this.aSize = new Float32Array(count);
    this.aAlpha = new Float32Array(count);
    this.aColor = new Float32Array(count * 3);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('psize', new THREE.BufferAttribute(this.aSize, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('palpha', new THREE.BufferAttribute(this.aAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('pcolor', new THREE.BufferAttribute(this.aColor, 3).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      uniforms: { map: { value: map }, uScale: { value: 500 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.material);
    this.points.frustumCulled = false;
  }

  emit(o: EmitOptions): void {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    const i3 = i * 3;
    this.pos[i3] = o.x;
    this.pos[i3 + 1] = o.y;
    this.pos[i3 + 2] = o.z;
    this.vel[i3] = o.vx ?? 0;
    this.vel[i3 + 1] = o.vy ?? 0;
    this.vel[i3 + 2] = o.vz ?? 0;
    this.life[i] = 0;
    this.maxLife[i] = o.life;
    this.s0[i] = o.size0;
    this.s1[i] = o.size1;
    this.a0[i] = o.alpha0 ?? 1;
    this.a1[i] = o.alpha1 ?? 0;
    this.tmp.setHex(o.color0);
    this.tmp2.setHex(o.color1 ?? o.color0);
    this.c0[i3] = this.tmp.r;
    this.c0[i3 + 1] = this.tmp.g;
    this.c0[i3 + 2] = this.tmp.b;
    this.c1[i3] = this.tmp2.r;
    this.c1[i3 + 1] = this.tmp2.g;
    this.c1[i3 + 2] = this.tmp2.b;
    this.drag[i] = o.drag ?? 0;
    this.grav[i] = o.gravity ?? 0;
  }

  update(dt: number, camera: THREE.PerspectiveCamera, viewportHeight: number): void {
    this.material.uniforms.uScale.value = viewportHeight / (2 * Math.tan((camera.fov * Math.PI) / 360));
    for (let i = 0; i < this.n; i++) {
      const ml = this.maxLife[i];
      if (ml <= 0) {
        this.aSize[i] = 0;
        continue;
      }
      const l = (this.life[i] += dt);
      if (l >= ml) {
        this.maxLife[i] = 0;
        this.aSize[i] = 0;
        this.aAlpha[i] = 0;
        continue;
      }
      const t = l / ml;
      const i3 = i * 3;
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= d;
      this.vel[i3 + 1] = this.vel[i3 + 1] * d + this.grav[i] * dt;
      this.vel[i3 + 2] *= d;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.pos[i3 + 1] < 0.5) {
        this.pos[i3 + 1] = 0.5;
        this.vel[i3 + 1] *= -0.3;
      }
      this.aSize[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      this.aAlpha[i] = this.a0[i] + (this.a1[i] - this.a0[i]) * t;
      this.aColor[i3] = this.c0[i3] + (this.c1[i3] - this.c0[i3]) * t;
      this.aColor[i3 + 1] = this.c0[i3 + 1] + (this.c1[i3 + 1] - this.c0[i3 + 1]) * t;
      this.aColor[i3 + 2] = this.c0[i3 + 2] + (this.c1[i3 + 2] - this.c0[i3 + 2]) * t;
    }
    for (const k of ['position', 'psize', 'palpha', 'pcolor']) (this.geo.attributes[k] as THREE.BufferAttribute).needsUpdate = true;
  }
}
