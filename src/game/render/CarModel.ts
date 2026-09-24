import * as THREE from 'three';
import type { CarStats } from '../data/cars';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { numberTexture, textures } from './Textures';
import { carAsset } from './Assets';

const RACE_NUMBERS: Record<string, number> = { viper: 7, rhino: 21, spectre: 13, volt: 42 };

/**
 * A car: the Blender model (art/blender/cars.py) when it loaded, otherwise the procedural low-poly one.
 * Local axes: +X forward, +Y up, +Z right. Outlines match the original top-down silhouettes (52 × 28 units).
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
  wheelRadius: number;
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

/** Materials shared by both car builds; vertex colours carry the Blender-baked occlusion when present. */
function carMaterials(car: CarStats, vertexColors: boolean) {
  // metallic car paint – reflections come from the scene environment map
  const paint = new THREE.Color(car.color).multiplyScalar(0.8);
  // clear-coated paint: a glossy lacquer layer over a slightly metallic base
  const bodyMat = new THREE.MeshPhysicalMaterial({ color: paint, metalness: 0.35, roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.06, vertexColors });
  bodyMat.userData.baseEmissive = 0x000000;
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x202226, roughness: 0.7, metalness: 0.2, vertexColors });
  const accentMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(car.accent).multiplyScalar(0.85), roughness: 0.4, metalness: 0.3, vertexColors });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x0e141b, roughness: 0.06, metalness: 0.9 });
  // lamps are pushed past 1.0 so they catch the bloom on high quality
  const headMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff4c8).multiplyScalar(12) });
  const tailMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xc01020).multiplyScalar(14) });
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.35, metalness: 0.85, vertexColors });
  return { bodyMat, darkMat, accentMat, glassMat, headMat, tailMat, barrelMat };
}

export function buildCarModel(car: CarStats): CarModel {
  return buildBlenderCar(car) ?? buildProceduralCar(car);
}

/** The Blender-modelled car: body parts by material, a shared wheel and turret, measurements from the model. */
function buildBlenderCar(car: CarStats): CarModel | null {
  const asset = carAsset(car.id);
  const wheelAsset = carAsset('wheel');
  const turretAsset = carAsset('turret');
  if (!asset || !wheelAsset || !turretAsset) return null;
  const info = asset.info;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const mats = carMaterials(car, true);
  const { bodyMat, darkMat, accentMat, glassMat, headMat, tailMat, barrelMat } = mats;
  // Volt's roof coils glow in the car's colour
  const coilMat = new THREE.MeshStandardMaterial({ color: car.color, emissive: car.color, emissiveIntensity: 1.4, roughness: 0.3, vertexColors: true });
  const turretMat = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.5, metalness: 0.6, vertexColors: true });
  const byName: Record<string, THREE.Material> = {
    paint: bodyMat,
    dark: darkMat,
    accent: accentMat,
    glass: glassMat,
    head: headMat,
    tail: tailMat,
    chrome: hubMat,
    coil: coilMat,
    tire_dark: wheelMat,
    tire: wheelMat,
    rim: hubMat,
    turret: turretMat,
    barrel: barrelMat,
  };
  for (const [name, geo] of asset.parts) {
    const mesh = new THREE.Mesh(geo, byName[name] ?? darkMat);
    mesh.castShadow = true;
    body.add(mesh);
  }

  // ---------- wheels (the axle runs along z)
  const wheelR = info.wheelR ?? 5.5;
  const track = info.track ?? 12;
  const wheels: THREE.Mesh[] = [];
  const frontWheels: THREE.Mesh[] = [];
  const tyreGeo = wheelAsset.parts.get('tire');
  const rimGeo = wheelAsset.parts.get('rim');
  for (const [x, isFront] of [
    [14, true],
    [-14, false],
  ] as [number, boolean][]) {
    for (const z of [-track, track]) {
      const w = new THREE.Mesh(tyreGeo, wheelMat);
      w.position.set(x, wheelR, z);
      if (rimGeo) w.add(new THREE.Mesh(rimGeo, hubMat));
      w.castShadow = true;
      root.add(w);
      wheels.push(w);
      if (isFront) frontWheels.push(w);
    }
  }

  // ---------- race number on the bonnet, tilted to its slope
  const num = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 8),
    new THREE.MeshStandardMaterial({
      map: numberTexture(RACE_NUMBERS[car.id] ?? 1, '#' + car.color.toString(16).padStart(6, '0')),
      transparent: true,
      roughness: 0.4,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
  );
  // lie flat, turn to read along the car, then tilt with the bonnet
  num.rotation.order = 'ZYX';
  num.rotation.set(-Math.PI / 2, -Math.PI / 2, Math.atan(info.hoodSlope ?? 0));
  num.position.set(15, (info.hoodY ?? 10) + 0.25, 0);
  body.add(num);

  // ---------- turret on the roof
  const turret = new THREE.Group();
  for (const [name, geo] of turretAsset.parts) {
    const mesh = new THREE.Mesh(geo, byName[name] ?? turretMat);
    mesh.castShadow = true;
    turret.add(mesh);
  }
  turret.position.set(-3, (info.roofY ?? 15) - 0.4, 0);
  body.add(turret);

  const fx = buildFx(car, body, root, info.rearX ?? -25, info.exhaustY ?? 5);
  const fadeMats: THREE.Material[] = [bodyMat, darkMat, accentMat, glassMat, headMat, tailMat, barrelMat, coilMat, turretMat];
  return { root, body, turret, wheels, frontWheels, bodyMat, tailMat, headMat, glassMat, ...fx, fadeMats, wheelRadius: wheelR };
}

/** Boost flame, shield bubble, drift underglow and the soft blob shadow. */
function buildFx(car: CarStats, body: THREE.Group, root: THREE.Group, rearX: number, flameY: number) {
  const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x5fb8ff).multiplyScalar(10), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const flameGeo = new THREE.ConeGeometry(4, 22, 10, 1, true);
  flameGeo.rotateZ(Math.PI / 2); // tip now points backwards (-X)
  flameGeo.translate(-11, 0, 0);
  const flame = new THREE.Mesh(flameGeo, flameMat);
  flame.position.set(rearX, flameY, 0);
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
  return { flame, flameMat, shield, underglow, underglowMat, shadow };
}

/** The original low-poly car built from extruded outlines (used when the Blender models are missing). */
function buildProceduralCar(car: CarStats): CarModel {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const { bodyMat, darkMat, accentMat, glassMat, headMat, tailMat, barrelMat } = carMaterials(car, false);

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
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(14, 2.2, 2.2), barrelMat);
  barrel.position.set(8, 0.8, 0);
  turret.add(barrel);
  const tip = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 3), accentMat);
  tip.position.set(15, 0.8, 0);
  turret.add(tip);
  turret.position.set(-3, top + cabinH * 0.6 + 1, 0);
  body.add(turret);

  const { flame, flameMat, shield, underglow, underglowMat, shadow } = buildFx(car, body, root, -25, lift + h * 0.5);

  // real shadows from the sun
  body.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  for (const w of wheels) w.castShadow = true;
  flame.castShadow = false;

  const fadeMats: THREE.Material[] = [bodyMat, darkMat, accentMat, glassMat, headMat, tailMat, barrelMat];

  return { root, body, turret, wheels, frontWheels, bodyMat, tailMat, headMat, glassMat, flame, flameMat, shield, underglow, underglowMat, shadow, fadeMats, wheelRadius: 6 };
}
