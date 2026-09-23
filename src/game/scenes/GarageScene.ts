import Phaser from 'phaser';
import { ABILITIES, CAR_IDS, CARS, type CarId } from '../data/cars';
import { PRIMARY_WEAPONS, SECONDARY_WEAPONS, WEAPONS, type WeaponId } from '../data/weapons';
import { AudioManager } from '../systems/AudioManager';
import { button, h, hex, layer } from '../ui/dom';
import { Storage, type Loadout } from '../utils/storage';
import { ensureDemo } from './shared';

/** SELECT YOUR CAR → SELECT LOADOUT → START RACE */
export class GarageScene extends Phaser.Scene {
  private root: HTMLElement | null = null;
  private loadout!: Loadout;

  constructor() {
    super('GarageScene');
  }

  create(): void {
    ensureDemo(this);
    this.loadout = Storage.getLoadout();
    this.showCars();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.root?.remove());
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

  private carPreview(id: CarId): string {
    const tex = this.textures.get(`car_${id}`).getSourceImage() as HTMLCanvasElement;
    return tex.toDataURL();
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
      img.src = this.carPreview(id);
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
      this.scene.start('MenuScene');
    });
    h('div', 'hint-line', 'Click a car to continue', nav);
  }

  private showLoadout(): void {
    const root = this.reset();
    const car = CARS[this.loadout.car];
    h('h1', 'screen-title', 'SELECT LOADOUT', root);
    h('div', 'subtitle', `<b style="color:${hex(car.color)}">${car.name}</b> · ability: ${ABILITIES[car.ability].name} [SPACE]`, root);
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
    group('PRIMARY', PRIMARY_WEAPONS, 'primary', 'LEFT MOUSE');
    group('SECONDARY', SECONDARY_WEAPONS, 'secondary', 'RIGHT MOUSE / Q');

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
    this.scene.start('RaceScene', { demo: false, loadout: { ...this.loadout } });
  }
}
