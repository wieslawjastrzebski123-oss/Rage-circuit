export interface Personality {
  kind: 'aggressive' | 'balanced' | 'racer';
  /** fraction of the route speed limit the bot aims for */
  pace: number;
  /** how often it opens fire, 0..1 */
  aggression: number;
  /** chance to take the shortcut on a lap */
  shortcutChance: number;
  /** chance to drift through a qualifying corner */
  driftChance: number;
  /** aim wobble in radians */
  aimError: number;
  /** energy kept in reserve for driving/abilities */
  energyReserve: number;
  /** preferred lateral bias on the racing line (px) */
  lineBias: number;
}

export const PERSONALITIES: Record<Personality['kind'], Personality> = {
  aggressive: {
    kind: 'aggressive',
    pace: 0.9,
    aggression: 1,
    shortcutChance: 0.55,
    driftChance: 0.5,
    aimError: 0.19,
    energyReserve: 12,
    lineBias: 10,
  },
  balanced: {
    kind: 'balanced',
    pace: 0.93,
    aggression: 0.6,
    shortcutChance: 0.35,
    driftChance: 0.65,
    aimError: 0.16,
    energyReserve: 28,
    lineBias: -8,
  },
  racer: {
    kind: 'racer',
    pace: 0.96,
    aggression: 0.3,
    shortcutChance: 0.2,
    driftChance: 0.85,
    aimError: 0.14,
    energyReserve: 40,
    lineBias: 0,
  },
};

/** Bot skill chosen before a solo race: scales pace, aim and how eagerly they fight. */
export function withDifficulty(p: Personality, d: 'easy' | 'normal' | 'hard'): Personality {
  if (d === 'easy') {
    return {
      ...p,
      pace: p.pace * 0.9,
      aggression: p.aggression * 0.45,
      aimError: p.aimError * 2 + 0.08,
      driftChance: p.driftChance * 0.6,
      shortcutChance: p.shortcutChance * 0.5,
    };
  }
  if (d === 'hard') {
    return {
      ...p,
      pace: Math.min(0.99, p.pace * 1.035),
      aggression: Math.min(1, p.aggression * 1.3 + 0.1),
      aimError: p.aimError * 0.6,
      driftChance: Math.min(1, p.driftChance * 1.15),
      energyReserve: p.energyReserve * 0.7,
    };
  }
  return p;
}
