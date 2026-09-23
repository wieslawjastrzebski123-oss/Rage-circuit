import { IS_TOUCH } from '../ui/device';
import {
  ABILITY_UNLOCK_LAP,
  ABILITY_UNLOCK_TIME_SHORT,
  PRIMARY_UNLOCK_TIME,
  SECONDARY_UNLOCK_LAP,
  SECONDARY_UNLOCK_TIME_SHORT,
} from '../constants';
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
  /** called when any car crosses the line for the last time */
  onCarFinish: ((car: Car) => void) | null = null;
  private wrongWayShown = new Set<Car>();

  readonly laps: number;

  constructor(world: World, laps: number) {
    this.world = world;
    this.laps = laps;
    this.checkpoints = new CheckpointManager(world.track);
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
    this.updateUnlocks();
    this.updateStandings();
    this.updateRubberBand();

    for (const c of w.cars) {
      const v = w.view(c);
      if (!v || c.race.finished) continue;
      const wrong = c.race.wrongWayTime > 1.2;
      if (wrong !== this.wrongWayShown.has(c)) {
        if (wrong) this.wrongWayShown.add(c);
        else this.wrongWayShown.delete(c);
        v.hud?.setWrongWay(wrong);
      }
    }
  }

  private onCheckpoint(car: Car, k: number): void {
    const n = this.checkpoints.count;
    const r = car.race;
    if (k === 0 || k % n !== 0 || r.finished) {
      if (k > 0) this.world.view(car)?.hud?.checkpointPing();
      return;
    }
    // completed a lap
    const lapTime = this.raceTime - r.lapStart;
    r.lapTimes.push(lapTime);
    r.lapStart = this.raceTime;
    r.lapsDone = k / n;
    if (r.lapsDone >= this.laps) {
      r.finished = true;
      r.finishTime = this.raceTime;
      r.finishOrder = ++this.finishCount;
      car.ghostTime = 0;
      this.world.view(car)?.hud?.setWrongWay(false);
      this.world.hud?.feed(`${car.name} finished ${ordinalShort(r.finishOrder)}`);
      this.onCarFinish?.(car);
      return;
    }
    const v = this.world.view(car);
    if (v) {
      const best = Math.min(...r.lapTimes);
      const isBest = lapTime <= best + 1e-6 && r.lapTimes.length > 1;
      v.hud?.lapTime(formatTime(lapTime * 1000), isBest);
      v.audio.lap();
      if (r.lapsDone === this.laps - 1) v.hud?.announce('FINAL LAP', '#ff2d6f');
      else v.hud?.announce(`LAP ${r.lapsDone + 1}`, '#00e5ff');
    }
  }

  /** Primary comes online shortly after GO, secondary and ability on later laps. */
  private updateUnlocks(): void {
    const t = this.raceTime;
    const primary = t >= PRIMARY_UNLOCK_TIME;
    const short = this.laps < ABILITY_UNLOCK_LAP;
    for (const c of this.world.cars) {
      const lap = c.race.lapsDone + 1;
      const secondary = lap >= SECONDARY_UNLOCK_LAP || (short && t >= SECONDARY_UNLOCK_TIME_SHORT) || c.race.finished;
      const ability = lap >= ABILITY_UNLOCK_LAP || (short && t >= ABILITY_UNLOCK_TIME_SHORT) || c.race.finished;
      const v = this.world.view(c);
      if (v && !c.race.finished) {
        const hud = v.hud;
        if (primary && !c.unlockPrimary) hud?.announce(`WEAPONS ONLINE`, '#7dff4a', 1300);
        // shown in the feed so it doesn't hide the lap-time message
        if (secondary && !c.unlockSecondary) hud?.feed(`🔓 ${c.secondary.name} UNLOCKED${IS_TOUCH ? '  [ALT]' : '  [RMB / Q]'}`);
        if (ability && !c.unlockAbility) hud?.feed(`🔓 ${c.abilityName} UNLOCKED${IS_TOUCH ? '  [SKILL]' : '  [SHIFT]'}`);
      }
      c.unlockPrimary = primary;
      c.unlockSecondary = secondary;
      c.unlockAbility = ability;
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
    return Math.min(this.laps, car.race.lapsDone + 1);
  }
}

function ordinalShort(n: number): string {
  return ['', '1st', '2nd', '3rd', '4th'][n] ?? `${n}th`;
}
