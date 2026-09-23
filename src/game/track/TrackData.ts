/**
 * INDUSTRIAL DISTRICT – hand-authored layout.
 * Control points are [x, y, halfWidth] in world pixels, listed in driving order.
 * The main loop is closed; the shortcut connects two points of the main loop.
 */
export type ControlPoint = [number, number, number];

export interface ObstacleDef {
  kind: 'container' | 'barrel' | 'explosive';
  x: number;
  y: number;
  /** containers only */
  w?: number;
  h?: number;
  angle?: number;
}

export interface PickupDef {
  kind: 'energy' | 'boost' | 'repair';
  x: number;
  y: number;
}

export interface TrackDef {
  name: string;
  worldWidth: number;
  worldHeight: number;
  main: ControlPoint[];
  shortcut: ControlPoint[];
  /** approximate start line position – the main loop is re-indexed so s = 0 lies here */
  start: [number, number];
  checkpointCount: number;
  obstacles: ObstacleDef[];
  pickups: PickupDef[];
}

export const INDUSTRIAL_DISTRICT: TrackDef = {
  name: 'INDUSTRIAL DISTRICT',
  worldWidth: 7900,
  worldHeight: 5600,
  start: [2250, 4920],
  checkpointCount: 14,
  main: [
    // bottom main straight, heading east
    [1500, 4930, 178],
    [2600, 4940, 189],
    [3600, 4930, 182],
    // the big drift corner: one constant-radius ~110° left-hander
    [5300, 5000, 178],
    [6028, 5061, 176],
    [6418, 5078, 173],
    [6748, 4868, 170],
    [6890, 4563, 170],
    [6905, 4000, 170],
    [6910, 2600, 170],
    // back straight north
    [6910, 1420, 165],
    // tight hairpin
    [6830, 860, 151],
    [6600, 600, 146],
    [6340, 650, 146],
    [6220, 950, 148],
    [6190, 1420, 154],
    [5960, 1860, 157],
    // chicane heading west
    [5340, 2250, 151],
    [4000, 2420, 143],
    [3640, 2060, 138],
    [3250, 2430, 138],
    [2850, 2100, 143],
    [2400, 2250, 155],
    // sharp junction – shortcut splits off here
    [1990, 2040, 151],
    // north-west detour loop
    [2020, 1460, 157],
    [1790, 990, 157],
    [1300, 800, 157],
    [800, 950, 157],
    [600, 1450, 157],
    // shortcut re-joins here
    [610, 2080, 159],
    // west side going south
    [650, 2900, 165],
    [720, 4180, 170],
    [960, 4730, 176],
  ],
  // narrow, twisty risk/reward cut across the industrial yard
  shortcut: [
    [1990, 2040, 102],
    [1660, 2120, 84],
    [1320, 1985, 81],
    [960, 2135, 84],
    [610, 2080, 102],
  ],
  obstacles: [
    // container island splitting the back straight
    { kind: 'container', x: 6940, y: 1880, w: 150, h: 46, angle: -1.55 },
    // drift corner exit – barrels on the outside wall punish running wide
    { kind: 'barrel', x: 7000, y: 4200 },
    { kind: 'barrel', x: 6995, y: 4235 },
    // bottom straight – barrels on the edges
    { kind: 'barrel', x: 3150, y: 4820 },
    { kind: 'barrel', x: 3185, y: 4835 },
    { kind: 'explosive', x: 3170, y: 5045 },
    // hairpin exit barrels
    { kind: 'barrel', x: 6280, y: 1250 },
    { kind: 'barrel', x: 6295, y: 1285 },
    { kind: 'explosive', x: 6100, y: 1150 },
    // chicane
    { kind: 'explosive', x: 3650, y: 2215 },
    { kind: 'barrel', x: 3230, y: 2340 },
    { kind: 'barrel', x: 3262, y: 2300 },
    { kind: 'explosive', x: 2860, y: 2250 },
    // shortcut hazards
    { kind: 'explosive', x: 1660, y: 2150 },
    { kind: 'barrel', x: 1330, y: 1960 },
    { kind: 'explosive', x: 960, y: 2110 },
    // NW loop
    { kind: 'container', x: 1310, y: 880, w: 110, h: 40, angle: 0.2 },
    { kind: 'barrel', x: 700, y: 1230 },
    { kind: 'barrel', x: 720, y: 1265 },
    // west side
    { kind: 'explosive', x: 560, y: 2700 },
    { kind: 'barrel', x: 790, y: 3300 },
    { kind: 'barrel', x: 760, y: 3820 },
  ],
  pickups: [
    { kind: 'energy', x: 2950, y: 4860 },
    { kind: 'boost', x: 2950, y: 4940 },
    { kind: 'repair', x: 2950, y: 5020 },
    { kind: 'boost', x: 6910, y: 1300 },
    { kind: 'energy', x: 6170, y: 1600 },
    { kind: 'repair', x: 1330, y: 1995 },
    { kind: 'energy', x: 2050, y: 1600 },
    { kind: 'boost', x: 1300, y: 740 },
    { kind: 'repair', x: 690, y: 3100 },
    { kind: 'energy', x: 6900, y: 3200 },
  ],
};
