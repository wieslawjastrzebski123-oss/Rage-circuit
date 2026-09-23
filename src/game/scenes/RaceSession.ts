import { PERSONALITIES, type Personality } from '../ai/Personality';
import { createAbility } from '../abilities';
import { DEBUG, DEFAULT_LAPS } from '../constants';
import { CAR_IDS, CARS, type CarId } from '../data/cars';
import { PRIMARY_WEAPONS, SECONDARY_WEAPONS } from '../data/weapons';
import { AICar } from '../entities/AICar';
import type { Car } from '../entities/Car';
import { PlayerCar } from '../entities/PlayerCar';
import { ChaseCamera } from '../render/ChaseCamera';
import type { Gfx } from '../render/Gfx';
import { AudioManager } from '../systems/AudioManager';
import { CollisionSystem } from '../systems/CollisionSystem';
import { CombatSystem } from '../systems/CombatSystem';
import { Effects } from '../systems/Effects';
import { InputManager } from '../systems/InputManager';
import { PickupSystem } from '../systems/PickupSystem';
import { RaceManager } from '../systems/RaceManager';
import { RespawnSystem } from '../systems/RespawnSystem';
import type { World } from '../systems/World';
import { Track } from '../track/Track';
import { INDUSTRIAL_DISTRICT } from '../track/TrackData';
import { TrackView } from '../track/TrackView';
import { DebugOverlay } from '../ui/DebugOverlay';
import { HUD } from '../ui/HUD';
import { button, h, layer, setCrosshair } from '../ui/dom';
import { pick, shuffle } from '../utils/math';
import { Storage, type Loadout } from '../utils/storage';
import { createWeapon } from '../weapons';

export interface RaceResults {
  loadout: Loadout;
  position: number;
  raceTime: number;
  bestLap: number;
  lapTimes: number[];
  kills: number;
  deaths: number;
  damageDealt: number;
  damageTaken: number;
  standings: { name: string; color: number; time: number | null; player: boolean }[];
  newBestRace: boolean;
  newBestLap: boolean;
  laps: number;
}

export interface SessionHooks {
  onResults: (r: RaceResults) => void;
  onRestart: () => void;
  onMainMenu: () => void;
}

let cachedTrack: Track | null = null;
export function getTrack(): Track {
  if (!cachedTrack) cachedTrack = new Track(INDUSTRIAL_DISTRICT);
  return cachedTrack;
}

const MAX_SUBSTEP = 1 / 100;

/**
 * One race (or the attract-mode demo race behind the menus):
 * owns the world, the systems, the chase camera and the HUD.
 */
export class RaceSession {
  readonly world: World;
  readonly race: RaceManager;
  readonly isDemo: boolean;
  readonly loadout: Loadout | null;
  private hooks: SessionHooks | null;
  private respawn: RespawnSystem;
  private pickups: PickupSystem;
  private input: InputManager | null = null;
  private hud: HUD | null = null;
  private debug: DebugOverlay | null = null;
  private cam: ChaseCamera;
  private view: TrackView;
  private smokeTimer = 0;
  private focus: Car;
  private demoSwitch = 0;
  paused = false;
  private pauseLayer: HTMLElement | null = null;
  private finished = false;
  private resultsTimer = -1;
  private crosshair = document.getElementById('crosshair');
  private onKey = (e: KeyboardEvent) => this.handleKey(e);
  private onBlur = () => this.setPaused(true);

  constructor(gfx: Gfx, loadout: Loadout | null, hooks: SessionHooks | null) {
    this.isDemo = loadout === null;
    this.loadout = loadout;
    this.hooks = hooks;
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
    };
    this.world = world;
    this.view = new TrackView(track, gfx.root);
    world.effects = new Effects(gfx);
    world.combat = new CombatSystem(world);
    world.collisions = new CollisionSystem(world, track.def.obstacles);
    this.pickups = new PickupSystem(world, track.def.pickups);
    this.race = new RaceManager(world, loadout?.laps ?? DEFAULT_LAPS);
    this.respawn = new RespawnSystem(world, this.race);
    this.cam = new ChaseCamera(gfx, track);

