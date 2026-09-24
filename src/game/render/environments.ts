import type { TrackTheme } from '../track/TrackData';

/**
 * Sky, sun, fog and ambient light for each track theme.
 * The ground-lighting bake (art/blender/ground_bake.py) reads the sun direction from here too.
 */
export interface Environment {
  /** degrees above the horizon */
  sunElevation: number;
  /** degrees; three.js spherical theta (0 = +z, 90 = +x) */
  sunAzimuth: number;
  sunColor: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  fogColor: number;
  /** fog grows as 1 - exp(-(d * density)^1.6) */
  fogDensity: number;
  sky: { turbidity: number; rayleigh: number; mie: number; mieG: number; clouds: number; cloudDensity: number };
  /** colour grade on the sky: multiplier at the horizon and overhead */
  skyTint: [number, number];
  exposure: number;
  /** how much paint and glass reflect the sky */
  envIntensity: number;
  /** what cars reflect from below the horizon */
  envGround: number;
  /** tyre smoke and landing dust */
  dust: [number, number];
}

export const ENVIRONMENTS: Record<TrackTheme, Environment> = {
  // late-afternoon haze over the industrial estate
  industrial: {
    sunElevation: 38,
    sunAzimuth: -35,
    sunColor: 0xfff0dc,
    sunIntensity: 2.7,
    hemiSky: 0xbcd0ff,
    hemiGround: 0x5a5044,
    hemiIntensity: 0.7,
    fogColor: 0xa4b4c6,
    fogDensity: 0.000166,
    sky: { turbidity: 3.5, rayleigh: 2.2, mie: 0.004, mieG: 0.82, clouds: 0.38, cloudDensity: 0.55 },
    skyTint: [0xffffff, 0xffffff],
    exposure: 0.72,
    envIntensity: 0.3,
    envGround: 0x2c2a28,
    dust: [0xd4d7de, 0xaeb2ba],
  },
  // desert sunset: a low orange sun over the top straight (it sets behind the stone arch),
  // long shadows, warm dusty air that turns the distant mesas violet
  desert: {
    sunElevation: 17,
    sunAzimuth: -100,
    sunColor: 0xffb574,
    sunIntensity: 4.2,
    hemiSky: 0xffcaa0,
    hemiGround: 0x7a4a2c,
    hemiIntensity: 1.3,
    fogColor: 0xd9a47a,
    fogDensity: 0.000118,
    sky: { turbidity: 5, rayleigh: 3.6, mie: 0.005, mieG: 0.88, clouds: 0.16, cloudDensity: 0.45 },
    skyTint: [0xffb27a, 0x9ab4ff],
    exposure: 0.92,
    envIntensity: 0.3,
    envGround: 0x5a3a26,
    dust: [0xe0c49c, 0xc49a6c],
  },
};

/** Unit vector pointing at the sun in three.js space (x, y up, z). */
export function sunDirection(env: Environment): [number, number, number] {
  const el = (env.sunElevation * Math.PI) / 180;
  const az = (env.sunAzimuth * Math.PI) / 180;
  return [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
}
