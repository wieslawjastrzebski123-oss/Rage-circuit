export const DEFAULT_LAPS = 5;
export const LAP_OPTIONS = [1, 3, 5, 7, 10];
export const RESPAWN_DELAY = 3;
export const GHOST_TIME = 1.2;
export const RESET_PENALTY = 2;
export const CAR_RADIUS = 19;

export const DEBUG = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === 'true';

/** Weapons come online during the race */
export const PRIMARY_UNLOCK_TIME = 7; // seconds after GO
export const SECONDARY_UNLOCK_LAP = 2; // available from this lap on
export const ABILITY_UNLOCK_LAP = 3;
/** in races shorter than 3 laps the later unlocks come on a timer instead */
export const SECONDARY_UNLOCK_TIME_SHORT = 25;
export const ABILITY_UNLOCK_TIME_SHORT = 50;
