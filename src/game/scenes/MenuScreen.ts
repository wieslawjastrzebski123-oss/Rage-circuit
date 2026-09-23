import { CARS } from '../data/cars';
import { AudioManager } from '../systems/AudioManager';
import { button, h, layer } from '../ui/dom';
import { formatTime } from '../utils/math';
import { Storage } from '../utils/storage';
import type { App } from '../App';

/** Title screen: PLAY / HOW TO PLAY / SETTINGS, over the attract-mode race. */
export class MenuScreen {
  private root: HTMLElement | null = null;
  private app: App;

  constructor(app: App) {
    this.app = app;
    this.showMain();
  }

  destroy(): void {
    this.root?.remove();
  }

  private reset(): HTMLElement {
    this.root?.remove();
    this.root = layer('menu');
    return this.root;
  }

  private click(): void {
    const a = AudioManager.instance;
    a.unlock();
    a.click();
  }

  private showMain(): void {
    const root = this.reset();
    const wrap = h('div', 'title-wrap', undefined, root);
    h('div', 'logo', '<span class="rage">RAGE</span><span class="circuit">CIRCUIT</span>', wrap);
    h('div', 'tagline', 'Drift. Boost. Shoot. Survive five laps of the Industrial District.', wrap);
    const col = h('div', 'col main-buttons', undefined, wrap);
    button('PLAY', col, () => {
      this.click();
      this.app.showGarage();
    }, 'primary big');
    button('HOW TO PLAY', col, () => {
      this.click();
      this.showHowTo();
    });
    button('SETTINGS', col, () => {
      this.click();
      this.showSettings();
    });

    const r = Storage.getRecords();
    const rec = h('div', 'records', undefined, wrap);
    const carName = (id: string | null) => (id ? CARS[id as keyof typeof CARS].name : '');
    const laps = Storage.getLoadout().laps ?? 5;
    const br = r.bestRace?.[String(laps)];
    h('div', '', `<span>BEST RACE · ${laps} ${laps === 1 ? 'LAP' : 'LAPS'}</span><b>${br ? formatTime(br.time) : '--'}</b><em>${carName(br?.car ?? null)}</em>`, rec);
    h('div', '', `<span>BEST LAP</span><b>${r.bestLapTime ? formatTime(r.bestLapTime) : '--'}</b><em>${carName(r.bestLapCar)}</em>`, rec);
    h('div', '', `<span>WINS</span><b>${r.wins} / ${r.racesFinished}</b><em>races</em>`, rec);
    h('div', 'footer', 'Desktop · keyboard + mouse · third-person view · add <code>?debug=true</code> to the URL for debug view', root);
  }

  private showHowTo(): void {
    const root = this.reset();
    const panel = h('div', 'panel wide', undefined, root);
    h('h2', '', 'HOW TO PLAY', panel);
    const grid = h('div', 'howto', undefined, panel);
    const rows: [string, string][] = [
      ['W / S', 'Throttle / brake & reverse'],
      ['A / D', 'Steer'],
      ['SPACE', 'Drift (while fast and turning). Hold to charge, release for a boost'],
      ['E', 'Boost – uses the Boost meter (fills from drifting, kills, pickups)'],
      ['MOUSE', 'Aim the turret. Cursor high = shoot ahead, at the sides = shoot sideways, near the bottom = shoot behind you'],
      ['LMB', 'Primary weapon (Machine Gun / Cannon)'],
      ['RMB / Q', 'Secondary weapon (Rocket / Mine)'],
      ['SHIFT', 'Car ability (Overcharge / Shield / Blink / EMP)'],
      ['R', 'Reset to last checkpoint (2 s penalty)'],
      ['ESC', 'Pause'],
    ];
    for (const [k, v] of rows) {
      h('div', 'k', k, grid);
      h('div', 'v', v, grid);
    }
    const tips = h('ul', 'tips', undefined, panel);
    [
      'Weapons come online during the race: primary 7 s after GO, secondary on lap 2, car ability on lap 3 (in 1–2 lap races after 25 s and 50 s).',
      'Energy powers weapons and abilities – it regenerates faster the faster you drive.',
      'Drift longer for a stronger boost: blue → yellow → orange → pink. Hitting a wall cancels the charge.',
      'Rockets home in lightly – dodge them with a hard turn or a drift.',
      'Red barrels explode. Shoot them when an enemy drives past.',
      'The yellow-striped shortcut is faster but narrow – one mistake and you lose more than you gain.',
      'Destroying a rival refills Boost and some Energy.',
    ].forEach((t) => h('li', '', t, tips));
    button('BACK', panel, () => {
      this.click();
      this.showMain();
    });
  }

  private showSettings(): void {
    const root = this.reset();
    const panel = h('div', 'panel', undefined, root);
    h('h2', '', 'SETTINGS', panel);
    const s = { ...Storage.getSettings() };
    const slider = (label: string, key: 'masterVolume' | 'sfxVolume' | 'cameraShake') => {
      const row = h('label', 'slider', undefined, panel);
      h('span', '', label, row);
      const input = h('input', '', undefined, row);
      input.type = 'range';
      input.min = '0';
      input.max = '100';
      input.value = String(Math.round(s[key] * 100));
      const val = h('b', '', `${input.value}%`, row);
      input.addEventListener('input', () => {
        s[key] = Number(input.value) / 100;
        val.textContent = `${input.value}%`;
        Storage.saveSettings(s);
        AudioManager.instance.applySettings();
      });
      input.addEventListener('change', () => this.click());
    };
    slider('MASTER VOLUME', 'masterVolume');
    slider('SFX VOLUME', 'sfxVolume');
    slider('CAMERA SHAKE', 'cameraShake');
    const q = h('label', 'slider', undefined, panel);
    h('span', '', 'GRAPHICS', q);
    const sel = h('select', '', '<option value="high">HIGH (shadows)</option><option value="low">LOW (faster)</option>', q);
    sel.value = s.quality;
    h('b', '', '', q);
    sel.addEventListener('change', () => {
      s.quality = sel.value === 'low' ? 'low' : 'high';
      Storage.saveSettings(s);
      this.app.gfx.applySettings();
      this.click();
    });
    button('BACK', panel, () => {
      this.click();
      this.showMain();
    });
  }
}
