import type Phaser from 'phaser';
import type { Track } from '../track/Track';
import type { Car } from '../entities/Car';
import type { Effects } from './Effects';
import type { AudioManager } from './AudioManager';
import type { CombatSystem } from './CombatSystem';
import type { HUD } from '../ui/HUD';
import type { CollisionSystem } from './CollisionSystem';

/** Shared services available to cars, weapons, abilities and AI. */
export interface World {
  scene: Phaser.Scene;
  track: Track;
  cars: Car[];
  /** simulation time in seconds since the scene started */
  time: number;
  raceStarted: boolean;
  effects: Effects;
  audio: AudioManager;
  combat: CombatSystem;
  collisions: CollisionSystem;
  hud: HUD | null;
  player: Car | null;
}
