import type { Car } from '../entities/Car';
import type { Effects } from '../systems/Effects';
import { angleDiff, clamp, damp, wrapAngle } from '../utils/math';
import type { Gfx } from './Gfx';
import type { Track } from '../track/Track';

/**
 * Third-person chase camera.
 * – follows behind the car, blending heading with travel direction (so drifts look right)
 * – pulls back and widens FOV with speed / boost for a sense of speed
 * – orbits the wreck while respawning
 * – rear view: cuts to a camera ahead of the car looking back (held by the player to shoot behind)
 */
export class ChaseCamera {
  private gfx: Gfx;
  private track: Track;
  private yaw = 0;
  /** how much of the desired distance is free of walls (0..1), smoothed */
  private clearance = 1;
  private dist = 125;
  private height = 50;
  private fov = 68;
  private x = 0;
  private y = 0;
  private orbit = 0;
  cinematic = false;
  /** look backwards (set every frame by the race session) */
  rear = false;
  private wasRear = false;
  private t = 0;

  constructor(gfx: Gfx, track: Track) {
    this.gfx = gfx;
    this.track = track;
  }

  /** Fraction of the way back to the desired camera spot that stays over the road. */
  private freeFraction(cx: number, cy: number, dx: number, dy: number, dist: number): number {
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      if (!this.track.isDrivable(cx - dx * dist * f, cy - dy * dist * f)) return Math.max(0.45, (i - 1) / steps);
    }
    return 1;
  }

  snap(car: Car): void {
    this.yaw = car.heading;
    this.x = car.x;
    this.y = car.y;
    this.orbit = 0;
  }

  update(dt: number, car: Car, fx: Effects): void {
    this.t += dt;
    const spd = car.speed;
    const k = clamp(spd / 650, 0, 1.3);

    // desired yaw: mostly where the car points, partly where it is actually going
    let target = car.heading;
    if (spd > 90 && car.forwardSpeed > 0) {
      const vel = Math.atan2(car.vy, car.vx);
      target = car.heading + angleDiff(car.heading, vel) * 0.55;
    }
    if (!car.alive) {
      this.orbit += dt * 0.6;
      target = car.heading + this.orbit;
    } else this.orbit = 0;
    if (this.cinematic) target += Math.sin(this.t * 0.25) * 0.7;
    const rear = this.rear && car.alive && !this.cinematic;
    if (rear) target += Math.PI;
    if (rear !== this.wasRear) {
      // a cut, like a racing game's look-back button – swinging 180° round the car would be disorienting
      this.wasRear = rear;
      this.yaw = wrapAngle(target);
      this.clearance = 1;
    }
    this.yaw = wrapAngle(this.yaw + angleDiff(this.yaw, target) * (1 - Math.exp(-(car.alive ? 4.5 : 1.5) * dt)));

    const boost = clamp(car.boostPower, 0, 1.4);
    const wantDist = (this.cinematic ? 170 : 118) + k * 26 + boost * 14 + (car.alive ? 0 : 90);
    const wantH = (this.cinematic ? 72 : 46) + k * 8 + (car.alive ? 0 : 60);
    this.dist = damp(this.dist, wantDist, 3, dt);
    this.height = damp(this.height, wantH, 3, dt);
    this.fov = damp(this.fov, 66 + k * 8 + boost * 7, 3, dt);

    // follow position smoothly but tightly (avoid motion sickness from lag)
    this.x = damp(this.x, car.x, 14, dt);
    this.y = damp(this.y, car.y, 14, dt);
    if (Math.hypot(this.x - car.x, this.y - car.y) > 400) {
      this.x = car.x;
      this.y = car.y;
    }

    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    // don't let barriers get between the camera and the car: pull in and lift up
    const free = this.freeFraction(this.x, this.y, c, s, this.dist);
    this.clearance = free < this.clearance ? damp(this.clearance, free, 10, dt) : damp(this.clearance, free, 2, dt);
    const dist = this.dist * this.clearance;
    const lift = (1 - this.clearance) * 55;
    const cam = this.gfx.camera;
    const sh = fx.shakeNow;
    cam.position.set(
      this.x - c * dist + (Math.random() - 0.5) * sh,
      this.height + lift + (Math.random() - 0.5) * sh * 0.6,
      this.y - s * dist + (Math.random() - 0.5) * sh,
    );
    cam.lookAt(this.x + c * 70, 14, this.y + s * 70);
    if (Math.abs(cam.fov - this.fov) > 0.05) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
    fx.focusX = car.x;
    fx.focusY = car.y;
  }
}
