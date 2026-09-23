export type CarId = 'viper' | 'rhino' | 'spectre' | 'volt';
export type AbilityId = 'nitro' | 'shield' | 'blink' | 'emp';

export interface CarStats {
  id: CarId;
  name: string;
  archetype: string;
  blurb: string;
  color: number;
  accent: number;
  /** forward acceleration, px/s² */
  acceleration: number;
  /** top speed, px/s */
  maxSpeed: number;
  reverseSpeed: number;
  /** max yaw rate, rad/s */
  handling: number;
  /** lateral velocity damping per second (higher = more grip) */
  grip: number;
  /** lateral damping while drifting */
  driftGrip: number;
  mass: number;
  hp: number;
  energy: number;
  ability: AbilityId;
  /** 1..10 bars shown in the garage */
  rating: { speed: number; acceleration: number; handling: number; armor: number };
  /** body shape used by the procedural texture generator */
  shape: 'wedge' | 'brick' | 'dart' | 'coil';
}

export const CARS: Record<CarId, CarStats> = {
  viper: {
    id: 'viper',
    name: 'VIPER',
    archetype: 'Speed / Assassin',
    blurb: 'Fastest car on the grid. Glass armor – hit and run.',
    color: 0xff2d55,
    accent: 0xffd23f,
    acceleration: 700,
    maxSpeed: 650,
    reverseSpeed: 230,
    handling: 2.8,
    grip: 7.2,
    driftGrip: 1.55,
    mass: 0.9,
    hp: 80,
    energy: 100,
    ability: 'nitro',
    rating: { speed: 10, acceleration: 9, handling: 7, armor: 4 },
    shape: 'wedge',
  },
  rhino: {
    id: 'rhino',
    name: 'RHINO',
    archetype: 'Tank',
    blurb: 'Heavy armored brute. Wins every shoving match.',
    color: 0x7dff4a,
    accent: 0x2b3a1a,
    acceleration: 480,
    maxSpeed: 560,
    reverseSpeed: 210,
    handling: 2.55,
    grip: 8.6,
    driftGrip: 2.2,
    mass: 1.65,
    hp: 150,
    energy: 100,
    ability: 'shield',
    rating: { speed: 6, acceleration: 5, handling: 5, armor: 10 },
    shape: 'brick',
  },
  spectre: {
    id: 'spectre',
    name: 'SPECTRE',
    archetype: 'Agile / Assassin',
    blurb: 'Razor handling and a short-range blink dash.',
    color: 0xb04dff,
    accent: 0x00e5ff,
    acceleration: 640,
    maxSpeed: 615,
    reverseSpeed: 240,
    handling: 3.45,
    grip: 9.2,
    driftGrip: 1.9,
    mass: 1.0,
    hp: 90,
    energy: 100,
    ability: 'blink',
    rating: { speed: 8, acceleration: 8, handling: 10, armor: 5 },
    shape: 'dart',
  },
  volt: {
    id: 'volt',
    name: 'VOLT',
    archetype: 'Control',
    blurb: 'Balanced all-rounder with an EMP that shuts enemies down.',
    color: 0x00e5ff,
    accent: 0x0a2a55,
    acceleration: 580,
    maxSpeed: 590,
    reverseSpeed: 225,
    handling: 3.15,
    grip: 8.6,
    driftGrip: 1.8,
    mass: 1.15,
    hp: 115,
    energy: 100,
    ability: 'emp',
    rating: { speed: 7, acceleration: 7, handling: 8, armor: 7 },
    shape: 'coil',
  },
};

export const CAR_IDS: CarId[] = ['viper', 'rhino', 'spectre', 'volt'];

export interface AbilityInfo {
  id: AbilityId;
  name: string;
  description: string;
  energyCost: number;
  cooldown: number; // seconds
}

export const ABILITIES: Record<AbilityId, AbilityInfo> = {
  nitro: {
    id: 'nitro',
    name: 'NITRO OVERDRIVE',
    description: 'Short, violent speed burst.',
    energyCost: 35,
    cooldown: 9,
  },
  shield: {
    id: 'shield',
    name: 'SHIELD',
    description: 'Blocks 80% of damage for 2.2 s.',
    energyCost: 40,
    cooldown: 11,
  },
  blink: {
    id: 'blink',
    name: 'BLINK',
    description: 'Instant dash forward. Cannot pass walls.',
    energyCost: 35,
    cooldown: 7,
  },
  emp: {
    id: 'emp',
    name: 'EMP',
    description: 'Pulse that jams nearby enemy weapons, abilities and boost.',
    energyCost: 45,
    cooldown: 12,
  },
};
