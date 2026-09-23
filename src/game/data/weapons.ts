export type WeaponId = 'machinegun' | 'cannon' | 'rocket' | 'mine';
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
    ttl: 0.55,
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
    ttl: 0.8,
    splash: 0,
    knockback: 220,
    spread: 0.01,
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
};

export const PRIMARY_WEAPONS: WeaponId[] = ['machinegun', 'cannon'];
export const SECONDARY_WEAPONS: WeaponId[] = ['rocket', 'mine'];
