import { Gfx } from './render/Gfx';
import { GarageScreen } from './scenes/GarageScreen';
import { MenuScreen } from './scenes/MenuScreen';
import { RaceSession, type RaceResults } from './scenes/RaceSession';
import { ResultsScreen } from './scenes/ResultsScreen';
import type { Loadout } from './utils/storage';

interface Screen {
  destroy(): void;
}

/**
 * Top-level state machine: MENU → GARAGE → RACE → RESULTS.
 * A demo race keeps running behind the menus; one render loop drives everything.
 */
export class App {
  readonly gfx: Gfx;
  private session: RaceSession | null = null;
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
      onResults: (r: RaceResults) => this.setScreen(new ResultsScreen(this, r)),
      onRestart: () => this.startRace(loadout),
      onMainMenu: () => this.showMenu(),
    });
  }
}
