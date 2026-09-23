import * as THREE from 'three';
import { CARS, type CarId } from '../data/cars';
import { buildCarModel } from '../render/CarModel';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const cache = new Map<CarId, string>();

/** Renders a 3/4 studio shot of a car model once and caches it as an image URL. */
export function carPreview(id: CarId): string {
  const hit = cache.get(id);
  if (hit) return hit;
  const W = 360;
  const H = 200;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(W, H);
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.add(new THREE.HemisphereLight(0xaabbee, 0x221a14, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(1, 2, 1.5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(CARS[id].color, 2);
  rim.position.set(-2, 1, -1);
  scene.add(rim);
  const model = buildCarModel(CARS[id]);
  model.shadow.visible = false;
  model.root.rotation.y = -0.6;
  scene.add(model.root);
  const cam = new THREE.PerspectiveCamera(32, W / H, 1, 1000);
  cam.position.set(-70, 48, 88);
  cam.lookAt(0, 6, 0);
  renderer.render(scene, cam);
  const url = renderer.domElement.toDataURL('image/png');
  pmrem.dispose();
  renderer.dispose();
  renderer.forceContextLoss();
  cache.set(id, url);
  return url;
}
