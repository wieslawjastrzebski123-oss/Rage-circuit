import type { CarId } from '../data/cars';
import type { WeaponId } from '../data/weapons';
import type { TrackId } from '../track/TrackData';

/** Shared between the browser client and the Node server. */
// 2: track choice, car height (jumps)
// 3: new weapons (projectile kinds, missile targets, oil slicks), oil and slipstream per car
export const PROTOCOL_VERSION = 3;
export const TICK_RATE = 60; // server simulation ticks per second
export const SUBSTEPS = 2; // physics sub-steps per tick (dt = 1/120 like solo)
export const SNAPSHOT_EVERY = 2; // ticks per snapshot → 30 Hz
export const MAX_PLAYERS = 5;
export const GRID_SIZE = 6; // humans + bots
export const DEFAULT_PORT = 8787;

export interface LobbyPlayer {
  id: number;
  name: string;
  car: CarId;
  primary: WeaponId;
  secondary: WeaponId;
  ready: boolean;
  host: boolean;
}

/** [throttle, steer, flags, aimX, aimY] */
export type InputTuple = [number, number, number, number, number];
export const IN_DRIFT = 1;
export const IN_BOOST = 2;
export const IN_FIRE1 = 4;
export const IN_FIRE2 = 8;
export const IN_ABILITY = 16;
export const IN_RESET = 32;

export interface CarSetup {
  id: number;
  car: CarId;
  name: string;
  /** player id of the human driver, or 0 for a bot */
  owner: number;
  primary: WeaponId;
  secondary: WeaponId;
}

export type ClientMsg =
  | { t: 'create'; v: number; name: string }
  | { t: 'join'; v: number; name: string; code: string }
  | { t: 'loadout'; car: CarId; primary: WeaponId; secondary: WeaponId }
  | { t: 'ready'; ready: boolean }
  | { t: 'laps'; laps: number }
  | { t: 'track'; track: TrackId }
  | { t: 'start' }
  | { t: 'in'; s: number; i: InputTuple }
  | { t: 'lobby' }
  | { t: 'ping'; c: number };

export interface NetResults {
  position: number;
  raceTime: number;
  bestLap: number;
  lapTimes: number[];
  kills: number;
  deaths: number;
  damageDealt: number;
  damageTaken: number;
  standings: { name: string; color: number; time: number | null; player: boolean }[];
  laps: number;
  car: CarId;
}

export type ServerMsg =
  | { t: 'welcome'; you: number; code: string }
  | { t: 'lobby'; players: LobbyPlayer[]; laps: number; track: TrackId; racing: boolean }
  | { t: 'error'; msg: string }
  | { t: 'start'; laps: number; track: TrackId; cars: CarSetup[] }
  | Snapshot
  | { t: 'results'; res: NetResults }
  | { t: 'raceOver' }
  | { t: 'pong'; c: number };

/**
 * Per-car public state:
 * [id, x, y, heading, vx, vy, angVel, bodyYaw, aim, flags, driftTime, boostPower,
 *  driftBoostTime, overcharge, shield, emp, ghost, hitFlash, frozen, hp, throttle, steer,
 *  progress, lapsDone, finishOrder, finishTime, cpPassed, driftBoostColor, z, vz, oilTime, slip]
 */
export type CarTuple = number[];
export const CF_ALIVE = 1;
export const CF_DRIFT = 2;
export const CF_BOOSTING = 4;
export const CF_FINISHED = 8;
export const CF_UNLOCK1 = 16;
export const CF_UNLOCK2 = 32;
export const CF_UNLOCK3 = 64;
export const CF_AIR = 128;

/** Private state for the receiving player's own car (prediction + HUD). */
export interface OwnState {
  /** last input sequence the server applied */
  ack: number;
  energy: number;
  boost: number;
  driftDir: number;
  driftPower: number;
  rubber: number;
  cd: [number, number, number];
  lapTimes: number[];
  lapStart: number;
  kills: number;
  deaths: number;
  dealt: number;
  taken: number;
  wrong: number;
  stuck: number;
  respawn: number;
}

/** [channel, method, args] – channel: 0 effects, 1 audio, 2 hud */
export type NetEvent = [number, string, unknown[]];

export interface Snapshot {
  t: 's';
  /** race time and phase (0 countdown, 1 racing) */
  rt: number;
  ph: number;
  c: CarTuple[];
  me: OwnState | null;
  /** projectiles: [kind (index in CombatSystem PROJECTILE_KINDS), x, y, vx, vy, missile target car id or 0] */
  p: number[][];
  /** mines and oil slicks: [x, y, age, armed, ownerId, kind (0 mine, 1 oil)] */
  m: number[][];
  /** barrels: [x, y, rot, alive, fuse>=0] */
  b: number[][];
  /** pickups available (1) or respawning (0) */
  pk: number[];
  e: NetEvent[];
}

export function encodeInput(c: {
  throttle: number;
  steer: number;
  drift: boolean;
  boost: boolean;
  firePrimary: boolean;
  fireSecondary: boolean;
  ability: boolean;
  reset: boolean;
  aimX: number;
  aimY: number;
}): InputTuple {
  const f =
    (c.drift ? IN_DRIFT : 0) |
    (c.boost ? IN_BOOST : 0) |
    (c.firePrimary ? IN_FIRE1 : 0) |
    (c.fireSecondary ? IN_FIRE2 : 0) |
    (c.ability ? IN_ABILITY : 0) |
    (c.reset ? IN_RESET : 0);
  return [c.throttle, c.steer, f, Math.round(c.aimX), Math.round(c.aimY)];
}

export function decodeInput(
  i: InputTuple,
  out: {
    throttle: number;
    steer: number;
    drift: boolean;
    boost: boolean;
    firePrimary: boolean;
    fireSecondary: boolean;
    ability: boolean;
    reset: boolean;
    aimX: number;
    aimY: number;
  },
): void {
  const clampUnit = (v: number) => (Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);
  out.throttle = clampUnit(i[0]);
  out.steer = clampUnit(i[1]);
  const f = i[2] | 0;
  out.drift = (f & IN_DRIFT) !== 0;
  out.boost = (f & IN_BOOST) !== 0;
  out.firePrimary = (f & IN_FIRE1) !== 0;
  out.fireSecondary = (f & IN_FIRE2) !== 0;
  out.ability = (f & IN_ABILITY) !== 0;
  out.reset = (f & IN_RESET) !== 0;
  out.aimX = Number.isFinite(i[3]) ? i[3] : 0;
  out.aimY = Number.isFinite(i[4]) ? i[4] : 0;
}

/** Round to one decimal to keep JSON small. */
export const r1 = (v: number): number => Math.round(v * 10) / 10;
