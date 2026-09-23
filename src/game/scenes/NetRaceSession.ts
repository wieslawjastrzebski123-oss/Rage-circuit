import { createAbility } from '../abilities';
import { CARS } from '../data/cars';
import { Car } from '../entities/Car';
import { Mine } from '../entities/Mine';
import { NetCar } from '../entities/NetCar';
import { Projectile, type ProjectileKind } from '../entities/Projectile';
import type { NetClient } from '../net/NetClient';
import {
  CF_ALIVE,
  CF_BOOSTING,
  CF_DRIFT,
  CF_FINISHED,
  CF_UNLOCK1,
  CF_UNLOCK2,
  CF_UNLOCK3,
  SUBSTEPS,
  TICK_RATE,
  encodeInput,
  type CarSetup,
  type CarTuple,
  type NetEvent,
  type NetResults,
  type ServerMsg,
  type Snapshot,
} from '../net/protocol';
import { ChaseCamera } from '../render/ChaseCamera';
import type { Gfx } from '../render/Gfx';
import { AudioManager } from '../systems/AudioManager';
import { CollisionSystem } from '../systems/CollisionSystem';
import { CombatSystem } from '../systems/CombatSystem';
import { Effects } from '../systems/Effects';
import { InputManager } from '../systems/InputManager';
import { PickupSystem } from '../systems/PickupSystem';
import type { World } from '../systems/World';
import { TrackView } from '../track/TrackView';
import { HUD, type RaceInfo } from '../ui/HUD';
import { button, h, layer, setCrosshair } from '../ui/dom';
import { angleDiff, lerp } from '../utils/math';
import { createWeapon } from '../weapons';
import { getTrack } from './RaceSession';

/** Other cars are shown this far in the past so there are always two snapshots to blend. */
const INTERP = 0.1;
const INPUT_DT = 1 / TICK_RATE;
const PROJ_KINDS: ProjectileKind[] = ['bullet', 'shell', 'rocket'];

interface Buffered {
  recv: number;
  s: Snapshot;
}

export interface NetHooks {
  onResults(res: NetResults): void;
  onLeave(): void;
}

const mute = new Proxy({}, { get: () => () => undefined });

/**
 * Client side of an online race: renders the server's world, predicts the
 * local car for instant response and reconciles it with authoritative state.
 */
export class NetRaceSession implements RaceInfo {
  readonly isDemo = false;
  readonly world: World;
  // RaceInfo
  phase = 'countdown';
  raceTime = 0;
  readonly laps: number;
  standings: Car[] = [];

  private net: NetClient;
  private hooks: NetHooks;
  private gfx: Gfx;
  private hud: HUD;
  private input: InputManager;
  private cam: ChaseCamera;
  private view: TrackView;
  private pickups: PickupSystem;
  private byId = new Map<number, NetCar>();
  private me: NetCar;
  private myId: number;
  // prediction
  private pred: Car;
  private predWorld: World;
  private history: { seq: number; c: Car['controls'] }[] = [];
  private seq = 0;
  private inputAcc = 0;
  private offX = 0;
  private offY = 0;
  private offH = 0;
  private ownFinished = false;
  // snapshots / events
  private snaps: Buffered[] = [];
  private events: { at: number; e: NetEvent }[] = [];
  private projPool: Projectile[] = [];
  private minePool: Mine[] = [];
  private resultsAt = -1;
  private results: NetResults | null = null;
  private menu: HTMLElement | null = null;
  private smokeTimer = 0;
  private onKey = (e: KeyboardEvent) => {
    if (e.code === 'Escape') this.toggleMenu();
  };

