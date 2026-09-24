import { PERSONALITIES } from '../src/game/ai/Personality';
import { createAbility } from '../src/game/abilities';
import { CAR_IDS, CARS } from '../src/game/data/cars';
import { PRIMARY_WEAPONS, SECONDARY_WEAPONS } from '../src/game/data/weapons';
import { AICar } from '../src/game/entities/AICar';
import type { Car } from '../src/game/entities/Car';
import { RemoteCar } from '../src/game/entities/RemoteCar';
import {
  CF_AIR,
  CF_ALIVE,
  CF_BOOSTING,
  CF_DRIFT,
  CF_FINISHED,
  CF_UNLOCK1,
  CF_UNLOCK2,
  CF_UNLOCK3,
  GRID_SIZE,
  SUBSTEPS,
  TICK_RATE,
  decodeInput,
  r1,
  type CarSetup,
  type CarTuple,
  type InputTuple,
  type LobbyPlayer,
  type NetEvent,
  type NetResults,
  type OwnState,
  type Snapshot,
} from '../src/game/net/protocol';
import { CollisionSystem } from '../src/game/systems/CollisionSystem';
import { CombatSystem } from '../src/game/systems/CombatSystem';
import { PickupSystem } from '../src/game/systems/PickupSystem';
import { RaceManager } from '../src/game/systems/RaceManager';
import { RespawnSystem } from '../src/game/systems/RespawnSystem';
import type { Viewer, World } from '../src/game/systems/World';
import type { TrackId } from '../src/game/track/TrackData';
import { getTrack } from '../src/game/track/tracks';
import { pick, shuffle } from '../src/game/utils/math';
import { createWeapon } from '../src/game/weapons';

/** input ticks the server holds back to absorb network jitter (4 × 16.7 ms ≈ 67 ms) */
const INPUT_BUFFER = 4;


const CH_EFFECTS = 0;
const CH_AUDIO = 1;
const CH_HUD = 2;
/** after the first car (bot or human) finishes, stragglers get this long before the race closes */
const FINISH_GRACE = 45;

/** Turns method calls into serialisable events (Car arguments become {c: id}). */
function recorder(channel: number, sink: NetEvent[]): unknown {
  return new Proxy(
    {},
    {
      get:
        (_t, method: string) =>
        (...args: unknown[]) => {
          sink.push([channel, method, args.map(ser)]);
        },
    },
  );
}

function ser(a: unknown): unknown {
  if (a && typeof a === 'object') {
    if ('stats' in a && 'id' in a) return { c: (a as Car).id };
    // any other positioned object (barrels, points) → plain position
    if ('x' in a && 'y' in a) return { x: r1((a as { x: number }).x), y: r1((a as { y: number }).y) };
  }
  if (typeof a === 'number') return r1(a);
  return a;
}

export interface RaceCallbacks {
  send(playerId: number, msg: unknown): void;
  onOver(): void;
}

/** One authoritative race running on the server. */
export class ServerRace {
  readonly world: World;
  readonly race: RaceManager;
  readonly laps: number;
  readonly setup: CarSetup[];
  private respawn: RespawnSystem;
  private pickups: PickupSystem;
  private humans = new Map<number, RemoteCar>();
  private inputQueues = new Map<number, { s: number; i: InputTuple }[]>();
  private broadcast: NetEvent[] = [];
  private personal = new Map<number, NetEvent[]>();
  private viewers = new Map<number, Viewer>();
  private tick = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private cb: RaceCallbacks;
  private firstFinishAt = -1;
  private overSent = false;

