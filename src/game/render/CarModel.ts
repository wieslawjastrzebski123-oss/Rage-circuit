import * as THREE from 'three';
import type { CarStats } from '../data/cars';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { numberTexture, textures } from './Textures';

const RACE_NUMBERS: Record<string, number> = { viper: 7, rhino: 21, spectre: 13, volt: 42 };

/**
 * Procedural low-poly car. Local axes: +X forward, +Y up, +Z right.
 * Outlines match the original top-down silhouettes (52 × 28 units).
 */
export interface CarModel {
  root: THREE.Group;
  /** tilts for roll / pitch */
  body: THREE.Group;
  turret: THREE.Group;
  wheels: THREE.Mesh[];
  frontWheels: THREE.Mesh[];
  bodyMat: THREE.MeshStandardMaterial;
  tailMat: THREE.MeshBasicMaterial;
  headMat: THREE.MeshBasicMaterial;
  glassMat: THREE.MeshStandardMaterial;
  flame: THREE.Mesh;
  flameMat: THREE.MeshBasicMaterial;
  shield: THREE.Mesh;
  underglow: THREE.Mesh;
  underglowMat: THREE.MeshBasicMaterial;
  shadow: THREE.Mesh;
  /** every material that should fade for ghost mode */
  fadeMats: THREE.Material[];
}

const S = 0.5; // texture px → world units
const outline = (pts: number[][]) => pts.map(([x, y]) => new THREE.Vector2((x - 52) * S, (y - 28) * S));

function roundRectShape(x0: number, y0: number, x1: number, y1: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const X0 = (x0 - 52) * S;
  const Y0 = (y0 - 28) * S;
  const X1 = (x1 - 52) * S;
  const Y1 = (y1 - 28) * S;
  const R = r * S;
  s.moveTo(X0 + R, Y0);
  s.lineTo(X1 - R, Y0);
  s.quadraticCurveTo(X1, Y0, X1, Y0 + R);
  s.lineTo(X1, Y1 - R);
  s.quadraticCurveTo(X1, Y1, X1 - R, Y1);
  s.lineTo(X0 + R, Y1);
  s.quadraticCurveTo(X0, Y1, X0, Y1 - R);
  s.lineTo(X0, Y0 + R);
  s.quadraticCurveTo(X0, Y0, X0 + R, Y0);
  return s;
}

/** Extrude a top-view outline upwards into a slab. */
function slab(shape: THREE.Shape, height: number, bevel = 1.2): THREE.ExtrudeGeometry {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 6,
  });
  g.rotateX(-Math.PI / 2); // extrusion (+Z) becomes +Y; shape y becomes -Z
  return g;
}

const sharedGeo = {
  wheel: (() => {
    const g = new THREE.CylinderGeometry(6, 6, 5, 14);
    g.rotateX(Math.PI / 2);
    g.userData.shared = true;
    return g;
  })(),
  // five-spoke rim merged into one geometry
  hub: (() => {
    const parts: THREE.BufferGeometry[] = [];
    const lip = new THREE.TorusGeometry(4.2, 0.6, 6, 16);
    lip.translate(0, 0, 2.7);
    parts.push(lip);
    const centre = new THREE.CylinderGeometry(1.4, 1.4, 5.6, 8);
    centre.rotateX(Math.PI / 2);
    parts.push(centre);
    for (let i = 0; i < 5; i++) {
      const spoke = new THREE.BoxGeometry(0.9, 4, 0.8);
      spoke.translate(0, 2, 2.6);
      spoke.rotateZ((i / 5) * Math.PI * 2);
      parts.push(spoke);
    }
    const g = mergeGeometries(parts.map((p) => p.toNonIndexed()))!;
    g.userData.shared = true;
    return g;
  })(),
};

const wheelMat = new THREE.MeshStandardMaterial({ color: 0x161618, roughness: 0.92 });
wheelMat.userData.shared = true;
const hubMat = new THREE.MeshStandardMaterial({ color: 0xc4c8ce, roughness: 0.25, metalness: 0.95 });
hubMat.userData.shared = true;

