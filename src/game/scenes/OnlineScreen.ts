import type { App } from '../App';
import { DEFAULT_LAPS, LAP_OPTIONS } from '../constants';
import { ABILITIES, CAR_IDS, CARS, type CarId } from '../data/cars';
import { PRIMARY_WEAPONS, SECONDARY_WEAPONS, WEAPONS, type WeaponId } from '../data/weapons';
import { NetClient } from '../net/NetClient';
import { DEFAULT_PORT, GRID_SIZE, MAX_PLAYERS, type LobbyPlayer, type ServerMsg } from '../net/protocol';
import { AudioManager } from '../systems/AudioManager';
import { button, h, hex, layer } from '../ui/dom';
import { Storage } from '../utils/storage';
import { carPreview } from './CarPreview';

/**
 * Default server: build-time setting; in local development the dev server on :8787;
 * otherwise the same host under /ws (nginx proxies it to the game server).
 */
export function defaultServerUrl(): string {
  const env = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (env) return env;
  const { hostname, host, protocol } = window.location;
  if (!hostname || hostname === 'localhost' || hostname === '127.0.0.1') return `ws://${hostname || 'localhost'}:${DEFAULT_PORT}`;
  return `${protocol === 'https:' ? 'wss' : 'ws'}://${host}/ws`;
}

/** Connect → create / join a room → lobby. */
export class OnlineScreen {
  private app: App;
  private root: HTMLElement | null = null;
  private net: NetClient | null = null;
  private players: LobbyPlayer[] = [];
  private laps = DEFAULT_LAPS;
  private racing = false;
  private error = '';

  constructor(app: App, net: NetClient | null = null) {
    this.app = app;
    if (net) {
      this.attach(net);
      this.renderLobby();
    } else this.renderConnect();
  }

  private click(): void {
    AudioManager.instance.unlock();
    AudioManager.instance.click();
  }

  private reset(cls = ''): HTMLElement {
    this.root?.remove();
    this.root = layer(`menu online ${cls}`);
    return this.root;
  }

  // ------------------------------------------------------------------ connect
  private renderConnect(busy = false): void {
    const root = this.reset();
    const panel = h('div', 'panel', undefined, root);
    h('h2', '', 'MULTIPLAYER', panel);
    h('p', 'small', `Up to ${MAX_PLAYERS} players per race – empty grid slots (${GRID_SIZE} cars) are filled with bots.`, panel);
    const prefs = Storage.getOnline(defaultServerUrl());
    const field = (label: string, value: string, placeholder: string, max = 64) => {
      const row = h('label', 'field', undefined, panel);
      h('span', '', label, row);
      const input = h('input', '', undefined, row);
      input.value = value;
      input.placeholder = placeholder;
      input.maxLength = max;
      input.spellcheck = false;
      return input;
    };
    const name = field('NICKNAME', prefs.name, 'e.g. SPEEDY', 12);
    const server = field('SERVER', prefs.server, 'wss://your-server.onrender.com');
    const code = field('ROOM CODE', '', 'to join a friend – e.g. KXQM', 4);
    code.style.textTransform = 'uppercase';
    if (this.error) h('div', 'error', this.error, panel);
    const row = h('div', 'nav', undefined, panel);
    const go = async (join: boolean) => {
      this.click();
      const nick = name.value.trim() || 'DRIVER';
      const url = server.value.trim();
      Storage.saveOnline({ name: nick, server: url });
      if (join && code.value.trim().length !== 4) {
        this.error = 'Enter the 4-letter room code.';
        this.renderConnect();
        return;
      }
      this.error = '';
      this.renderConnect(true);
      try {
        const net = await NetClient.connect(url);
        this.attach(net);
        if (join) net.join(code.value.trim(), nick);
        else net.create(nick);
      } catch (e) {
        this.error = (e as Error).message;
        this.renderConnect();
      }
    };
    const create = button(busy ? 'CONNECTING…' : 'CREATE ROOM', row, () => void go(false), 'primary');
    const join = button('JOIN', row, () => void go(true));
    create.disabled = join.disabled = busy;
    button('BACK', panel, () => {
      this.click();
      this.app.showMenu();
    });
  }

  // ------------------------------------------------------------------ lobby
  private attach(net: NetClient): void {
    this.net = net;
    net.onClose = (reason) => {
      this.net = null;
      this.error = reason;
      this.renderConnect();
    };
    net.setHandler((msg) => this.onMessage(msg));
  }

  private onMessage(msg: ServerMsg): void {
    switch (msg.t) {
      case 'error':
        this.error = msg.msg;
        if (this.players.length) this.renderLobby();
        else {
          this.net?.close();
          this.net = null;
          this.renderConnect();
        }
        break;
      case 'lobby':
        this.players = msg.players;
        this.laps = msg.laps;
        this.racing = msg.racing;
        this.error = '';
        this.renderLobby();
        break;
      case 'start':
        this.app.startNetRace(this.net!, msg);
        break;
    }
  }