  constructor(gfx: Gfx, net: NetClient, start: { laps: number; cars: CarSetup[] }, hooks: NetHooks) {
    this.gfx = gfx;
    this.net = net;
    this.hooks = hooks;
    this.laps = start.laps;
    gfx.resetRoot();
    const track = getTrack();
    const audio = AudioManager.instance;

    const world: World = {
      gfx,
      track,
      cars: [],
      time: 0,
      raceStarted: false,
      effects: null!,
      audio,
      combat: null!,
      collisions: null!,
      hud: null,
      player: null,
      view: (car) => (car === world.player ? { hud: world.hud, effects: world.effects, audio: world.audio } : null),
    };
    this.world = world;
    this.view = new TrackView(track, gfx.root);
    world.effects = new Effects(gfx);
    world.combat = new CombatSystem(world);
    world.collisions = new CollisionSystem(world, track.def.obstacles);
    this.pickups = new PickupSystem(world, track.def.pickups);

    const mySetup = start.cars.find((c) => c.owner === net.you)!;
    this.myId = mySetup.id;
    for (const s of start.cars) {
      const isMe = s.id === this.myId;
      const car = new NetCar(world, CARS[s.car], s.name, isMe);
      car.primary = createWeapon(s.primary);
      car.secondary = createWeapon(s.secondary);
      car.ability = createAbility(car.stats.ability);
      car.simCombat = false;
      world.cars.push(car);
      this.byId.set(s.id, car);
    }
    this.me = this.byId.get(this.myId)!;
    world.player = this.me;
    this.standings = world.cars.slice();

    // headless world used only to predict our own car
    const pw: World = {
      gfx: null,
      track,
      cars: [],
      time: 0,
      raceStarted: false,
      effects: mute as World['effects'],
      audio: mute as World['audio'],
      combat: { applyDamage: () => 0 } as unknown as World['combat'],
      collisions: null!,
      hud: null,
      player: null,
      view: () => null,
    };
    pw.collisions = new CollisionSystem(pw, track.def.obstacles);
    this.predWorld = pw;
    this.pred = new Car(pw, CARS[mySetup.car], mySetup.name, true);
    this.pred.primary = createWeapon(mySetup.primary);
    this.pred.secondary = createWeapon(mySetup.secondary);
    this.pred.ability = createAbility(this.pred.stats.ability);
    this.pred.simCombat = false;
    pw.cars.push(this.pred);

    this.input = new InputManager(gfx);
    this.cam = new ChaseCamera(gfx, track);
    this.hud = new HUD(track);
    this.hud.selfName = mySetup.name;
    world.hud = this.hud;
    this.hud.announce('INDUSTRIAL DISTRICT', '#ff2d6f', 2200);
    audio.startEngine();
    setCrosshair(true);
    window.addEventListener('keydown', this.onKey);

    net.setHandler((msg) => this.onMessage(msg));
  }

  // ------------------------------------------------------------------ RaceInfo
  positionOf(car: Car): number {
    return this.standings.indexOf(car) + 1;
  }
  currentLap(car: Car): number {
    return Math.min(this.laps, car.race.lapsDone + 1);
  }

  // ------------------------------------------------------------------ network
  private onMessage(msg: ServerMsg): void {
    const now = performance.now() / 1000;
    switch (msg.t) {
      case 's': {
        this.snaps.push({ recv: now, s: msg });
        if (this.snaps.length > 30) this.snaps.shift();
        for (const e of msg.e) this.events.push({ at: now + INTERP, e });
        this.applyLatest(msg);
        this.reconcile(msg);
        break;
      }
      case 'results':
        this.results = msg.res;
        this.resultsAt = now + 3.2;
        break;
      case 'raceOver':
        if (!this.results) this.hooks.onLeave();
        break;
    }
  }

