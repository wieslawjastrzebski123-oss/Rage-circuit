import Phaser from 'phaser';
import { PERSONALITIES, type Personality } from '../ai/Personality';
import { createAbility } from '../abilities';
import { DEBUG } from '../constants';
import { CAR_IDS, CARS, type CarId } from '../data/cars';
import { PRIMARY_WEAPONS, SECONDARY_WEAPONS } from '../data/weapons';
import { AICar } from '../entities/AICar';
import type { Car } from '../entities/Car';
import { PlayerCar } from '../entities/PlayerCar';
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
import { orientedBox, TrackRenderer } from '../track/TrackRenderer';
import { HUD } from '../ui/HUD';
import { button, h, layer, setCrosshair } from '../ui/dom';
import { clamp, damp, pick, shuffle } from '../utils/math';
import { Storage, type Loadout } from '../utils/storage';
import { createWeapon } from '../weapons';
import { DebugOverlay } from '../ui/DebugOverlay';

export interface RaceData {
  demo: boolean;
  loadout?: Loadout;
}

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
}

let cachedTrack: Track | null = null;
function getTrack(): Track {
  if (!cachedTrack) cachedTrack = new Track(INDUSTRIAL_DISTRICT);
  return cachedTrack;
}

const MAX_SUBSTEP = 1 / 100;

export class RaceScene extends Phaser.Scene {
  world!: World;
  race!: RaceManager;
  isDemo = true;
  private data_!: RaceData;
  private renderer_!: TrackRenderer;
  private respawn!: RespawnSystem;
  private pickups!: PickupSystem;
  private input_: InputManager | null = null;
  private hud: HUD | null = null;
  private debug: DebugOverlay | null = null;
  private camX = 0;
  private camY = 0;
  private zoom = 1;
  private focus!: Car;
  private demoSwitch = 0;
  private paused = false;
  private pauseLayer: HTMLElement | null = null;
  private finished = false;
  private resultsTimer = -1;
  private crosshair: HTMLElement | null = null;
  private onKey = (e: KeyboardEvent) => this.handleKey(e);
  private onBlur = () => this.setPaused(true);

  constructor() {
    super('RaceScene');
  }

  init(data: RaceData): void {
    this.data_ = { demo: data?.demo ?? true, loadout: data?.loadout };
    this.isDemo = this.data_.demo;
    this.paused = false;
    this.finished = false;
    this.resultsTimer = -1;
    this.pauseLayer = null;
  }

