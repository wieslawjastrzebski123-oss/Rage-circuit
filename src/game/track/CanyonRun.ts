import type { TrackDef } from './TrackData';

/**
 * CANYON RUN – a wide desert circuit at sunset.
 * Long straights (room to fight side by side) with a kicker on three of them, sweeping corners,
 * an S through a sandstone canyon and a narrow shortcut with a forced big jump.
 * Control points are [x, y, halfWidth] in driving order, like the Industrial District.
 */
export const CANYON_RUN: TrackDef = {
  id: 'canyon',
  name: 'CANYON RUN',
  tagline: 'Wide open desert, big jumps and a canyon shortcut.',
  theme: 'desert',
  worldWidth: 7800,
  worldHeight: 7000,
  start: [2100, 6310],
  checkpointCount: 16,
  main: [
    // start / finish straight, heading east – jump #1
    [1500, 6300, 250],
    [2600, 6320, 262],
    [3800, 6310, 262],
    [4900, 6270, 256],
    // long left-hand sweeper up the east side
    [5900, 6110, 250],
    [6650, 5620, 245],
    [7020, 4820, 242],
    // east straight, heading north – jump #2
    [7100, 3800, 242],
    [7090, 2700, 242],
    // north-east sweeper
    [6950, 1800, 240],
    [6450, 1150, 242],
    [5600, 860, 248],
    // top straight, heading west – jump #3 flies you through the stone arch
    [4500, 800, 252],
    [3400, 820, 250],
    // the canyon: an S between sandstone walls
    [2500, 950, 222],
    [1900, 1450, 205],
    [1800, 2200, 202],
    [2300, 2900, 202],
    [2200, 3700, 208],
    [1500, 4300, 218],
    // west sweeper back to the start
    [1000, 5000, 236],
    [1000, 5700, 246],
  ],
  // narrow cut down the middle of the mesa field; its big jump can't be avoided
  shortcut: [
    [3400, 820, 130],
    [3200, 1500, 128],
    [3050, 2300, 128],
    [2900, 3100, 128],
    [2200, 3700, 130],
  ],
  jumps: [
    { x: 3500, y: 6318, angle: 0, width: 230, length: 95, height: 16 },
    { x: 7160, y: 3950, angle: -Math.PI / 2, width: 220, length: 95, height: 16 },
    { x: 5000, y: 812, angle: Math.PI, width: 240, length: 100, height: 18 },
    { x: 3160, y: 1720, angle: 1.756, width: 300, length: 110, height: 20 },
  ],
  obstacles: [
    // only three explosive barrels on the whole lap
    { kind: 'explosive', x: 2900, y: 6440 },
    { kind: 'explosive', x: 7230, y: 2350 },
    { kind: 'explosive', x: 2050, y: 1750 },
    // loose barrels to scatter
    { kind: 'barrel', x: 4300, y: 6150 },
    { kind: 'barrel', x: 4330, y: 6180 },
    { kind: 'barrel', x: 6960, y: 3150 },
    { kind: 'barrel', x: 6990, y: 3185 },
    { kind: 'barrel', x: 3800, y: 690 },
    { kind: 'barrel', x: 1250, y: 5250 },
    { kind: 'barrel', x: 1280, y: 5285 },
    { kind: 'barrel', x: 3010, y: 2700 },
    // a wrecked trailer splitting the lanes after the north-east sweeper
    { kind: 'container', x: 5700, y: 900, w: 150, h: 46, angle: -0.25 },
  ],
  pickups: [
    { kind: 'energy', x: 2800, y: 6200 },
    { kind: 'repair', x: 2800, y: 6440 },
    { kind: 'boost', x: 4150, y: 6310 },
    { kind: 'energy', x: 7040, y: 3000 },
    { kind: 'repair', x: 6600, y: 1250 },
    { kind: 'boost', x: 4150, y: 815 },
    { kind: 'repair', x: 1880, y: 2200 },
    { kind: 'energy', x: 2240, y: 3300 },
    { kind: 'boost', x: 2990, y: 2500 },
    { kind: 'energy', x: 1020, y: 5300 },
    { kind: 'hunter', x: 5300, y: 6255 },
    { kind: 'hunter', x: 1880, y: 1560 },
  ],
};
