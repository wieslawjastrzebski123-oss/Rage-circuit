import type { Car } from '../entities/Car';
import type { Track, TrackHit } from '../track/Track';

const MAX_STEP = 450; // bigger jumps in one frame are ignored (never happens while driving)
const WRONG_WAY_SPEED = 60;

/**
 * Tracks each car's continuous race distance ("progress") along the track.
 * Checkpoints are just fixed distances, so they can only be passed in order,
 * and walls make it impossible to skip ahead – reversing lowers progress again.
 */
export class CheckpointManager {
  private track: Track;
  private hit = {} as TrackHit;
  readonly count: number;

  constructor(track: Track) {
    this.track = track;
    this.count = track.checkpoints.length;
  }

  /** Race distance of the k-th checkpoint crossing (k = 0 is the first start-line crossing). */
  distanceOf(k: number): number {
    const n = this.count;
    return Math.floor(k / n) * this.track.length + this.track.checkpoints[((k % n) + n) % n];
  }

  /** Initialise a car standing on the grid, `behind` px before the start line. */
  placeOnGrid(car: Car, behind: number): void {
    const L = this.track.length;
    car.race.s = (L - behind) % L;
    car.race.progress = -behind;
    car.race.cpPassed = 0;
    car.race.lapsDone = 0;
  }

  /** Set the race state after a respawn / reset at the last checkpoint. */
  placeAtCheckpoint(car: Car): { x: number; y: number; angle: number; hw: number } {
    const k = car.race.cpPassed - 1;
    const d = k >= 0 ? this.distanceOf(k) : Math.min(car.race.progress, -60);
    const pt = this.track.pointAt(d);
    car.race.progress = d;
    car.race.s = ((d % this.track.length) + this.track.length) % this.track.length;
    return pt;
  }

  /**
   * Updates progress and returns the list of checkpoint indices passed this frame.
   */
  update(car: Car, dt: number, out: number[]): TrackHit | null {
    out.length = 0;
    const r = car.race;
    const h = this.track.query(car.x, car.y, r.s, this.hit);
    if (!h) return null;
    const L = this.track.length;
    let ds = h.s - r.s;
    if (ds > L / 2) ds -= L;
    if (ds < -L / 2) ds += L;
    if (Math.abs(ds) < MAX_STEP) {
      r.progress += ds;
      r.s = h.s;
    }
    r.usingShortcut = h.seg.path === 1;

    // wrong way: moving against the track direction for a while
    const along = car.vx * h.seg.tx + car.vy * h.seg.ty;
    if (car.alive && along < -WRONG_WAY_SPEED) r.wrongWayTime += dt;
    else r.wrongWayTime = Math.max(0, r.wrongWayTime - dt * 3);

    while (r.progress >= this.distanceOf(r.cpPassed)) {
      out.push(r.cpPassed);
      r.cpPassed++;
    }
    return h;
  }
}