  /** Race-wide state that isn't interpolated (laps, standings, phase). */
  private applyLatest(s: Snapshot): void {
    this.phase = s.ph === 0 ? 'countdown' : 'racing';
    this.world.raceStarted = this.predWorld.raceStarted = s.ph === 1;
    for (const t of s.c) {
      const car = this.byId.get(t[0]);
      if (!car) continue;
      const r = car.race;
      r.progress = t[22];
      r.lapsDone = t[23];
      r.finishOrder = t[24];
      r.finishTime = t[25];
      r.cpPassed = t[26];
      r.finished = (t[9] & CF_FINISHED) !== 0;
      car.unlockPrimary = (t[9] & CF_UNLOCK1) !== 0;
      car.unlockSecondary = (t[9] & CF_UNLOCK2) !== 0;
      car.unlockAbility = (t[9] & CF_UNLOCK3) !== 0;
    }
    if (s.me) {
      const m = s.me;
      const me = this.me;
      me.energy = m.energy;
      me.boostMeter = m.boost;
      me.race.lapTimes = m.lapTimes;
      me.race.lapStart = m.lapStart;
      me.combat.kills = m.kills;
      me.combat.deaths = m.deaths;
      me.combat.damageDealt = m.dealt;
      me.combat.damageTaken = m.taken;
      me.primary.cooldownLeft = m.cd[0] * me.primary.stats.cooldown;
      me.secondary.cooldownLeft = m.cd[1] * me.secondary.stats.cooldown;
      me.ability.cooldownLeft = m.cd[2] * me.ability.info.cooldown;
    }
    this.standings.sort((a, b) => {
      if (a.race.finished && b.race.finished) return a.race.finishOrder - b.race.finishOrder;
      if (a.race.finished) return -1;
      if (b.race.finished) return 1;
      return b.race.progress - a.race.progress;
    });
    this.pickups.showState(s.pk, this.world.time);
    const barrels = this.world.collisions.barrels;
    s.b.forEach((b, i) => {
      const bar = barrels[i];
      if (!bar) return;
      bar.x = b[0];
      bar.y = b[1];
      bar.rot = b[2];
      bar.alive = b[3] === 1;
      bar.fuse = b[4] === 1 ? 0.1 : -1;
      bar.vx = bar.vy = 0;
      bar.sync();
    });
  }

  /** Physics + status fields shared by display and predicted cars. */
  private applyTuple(car: Car, t: CarTuple, withControls: boolean): void {
    car.x = t[1];
    car.y = t[2];
    car.heading = t[3];
    car.vx = t[4];
    car.vy = t[5];
    car.angVel = t[6];
    car.bodyYaw = t[7];
    const flags = t[9];
    const alive = (flags & CF_ALIVE) !== 0;
    if (alive !== car.alive) car.setAlive(alive);
    car.drifting = (flags & CF_DRIFT) !== 0;
    car.boosting = (flags & CF_BOOSTING) !== 0;
    car.driftTime = t[10];
    car.boostPower = t[11];
    car.driftBoostTime = t[12];
    car.overchargeTime = t[13];
    car.shieldTime = t[14];
    car.empTime = t[15];
    car.ghostTime = t[16];
    car.hitFlash = t[17];
    car.frozenTime = t[18];
    car.hp = t[19];
    car.driftBoostColor = t[27];
    if (withControls) {
      car.aimAngle = t[8];
      car.controls.throttle = t[20];
      car.controls.steer = t[21];
    }
  }

  /** Reset our predicted car to the server's state and replay unacknowledged inputs. */
  private reconcile(s: Snapshot): void {
    const t = s.c.find((c) => c[0] === this.myId);
    if (!t || !s.me) return;
    if ((t[9] & CF_FINISHED) !== 0) this.ownFinished = true;
    const p = this.pred;
    const bx = p.x;
    const by = p.y;
    const bh = p.heading;
    this.applyTuple(p, t, false);
    p.boostMeter = s.me.boost;
    p.energy = s.me.energy;
    p.driftDir = s.me.driftDir;
    p.driftBoostPower = s.me.driftPower;
    p.rubberBand = s.me.rubber;
    const ack = s.me.ack;
    this.history = this.history.filter((hh) => hh.seq > ack);
    for (const hh of this.history) {
      Object.assign(p.controls, hh.c);
      this.simTick();
    }
    // hide the correction: show the old position and let the offset decay
    this.offX += bx - p.x;
    this.offY += by - p.y;
    this.offH += angleDiff(p.heading, bh);
    if (Math.hypot(this.offX, this.offY) > 160) this.offX = this.offY = this.offH = 0; // respawn/teleport
  }

  private simTick(): void {
    const dt = INPUT_DT / SUBSTEPS;
    for (let k = 0; k < SUBSTEPS; k++) {
      this.predWorld.time += dt;
      this.pred.update(dt);
      this.predWorld.collisions.resolveStatic(this.pred);
    }
  }