export function buildCarModel(car: CarStats): CarModel {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  // metallic car paint – reflections come from the scene environment map
  const paint = new THREE.Color(car.color).multiplyScalar(0.8);
  // clear-coated paint: a glossy lacquer layer over a slightly metallic base
  const bodyMat = new THREE.MeshPhysicalMaterial({ color: paint, metalness: 0.35, roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.06 });
  bodyMat.userData.baseEmissive = 0x000000;
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x202226, roughness: 0.7, metalness: 0.2 });
  const accentMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(car.accent).multiplyScalar(0.85), roughness: 0.4, metalness: 0.3 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x0e141b, roughness: 0.06, metalness: 0.9 });
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff4c8 });
  const tailMat = new THREE.MeshBasicMaterial({ color: 0x801018 });

  // ---------- chassis
  const lift = 3.5;
  let shape: THREE.Shape;
  let h = 7;
  switch (car.shape) {
    case 'wedge':
      shape = new THREE.Shape(outline([[6, 12], [30, 7], [78, 9], [100, 22], [100, 34], [78, 47], [30, 49], [6, 44]]));
      h = 5.5;
      break;
    case 'brick':
      shape = roundRectShape(4, 6, 98, 50, 6);
      h = 10;
      break;
    case 'dart':
      shape = new THREE.Shape(outline([[4, 8], [22, 14], [60, 10], [102, 26], [102, 30], [60, 46], [22, 42], [4, 48], [12, 28]]));
      h = 5;
      break;
    default:
      shape = roundRectShape(6, 8, 98, 48, 16);
      h = 8;
  }
  const chassis = new THREE.Mesh(slab(shape, h), bodyMat);
  chassis.position.y = lift;
  body.add(chassis);
  const skirt = new THREE.Mesh(slab(shape, 2, 0.4), darkMat);
  skirt.scale.set(1.02, 1, 1.02);
  skirt.position.y = lift - 0.5;
  body.add(skirt);
  const top = lift + h + 1.2;

  // ---------- cabin
  const cabinLen = car.shape === 'brick' ? 26 : 20;
  const cabinW = car.shape === 'dart' ? 12 : car.shape === 'brick' ? 22 : 18;
  const cabinH = car.shape === 'brick' ? 8 : 6.5;
  const cabinShape = new THREE.Shape();
  const cx0 = car.shape === 'brick' ? -8 : -6;
  cabinShape.moveTo(cx0 - cabinLen / 2, -cabinW / 2);
  cabinShape.lineTo(cx0 + cabinLen / 2, -cabinW / 2 + 2);
  cabinShape.lineTo(cx0 + cabinLen / 2, cabinW / 2 - 2);
  cabinShape.lineTo(cx0 - cabinLen / 2, cabinW / 2);
  cabinShape.closePath();
  const cabinGeo = slab(cabinShape, cabinH, 1.5);
  // taper the roof a bit
  const pos = cabinGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y > cabinH * 0.5) {
      pos.setX(i, pos.getX(i) * 0.78 + cx0 * 0.22 - 1.5);
      pos.setZ(i, pos.getZ(i) * 0.8);
    }
  }
  cabinGeo.computeVertexNormals();
  const cabin = new THREE.Mesh(cabinGeo, glassMat);
  cabin.position.y = top - 0.5;
  body.add(cabin);

  // ---------- accent details per archetype
  switch (car.shape) {
    case 'wedge': {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(44, 0.6, 3), accentMat);
      stripe.position.set(2, top + 0.1, 0);
      body.add(stripe);
      const wing = new THREE.Mesh(new THREE.BoxGeometry(5, 1.2, 28), darkMat);
      wing.position.set(-22, top + 6, 0);
      body.add(wing);
      for (const z of [-8, 8]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(2, 6, 1.2), darkMat);
        post.position.set(-21, top + 3, z);
        body.add(post);
      }
      break;
    }
    case 'brick': {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(4, 7, 26), accentMat);
      bar.position.set(26, lift + 4, 0);
      body.add(bar);
      const rack = new THREE.Mesh(new THREE.BoxGeometry(14, 1.5, 20), darkMat);
      rack.position.set(-16, top + 0.8, 0);
      body.add(rack);
      for (const z of [-12, 12]) {
        const plate = new THREE.Mesh(new THREE.BoxGeometry(34, 5, 1.2), darkMat);
        plate.position.set(0, lift + 5, z * 1.15);
        body.add(plate);
      }
      break;
    }
    case 'dart': {
      for (const z of [-1, 1]) {
        const fin = new THREE.Mesh(new THREE.BoxGeometry(12, 8, 1.2), accentMat);
        fin.position.set(-20, top + 3, z * 9);
        fin.rotation.z = -0.35;
        body.add(fin);
      }
      const spine = new THREE.Mesh(new THREE.BoxGeometry(28, 0.8, 2), accentMat);
      spine.position.set(12, top, 0);
      body.add(spine);
      break;
    }
    default: {
      for (let i = 0; i < 3; i++) {
        const coil = new THREE.Mesh(new THREE.TorusGeometry(5, 1, 6, 16), accentMat);
        coil.rotation.y = Math.PI / 2;
        coil.position.set(-20 + i * 5, top + 2, 0);
        body.add(coil);
      }
      break;
    }
  }

  // ---------- lights
  const front = car.shape === 'dart' ? 23 : car.shape === 'wedge' ? 22 : 23;
  for (const z of [-7, 7]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2, 4), headMat);
    hl.position.set(front + 1, lift + h * 0.55, z * (car.shape === 'dart' ? 0.6 : 1));
    body.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.2, 5), tailMat);
    tl.position.set(-24.5, lift + h * 0.6, z * 1.2);
    body.add(tl);
  }

  // ---------- wheels
  const wheels: THREE.Mesh[] = [];
  const frontWheels: THREE.Mesh[] = [];
  const track = car.shape === 'brick' ? 13.5 : 12.5;
  for (const [x, isFront] of [
    [14, true],
    [-14, false],
  ] as [number, boolean][]) {
    for (const z of [-track, track]) {
      const w = new THREE.Mesh(sharedGeo.wheel, wheelMat);
      w.position.set(x, 6, z);
      const hub = new THREE.Mesh(sharedGeo.hub, hubMat);
      // spokes face outwards on both sides of the car
      if (z < 0) hub.rotation.y = Math.PI;
      w.add(hub);
      root.add(w);
      wheels.push(w);
      if (isFront) frontWheels.push(w);
    }
  }

  // ---------- details: fender flares, mirrors, exhausts, diffuser, race number
  for (const [x] of [[14], [-14]]) {
    for (const z of [-1, 1]) {
      const flare = new THREE.Mesh(new THREE.BoxGeometry(17, 4, 3.2), darkMat);
      flare.position.set(x, 11.5, z * (track + 0.4));
      body.add(flare);
    }
  }
  for (const z of [-1, 1]) {
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2, 3), darkMat);
    mirror.position.set(4, top + 1.2, z * (cabinW / 2 + 2.5));
    body.add(mirror);
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 4, 8).rotateZ(Math.PI / 2), hubMat);
    pipe.position.set(-25.5, lift + 1.5, z * 5);
    body.add(pipe);
  }
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(3, 2.5, 20), darkMat);
  diffuser.position.set(-24.5, lift + 0.5, 0);
  body.add(diffuser);
  const num = new THREE.Mesh(
    new THREE.PlaneGeometry(9, 9),
    new THREE.MeshStandardMaterial({ map: numberTexture(RACE_NUMBERS[car.id] ?? 1, '#' + car.color.toString(16).padStart(6, '0')), transparent: true, roughness: 0.4 }),
  );
  num.rotation.x = -Math.PI / 2;
  num.rotation.z = -Math.PI / 2;
  num.position.set(15, top + 0.2, 0);
  body.add(num);

  // ---------- turret
  const turret = new THREE.Group();
  const tBase = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 5.5, 3, 10), new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.5, metalness: 0.6 }));
  turret.add(tBase);
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.35, metalness: 0.85 });
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(14, 2.2, 2.2), barrelMat);
  barrel.position.set(8, 0.8, 0);
  turret.add(barrel);
  const tip = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 3), accentMat);
  tip.position.set(15, 0.8, 0);
  turret.add(tip);
  turret.position.set(-3, top + cabinH * 0.6 + 1, 0);
  body.add(turret);

  // ---------- fx meshes
  const flameMat = new THREE.MeshBasicMaterial({ color: 0x5fb8ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const flameGeo = new THREE.ConeGeometry(4, 22, 10, 1, true);
  flameGeo.rotateZ(Math.PI / 2); // tip now points backwards (-X)
  flameGeo.translate(-11, 0, 0);
  const flame = new THREE.Mesh(flameGeo, flameMat);
  flame.position.set(-25, lift + h * 0.5, 0);
  flame.visible = false;
  body.add(flame);

  const shield = new THREE.Mesh(
    new THREE.IcosahedronGeometry(36, 2),
    new THREE.MeshBasicMaterial({ color: 0x7dff4a, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, wireframe: true }),
  );
  shield.position.y = 10;
  shield.visible = false;
  root.add(shield);

  const underglowMat = new THREE.MeshBasicMaterial({
    map: textures().soft,
    color: car.color,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  // only shown while drifting – doubles as the drift-charge indicator
  const underglow = new THREE.Mesh(new THREE.PlaneGeometry(90, 60), underglowMat);
  underglow.rotation.x = -Math.PI / 2;
  underglow.position.y = 0.9;
  underglow.visible = false;
  root.add(underglow);

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(70, 44),
    new THREE.MeshBasicMaterial({ map: textures().soft, color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.7;
  root.add(shadow);

  // real shadows from the sun
  body.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  for (const w of wheels) w.castShadow = true;
  flame.castShadow = false;

  const fadeMats: THREE.Material[] = [bodyMat, darkMat, accentMat, glassMat, headMat, tailMat, barrelMat];

  return { root, body, turret, wheels, frontWheels, bodyMat, tailMat, headMat, glassMat, flame, flameMat, shield, underglow, underglowMat, shadow, fadeMats };
}