    const personalities = shuffle([PERSONALITIES.aggressive, PERSONALITIES.balanced, PERSONALITIES.racer]);
    if (!loadout) {
      const ids = shuffle(CAR_IDS.slice());
      ids.forEach((id, i) => world.cars.push(this.makeBot(id, personalities[i % 3])));
      this.race.setupGrid(shuffle(world.cars.slice()));
      this.race.startImmediately();
      this.focus = pick(world.cars);
      this.cam.cinematic = true;
    } else {
      this.input = new InputManager(gfx);
      const player = new PlayerCar(world, CARS[loadout.car], this.input);
      player.primary = createWeapon(loadout.primary);
      player.secondary = createWeapon(loadout.secondary);
      player.ability = createAbility(player.stats.ability);
      world.player = player;
      const bots = CAR_IDS.filter((id) => id !== loadout.car).map((id, i) => this.makeBot(id, personalities[i]));
      world.cars.push(player, ...bots);
      // player starts near the back – more to fight for
      const grid = shuffle(bots.slice()) as Car[];
      grid.splice(Math.random() < 0.5 ? 2 : 3, 0, player);
      this.race.setupGrid(grid);
      this.focus = player;

      this.hud = new HUD(track);
      world.hud = this.hud;
      this.race.onPlayerFinish = () => this.onPlayerFinish();
      audio.startEngine();
      setCrosshair(true);
      this.hud.announce('INDUSTRIAL DISTRICT', '#ff2d6f', 2200);
      window.addEventListener('keydown', this.onKey);
      window.addEventListener('blur', this.onBlur);
    }
    for (const c of world.cars) {
      if (c instanceof AICar) c.racing.requestReset = () => this.respawn.reset(c);
    }
    this.cam.snap(this.focus);