  // ------------------------------------------------------------------ frame
  update(rawDt: number): void {
    const dt = Math.min(rawDt, 0.05);
    const now = performance.now() / 1000;
    this.world.time += dt;

    // fixed-rate input: sample, send, predict
    this.inputAcc += dt;
    while (this.inputAcc >= INPUT_DT) {
      this.inputAcc -= INPUT_DT;
      const c = this.pred.controls;
      if (this.menu) {
        c.throttle = c.steer = 0;
        c.drift = c.boost = c.firePrimary = c.fireSecondary = c.ability = c.reset = false;
      } else this.input.read(c, this.pred.x, this.pred.y);
      this.seq++;
      this.net.send({ t: 'in', s: this.seq, i: encodeInput(c) });
      if (!this.ownFinished) {
        this.history.push({ seq: this.seq, c: { ...c } });
        if (this.history.length > 120) this.history.shift();
        this.simTick();
      }
    }

    this.interpolate(now);
    this.updateProjectiles(now);
    for (const car of this.world.cars) car.updateVisuals(dt);

    // delayed events line up with the interpolated picture
    while (this.events.length && this.events[0].at <= now) this.playEvent(this.events.shift()!.e);

    this.cam.update(dt, this.me, this.world.effects);
    this.gfx.follow(this.me.x, this.me.y);
    this.smokeTimer -= dt;
    if (this.smokeTimer <= 0) {
      this.smokeTimer = 0.35;
      for (const c of this.view.chimneys) this.world.effects.chimneySmoke(c.x, c.y, c.h);
    }
    this.world.effects.update(dt);
    this.pickups.showState(this.snaps.at(-1)?.s.pk ?? [], this.world.time);

    const latest = this.snaps.at(-1);
    if (latest) this.raceTime = latest.s.rt + (latest.s.ph === 1 ? now - latest.recv : 0);
    if (!this.results) this.hud.update(dt, this.me, this, this.world.cars);
    const a = this.world.audio;
    a.setListener(this.me.x, this.me.y);
    const me = this.me;
    const screech = me.alive && (me.drifting || (me.controls.throttle < 0 && me.forwardSpeed > 250)) ? 1 : 0;
    a.updateEngine(me.alive ? me.speed / me.stats.maxSpeed : 0, me.alive ? me.controls.throttle : 0, me.boostPower, screech);
    const cross = document.getElementById('crosshair');
    cross?.classList.toggle('lock', me.alive && this.world.combat.findTargetInCone(me, me.aimAngle, 0.12, 900) !== null);

    if (this.resultsAt > 0 && now >= this.resultsAt && this.results) {
      this.resultsAt = -1;
      this.hud.setVisible(false);
      setCrosshair(false);
      this.hooks.onResults(this.results);
    }
  }

  private interpolate(now: number): void {
    const latest = this.snaps.at(-1);
    if (!latest) return;
    const renderRt = latest.s.rt + (now - latest.recv) - INTERP;
    let a = this.snaps[0];
    let b = latest;
    for (let i = this.snaps.length - 1; i > 0; i--) {
      if (this.snaps[i - 1].s.rt <= renderRt) {
        a = this.snaps[i - 1];
        b = this.snaps[i];
        break;
      }
    }
    const span = b.s.rt - a.s.rt;
    const k = span > 0 ? Math.max(0, Math.min(1.5, (renderRt - a.s.rt) / span)) : 1;
    const aById = new Map(a.s.c.map((t) => [t[0], t]));
    for (const tb of b.s.c) {
      const car = this.byId.get(tb[0]);
      if (!car) continue;
      if (car === this.me && !this.ownFinished) {
        this.showPredicted(now);
        continue;
      }
      const ta = aById.get(tb[0]) ?? tb;
      this.applyTuple(car, tb, true);
      car.x = lerp(ta[1], tb[1], k);
      car.y = lerp(ta[2], tb[2], k);
      car.heading = ta[3] + angleDiff(ta[3], tb[3]) * k;
      car.aimAngle = ta[8] + angleDiff(ta[8], tb[8]) * k;
    }
  }