  constructor(players: LobbyPlayer[], laps: number, trackId: TrackId, cb: RaceCallbacks) {
    this.cb = cb;
    this.laps = laps;
    const t = getTrack(trackId);
    const world: World = {
      gfx: null,
      track: t,
      cars: [],
      time: 0,
      raceStarted: false,
      leader: null,
      effects: recorder(CH_EFFECTS, this.broadcast) as World['effects'],
      audio: recorder(CH_AUDIO, this.broadcast) as World['audio'],
      combat: null!,
      collisions: null!,
      hud: recorder(CH_HUD, this.broadcast) as World['hud'],
      player: null,
      view: (car) => (car instanceof RemoteCar && !car.aiControlled ? (this.viewers.get(car.owner) ?? null) : null),
    };
    this.world = world;
    world.combat = new CombatSystem(world);
    world.collisions = new CollisionSystem(world, t.def.obstacles);
    this.pickups = new PickupSystem(world, t.def.pickups);
    this.race = new RaceManager(world, laps);
    this.respawn = new RespawnSystem(world, this.race);

    // humans in lobby order, bots fill the grid
    const names = new Set<string>();
    const unique = (n: string) => {
      let name = n;
      for (let k = 2; names.has(name); k++) name = `${n} ${k}`;
      names.add(name);
      return name;
    };
    for (const p of players) {
      const car = new RemoteCar(world, CARS[p.car], unique(p.name), p.id);
      car.primary = createWeapon(p.primary);
      car.secondary = createWeapon(p.secondary);
      car.ability = createAbility(car.stats.ability);
      world.cars.push(car);
      this.humans.set(p.id, car);
      this.inputQueues.set(p.id, []);
      const sink: NetEvent[] = [];
      this.personal.set(p.id, sink);
      this.viewers.set(p.id, {
        hud: recorder(CH_HUD, sink) as Viewer['hud'],
        effects: recorder(CH_EFFECTS, sink) as Viewer['effects'],
        audio: recorder(CH_AUDIO, sink) as Viewer['audio'],
      });
    }
    const personalities = [PERSONALITIES.aggressive, PERSONALITIES.balanced, PERSONALITIES.racer];
    const botCars = shuffle(CAR_IDS.slice());
    for (let i = 0; world.cars.length < GRID_SIZE; i++) {
      const id = botCars[i % botCars.length];
      const bot = new AICar(world, CARS[id], personalities[i % 3], unique(CARS[id].name));
      bot.primary = createWeapon(pick(PRIMARY_WEAPONS));
      bot.secondary = createWeapon(pick(SECONDARY_WEAPONS));
      bot.ability = createAbility(bot.stats.ability);
      bot.racing.requestReset = () => this.respawn.reset(bot);
      world.cars.push(bot);
    }
    this.race.setupGrid(shuffle(world.cars.slice()));
    this.race.onCarFinish = (car) => this.onFinish(car);

    this.setup = world.cars.map((c) => ({
      id: c.id,
      car: c.stats.id,
      name: c.name,
      owner: c instanceof RemoteCar ? c.owner : 0,
      primary: c.primary.stats.id,
      secondary: c.secondary.stats.id,
    }));
  }

