import type { Track } from '../track/Track';
import type { Car } from '../entities/Car';
import type { Effects } from './Effects';
import type { AudioManager } from './AudioManager';
import type { CombatSystem } from './CombatSystem';
import type { HUD } from '../ui/HUD';
import type { CollisionSystem } from './CollisionSystem';
import type { Gfx } from '../render/Gfx';

/**
 * Presentation channel for one human's own car: HUD messages, screen shake,
 * personal sound cues. Locally it is the real HUD/Effects; on the server it is a
 * recorder that forwards the calls to that player's browser.
 */
export interface Viewer {
  hud: HUD | null;
  effects: Effects;
  audio: AudioManager;
}

/** Shared services available to cars, weapons, abilities and AI. */
export interface World {
  /** null when the simulation runs headless on the server */
  gfx: Gfx | null;
  track: Track;
  cars: Car[];
  /** simulation time in seconds since the scene started */
  time: number;
  raceStarted: boolean;
  /** effects / sounds everyone sees and hears */
  effects: Effects;
  audio: AudioManager;
  combat: CombatSystem;
  collisions: CollisionSystem;
  /** HUD messages for everyone (countdown, race feed) */
  hud: HUD | null;
  /** the locally controlled car (solo mode / client prediction) */
  player: Car | null;
  /** first place right now (set by the race manager; the hunter missile goes for it) */
  leader: Car | null;
  /** personal channel for the human driving `car`, or null if it's a bot */
  view(car: Car): Viewer | null;
}
