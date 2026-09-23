export type CarId = 'viper' | 'rhino' | 'spectre' | 'volt';
export type AbilityId = 'overcharge' | 'shield' | 'blink' | 'emp';

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
    blurb: 'Fastest car on the grid. Overcharge turns it into a killer for 3 seconds.',
    color: 0xff2d55,
    accent: 0xffd23f,
    acceleration: 680,
    maxSpeed: 635,
    reverseSpeed: 230,
    handling: 2.85,
    grip: 7.2,
    driftGrip: 1.55,
    mass: 0.9,
    hp: 85,
    energy: 100,
    ability: 'overcharge',
    rating: { speed: 10, acceleration: 10, handling: 6, armor: 4 },
    shape: 'wedge',
  },
  rhino: {
    id: 'rhino',
    name: 'RHINO',
    archetype: 'Tank',
    blurb: 'Heavy armored brute. Wins every shoving match and rarely dies.',
    color: 0x7dff4a,
    accent: 0x2b3a1a,
    acceleration: 610,
    maxSpeed: 612,
    reverseSpeed: 210,
    handling: 2.85,
    grip: 8.6,
    driftGrip: 2.2,
    mass: 1.55,
    hp: 145,
    energy: 100,
    ability: 'shield',
    rating: { speed: 7, acceleration: 7, handling: 6, armor: 10 },
    shape: 'brick',
  },
  spectre: {
    id: 'spectre',
    name: 'SPECTRE',
    archetype: 'Agile / Assassin',
    blurb: 'Razor handling and a blink dash that can skip a whole corner.',
    color: 0xb04dff,
    accent: 0x00e5ff,
    acceleration: 630,
    maxSpeed: 610,
    reverseSpeed: 240,
    handling: 3.3,
    grip: 9.2,
    driftGrip: 1.9,
    mass: 1.0,
    hp: 90,
    energy: 100,
    ability: 'blink',
    rating: { speed: 7, acceleration: 8, handling: 10, armor: 4 },
    shape: 'dart',
  },
  volt: {
    id: 'volt',
    name: 'VOLT',
    archetype: 'Control',
    blurb: 'Balanced all-rounder with extra energy and an EMP that shuts rivals down.',
    color: 0x00e5ff,
    accent: 0x0a2a55,
    acceleration: 625,
    maxSpeed: 622,
    reverseSpeed: 225,
    handling: 3.2,
    grip: 8.6,
    driftGrip: 1.8,
    mass: 1.15,
    hp: 125,
    energy: 120,
    ability: 'emp',
    rating: { speed: 8, acceleration: 8, handling: 8, armor: 8 },
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
  overcharge: {
    id: 'overcharge',
    name: 'OVERCHARGE',
    description: '3 s: primary fires 60% faster, hits 30% harder and costs no energy.',
    energyCost: 30,
    cooldown: 11,
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
