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
  worldWidth: 7000,
  worldHeight: 5100,
  start: [2250, 4420],
  checkpointCount: 14,
  main: [
    // bottom main straight, heading east
    [1500, 4430, 132],
    [2600, 4440, 140],
    [3600, 4430, 135],
    // the big drift corner: one constant-radius ~110° left-hander
    [4400, 4500, 132],
    [5128, 4561, 130],
    [5518, 4578, 128],
    [5848, 4368, 126],
    [5990, 4063, 126],
    [6005, 3500, 126],
    [6010, 2600, 126],
    // back straight north
    [6010, 1420, 122],
    // tight hairpin
    [5930, 860, 112],
    [5700, 600, 108],
    [5440, 650, 108],
    [5320, 950, 110],
    [5290, 1420, 114],
    [5060, 1860, 116],
    // chicane heading west
    [4440, 2250, 112],
    [4000, 2360, 106],
    [3640, 2110, 102],
    [3250, 2370, 102],
    [2850, 2160, 106],
    [2400, 2250, 115],
    // sharp junction – shortcut splits off here
    [1990, 2040, 112],
    // north-west detour loop
    [2020, 1460, 116],
    [1790, 990, 116],
    [1300, 800, 116],
    [800, 950, 116],
    [600, 1450, 116],
    // shortcut re-joins here
    [610, 2080, 118],
    // west side going south
    [650, 2900, 122],
    [720, 3680, 126],
    [960, 4230, 130],
  ],
  // narrow, twisty risk/reward cut across the industrial yard
  shortcut: [
    [1990, 2040, 70],
    [1660, 2120, 58],
    [1320, 1985, 56],
    [960, 2135, 58],
    [610, 2080, 70],
  ],
  obstacles: [
    // container island splitting the back straight
    { kind: 'container', x: 6040, y: 1880, w: 150, h: 46, angle: -1.55 },
    // drift corner exit – barrels on the outside wall punish running wide
    { kind: 'barrel', x: 6100, y: 3700 },
    { kind: 'barrel', x: 6095, y: 3735 },
    // bottom straight – barrels on the edges
    { kind: 'barrel', x: 3150, y: 4320 },
    { kind: 'barrel', x: 3185, y: 4335 },
    { kind: 'explosive', x: 3170, y: 4545 },
    // hairpin exit barrels
    { kind: 'barrel', x: 5380, y: 1250 },
    { kind: 'barrel', x: 5395, y: 1285 },
    { kind: 'explosive', x: 5200, y: 1150 },
    // chicane
    { kind: 'explosive', x: 3650, y: 2215 },
    { kind: 'barrel', x: 3240, y: 2270 },
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
    { kind: 'barrel', x: 760, y: 3320 },
  ],
  pickups: [
    { kind: 'energy', x: 2950, y: 4360 },
    { kind: 'boost', x: 2950, y: 4440 },
    { kind: 'repair', x: 2950, y: 4520 },
    { kind: 'boost', x: 6010, y: 1300 },
    { kind: 'energy', x: 5270, y: 1600 },
    { kind: 'repair', x: 1330, y: 1995 },
    { kind: 'energy', x: 2050, y: 1600 },
    { kind: 'boost', x: 1300, y: 740 },
    { kind: 'repair', x: 690, y: 3100 },
    { kind: 'energy', x: 6000, y: 3200 },
  ],
};
