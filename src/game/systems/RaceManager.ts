import { RACE_LAPS } from '../constants';
import type { Car } from '../entities/Car';
import { clamp, formatTime } from '../utils/math';
import { CheckpointManager } from './CheckpointManager';
import type { World } from './World';

export type RacePhase = 'countdown' | 'racing' | 'done';

const COUNTDOWN = 3;
const RUBBER_MAX = 0.05; // at most +5% acceleration when far behind
const RUBBER_GAP = 2600; // px behind the leader for full bonus

/** Countdown, laps, positions, finish order, rubber banding. */
export class RaceManager {
  private world: World;
  readonly checkpoints: CheckpointManager;
  phase: RacePhase = 'countdown';
  /** seconds since GO */
  raceTime = 0;
  private countdownLeft = COUNTDOWN + 0.6;
  private lastCount = -1;
  private finishCount = 0;
  private passed: number[] = [];
  standings: Car[] = [];
  onPlayerFinish: (() => void) | null = null;
  private wrongWayShown = false;

  constructor(world: World) {
    this.world = world;
    this.checkpoints = new CheckpointManager(world.track);
  }

  get laps(): number {
    return RACE_LAPS;
  }

  /** Line the cars up on the grid in the given order. */
  setupGrid(cars: Car[]): void {
    const t = this.world.track;
    cars.forEach((car, i) => {
      const behind = 130 + i * 90;
      const p = t.pointAt(-behind);
      const lat = (i % 2 === 0 ? -1 : 1) * p.hw * 0.42;
      const x = p.x - Math.sin(p.angle) * lat;
      const y = p.y + Math.cos(p.angle) * lat;
      car.setPose(x, y, p.angle);
      this.checkpoints.placeOnGrid(car, behind);
    });
    this.standings = cars.slice();
  }

  /** Skip the countdown (attract mode). */
  startImmediately(): void {
    this.countdownLeft = 0;
    this.phase = 'racing';
    this.world.raceStarted = true;
  }

  update(dt: number): void {
    const w = this.world;
    if (this.phase === 'countdown') {
      this.countdownLeft -= dt;
      const n = Math.ceil(this.countdownLeft - 0.6);
      if (n !== this.lastCount && n <= COUNTDOWN) {
        this.lastCount = n;
        if (n > 0) {
          w.hud?.countdown(String(n));
          w.audio.countdown(false);
        }
      }
      if (this.countdownLeft <= 0.6) {
        this.phase = 'racing';
        w.raceStarted = true;
        w.hud?.countdown('GO!');
        w.audio.countdown(true);
        for (const c of w.cars) c.race.lapStart = 0;
      }
      return;
    }

    this.raceTime += dt;
    for (const car of w.cars) {
      this.checkpoints.update(car, dt, this.passed);
      for (const k of this.passed) this.onCheckpoint(car, k);
    }
    this.updateStandings();
    this.updateRubberBand();

    const p = w.player;
    if (p && !p.race.finished) {
      const wrong = p.race.wrongWayTime > 1.2;
      if (wrong !== this.wrongWayShown) {
        this.wrongWayShown = wrong;
        w.hud?.setWrongWay(wrong);
      }
    }
  }

  private onCheckpoint(car: Car, k: number): void {
    const n = this.checkpoints.count;
    const r = car.race;
    if (k === 0 || k % n !== 0 || r.finished) {
      if (car.isPlayer && k > 0) this.world.hud?.checkpointPing();
      return;
    }
    // completed a lap
    const lapTime = this.raceTime - r.lapStart;
    r.lapTimes.push(lapTime);
    r.lapStart = this.raceTime;
    r.lapsDone = k / n;
    if (r.lapsDone >= RACE_LAPS) {
      r.finished = true;
      r.finishTime = this.raceTime;
      r.finishOrder = ++this.finishCount;
      car.ghostTime = 0;
      if (car.isPlayer) {
        this.world.hud?.setWrongWay(false);
        this.onPlayerFinish?.();
      } else this.world.hud?.feed(`${car.name} finished ${ordinalShort(r.finishOrder)}`);
      return;
    }
    if (car.isPlayer) {
      const w = this.world;
      const best = Math.min(...r.lapTimes);
      const isBest = lapTime <= best + 1e-6 && r.lapTimes.length > 1;
      w.hud?.lapTime(formatTime(lapTime * 1000), isBest);
      w.audio.lap();
      if (r.lapsDone === RACE_LAPS - 1) w.hud?.announce('FINAL LAP', '#ff2d6f');
      else w.hud?.announce(`LAP ${r.lapsDone + 1}`, '#00e5ff');
    }
  }

  private updateStandings(): void {
    this.standings.sort((a, b) => {
      if (a.race.finished && b.race.finished) return a.race.finishOrder - b.race.finishOrder;
      if (a.race.finished) return -1;
      if (b.race.finished) return 1;
      return b.race.progress - a.race.progress;
    });
  }

  private updateRubberBand(): void {
    let lead = -Infinity;
    for (const c of this.world.cars) if (!c.race.finished) lead = Math.max(lead, c.race.progress);
    for (const c of this.world.cars) {
      const gap = lead - c.race.progress;
      c.rubberBand = 1 + RUBBER_MAX * clamp((gap - 400) / RUBBER_GAP, 0, 1);
    }
  }

  positionOf(car: Car): number {
    return this.standings.indexOf(car) + 1;
  }

  currentLap(car: Car): number {
    return Math.min(RACE_LAPS, car.race.lapsDone + 1);
  }
}

function ordinalShort(n: number): string {
  return ['', '1st', '2nd', '3rd', '4th'][n] ?? `${n}th`;
}
