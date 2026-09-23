import type { Car } from '../entities/Car';
import { DRIFT_LEVELS } from '../entities/Car';
import type { RaceManager } from '../systems/RaceManager';
import type { Track } from '../track/Track';
import { formatTime } from '../utils/math';
import { h, hex, layer } from './dom';

interface Bar {
  fill: HTMLElement;
  text: HTMLElement;
}

interface Slot {
  root: HTMLElement;
  cd: HTMLElement;
  info: HTMLElement;
}

const ORD = ['', 'st', 'nd', 'rd', 'th'];

/** In-race heads-up display rendered as HTML over the canvas. */
export class HUD {
  private root: HTMLElement;
  private pos: HTMLElement;
  private posSuffix: HTMLElement;
  private lap: HTMLElement;
  private raceTime: HTMLElement;
  private lapTimeEl: HTMLElement;
  private bestLap: HTMLElement;
  private board: HTMLElement;
  private boardRows: HTMLElement[] = [];
  private hp: Bar;
  private energy: Bar;
  private boost: Bar;
  private drift: HTMLElement;
  private driftPips: HTMLElement[] = [];
  private primary: Slot;
  private secondary: Slot;
  private ability: Slot;
  private speed: HTMLElement;
  private center: HTMLElement;
  private sub: HTMLElement;
  private countdownEl: HTMLElement;
  private wrongWay: HTMLElement;
  private respawn: HTMLElement;
  private hint: HTMLElement;
  private feedEl: HTMLElement;
  private vignette: HTMLElement;
  private status: HTMLElement;
  private mini: HTMLCanvasElement;
  private miniCtx: CanvasRenderingContext2D;
  private miniBg: HTMLCanvasElement;
  private miniScale = 1;
  private miniTimer = 0;
  private announceTimer = 0;
  private subTimer = 0;
  private last: Record<string, string> = {};

  constructor(track: Track) {
    this.root = layer('hud');
    const tl = h('div', 'hud-tl', undefined, this.root);
    const posWrap = h('div', 'hud-pos', undefined, tl);
    this.pos = h('span', 'pos-num', '1', posWrap);
    this.posSuffix = h('span', 'pos-suf', 'st<small>/4</small>', posWrap);
    this.lap = h('div', 'hud-lap', 'LAP 1/5', tl);
    const times = h('div', 'hud-times', undefined, tl);
    this.raceTime = h('div', '', '', times);
    this.lapTimeEl = h('div', '', '', times);
    this.bestLap = h('div', 'best', '', times);

    const tr = h('div', 'hud-tr', undefined, this.root);
    this.board = h('div', 'hud-board', undefined, tr);
    for (let i = 0; i < 4; i++) this.boardRows.push(h('div', 'row', '', this.board));
    this.mini = h('canvas', 'hud-mini', undefined, tr);

    const bl = h('div', 'hud-bl', undefined, this.root);
    this.hp = this.bar(bl, 'HP', 'hp');
    this.energy = this.bar(bl, 'ENERGY', 'energy');
    this.boost = this.bar(bl, 'BOOST  [E]', 'boost');
    this.drift = h('div', 'hud-drift', '<span class="lbl">DRIFT [SHIFT]</span>', bl);
    const pips = h('div', 'pips', undefined, this.drift);
    for (const L of DRIFT_LEVELS) {
      const p = h('div', 'pip', undefined, pips);
      p.style.setProperty('--c', hex(L.color));
      this.driftPips.push(p);
    }
    this.status = h('div', 'hud-status', '', bl);

    const br = h('div', 'hud-br', undefined, this.root);
    this.primary = this.slot(br, 'LMB');
    this.secondary = this.slot(br, 'RMB');
    this.ability = this.slot(br, 'SPACE');

    this.speed = h('div', 'hud-speed', '0', this.root);
    this.center = h('div', 'hud-center', '', this.root);
    this.sub = h('div', 'hud-sub', '', this.root);
    this.countdownEl = h('div', 'hud-countdown', '', this.root);
    this.wrongWay = h('div', 'hud-wrong', 'WRONG WAY', this.root);
    this.respawn = h('div', 'hud-respawn', '', this.root);
    this.hint = h('div', 'hud-hint', '', this.root);
    this.feedEl = h('div', 'hud-feed', '', this.root);
    this.vignette = h('div', 'hud-vignette', '', this.root);

    // minimap background (track outline) drawn once
    const W = 210;
    const pad = 10;
    this.miniScale = Math.min((W - pad * 2) / track.width, (W - pad * 2) / track.height);
    const Hh = Math.ceil(track.height * this.miniScale + pad * 2);
    this.mini.width = W;
    this.mini.height = Hh;
    this.miniCtx = this.mini.getContext('2d')!;
    this.miniBg = document.createElement('canvas');
    this.miniBg.width = W;
    this.miniBg.height = Hh;
    const g = this.miniBg.getContext('2d')!;
    const tx = (x: number) => pad + x * this.miniScale;
    const drawPath = (pts: { x: number; y: number }[], closed: boolean, width: number, color: string) => {
      g.beginPath();
      pts.forEach((p, i) => (i ? g.lineTo(tx(p.x), tx(p.y)) : g.moveTo(tx(p.x), tx(p.y))));
      if (closed) g.closePath();
      g.lineWidth = width;
      g.strokeStyle = color;
      g.lineJoin = 'round';
      g.stroke();
    };
    drawPath(track.main, true, 7, 'rgba(255,45,111,0.35)');
    drawPath(track.main, true, 4, 'rgba(230,232,240,0.85)');
    drawPath(track.shortcut, false, 2.5, 'rgba(255,176,0,0.9)');
    const st = track.pointAt(0);
    g.fillStyle = '#fff';
    g.fillRect(tx(st.x) - 1, tx(st.y) - 6, 3, 12);
  }

