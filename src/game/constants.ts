export const RACE_LAPS = 5;
export const RESPAWN_DELAY = 3;
export const GHOST_TIME = 1.2;
export const RESET_PENALTY = 2;
export const CAR_RADIUS = 19;

export const DEBUG = new URLSearchParams(window.location.search).get('debug') === 'true';

/** Render order (higher draws on top). */
export const Depth = {
  Ground: -100,
  Road: -90,
  Skid: -70,
  Pickup: -60,
  Mine: -55,
  Shadow: -50,
  Barrel: -45,
  CarFx: -40,
  Car: 0,
  Turret: 5,
  Projectile: 10,
  Effects: 20,
  Props: 30,
  Lights: 35,
  Labels: 40,
  Debug: 90,
} as const;
