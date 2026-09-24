import { LAP_OPTIONS } from '../src/game/constants';
import { CAR_IDS } from '../src/game/data/cars';
import { PRIMARY_WEAPONS, SECONDARY_WEAPONS } from '../src/game/data/weapons';
import { MAX_PLAYERS, type ClientMsg, type LobbyPlayer, type ServerMsg } from '../src/game/net/protocol';
import type { TrackId } from '../src/game/track/TrackData';
import { isTrackId } from '../src/game/track/tracks';
import { ServerRace } from './ServerRace';

export interface Client {
  id: number;
  send(msg: ServerMsg): void;
}

/** A lobby with up to 5 players; runs one race at a time. */
export class Room {
  readonly code: string;
  private players: (LobbyPlayer & { client: Client })[] = [];
  private laps = 5;
  private track: TrackId = 'industrial';
  /** fill empty grid slots with bots */
  private bots = true;
  private race: ServerRace | null = null;
  private onEmpty: () => void;

  constructor(code: string, onEmpty: () => void) {
    this.code = code;
    this.onEmpty = onEmpty;
  }

  get size(): number {
    return this.players.length;
  }

  get racing(): boolean {
    return this.race !== null;
  }

  add(client: Client, name: string): string | null {
    if (this.players.length >= MAX_PLAYERS) return 'Room is full (max 5 players).';
    if (this.race) return 'A race is in progress – try again when it ends.';
    this.players.push({
      id: client.id,
      name,
      car: CAR_IDS[this.players.length % CAR_IDS.length],
      primary: 'machinegun',
      secondary: 'rocket',
      ready: false,
      host: this.players.length === 0,
      client,
    });
    client.send({ t: 'welcome', you: client.id, code: this.code });
    this.broadcastLobby();
    return null;
  }

  remove(clientId: number): void {
    const i = this.players.findIndex((p) => p.id === clientId);
    if (i < 0) return;
    const wasHost = this.players[i].host;
    this.players.splice(i, 1);
    this.race?.leave(clientId);
    if (this.players.length === 0) {
      this.race?.stop();
      this.race = null;
      this.onEmpty();
      return;
    }
    if (wasHost) this.players[0].host = true;
    this.broadcastLobby();
  }

  handle(clientId: number, msg: ClientMsg): void {
    const p = this.players.find((q) => q.id === clientId);
    if (!p) return;
    switch (msg.t) {
      case 'loadout':
        if (this.race) return;
        if (CAR_IDS.includes(msg.car)) p.car = msg.car;
        if (PRIMARY_WEAPONS.includes(msg.primary)) p.primary = msg.primary;
        if (SECONDARY_WEAPONS.includes(msg.secondary)) p.secondary = msg.secondary;
        this.broadcastLobby();
        break;
      case 'ready':
        if (this.race) return;
        p.ready = !!msg.ready;
        this.broadcastLobby();
        break;
      case 'laps':
        if (!p.host || this.race || !LAP_OPTIONS.includes(msg.laps)) return;
        this.laps = msg.laps;
        this.broadcastLobby();
        break;
      case 'track':
        if (!p.host || this.race || !isTrackId(msg.track)) return;
        this.track = msg.track;
        this.broadcastLobby();
        break;
      case 'bots':
        if (!p.host || this.race) return;
        this.bots = !!msg.bots;
        this.broadcastLobby();
        break;
      case 'start':
        if (!p.host || this.race) return;
        if (this.players.some((q) => !q.host && !q.ready)) {
          p.client.send({ t: 'error', msg: 'Everyone must be READY first.' });
          return;
        }
        try {
          this.startRace();
        } catch (err) {
          console.error('race start failed', err);
          this.race = null;
          p.client.send({ t: 'error', msg: 'Server error while starting the race.' });
        }
        break;
      case 'in':
        this.race?.input(clientId, msg.s, msg.i);
        break;
      case 'lobby':
        // back from the results screen
        if (this.race?.hasHuman(clientId)) this.race.leave(clientId);
        p.client.send(this.lobbyMsg());
        break;
    }
  }

  private startRace(): void {
    const racers = this.players.map(({ client: _c, ...rest }) => rest);
    const race = new ServerRace(racers, this.laps, this.track, this.bots, {
      send: (id, msg) => this.players.find((q) => q.id === id)?.client.send(msg as ServerMsg),
      onOver: () => {
        this.race = null;
        for (const q of this.players) {
          q.ready = false;
          q.client.send({ t: 'raceOver' });
        }
        this.broadcastLobby();
      },
    });
    this.race = race;
    for (const q of this.players) q.client.send({ t: 'start', laps: this.laps, track: this.track, cars: race.setup });
    race.start();
    this.broadcastLobby();
  }

  private lobbyMsg(): ServerMsg {
    return {
      t: 'lobby',
      players: this.players.map(({ client: _c, ...rest }) => rest),
      laps: this.laps,
      track: this.track,
      bots: this.bots,
      racing: this.race !== null,
    };
  }

  private broadcastLobby(): void {
    const msg = this.lobbyMsg();
    for (const p of this.players) p.client.send(msg);
  }
}