  private bar(parent: HTMLElement, label: string, cls: string): Bar {
    const wrap = h('div', `hud-bar ${cls}`, undefined, parent);
    h('span', 'lbl', label, wrap);
    const track = h('div', 'track', undefined, wrap);
    const fill = h('div', 'fill', undefined, track);
    const text = h('span', 'val', '', wrap);
    return { fill, text };
  }

  private slot(parent: HTMLElement, key: string): Slot {
    const root = h('div', 'hud-slot', undefined, parent);
    h('div', 'key', key, root);
    const info = h('div', 'info', '', root);
    const cd = h('div', 'cd', '', root);
    return { root, cd, info };
  }

  private setText(key: string, el: HTMLElement, html: string): void {
    if (this.last[key] === html) return;
    this.last[key] = html;
    el.innerHTML = html;
  }

  // ------------------------------------------------------------ messages
  announce(text: string, color = '#ffffff', ms = 1600): void {
    this.center.textContent = text;
    this.center.style.color = color;
    this.center.classList.remove('show');
    void this.center.offsetWidth;
    this.center.classList.add('show');
    this.announceTimer = ms / 1000;
  }

  flash(text: string, color = '#ffffff', ms = 900): void {
    this.sub.textContent = text;
    this.sub.style.color = color;
    this.sub.classList.add('show');
    this.subTimer = ms / 1000;
  }

  countdown(text: string): void {
    this.countdownEl.textContent = text;
    this.countdownEl.classList.remove('pop', 'go');
    void this.countdownEl.offsetWidth;
    this.countdownEl.classList.add('pop');
    if (text === 'GO!') this.countdownEl.classList.add('go');
  }

  feed(text: string): void {
    const e = h('div', 'item', text, this.feedEl);
    setTimeout(() => e.classList.add('out'), 3200);
    setTimeout(() => e.remove(), 3800);
    while (this.feedEl.children.length > 5) this.feedEl.firstElementChild?.remove();
  }

  lapTime(text: string, best: boolean): void {
    this.flash(`LAP ${text}${best ? '  ★ BEST' : ''}`, best ? '#ffd23f' : '#ffffff', 2200);
  }

  checkpointPing(): void {
    this.lap.classList.remove('ping');
    void this.lap.offsetWidth;
    this.lap.classList.add('ping');
  }

  setWrongWay(on: boolean): void {
    this.wrongWay.classList.toggle('show', on);
  }

  setRespawn(t: number | null): void {
    if (t === null) {
      this.respawn.classList.remove('show');
      return;
    }
    this.respawn.classList.add('show');
    this.setText('respawn', this.respawn, `RESPAWNING <b>${t.toFixed(1)}</b>`);
  }

  setHint(text: string | null): void {
    this.hint.textContent = text ?? '';
    this.hint.classList.toggle('show', !!text);
  }

  damageFlash(intensity: number): void {
    this.vignette.style.opacity = String(0.25 + 0.6 * intensity);
    this.vignette.classList.remove('fade');
    void this.vignette.offsetWidth;
    this.vignette.classList.add('fade');
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? '' : 'none';
  }