    if (DEBUG) {
      this.debug = new DebugOverlay(world, this.race);
      (window as unknown as { __rc: RaceSession }).__rc = this;
    }
  }

  private makeBot(id: CarId, p: Personality): AICar {
    const bot = new AICar(this.world, CARS[id], p);
    bot.primary = createWeapon(pick(PRIMARY_WEAPONS));
    bot.secondary = createWeapon(pick(SECONDARY_WEAPONS));
    bot.ability = createAbility(bot.stats.ability);
    return bot;
  }

  // ------------------------------------------------------------------ loop
  update(rawDt: number): void {
    if (this.paused) return;
    const frameDt = Math.min(rawDt, 0.05);
    const fx = this.world.effects;

    if (fx.hitStop > 0) fx.hitStop -= frameDt * 1000;
    else {
      const steps = Math.max(1, Math.ceil(frameDt / MAX_SUBSTEP));
      const dt = frameDt / steps;
      for (let i = 0; i < steps; i++) this.step(dt);
    }

    for (const c of this.world.cars) c.updateVisuals(frameDt);
    this.updateDemoFocus(frameDt);
    this.cam.update(frameDt, this.focus, fx);
    this.world.gfx.follow(this.focus.x, this.focus.y);
    this.smokeTimer -= frameDt;
    if (this.smokeTimer <= 0) {
      this.smokeTimer = 0.35;
      for (const c of this.view.chimneys) fx.chimneySmoke(c.x, c.y, c.h);
    }
    fx.update(frameDt);
    this.updateAudio();
    if (this.hud && this.world.player) this.hud.update(frameDt, this.world.player, this.race, this.world.cars);
    this.updateCrosshair();
    this.debug?.update(frameDt);

    if (this.resultsTimer > 0) {
      this.resultsTimer -= frameDt;
      if (this.resultsTimer <= 0) this.showResults();
    }
  }

  step(dt: number): void {
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

  private updateDemoFocus(dt: number): void {
    if (!this.isDemo) return;
    this.demoSwitch += dt;
    if (this.demoSwitch > 10) {
      this.demoSwitch = 0;
      const others = this.world.cars.filter((c) => c !== this.focus && c.alive);
      if (others.length) {
        this.focus = pick(others);
        this.cam.snap(this.focus);
      }
    }
  }

  private updateAudio(): void {
    const a = this.world.audio;
    a.setListener(this.focus.x, this.focus.y);
    const p = this.world.player;
    if (!p) return;
    const ratio = p.alive ? p.speed / p.stats.maxSpeed : 0;
    const screech = p.alive && (p.drifting || (p.controls.throttle < 0 && p.forwardSpeed > 250)) ? 1 : 0;
    a.updateEngine(ratio, p.alive && this.world.raceStarted ? p.controls.throttle : 0, p.boostPower, screech);
  }

  private updateCrosshair(): void {
    const p = this.world.player;
    if (!this.crosshair || !p) return;
    const locked = p.alive && this.world.combat.findTargetInCone(p, p.aimAngle, 0.12, 900) !== null;
    this.crosshair.classList.toggle('lock', locked);
  }

  // ------------------------------------------------------------------ finish
  private onPlayerFinish(): void {
    const p = this.world.player as PlayerCar;
    if (this.finished) return;
    this.finished = true;
    p.enableAutopilot();
    const pos = this.race.positionOf(p);
    const ord = ['', '1ST', '2ND', '3RD', '4TH'][pos];
    this.hud?.announce(pos === 1 ? 'VICTORY!' : `FINISHED ${ord}`, pos === 1 ? '#ffd23f' : '#ffffff', 3000);
    this.world.audio.lap();
    setCrosshair(false);
    this.resultsTimer = 3.2;
  }

  private showResults(): void {
    const p = this.world.player!;
    const lo = this.loadout!;
    const bestLap = Math.min(...p.race.lapTimes);
    const rec = Storage.getRecords();
    const key = String(this.race.laps);
    const prevBest = rec.bestRace[key];
    const newBestRace = !prevBest || p.race.finishTime * 1000 < prevBest.time;
    const newBestLap = rec.bestLapTime === null || bestLap * 1000 < rec.bestLapTime;
    if (newBestRace) {
      rec.bestRace[key] = { time: p.race.finishTime * 1000, car: lo.car };
    }
    if (newBestLap) {
      rec.bestLapTime = bestLap * 1000;
      rec.bestLapCar = lo.car;
    }
    const position = this.race.positionOf(p);
    rec.racesFinished++;
    if (position === 1) rec.wins++;
    Storage.saveRecords(rec);
    this.hud?.setVisible(false);
    this.hooks?.onResults({
      loadout: lo,
      position,
      raceTime: p.race.finishTime,
      bestLap,
      lapTimes: p.race.lapTimes.slice(),
      kills: p.combat.kills,
      deaths: p.combat.deaths,
      damageDealt: p.combat.damageDealt,
      damageTaken: p.combat.damageTaken,
      standings: this.race.standings.map((c) => ({
        name: c.name,
        color: c.stats.color,
        time: c.race.finished ? c.race.finishTime : null,
        player: c.isPlayer,
      })),
      newBestRace,
      newBestLap,
      laps: this.race.laps,
    });
  }

  // ------------------------------------------------------------------ pause
  private handleKey(e: KeyboardEvent): void {
    if (this.finished) return;
    if (e.code === 'Escape' || e.code === 'KeyP') this.setPaused(!this.paused);
  }

  private setPaused(p: boolean): void {
    if (this.isDemo || this.finished || p === this.paused) return;
    this.paused = p;
    if (p) {
      this.world.audio.updateEngine(0, 0, 0, 0);
      setCrosshair(false);
      this.pauseLayer = layer('menu pause');
      const panel = h('div', 'panel', undefined, this.pauseLayer);
      h('h2', '', 'PAUSED', panel);
      const col = h('div', 'col', undefined, panel);
      button('RESUME', col, () => this.setPaused(false), 'primary');
      button('RESTART RACE', col, () => this.hooks?.onRestart());
      button('MAIN MENU', col, () => this.hooks?.onMainMenu());
      h('p', 'small', 'WASD drive · SPACE drift · E boost · Mouse aim · LMB/RMB fire · SHIFT ability · R reset', panel);
    } else {
      this.pauseLayer?.remove();
      this.pauseLayer = null;
      setCrosshair(true);
    }
  }

  // ------------------------------------------------------------------ teardown
  destroy(): void {
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('blur', this.onBlur);
    this.pauseLayer?.remove();
    this.hud?.destroy();
    this.debug?.destroy();
    this.input?.destroy();
    this.world.audio.stopEngine();
    this.world.effects.destroy();
    setCrosshair(false);
  }
}