  create(): void {
    const track = getTrack();
    const audio = AudioManager.instance;
    const world: World = {
      scene: this,
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
    world.effects = new Effects(this);
    world.combat = new CombatSystem(world);
    world.collisions = new CollisionSystem(world, track.def.obstacles);

    this.renderer_ = new TrackRenderer(this, track);
    for (const o of track.def.obstacles) {
      if (o.kind === 'container') {
        this.renderer_.addProp(orientedBox(o.x, o.y, o.w ?? 100, o.h ?? 40, o.angle ?? 0, 34, 0xd6562b, 0x6b2a14, 0xffb000));
      }
    }
    this.pickups = new PickupSystem(world, track.def.pickups);
    this.race = new RaceManager(world);
    this.respawn = new RespawnSystem(world, this.race);

    const personalities = shuffle([PERSONALITIES.aggressive, PERSONALITIES.balanced, PERSONALITIES.racer]);
    if (this.isDemo) {
      const ids = shuffle(CAR_IDS.slice());
      ids.forEach((id, i) => world.cars.push(this.makeBot(id, personalities[i % 3] ?? PERSONALITIES.balanced)));
      this.race.setupGrid(shuffle(world.cars.slice()));
      this.race.startImmediately();
      this.focus = pick(world.cars);
    } else {
      const lo = this.data_.loadout ?? Storage.getLoadout();
      this.input_ = new InputManager(this);
      const player = new PlayerCar(world, CARS[lo.car], this.input_);
      player.primary = createWeapon(lo.primary);
      player.secondary = createWeapon(lo.secondary);
      player.ability = createAbility(player.stats.ability);
      world.player = player;
      const others = CAR_IDS.filter((id) => id !== lo.car);
      const bots = others.map((id, i) => this.makeBot(id, personalities[i]));
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
      this.crosshair = document.getElementById('crosshair');
      setCrosshair(true);
      this.hud.announce('INDUSTRIAL DISTRICT', '#ff2d6f', 2200);
    }
    for (const c of world.cars) {
      if (c instanceof AICar) c.racing.requestReset = () => this.respawn.reset(c);
    }

    this.camX = this.focus.x;
    this.camY = this.focus.y;
    this.zoom = this.baseZoom();
    this.cameras.main.setZoom(this.zoom).centerOn(this.camX, this.camY);
    this.cameras.main.setBackgroundColor('#0b0c10');

    if (DEBUG) {
      this.debug = new DebugOverlay(this, world, this.race);
      (window as unknown as { __rc: RaceScene }).__rc = this;
    }

    window.addEventListener('keydown', this.onKey);
    if (!this.isDemo) window.addEventListener('blur', this.onBlur);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
  }

  private makeBot(id: CarId, p: Personality): AICar {
    const bot = new AICar(this.world, CARS[id], p);
    bot.primary = createWeapon(pick(PRIMARY_WEAPONS));
    bot.secondary = createWeapon(pick(SECONDARY_WEAPONS));
    bot.ability = createAbility(bot.stats.ability);
    return bot;
  }

  private baseZoom(): number {
    const h = this.scale.height;
    return clamp(h / (this.isDemo ? 1100 : 960), 0.6, 1.8);
  }

  // ------------------------------------------------------------------ loop
  update(_time: number, delta: number): void {
    if (this.paused) return;
    const frameDt = Math.min(delta / 1000, 0.05);
    const fx = this.world.effects;

    if (fx.hitStop > 0) {
      fx.hitStop -= delta;
    } else {
      const steps = Math.max(1, Math.ceil(frameDt / MAX_SUBSTEP));
      const dt = frameDt / steps;
      for (let i = 0; i < steps; i++) this.step(dt);
    }

    for (const c of this.world.cars) c.updateVisuals(frameDt);
    this.updateCamera(frameDt);
    this.renderer_.update(this.cameras.main);
    this.updateAudio();
    if (this.hud && this.world.player) this.hud.update(frameDt, this.world.player, this.race, this.world.cars);
    this.updateCrosshair();
    this.debug?.update(frameDt);

    if (this.resultsTimer > 0) {
      this.resultsTimer -= frameDt;
      if (this.resultsTimer <= 0) this.showResults();
    }
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

  private updateCamera(dt: number): void {
    const cam = this.cameras.main;
    if (this.isDemo) {
      this.demoSwitch += dt;
      if (this.demoSwitch > 9) {
        this.demoSwitch = 0;
        const others = this.world.cars.filter((c) => c !== this.focus && c.alive);
        if (others.length) this.focus = pick(others);
      }
    }
    const f = this.focus;
    const spd = f.speed;
    let lx = f.vx * 0.3;
    let ly = f.vy * 0.3;
    const ll = Math.hypot(lx, ly);
    if (ll > 230) {
      lx *= 230 / ll;
      ly *= 230 / ll;
    }
    // lean a little toward the aim point so you can see what you shoot at
    if (f.isPlayer && f.alive) {
      const ax = clamp((f.controls.aimX - f.x) * 0.12, -110, 110);
      const ay = clamp((f.controls.aimY - f.y) * 0.12, -80, 80);
      lx += ax;
      ly += ay;
    }
    this.camX = damp(this.camX, f.x + lx, 4.5, dt);
    this.camY = damp(this.camY, f.y + ly, 4.5, dt);
    // snap if we fell far behind (respawn / camera switch)
    if (Math.hypot(this.camX - f.x, this.camY - f.y) > 900) {
      this.camX = f.x;
      this.camY = f.y;
    }
    const speedK = clamp(spd / 700, 0, 1);
    const targetZoom = this.baseZoom() * (1 - 0.06 * speedK - 0.05 * clamp(f.boostPower, 0, 1.3));
    this.zoom = damp(this.zoom, targetZoom, 1.8, dt);
    cam.setZoom(this.zoom);
    cam.centerOn(this.camX, this.camY);
  }

  private updateAudio(): void {
    const a = this.world.audio;
    a.setListener(this.camX, this.camY);
    const p = this.world.player;
    if (!p) return;
    const ratio = p.alive ? p.speed / p.stats.maxSpeed : 0;
    const screech = p.alive && (p.drifting || (p.controls.throttle < 0 && p.forwardSpeed > 250)) ? 1 : 0;
    a.updateEngine(ratio, p.alive && this.world.raceStarted ? p.controls.throttle : 0, p.boostPower, this.paused ? 0 : screech);
  }

  private updateCrosshair(): void {
    const p = this.world.player;
    if (!this.crosshair || !p) return;
    const locked = p.alive && this.world.combat.findLockTarget(p, p.controls.aimX, p.controls.aimY, 70) !== null;
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
    const lo = this.data_.loadout ?? Storage.getLoadout();
    const bestLap = Math.min(...p.race.lapTimes);
    const rec = Storage.getRecords();
    const newBestRace = rec.bestRaceTime === null || p.race.finishTime * 1000 < rec.bestRaceTime;
    const newBestLap = rec.bestLapTime === null || bestLap * 1000 < rec.bestLapTime;
    if (newBestRace) {
      rec.bestRaceTime = p.race.finishTime * 1000;
      rec.bestRaceCar = lo.car;
    }
    if (newBestLap) {
      rec.bestLapTime = bestLap * 1000;
      rec.bestLapCar = lo.car;
    }
    const position = this.race.positionOf(p);
    rec.racesFinished++;
    if (position === 1) rec.wins++;
    Storage.saveRecords(rec);

    const results: RaceResults = {
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
    };
    this.hud?.setVisible(false);
    this.scene.launch('ResultsScene', results);
  }

  // ------------------------------------------------------------------ pause
  private handleKey(e: KeyboardEvent): void {
    if (this.isDemo || this.finished) return;
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
      button('RESTART RACE', col, () => this.scene.restart(this.data_));
      button('MAIN MENU', col, () => this.scene.start('MenuScene'));
      h('p', 'small', 'WASD drive · SHIFT drift · E boost · Mouse aim · LMB/RMB fire · SPACE ability · R reset', panel);
    } else {
      this.pauseLayer?.remove();
      this.pauseLayer = null;
      setCrosshair(true);
    }
  }

  // ------------------------------------------------------------------ teardown
  private cleanup(): void {
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('blur', this.onBlur);
    this.pauseLayer?.remove();
    this.hud?.destroy();
    this.hud = null;
    this.debug?.destroy();
    this.debug = null;
    this.input_?.destroy();
    this.input_ = null;
    this.world.audio.stopEngine();
    this.world.combat.clear();
    for (const c of this.world.cars) c.destroy();
    this.world.cars.length = 0;
    setCrosshair(false);
    this.scene.stop('ResultsScene');
  }
}
