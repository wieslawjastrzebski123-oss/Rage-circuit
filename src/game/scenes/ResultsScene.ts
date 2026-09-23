import Phaser from 'phaser';
import { CARS } from '../data/cars';
import { AudioManager } from '../systems/AudioManager';
import { button, h, hex, layer } from '../ui/dom';
import { formatTime } from '../utils/math';
import type { RaceResults } from './RaceScene';

const ORD = ['', '1ST', '2ND', '3RD', '4TH'];

/** RACE FINISHED overlay shown on top of the (still running) race. */
export class ResultsScene extends Phaser.Scene {
  private root: HTMLElement | null = null;

  constructor() {
    super('ResultsScene');
  }

  create(res: RaceResults): void {
    const root = layer('menu results');
    this.root = root;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.root?.remove());

    const panel = h('div', 'panel wide', undefined, root);
    h('h1', 'screen-title', 'RACE FINISHED', panel);
    h('div', `place p${res.position}`, ORD[res.position] ?? `${res.position}TH`, panel);

    const grid = h('div', 'result-grid', undefined, panel);
    const stat = (label: string, value: string, badge = '') => h('div', 'rstat', `<span>${label}</span><b>${value}</b>${badge ? `<em>${badge}</em>` : ''}`, grid);
    stat('POSITION', `${res.position} / ${res.standings.length}`);
    stat('RACE TIME', formatTime(res.raceTime * 1000), res.newBestRace ? 'NEW RECORD' : '');
    stat('BEST LAP', formatTime(res.bestLap * 1000), res.newBestLap ? 'NEW RECORD' : '');
    stat('KILLS', String(res.kills));
    stat('DEATHS', String(res.deaths));
    stat('DAMAGE DEALT', String(Math.round(res.damageDealt)));
    stat('DAMAGE TAKEN', String(Math.round(res.damageTaken)));
    stat('CAR', CARS[res.loadout.car].name);

    const laps = h('div', 'laps', undefined, panel);
    res.lapTimes.forEach((t, i) => {
      const best = Math.abs(t - res.bestLap) < 1e-6;
      h('span', best ? 'best' : '', `L${i + 1} ${formatTime(t * 1000)}`, laps);
    });

    const table = h('div', 'standings', undefined, panel);
    res.standings.forEach((s, i) => {
      h(
        'div',
        `row ${s.player ? 'me' : ''}`,
        `<span class="n">${i + 1}</span><span class="dot" style="background:${hex(s.color)}"></span><span class="name">${s.name}</span><span class="t">${s.time === null ? 'racing…' : formatTime(s.time * 1000)}</span>`,
        table,
      );
    });

    const nav = h('div', 'nav', undefined, panel);
    const click = () => AudioManager.instance.click();
    button('RESTART', nav, () => {
      click();
      this.scene.start('RaceScene', { demo: false, loadout: res.loadout });
    }, 'primary');
    button('CHANGE CAR', nav, () => {
      click();
      this.scene.stop('RaceScene');
      this.scene.start('GarageScene');
    });
    button('MAIN MENU', nav, () => {
      click();
      this.scene.stop('RaceScene');
      this.scene.start('MenuScene');
    });
  }
}