  /** Our car: predicted state plus a decaying correction offset. */
  private showPredicted(_now: number): void {
    const p = this.pred;
    const me = this.me;
    const decay = Math.exp(-12 * (1 / 60));
    this.offX *= decay;
    this.offY *= decay;
    this.offH *= decay;
    me.x = p.x + this.offX;
    me.y = p.y + this.offY;
    me.heading = p.heading + this.offH;
    me.vx = p.vx;
    me.vy = p.vy;
    me.angVel = p.angVel;
    me.bodyYaw = p.bodyYaw;
    me.aimAngle = p.aimAngle;
    if (p.alive !== me.alive) me.setAlive(p.alive);
    me.drifting = p.drifting;
    me.driftTime = p.driftTime;
    me.boostPower = p.boostPower;
    me.boosting = p.boosting;
    me.driftBoostTime = p.driftBoostTime;
    me.driftBoostColor = p.driftBoostColor;
    me.overchargeTime = p.overchargeTime;
    me.shieldTime = p.shieldTime;
    me.empTime = p.empTime;
    me.ghostTime = p.ghostTime;
    me.hitFlash = p.hitFlash;
    me.frozenTime = p.frozenTime;
    me.hp = p.hp;
    me.boostMeter = p.boostMeter;
    me.controls.throttle = p.controls.throttle;
    me.controls.steer = p.controls.steer;
    me.controls.aimX = p.controls.aimX;
    me.controls.aimY = p.controls.aimY;
  }

  private updateProjectiles(now: number): void {
    const latest = this.snaps.at(-1);
    if (!latest) return;
    const age = now - latest.recv - INTERP;
    const root = this.gfx.root;
    const ps = latest.s.p;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      const proj = (this.projPool[i] ??= new Projectile(root));
      proj.show(PROJ_KINDS[p[0]] ?? 'bullet', p[1] + p[3] * age, p[2] + p[4] * age, p[3], p[4]);
    }
    for (let i = ps.length; i < this.projPool.length; i++) this.projPool[i].kill();
    const ms = latest.s.m;
    for (let i = 0; i < ms.length; i++) {
      const m = ms[i];
      const mine = (this.minePool[i] ??= new Mine(root));
      const owner = this.byId.get(m[4]);
      mine.show(m[0], m[1], m[2] + (now - latest.recv), m[3] === 1, owner?.stats.color ?? 0xffb000, this.world.time);
    }
    for (let i = ms.length; i < this.minePool.length; i++) this.minePool[i].kill();
  }

  private playEvent([ch, method, args]: NetEvent): void {
    if (method === 'freeze') return; // hit-stop would desync the interpolation
    const resolved = args.map((a) => {
      if (a && typeof a === 'object' && 'c' in a) return this.byId.get((a as { c: number }).c) ?? { x: 0, y: 0 };
      return a;
    });
    const target: Record<string, unknown> | null =
      ch === 0 ? (this.world.effects as unknown as Record<string, unknown>) : ch === 1 ? (this.world.audio as unknown as Record<string, unknown>) : (this.hud as unknown as Record<string, unknown>);
    const fn = target?.[method];
    if (typeof fn === 'function') {
      try {
        (fn as (...a: unknown[]) => void).apply(target, resolved);
      } catch {
        /* a malformed event must never break the frame */
      }
    }
  }

  // ------------------------------------------------------------------ menu
  private toggleMenu(): void {
    if (this.menu) {
      this.menu.remove();
      this.menu = null;
      setCrosshair(true);
      return;
    }
    setCrosshair(false);
    this.menu = layer('menu pause');
    const panel = h('div', 'panel', undefined, this.menu);
    h('h2', '', 'ONLINE RACE', panel);
    h('p', 'small', 'The race keeps running while this menu is open.', panel);
    const col = h('div', 'col', undefined, panel);
    button('CONTINUE', col, () => this.toggleMenu(), 'primary');
    button('LEAVE RACE', col, () => this.hooks.onLeave());
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKey);
    this.menu?.remove();
    this.hud.destroy();
    this.input.destroy();
    this.world.audio.stopEngine();
    this.world.effects.destroy();
    this.net.setHandler(null);
    setCrosshair(false);
  }
}
