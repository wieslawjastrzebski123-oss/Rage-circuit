/**
 * Headless check of client-side prediction: connects like a browser, drives with
 * scripted inputs at exactly 60 Hz, predicts its own car with the same code the
 * browser uses and reports how far the server's corrections move it.
 * Usage: npm run server  (in another terminal), then  npx tsx scripts/prediction-test.ts
 */
import WebSocket from 'ws';
import { createAbility } from '../src/game/abilities';
import { CARS } from '../src/game/data/cars';
import { Car } from '../src/game/entities/Car';
import { CF_ALIVE, CF_BOOSTING, CF_DRIFT, SUBSTEPS, TICK_RATE, encodeInput, type ServerMsg, type Snapshot } from '../src/game/net/protocol';
import { CollisionSystem } from '../src/game/systems/CollisionSystem';
import type { World } from '../src/game/systems/World';
import { Track } from '../src/game/track/Track';
import { INDUSTRIAL_DISTRICT } from '../src/game/track/TrackData';
import { createWeapon } from '../src/game/weapons';

const url = process.env.SERVER ?? 'ws://localhost:8787';
const mute = new Proxy({}, { get: () => () => undefined });
const track = new Track(INDUSTRIAL_DISTRICT);
const pw: World = {
  gfx: null, track, cars: [], time: 0, raceStarted: false,
  effects: mute as World['effects'], audio: mute as World['audio'],
  combat: { applyDamage: () => 0 } as unknown as World['combat'],
  collisions: null!, hud: null, player: null, view: () => null,
};
pw.collisions = new CollisionSystem(pw, track.def.obstacles);

const ws = new WebSocket(url);
let pred: Car | null = null;
let myId = 0;
let seq = 0;
const history: { seq: number; c: Car['controls'] }[] = [];
const corrections: number[] = [];
let started = false;

function simTick(p: Car) {
  const dt = 1 / TICK_RATE / SUBSTEPS;
  for (let k = 0; k < SUBSTEPS; k++) {
    p.update(dt);
    pw.collisions.resolveStatic(p);
  }
}

function reconcile(s: Snapshot) {
  const t = s.c.find((c) => c[0] === myId);
  if (!t || !s.me || !pred) return;
  const p = pred;
  const bx = p.x;
  const by = p.y;
  p.x = t[1]; p.y = t[2]; p.heading = t[3]; p.vx = t[4]; p.vy = t[5]; p.angVel = t[6]; p.bodyYaw = t[7];
  p.alive = (t[9] & CF_ALIVE) !== 0; p.drifting = (t[9] & CF_DRIFT) !== 0; p.boosting = (t[9] & CF_BOOSTING) !== 0;
  p.driftTime = t[10]; p.boostPower = t[11]; p.driftBoostTime = t[12]; p.overchargeTime = t[13];
  p.shieldTime = t[14]; p.empTime = t[15]; p.ghostTime = t[16]; p.frozenTime = t[18]; p.hp = t[19];
  p.boostMeter = s.me.boost; p.energy = s.me.energy; p.driftDir = s.me.driftDir; p.driftBoostPower = s.me.driftPower; p.rubberBand = s.me.rubber;
  while (history.length && history[0].seq <= s.me.ack) history.shift();
  for (const h of history) { Object.assign(p.controls, h.c); simTick(p); }
  if (s.ph === 1) corrections.push(Math.hypot(bx - p.x, by - p.y));
}

ws.on('open', () => ws.send(JSON.stringify({ t: 'create', v: 1, name: 'probe' })));
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString()) as ServerMsg;
  if (m.t === 'lobby' && !m.racing && !started) { started = true; ws.send(JSON.stringify({ t: 'laps', laps: 1 })); ws.send(JSON.stringify({ t: 'start' })); }
  if (m.t === 'start') {
    const mine = m.cars.find((c) => c.owner !== 0)!;
    myId = mine.id;
    pred = new Car(pw, CARS[mine.car], mine.name, true);
    pred.primary = createWeapon(mine.primary); pred.secondary = createWeapon(mine.secondary); pred.ability = createAbility(pred.stats.ability);
    pred.simCombat = false;
    // 60 Hz input loop with an accumulator (like the browser's frame loop)
    let last = performance.now(); let acc = 0;
    setInterval(() => {
      const now = performance.now(); acc += now - last; last = now;
      while (acc >= 1000 / TICK_RATE) {
        acc -= 1000 / TICK_RATE;
        const p = pred!;
        const c = p.controls;
        seq++;
        c.throttle = 1; c.steer = Math.sin(seq / 50) * 0.7; c.drift = seq % 240 > 200; c.boost = seq % 300 > 250;
        c.aimX = p.x + 100; c.aimY = p.y;
        ws.send(JSON.stringify({ t: 'in', s: seq, i: encodeInput(c) }));
        history.push({ seq, c: { ...c } });
        simTick(p);
      }
    }, 4);
  }
  if (m.t === 's') { pw.raceStarted = m.ph === 1; reconcile(m); }
});

setTimeout(() => {
  const c = corrections.slice().sort((a, b) => a - b);
  const q = (f: number) => (c[Math.floor(c.length * f)] ?? 0).toFixed(2);
  console.log(`snapshots ${c.length}: median correction ${q(0.5)}, p90 ${q(0.9)}, p99 ${q(0.99)}, max ${(c.at(-1) ?? 0).toFixed(1)} (units; car length 52)`);
  process.exit(0);
}, Number(process.env.SECONDS ?? 20) * 1000);