  // ------------------------------------------------------------ per-frame
  update(dt: number, player: Car, race: RaceManager, cars: Car[]): void {
    if (this.announceTimer > 0) {
      this.announceTimer -= dt;
      if (this.announceTimer <= 0) this.center.classList.remove('show');
    }
    if (this.subTimer > 0) {
      this.subTimer -= dt;
      if (this.subTimer <= 0) this.sub.classList.remove('show');
    }

    const pos = race.positionOf(player);
    this.setText('pos', this.pos, String(pos));
    this.setText('suf', this.posSuffix, `${ORD[pos] ?? 'th'}<small>/${cars.length}</small>`);
    const lap = race.currentLap(player);
    this.setText('lap', this.lap, player.race.finished ? 'FINISHED' : `LAP <b>${lap}</b>/${race.laps}`);
    const rt = race.phase === 'countdown' ? 0 : player.race.finished ? player.race.finishTime : race.raceTime;
    this.setText('rt', this.raceTime, `<span>TIME</span> ${formatTime(rt * 1000)}`);
    const lt = race.phase === 'countdown' || player.race.finished ? 0 : race.raceTime - player.race.lapStart;
    this.setText('lt', this.lapTimeEl, `<span>LAP</span> ${formatTime(lt * 1000)}`);
    const best = player.race.lapTimes.length ? Math.min(...player.race.lapTimes) : 0;
    this.setText('bl', this.bestLap, `<span>BEST</span> ${formatTime(best * 1000)}`);

    race.standings.forEach((c, i) => {
      const row = this.boardRows[i];
      if (!row) return;
      const gap = i === 0 || c.race.finished ? '' : this.gapText(race.standings[0], c);
      const html = `<span class="n">${i + 1}</span><span class="dot" style="background:${hex(c.stats.color)}"></span><span class="name">${c.name}</span><span class="gap">${c.race.finished ? '🏁' : gap}</span>`;
      this.setText(`row${i}`, row, html);
      row.classList.toggle('me', c.isPlayer);
      row.classList.toggle('dead', !c.alive);
    });

    this.setBar(this.hp, player.hp / player.maxHp, `${Math.ceil(player.hp)}`);
    this.setBar(this.energy, player.energy / player.maxEnergy, `${Math.floor(player.energy)}`);
    this.setBar(this.boost, player.boostMeter / 100, `${Math.floor(player.boostMeter)}`);
    this.hp.fill.classList.toggle('low', player.hp / player.maxHp < 0.3);
    this.boost.fill.classList.toggle('active', player.boosting);

    const lvl = player.drifting ? player.driftLevel : 0;
    this.drift.classList.toggle('active', player.drifting);
    this.driftPips.forEach((p, i) => {
      let fill = 0;
      if (player.drifting) {
        const t0 = i === 0 ? 0 : DRIFT_LEVELS[i - 1].time;
        const t1 = DRIFT_LEVELS[i].time;
        fill = Math.max(0, Math.min(1, (player.driftTime - t0) / (t1 - t0)));
      }
      p.style.setProperty('--f', fill.toFixed(3));
      p.classList.toggle('on', i < lvl);
    });

    const status: string[] = [];
    if (player.shieldTime > 0) status.push('<span class="st shield">SHIELD</span>');
    if (player.empTime > 0) status.push('<span class="st emp">JAMMED</span>');
    if (player.nitroTime > 0) status.push('<span class="st nitro">NITRO</span>');
    if (player.ghostTime > 0 && player.alive) status.push('<span class="st ghost">GHOST</span>');
    if (player.frozenTime > 0) status.push(`<span class="st ghost">RESET ${player.frozenTime.toFixed(1)}</span>`);
    this.setText('status', this.status, status.join(''));

    this.updateSlot('p', this.primary, player.primary.name, player.primary.cooldownRatio, player.energy >= player.primary.stats.energyCost, `${player.primary.stats.energyCost} EN`, player);
    this.updateSlot('s', this.secondary, player.secondary.name, player.secondary.cooldownRatio, player.energy >= player.secondary.stats.energyCost, `${player.secondary.stats.energyCost} EN`, player);
    this.updateSlot('a', this.ability, player.abilityName, player.ability.cooldownRatio, player.energy >= player.ability.info.energyCost, `${player.ability.info.energyCost} EN`, player);

    this.setText('spd', this.speed, `${Math.round(player.speed * 0.36)}<small>KM/H</small>`);

    this.miniTimer -= dt;
    if (this.miniTimer <= 0) {
      this.miniTimer = 1 / 20;
      this.drawMinimap(cars);
    }
  }

  private gapText(leader: Car, c: Car): string {
    const d = leader.race.progress - c.race.progress;
    const secs = d / Math.max(250, leader.speed);
    return `+${secs.toFixed(1)}`;
  }

  private setBar(b: Bar, ratio: number, text: string): void {
    b.fill.style.transform = `scaleX(${Math.max(0, Math.min(1, ratio)).toFixed(3)})`;
    if (b.text.textContent !== text) b.text.textContent = text;
  }

  private updateSlot(key: string, s: Slot, name: string, cd: number, affordable: boolean, cost: string, player: Car): void {
    this.setText(`${key}n`, s.info, `<b>${name}</b><span>${cost}</span>`);
    s.cd.style.transform = `scaleX(${Math.max(0, Math.min(1, cd)).toFixed(3)})`;
    const jammed = player.empTime > 0 || !player.alive;
    s.root.classList.toggle('ready', cd <= 0 && affordable && !jammed);
    s.root.classList.toggle('noenergy', !affordable);
    s.root.classList.toggle('jammed', jammed);
  }

  private drawMinimap(cars: Car[]): void {
    const g = this.miniCtx;
    g.clearRect(0, 0, this.mini.width, this.mini.height);
    g.drawImage(this.miniBg, 0, 0);
    const pad = 10;
    for (const c of cars) {
      const x = pad + c.x * this.miniScale;
      const y = pad + c.y * this.miniScale;
      g.beginPath();
      g.arc(x, y, c.isPlayer ? 5 : 4, 0, Math.PI * 2);
      g.fillStyle = c.alive ? hex(c.stats.color) : '#555';
      g.fill();
      if (c.isPlayer) {
        g.lineWidth = 2;
        g.strokeStyle = '#fff';
        g.stroke();
      }
    }
  }

  destroy(): void {
    this.root.remove();
  }
}