  private me(): LobbyPlayer | undefined {
    return this.players.find((p) => p.id === this.net?.you);
  }

  private renderLobby(): void {
    const net = this.net;
    if (!net) return;
    const root = this.reset('lobby');
    const me = this.me();
    const top = h('div', 'lobby-head', undefined, root);
    h('div', 'code', `ROOM <b>${net.code || '····'}</b>`, top);
    h('div', 'small', 'Share this code with friends so they can join.', top);

    const grid = h('div', 'lobby-grid', undefined, root);
    // players
    const list = h('div', 'panel lobby-list', undefined, grid);
    h('h2', '', `DRIVERS ${this.players.length}/${MAX_PLAYERS}`, list);
    for (const p of this.players) {
      const car = CARS[p.car];
      h(
        'div',
        `lp ${p.id === net.you ? 'me' : ''}`,
        `<span class="dot" style="background:${hex(car.color)}"></span><b>${p.name}${p.host ? ' 👑' : ''}</b><span>${car.name} · ${WEAPONS[p.primary].name} · ${WEAPONS[p.secondary].name}</span><em class="${p.ready || p.host ? 'ok' : ''}">${p.host ? 'HOST' : p.ready ? 'READY' : 'NOT READY'}</em>`,
        list,
      );
    }
    for (let i = this.players.length; i < GRID_SIZE; i++) h('div', 'lp bot', `<span class="dot"></span><b>BOT</b><span>fills an empty slot</span>`, list);
    h('div', 'small', `Ping ${Math.round(net.rtt)} ms`, list);

    // own setup
    if (me) {
      const mine = h('div', 'panel lobby-setup', undefined, grid);
      h('h2', '', 'YOUR CAR', mine);
      const cars = h('div', 'mini-cards', undefined, mine);
      for (const id of CAR_IDS) {
        const c = CARS[id];
        const card = h('div', `mini ${me.car === id ? 'selected' : ''}`, undefined, cars);
        card.style.setProperty('--c', hex(c.color));
        const img = h('img', '', undefined, card);
        img.src = carPreview(id);
        h('b', '', c.name, card);
        h('span', '', ABILITIES[c.ability].name, card);
        card.addEventListener('click', () => this.sendLoadout({ car: id }));
      }
      const weapons = (label: string, ids: WeaponId[], key: 'primary' | 'secondary') => {
        const row = h('div', 'wrow', undefined, mine);
        h('span', '', label, row);
        for (const w of ids) {
          const b = h('button', `lap-opt ${me[key] === w ? 'selected' : ''}`, WEAPONS[w].name, row);
          b.addEventListener('click', () => this.sendLoadout({ [key]: w }));
        }
      };
      weapons('PRIMARY', PRIMARY_WEAPONS, 'primary');
      weapons('SECONDARY', SECONDARY_WEAPONS, 'secondary');
      const lapsRow = h('div', 'wrow', undefined, mine);
      h('span', '', 'LAPS', lapsRow);
      for (const n of LAP_OPTIONS) {
        const b = h('button', `lap-opt ${this.laps === n ? 'selected' : ''}`, String(n), lapsRow);
        b.disabled = !me.host;
        b.addEventListener('click', () => {
          this.click();
          net.send({ t: 'laps', laps: n });
        });
      }
    }

    if (this.error) h('div', 'error', this.error, root);
    const nav = h('div', 'nav', undefined, root);
    button('LEAVE', nav, () => {
      this.click();
      net.close();
      this.net = null;
      this.app.showMenu();
    });
    if (this.racing) h('div', 'hint-line', 'A race is running – you will see the lobby again when it ends.', nav);
    else if (me?.host) {
      const waiting = this.players.some((p) => !p.host && !p.ready);
      const start = button(waiting ? 'WAITING FOR READY…' : 'START RACE', nav, () => {
        this.click();
        net.send({ t: 'start' });
      }, 'primary big');
      start.disabled = waiting;
    } else if (me) {
      button(me.ready ? 'NOT READY' : 'READY', nav, () => {
        this.click();
        net.send({ t: 'ready', ready: !me.ready });
      }, me.ready ? '' : 'primary big');
    }
  }

  private sendLoadout(change: Partial<{ car: CarId; primary: WeaponId; secondary: WeaponId }>): void {
    const me = this.me();
    if (!me || !this.net) return;
    this.click();
    const lo = { car: me.car, primary: me.primary, secondary: me.secondary, ...change };
    this.net.send({ t: 'loadout', ...lo });
  }

  /** Hand the connection over (race starts) without closing it. */
  detach(): NetClient | null {
    const n = this.net;
    this.net = null;
    return n;
  }

  destroy(): void {
    this.root?.remove();
    // leaving the screen without handing the connection to a race closes it
    if (this.net) {
      this.net.close();
      this.net = null;
    }
  }
}
