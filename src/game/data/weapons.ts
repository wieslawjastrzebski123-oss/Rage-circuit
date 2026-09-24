export type WeaponId = 'machinegun' | 'cannon' | 'shotgun' | 'railgun' | 'rocket' | 'mine' | 'swarm' | 'oil' | 'hunter';
export type WeaponSlot = 'primary' | 'secondary';

export interface WeaponStats {
  id: WeaponId;
  name: string;
  slot: WeaponSlot;
  description: string;
  energyCost: number;
  /** seconds between shots */
  cooldown: number;
  damage: number;
  projectileSpeed: number;
  /** seconds */
  ttl: number;
  /** splash radius (0 = direct hit only) */
  splash: number;
  knockback: number;
  spread: number; // radians
  /** projectiles per shot (shotgun pellets, swarm missiles) */
  count?: number;
  /** passes through cars, hitting everything on its line */
  pierce?: boolean;
}

export const WEAPONS: Record<WeaponId, WeaponStats> = {
  machinegun: {
    id: 'machinegun',
    name: 'MACHINE GUN',
    slot: 'primary',
    description: 'Rapid fire, low damage, cheap on energy.',
    energyCost: 1.7,
    cooldown: 0.11,
    damage: 4,
    projectileSpeed: 1350,
    ttl: 0.83,
    splash: 0,
    knockback: 12,
    spread: 0.045,
  },
  cannon: {
    id: 'cannon',
    name: 'CANNON',
    slot: 'primary',
    description: 'Slow, heavy shells with knockback.',
    energyCost: 11,
    cooldown: 0.75,
    damage: 22,
    projectileSpeed: 1050,
    ttl: 1.2,
    splash: 0,
    knockback: 220,
    spread: 0.01,
  },
  shotgun: {
    id: 'shotgun',
    name: 'SHOTGUN',
    slot: 'primary',
    description: 'Eight pellets in a wide cone. Brutal side by side, useless at range.',
    energyCost: 9,
    cooldown: 0.7,
    damage: 5,
    projectileSpeed: 1500,
    ttl: 0.26,
    splash: 0,
    knockback: 34,
    spread: 0.2,
    count: 8,
  },
  railgun: {
    id: 'railgun',
    name: 'RAILGUN',
    slot: 'primary',
    description: 'Slow to reload, but the slug crosses the screen instantly and pierces every car in line.',
    energyCost: 20,
    cooldown: 1.9,
    damage: 30,
    projectileSpeed: 5200,
    ttl: 0.28,
    splash: 0,
    knockback: 160,
    spread: 0,
    pierce: true,
  },
  rocket: {
    id: 'rocket',
    name: 'ROCKET',
    slot: 'secondary',
    description: 'Lightly homing missile. Dodge with a hard turn.',
    energyCost: 28,
    cooldown: 2.4,
    damage: 28,
    projectileSpeed: 560,
    ttl: 3.0,
    splash: 110,
    knockback: 320,
    spread: 0,
  },
  mine: {
    id: 'mine',
    name: 'MINE',
    slot: 'secondary',
    description: 'Dropped behind you. Arms after a moment.',
    energyCost: 22,
    cooldown: 6,
    damage: 27,
    projectileSpeed: 0,
    ttl: 20,
    splash: 120,
    knockback: 360,
    spread: 0,
  },
  swarm: {
    id: 'swarm',
    name: 'SWARM',
    slot: 'secondary',
    description: 'Three small homing missiles that fan out and converge. Hard to dodge, weak alone.',
    energyCost: 30,
    cooldown: 3,
    damage: 11,
    projectileSpeed: 620,
    ttl: 2.4,
    splash: 60,
    knockback: 140,
    spread: 0.45,
    count: 3,
  },
  oil: {
    id: 'oil',
    name: 'OIL SLICK',
    slot: 'secondary',
    description: 'A puddle behind you. Anyone who drives through loses grip and spins.',
    energyCost: 18,
    cooldown: 5,
    damage: 0,
    projectileSpeed: 0,
    ttl: 10,
    splash: 58,
    knockback: 0,
    spread: 0,
  },
  // not selectable: launched by the HUNTER pickup straight at the race leader
  hunter: {
    id: 'hunter',
    name: 'HUNTER',
    slot: 'secondary',
    description: 'Seeks out the leader, flying over walls.',
    energyCost: 0,
    cooldown: 0,
    damage: 36,
    projectileSpeed: 700,
    ttl: 9,
    splash: 130,
    knockback: 380,
    spread: 0,
  },
};

export const PRIMARY_WEAPONS: WeaponId[] = ['machinegun', 'cannon', 'shotgun', 'railgun'];
export const SECONDARY_WEAPONS: WeaponId[] = ['rocket', 'swarm', 'mine', 'oil'];

/** How far a direct-fire weapon reaches (units). */
export function weaponRange(w: WeaponStats): number {
  return w.projectileSpeed * w.ttl;
}
