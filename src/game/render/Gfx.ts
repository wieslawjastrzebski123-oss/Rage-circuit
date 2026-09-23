import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Storage } from '../utils/storage';

export const FOG_COLOR = 0xa4b4c6;

// late-afternoon sun
const SUN_ELEVATION = THREE.MathUtils.degToRad(38);
const SUN_AZIMUTH = THREE.MathUtils.degToRad(-35);
const SHADOW_RANGE = 750;

/**
 * Owns the WebGL renderer, the 3D scene, the chase camera and post-processing.
 * Game world coordinates map as: world (x, y) → three (x, 0, y), Y is up.
 */
export class Gfx {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  /** everything belonging to the current race lives under this group */
  root = new THREE.Group();
  private sky: Sky;
  private sun: THREE.DirectionalLight;
  private sunDir = new THREE.Vector3();
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -10);
  private hit = new THREE.Vector3();

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.72;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 3, 12000);
    this.scene.fog = new THREE.Fog(FOG_COLOR, 3200, 11000);
    this.scene.add(this.root, this.camera);

    // physically based sky, follows the camera so it never gets clipped
    this.sky = new Sky();
    this.sky.scale.setScalar(10000);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 3.5;
    u.rayleigh.value = 2.2;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.82;
    this.sunDir.setFromSphericalCoords(1, Math.PI / 2 - SUN_ELEVATION, SUN_AZIMUTH);
    u.sunPosition.value.copy(this.sunDir);
    this.scene.add(this.sky);

    // image-based lighting for reflections on paint and glass
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    pmrem.dispose();

    this.scene.add(new THREE.HemisphereLight(0xbcd0ff, 0x5a5044, 0.7));
    this.sun = new THREE.DirectionalLight(0xfff0dc, 2.7);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -SHADOW_RANGE;
    sc.right = sc.top = SHADOW_RANGE;
    sc.near = 10;
    sc.far = 4000;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 1.2;
    this.scene.add(this.sun, this.sun.target);

    this.applySettings();

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  applySettings(): void {
    const high = Storage.getSettings().quality === 'high';
    this.renderer.setPixelRatio(high ? Math.min(window.devicePixelRatio, 1.5) : 1);
    if (this.renderer.shadowMap.enabled !== high) {
      this.renderer.shadowMap.enabled = high;
      this.sun.castShadow = high;
      // materials must recompile when shadows are switched
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        if (m) (Array.isArray(m) ? m : [m]).forEach((mm) => (mm.needsUpdate = true));
      });
    }
    this.resize();
  }

  resize(): void {
    const w = Math.max(320, window.innerWidth);
    const h = Math.max(240, window.innerHeight);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Keep the shadow-casting sun centred on the action. */
  follow(x: number, y: number): void {
    // snap to texel-ish steps to reduce shadow shimmering
    const sx = Math.round(x / 8) * 8;
    const sy = Math.round(y / 8) * 8;
    this.sun.target.position.set(sx, 0, sy);
    this.sun.position.set(sx + this.sunDir.x * 1800, this.sunDir.y * 1800, sy + this.sunDir.z * 1800);
  }

  /** Remove and free everything from the previous race. */
  resetRoot(): void {
    this.scene.remove(this.root);
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry && !m.geometry.userData.shared) m.geometry.dispose();
      const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
      for (const mat of mats) if (!mat.userData.shared) (mat as THREE.Material).dispose();
    });
    this.root = new THREE.Group();
    this.scene.add(this.root);
  }

  render(): void {
    this.sky.position.copy(this.camera.position);
    // rendered directly so the canvas' multisample anti-aliasing applies
    this.renderer.render(this.scene, this.camera);
  }

  /** Mouse (client px) → point on the horizontal plane at turret height. Null if above the horizon. */
  screenToGround(clientX: number, clientY: number): THREE.Vector3 | null {
    this.ndc.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    return this.raycaster.ray.intersectPlane(this.plane, this.hit);
  }

  /** Horizontal direction of the mouse ray (used when the cursor is above the horizon). */
  rayDirection(clientX: number, clientY: number): THREE.Vector3 {
    this.ndc.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    return this.raycaster.ray.direction;
  }

  /** World point → CSS pixel position (for DOM overlays). z > 1 means behind the camera. */
  project(x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    out.set(x, y, z).project(this.camera);
    const zz = out.z;
    out.x = (out.x * 0.5 + 0.5) * window.innerWidth;
    out.y = (-out.y * 0.5 + 0.5) * window.innerHeight;
    out.z = zz;
    return out;
  }
}
