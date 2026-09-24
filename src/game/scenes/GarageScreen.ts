import { IS_TOUCH } from '../ui/device';
import { ABILITIES, CAR_IDS, CARS } from '../data/cars';
import { PRIMARY_WEAPONS, SECONDARY_WEAPONS, WEAPONS, type WeaponId } from '../data/weapons';
import { AudioManager } from '../systems/AudioManager';
import { button, h, hex, layer } from '../ui/dom';
import { Storage, type Difficulty, type Loadout } from '../utils/storage';
import { DEFAULT_LAPS, LAP_OPTIONS } from '../constants';
import type { App } from '../App';
import { carPreview } from './CarPreview';

/** SELECT YOUR CAR → SELECT LOADOUT → START RACE */
export class GarageScreen {
  private root: HTMLElement | null = null;
  private loadout: Loadout;
  private app: App;

  constructor(app: App) {
    this.app = app;
    this.loadout = Storage.getLoadout();
    this.showCars();
  }

  destroy(): void {
    this.root?.remove();
  }

  private reset(): HTMLElement {
    this.root?.remove();
    this.root = layer('menu garage');
    return this.root;
  }

  private click(): void {
    AudioManager.instance.unlock();
    AudioManager.instance.click();
  }

  private showCars(): void {
    const root = this.reset();
    h('h1', 'screen-title', 'SELECT YOUR CAR', root);
    const cards = h('div', 'cards', undefined, root);
    const statRow = (parent: HTMLElement, label: string, v: number, color: string) => {
      const r = h('div', 'stat', undefined, parent);
      h('span', '', label, r);
      const bars = h('div', 'bars', undefined, r);
      for (let i = 1; i <= 10; i++) {
        const b = h('i', i <= v ? 'on' : '', undefined, bars);
        if (i <= v) b.style.background = color;
      }
    };
    for (const id of CAR_IDS) {
      const car = CARS[id];
      const col = hex(car.color);
      const card = h('div', `card ${id === this.loadout.car ? 'selected' : ''}`, undefined, cards);
      card.style.setProperty('--c', col);
      h('div', 'car-name', car.name, card);
      h('div', 'archetype', car.archetype, card);
      const img = h('img', 'car-img', undefined, card);
      img.src = carPreview(id);
      img.alt = car.name;
      const stats = h('div', 'stats', undefined, card);
      statRow(stats, 'SPEED', car.rating.speed, col);
      statRow(stats, 'ACCEL', car.rating.acceleration, col);
      statRow(stats, 'HANDLING', car.rating.handling, col);
      statRow(stats, 'ARMOR', car.rating.armor, col);
      const ab = ABILITIES[car.ability];
      h('div', 'ability', `<span>ABILITY</span><b>${ab.name}</b><em>${ab.description}</em>`, card);
      h('div', 'blurb', car.blurb, card);
      card.addEventListener('click', () => {
        this.click();
        this.loadout.car = id;
        this.showLoadout();
      });
    }
    const nav = h('div', 'nav', undefined, root);
    button('BACK', nav, () => {
      this.click();
      this.app.showMenu();
    });
    h('div', 'hint-line', IS_TOUCH ? 'Tap a car to continue' : 'Click a car to continue', nav);
  }

  private showLoadout(): void {
    const root = this.reset();
    const car = CARS[this.loadout.car];
    h('h1', 'screen-title', 'SELECT LOADOUT', root);
    h('div', 'subtitle', `<b style="color:${hex(car.color)}">${car.name}</b> · ability: ${ABILITIES[car.ability].name} ${IS_TOUCH ? '' : '[SHIFT]'}`, root);
    const wrap = h('div', 'loadout', undefined, root);
    const group = (title: string, ids: WeaponId[], key: 'primary' | 'secondary', keyLabel: string) => {
      const g = h('div', 'group', undefined, wrap);
      h('h3', '', `${title} <small>${keyLabel}</small>`, g);
      const opts = h('div', 'opts', undefined, g);
      const els: HTMLElement[] = [];
      for (const id of ids) {
        const w = WEAPONS[id];
        const o = h('div', `opt ${this.loadout[key] === id ? 'selected' : ''}`, undefined, opts);
        h('b', '', w.name, o);
        h('p', '', w.description, o);
        h(
          'div',
          'wstats',
          `<span>DMG <b>${w.damage}</b></span><span>ENERGY <b>${w.energyCost}</b></span><span>${w.cooldown < 0.2 ? 'RATE <b>' + Math.round(1 / w.cooldown) + '/s</b>' : 'CD <b>' + w.cooldown + 's</b>'}</span>`,
          o,
        );
        o.addEventListener('click', () => {
          this.click();
          this.loadout[key] = id;
          els.forEach((e) => e.classList.remove('selected'));
          o.classList.add('selected');
        });
        els.push(o);
      }
    };
    // stored loadouts could hold a weapon in the wrong slot after data changes
    if (!PRIMARY_WEAPONS.includes(this.loadout.primary)) this.loadout.primary = 'machinegun';
    if (!SECONDARY_WEAPONS.includes(this.loadout.secondary)) this.loadout.secondary = 'rocket';
    group('PRIMARY', PRIMARY_WEAPONS, 'primary', IS_TOUCH ? 'FIRE' : 'LEFT MOUSE');
    group('SECONDARY', SECONDARY_WEAPONS, 'secondary', IS_TOUCH ? 'ALT' : 'RIGHT MOUSE / Q');

    // race length
    if (!LAP_OPTIONS.includes(this.loadout.laps)) this.loadout.laps = DEFAULT_LAPS;
    const lapsRow = h('div', 'laps-select', undefined, root);
    h('h3', '', 'LAPS', lapsRow);
    const lapBtns: HTMLElement[] = [];
    for (const n of LAP_OPTIONS) {
      const b = h('button', `lap-opt ${this.loadout.laps === n ? 'selected' : ''}`, String(n), lapsRow);
      b.addEventListener('click', () => {
        this.click();
        this.loadout.laps = n;
        lapBtns.forEach((x) => x.classList.remove('selected'));
        b.classList.add('selected');
      });
      lapBtns.push(b);
    }

    // bot skill
    const diffRow = h('div', 'laps-select', undefined, root);
    h('h3', '', 'BOTS', diffRow);
    const diffBtns: HTMLElement[] = [];
    const levels: [Difficulty, string][] = [
      ['easy', 'EASY'],
      ['normal', 'NORMAL'],
      ['hard', 'HARD'],
    ];
    if (!levels.some(([d]) => d === this.loadout.difficulty)) this.loadout.difficulty = 'normal';
    for (const [d, label] of levels) {
      const b = h('button', `lap-opt diff ${this.loadout.difficulty === d ? 'selected' : ''}`, label, diffRow);
      b.addEventListener('click', () => {
        this.click();
        this.loadout.difficulty = d;
        diffBtns.forEach((x) => x.classList.remove('selected'));
        b.classList.add('selected');
      });
      diffBtns.push(b);
    }

    const nav = h('div', 'nav', undefined, root);
    button('BACK', nav, () => {
      this.click();
      this.showCars();
    });
    button('START RACE', nav, () => this.start(), 'primary big');
  }

  private start(): void {
    this.click();
    Storage.saveLoadout(this.loadout);
    this.app.startRace({ ...this.loadout });
  }
}
