import type { NetClient } from './net/NetClient';
import type { CarSetup, NetResults } from './net/protocol';
import { Gfx } from './render/Gfx';
import { GarageScreen } from './scenes/GarageScreen';
import { MenuScreen } from './scenes/MenuScreen';
import { NetRaceSession } from './scenes/NetRaceSession';
import { OnlineScreen } from './scenes/OnlineScreen';
import { RaceSession, type RaceResults } from './scenes/RaceSession';
import { ResultsScreen } from './scenes/ResultsScreen';
import type { Loadout } from './utils/storage';

interface Screen {
  destroy(): void;
}

interface Session {
  readonly isDemo: boolean;
  update(dt: number): void;
  destroy(): void;
}

/**
 * Top-level state machine: MENU → GARAGE → RACE → RESULTS, plus the online
 * flow MULTIPLAYER → LOBBY → NET RACE → RESULTS → LOBBY.
 * A demo race keeps running behind the menus; one render loop drives everything.
 */
export class App {
  readonly gfx: Gfx;
  private session: Session | null = null;
  private screen: Screen | null = null;
  private last = performance.now();

  constructor(container: HTMLElement) {
    this.gfx = new Gfx(container);
    this.showMenu();
    requestAnimationFrame(this.loop);
  }

  private loop = (now: number): void => {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.session?.update(dt);
    this.gfx.render();
    requestAnimationFrame(this.loop);
  };

  private setScreen(s: Screen | null): void {
    this.screen?.destroy();
    this.screen = s;
  }

  private ensureDemo(): void {
    if (this.session?.isDemo) return;
    this.session?.destroy();
    this.session = new RaceSession(this.gfx, null, null);
  }

  showMenu(): void {
    this.ensureDemo();
    this.setScreen(new MenuScreen(this));
  }

  showGarage(): void {
    this.ensureDemo();
    this.setScreen(new GarageScreen(this));
  }

  startRace(loadout: Loadout): void {
    this.setScreen(null);
    this.session?.destroy();
    this.session = new RaceSession(this.gfx, loadout, {
      onResults: (r: RaceResults) =>
        this.setScreen(
          new ResultsScreen({ ...r, car: r.loadout.car }, [
            { label: 'RESTART', run: () => this.startRace(loadout) },
            { label: 'CHANGE CAR', run: () => this.showGarage() },
            { label: 'MAIN MENU', run: () => this.showMenu() },
          ]),
        ),
      onRestart: () => this.startRace(loadout),
      onMainMenu: () => this.showMenu(),
    });
  }

  // ------------------------------------------------------------------ online
  showOnline(net: NetClient | null = null): void {
    this.ensureDemo();
    this.setScreen(new OnlineScreen(this, net));
  }

  startNetRace(net: NetClient, start: { laps: number; cars: CarSetup[] }): void {
    // the lobby hands its connection over instead of closing it
    if (this.screen instanceof OnlineScreen) this.screen.detach();
    this.setScreen(null);
    this.session?.destroy();
    const leave = () => {
      net.close();
      this.showMenu();
    };
    const backToLobby = () => {
      net.send({ t: 'lobby' });
      this.showOnline(net);
    };
    net.onClose = () => this.showMenu();
    this.session = new NetRaceSession(this.gfx, net, start, {
      onResults: (res: NetResults) =>
        this.setScreen(
          new ResultsScreen(res, [
            { label: 'BACK TO LOBBY', run: backToLobby },
            { label: 'LEAVE', run: leave },
          ]),
        ),
      onLeave: backToLobby,
    });
  }
}