  /**
   * Fixed 60 Hz simulation. Node's setInterval drifts (a 16.7 ms interval really fires
   * at ~58.8 Hz), which would make every client's input queue overflow – so we poll
   * often and run exactly as many ticks as real time demands.
   */
  start(): void {
    const tickMs = 1000 / TICK_RATE;
    let last = performance.now();
    let acc = 0;
    this.timer = setInterval(() => {
      const now = performance.now();
      acc += now - last;
      last = now;
      let n = 0;
      while (acc >= tickMs && n < 5) {
        acc -= tickMs;
        this.update();
        n++;
      }
      if (n === 5) acc = 0; // way behind (server hiccup) – don't spiral
    }, 4);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  input(playerId: number, s: number, i: InputTuple): void {
    const q = this.inputQueues.get(playerId);
    const car = this.humans.get(playerId);
    if (!q || !car) return;
    // first input: start INPUT_BUFFER ticks behind it – a small jitter buffer so uneven packet
    // arrival doesn't starve the queue (own car is predicted, so this isn't felt)
    if (car.ack === 0) car.ack = Math.max(0, s - 1 - INPUT_BUFFER);
    if (s <= car.ack) {
      // slightly late: that tick was already simulated with a repeated input – drop it.
      // Far behind (client stalled or runs slow): re-anchor to the client instead of ignoring it.
      if (car.ack - s <= INPUT_BUFFER) return;
      q.length = 0;
      car.ack = Math.max(0, s - 1 - INPUT_BUFFER);
    }
    q.push({ s, i });
    // client clock running ahead: resync to the buffer target instead of letting latency grow
    if (q.length > INPUT_BUFFER + 8) {
      const drop = q.length - INPUT_BUFFER;
      const skipped = q.splice(0, drop);
      car.ack = skipped[skipped.length - 1].s;
      decodeInput(skipped[skipped.length - 1].i, car.controls);
    }
  }

  /** Player left mid-race: a bot takes over their car. */
  leave(playerId: number): void {
    const car = this.humans.get(playerId);
    if (car) {
      car.becomeBot();
      this.world.hud?.feed(`${car.name} left – bot takes over`);
    }
    this.humans.delete(playerId);
    this.inputQueues.delete(playerId);
    if (this.humans.size === 0) this.finishRace();
  }

  hasHuman(playerId: number): boolean {
    return this.humans.has(playerId);
  }

  private update(): void {
    // consume inputs strictly in sequence, one per tick. If the next one hasn't arrived,
    // repeat the last controls *as* that sequence number – the client replays from `ack`,
    // so server and prediction stay one-to-one and a late packet costs at most a tiny nudge.
    for (const [pid, car] of this.humans) {
      if (car.aiControlled || car.ack === 0) continue;
      const q = this.inputQueues.get(pid)!;
      const want = car.ack + 1;
      if (q.length && q[0].s === want) decodeInput(q.shift()!.i, car.controls);
      car.ack = want;
    }
    const dt = 1 / TICK_RATE / SUBSTEPS;
    for (let k = 0; k < SUBSTEPS; k++) this.step(dt);
    this.tick++;
    if (this.tick % 2 === 0) this.sendSnapshots();

    if (this.firstFinishAt >= 0 && this.race.raceTime - this.firstFinishAt > FINISH_GRACE) this.finishRace();
  }

  private step(dt: number): void {
    const w = this.world;
    w.time += dt;
    this.race.update(dt);
    for (const c of w.cars) c.think(dt);
    for (const c of w.cars) c.update(dt);
    w.collisions.step(dt);
    w.combat.update(dt);
    this.pickups.update(dt);
    this.respawn.update(dt);
  }

  private onFinish(car: Car): void {
    if (this.firstFinishAt < 0) this.firstFinishAt = this.race.raceTime;
    if (!(car instanceof RemoteCar) || car.aiControlled) return;
    car.enableAutopilot();
    this.cb.send(car.owner, { t: 'results', res: this.results(car) });
    const stillRacing = [...this.humans.values()].some((c) => !c.race.finished);
    if (!stillRacing) setTimeout(() => this.finishRace(), 6000);
  }

  private finishRace(): void {
    if (this.overSent) return;
    this.overSent = true;
    // anyone who didn't make it gets their results as-is
    for (const car of this.humans.values()) {
      if (!car.race.finished) this.cb.send(car.owner, { t: 'results', res: this.results(car) });
    }
    this.stop();
    this.cb.onOver();
  }

  private results(car: RemoteCar): NetResults {
    const r = car.race;
    return {
      position: this.race.positionOf(car),
      raceTime: r.finished ? r.finishTime : this.race.raceTime,
      bestLap: r.lapTimes.length ? Math.min(...r.lapTimes) : 0,
      lapTimes: r.lapTimes.slice(),
      kills: car.combat.kills,
      deaths: car.combat.deaths,
      damageDealt: car.combat.damageDealt,
      damageTaken: car.combat.damageTaken,
      standings: this.race.standings.map((c) => ({
        name: c.name,
        color: c.stats.color,
        time: c.race.finished ? c.race.finishTime : null,
        player: c === car,
      })),
      laps: this.laps,
      car: car.stats.id,
    };
  }

  // ---------------------------------------------------------------- snapshots
  private carTuple(c: Car): CarTuple {
    const r = c.race;
    const flags =
      (c.alive ? CF_ALIVE : 0) |
      (c.drifting ? CF_DRIFT : 0) |
      (c.boosting ? CF_BOOSTING : 0) |
      (r.finished ? CF_FINISHED : 0) |
      (c.unlockPrimary ? CF_UNLOCK1 : 0) |
      (c.unlockSecondary ? CF_UNLOCK2 : 0) |
      (c.unlockAbility ? CF_UNLOCK3 : 0) |
      (c.airborne ? CF_AIR : 0);
    return [
      c.id,
      r1(c.x),
      r1(c.y),
      Math.round(c.heading * 1000) / 1000,
      r1(c.vx),
      r1(c.vy),
      Math.round(c.angVel * 1000) / 1000,
      Math.round(c.bodyYaw * 1000) / 1000,
      Math.round(c.aimAngle * 100) / 100,
      flags,
      Math.round(c.driftTime * 100) / 100,
      Math.round(c.boostPower * 100) / 100,
      Math.round(c.driftBoostTime * 100) / 100,
      Math.round(c.overchargeTime * 100) / 100,
      Math.round(c.shieldTime * 100) / 100,
      Math.round(c.empTime * 100) / 100,
      Math.round(c.ghostTime * 100) / 100,
      Math.round(c.hitFlash * 100) / 100,
      Math.round(c.frozenTime * 100) / 100,
      r1(c.hp),
      c.controls.throttle,
      Math.round(c.controls.steer * 100) / 100,
      r1(c.race.progress),
      r.lapsDone,
      r.finishOrder,
      Math.round(r.finishTime * 1000) / 1000,
      r.cpPassed,
      c.driftBoostColor,
      r1(c.z),
      r1(c.vz),
      Math.round(c.oilTime * 100) / 100,
      Math.round(c.slip * 100) / 100,
    ];
  }

  private own(car: RemoteCar): OwnState {
    return {
      ack: car.ack,
      energy: r1(car.energy),
      boost: r1(car.boostMeter),
      driftDir: car.driftDir,
      driftPower: car.driftBoostPower,
      rubber: Math.round(car.rubberBand * 1000) / 1000,
      cd: [
        Math.round(car.primary.cooldownRatio * 100) / 100,
        Math.round(car.secondary.cooldownRatio * 100) / 100,
        Math.round(car.ability.cooldownRatio * 100) / 100,
      ],
      lapTimes: car.race.lapTimes.map((t) => Math.round(t * 1000) / 1000),
      lapStart: Math.round(car.race.lapStart * 1000) / 1000,
      kills: car.combat.kills,
      deaths: car.combat.deaths,
      dealt: Math.round(car.combat.damageDealt),
      taken: Math.round(car.combat.damageTaken),
      wrong: Math.round(car.race.wrongWayTime * 10) / 10,
      stuck: Math.round(car.stuckTime * 10) / 10,
      respawn: Math.round(car.respawnTimer * 10) / 10,
    };
  }

  private sendSnapshots(): void {
    const w = this.world;
    const cars = w.cars.map((c) => this.carTuple(c));
    const proj = w.combat.snapshotProjectiles();
    const mines = w.combat.snapshotMines();
    const barrels = w.collisions.barrels.map((b) => [r1(b.x), r1(b.y), Math.round(b.rot * 100) / 100, b.alive ? 1 : 0, b.fuse >= 0 ? 1 : 0]);
    const pk = this.pickups.pickups.map((p) => (p.timer > 0 ? 0 : 1));
    const events = this.broadcast.splice(0);
    for (const [pid, car] of this.humans) {
      const mine = this.personal.get(pid)!;
      const snap: Snapshot = {
        t: 's',
        rt: Math.round(this.race.raceTime * 1000) / 1000,
        ph: this.race.phase === 'countdown' ? 0 : 1,
        c: cars,
        me: this.own(car),
        p: proj,
        m: mines,
        b: barrels,
        pk,
        e: mine.length ? events.concat(mine.splice(0)) : events,
      };
      this.cb.send(pid, snap);
    }
  }
}
