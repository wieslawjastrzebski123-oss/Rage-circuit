"""
Seamless PBR surface textures for the track (asphalt, concrete, yard slabs, grass, gravel, corrugated steel).

Procedural noise comes from Blender's shader nodes (baked with Cycles on seamless 4D torus
coordinates); layers are combined into colour / normal / ORM maps with numpy.
ORM packs ambient occlusion (R), roughness (G) and metalness (B), the layout three.js expects.

    npm run art:textures              # all materials
    npm run art:textures -- asphalt   # just one
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from common import (bake_layers, blur, cavity, mix, normal_from_height, reset_scene, save, smooth, srgb)  # noqa: E402


def write(name, color, height, rough, strength, metal=0.0, ao_sigma=3.0, ao_k=6.0, extra_ao=None):
    ao = cavity(height, ao_sigma, ao_k)
    if extra_ao is not None:
        ao = ao * extra_ao
    save(f'tex/{name}_color', color, quality=86, color=True)
    save(f'tex/{name}_normal', normal_from_height(height, strength), quality=90)
    orm = np.stack([ao, np.clip(rough, 0.04, 1), np.full_like(ao, metal) if np.isscalar(metal) else metal], axis=2)
    save(f'tex/{name}_orm', orm, quality=88)


# tile sizes (world units) are set by the game: asphalt 320, concrete 110, yard 600, grass 200, gravel 150

def asphalt(S=1024):
    # fine aggregate, stone tint, large mottling
    agg, stone, mottle = bake_layers(S, lambda N: (
        N.voronoi(420, 420, 1, feature='SMOOTH_F1'),
        N.voronoi(420, 420, 1, out='Random'),
        N.noise(5, 5, 2, detail=6, rough=0.6),
    )).transpose(2, 0, 1)
    grain, cracks, crack_mask = bake_layers(S, lambda N: (
        N.noise(900, 900, 3, detail=2, rough=0.5),
        N.voronoi(3, 3, 4, feature='DISTANCE_TO_EDGE', warp=0.35, warp_scale=3.0),
        N.noise(3, 3, 5, detail=3),
    )).transpose(2, 0, 1)
    patch, wear = bake_layers(S, lambda N: (
        N.noise(2.2, 2.2, 6, detail=5, rough=0.5, distortion=0.4),
        N.noise(14, 3, 7, detail=4),
    )).transpose(2, 0, 1)[:2]

    base = mix(srgb(0x353638), srgb(0x47474a), smooth(0.3, 0.7, mottle))
    # exposed stones: light grey / warm grey specks
    stones = smooth(0.62, 0.9, stone) * smooth(0.55, 0.2, agg)
    col = mix(base, mix(srgb(0x6b6a66), srgb(0x857c70), stone), stones * 0.55)
    col = col * (0.9 + 0.2 * grain[:, :, None])
    # darker, smoother resurfaced patches
    pm = smooth(0.58, 0.62, patch)
    col = mix(col, col * 0.78, pm)
    # tar-sealed cracks (only in some places)
    cr = smooth(0.005, 0.0015, cracks) * smooth(0.58, 0.63, crack_mask)
    col = mix(col, srgb(0x1b1c1e), cr * 0.85)
    # faint lighter streaks along the direction of travel (worn, polished)
    col = col * (1 + 0.08 * smooth(0.55, 0.75, wear)[:, :, None])

    h = (1 - agg) * 0.6 * (1 - pm * 0.6) + grain * 0.25 - cr * 0.4
    rough = 0.9 - 0.08 * stones - 0.1 * pm - 0.3 * cr - 0.06 * smooth(0.55, 0.75, wear)
    write('asphalt', col, h, rough, strength=5.0, ao_sigma=2.0, ao_k=3.0)


def concrete(S=1024):
    # tile: 110 units wide (≈9.5 m); walls use the bottom 20% vertically
    mottle, pores, streak = bake_layers(S, lambda N: (
        N.noise(6, 6, 11, detail=6, rough=0.6),
        N.noise(700, 700, 12, detail=2),
        N.noise(40, 2.5, 13, detail=4, rough=0.6),
    )).transpose(2, 0, 1)
    pits, chips, stain = bake_layers(S, lambda N: (
        N.voronoi(160, 160, 14, feature='F1'),
        N.noise(9, 9, 15, detail=5, distortion=0.6),
        N.noise(3, 3, 16, detail=4),
    )).transpose(2, 0, 1)

    col = mix(srgb(0x9d9b95), srgb(0xb9b6ae), smooth(0.3, 0.7, mottle))
    col = col * (0.93 + 0.12 * pores[:, :, None])
    # vertical rain streaks
    st = smooth(0.52, 0.72, streak)
    col = mix(col, col * 0.72, st * 0.6)
    col = mix(col, col * np.array([0.9, 0.86, 0.78]), smooth(0.55, 0.75, stain) * 0.5)
    # small air pits
    pit = smooth(0.08, 0.03, pits)
    col = mix(col, col * 0.55, pit)
    # block joints every third of the tile
    u = (np.arange(S) + 0.5) / S
    joint = np.zeros(S)
    for k in range(3):
        d = np.abs(u - (k / 3 + 1 / 6)) * S
        joint = np.maximum(joint, smooth(3.0, 1.0, d))
    joint = np.broadcast_to(joint[None, :], (S, S))
    col = mix(col, col * 0.45, joint)
    # chipped edges near joints
    chip = smooth(0.62, 0.7, chips) * np.broadcast_to(smooth(14, 4, np.min([np.abs(u - (k / 3 + 1 / 6)) * S for k in range(3)], axis=0))[None, :], (S, S))
    col = mix(col, col * 0.8, chip)

    h = mottle * 0.3 + pores * 0.3 - pit * 0.6 - joint * 1.2 - chip * 0.5
    rough = 0.9 + 0.05 * pores - 0.12 * st
    write('concrete', col, h, rough, strength=4.0, ao_sigma=2.5, ao_k=4.0)


def yard(S=1024):
    # 600-unit tile (≈52 m) of weathered industrial concrete: saw-cut joints every ~13 m, dust, oil and tyre grime
    mottle, grit, stain = bake_layers(S, lambda N: (
        N.noise(7, 7, 21, detail=6, rough=0.6),
        N.noise(800, 800, 22, detail=2),
        N.noise(3, 3, 23, detail=6, rough=0.6, distortion=0.5),
    )).transpose(2, 0, 1)
    cracks, crack_mask, wob = bake_layers(S, lambda N: (
        N.voronoi(7, 7, 24, feature='DISTANCE_TO_EDGE', warp=0.3, warp_scale=3.0),
        N.noise(4, 4, 25, detail=3),
        N.noise(60, 60, 26, detail=3),
    )).transpose(2, 0, 1)
    dust, streak, spots = bake_layers(S, lambda N: (
        N.noise(12, 12, 27, detail=6, rough=0.65),
        N.noise(3, 18, 28, detail=4),
        N.voronoi(40, 40, 29, feature='F1'),
    )).transpose(2, 0, 1)

    n = 4
    yy, xx = np.mgrid[0:S, 0:S] + 0.5
    cell = S / n
    sx = np.abs(((xx + (wob - 0.5) * 1.5) % cell) - cell / 2)
    sy = np.abs(((yy + (wob - 0.5) * 1.5) % cell) - cell / 2)
    seam = smooth(1.0, 0.2, np.minimum(cell / 2 - sx, cell / 2 - sy))
    rng = np.random.default_rng(7)
    tone = rng.uniform(-1, 1, (n, n))
    slab_tone = tone[(yy // cell).astype(int) % n, (xx // cell).astype(int) % n]

    col = mix(srgb(0x6e6b65), srgb(0x88847c), smooth(0.25, 0.75, mottle))
    col = col * (1 + 0.035 * slab_tone[:, :, None]) * (0.9 + 0.16 * grit[:, :, None])
    # pale dust drifts and darker grime
    col = mix(col, srgb(0x9a9284), smooth(0.55, 0.8, dust) * 0.35)
    col = col * (1 - 0.18 * smooth(0.5, 0.75, streak)[:, :, None])
    stn = smooth(0.6, 0.75, stain)
    col = mix(col, col * 0.6, stn * 0.7)
    # small oil drips
    drip = smooth(0.12, 0.05, spots) * smooth(0.55, 0.65, stain + 0.1)
    col = mix(col, col * 0.5, drip * 0.6)
    cr = smooth(0.008, 0.003, cracks) * smooth(0.6, 0.66, crack_mask)
    col = mix(col, col * 0.55, cr * 0.8)
    col = mix(col, col * 0.8, seam)

    h = grit * 0.3 + mottle * 0.2 - seam * 0.5 - cr * 0.4
    rough = 0.92 - 0.3 * stn - 0.2 * drip + 0.04 * grit
    write('yard', col, h, rough, strength=3.0, ao_sigma=2.5, ao_k=3.0)


def grass(S=1024):
    blades, clumps, dry = bake_layers(S, lambda N: (
        N.noise(900, 900, 31, detail=3, rough=0.7),
        N.voronoi(180, 180, 32, feature='F1'),
        N.noise(4, 4, 33, detail=5, rough=0.55),
    )).transpose(2, 0, 1)
    dirt, tint, fine = bake_layers(S, lambda N: (
        N.noise(6, 6, 34, detail=5, distortion=0.8),
        N.voronoi(180, 180, 32, out='Random'),
        N.noise(1800, 1800, 35, detail=1),
    )).transpose(2, 0, 1)

    green = mix(srgb(0x3f5a2a), srgb(0x5d7a36), tint)
    col = mix(green, srgb(0x8c8a4a), smooth(0.55, 0.75, dry) * 0.7)
    tuft = smooth(0.7, 0.2, clumps)
    col = col * (0.55 + 0.6 * tuft[:, :, None]) * (0.8 + 0.4 * blades[:, :, None]) * (0.9 + 0.2 * fine[:, :, None])
    bare = smooth(0.66, 0.74, dirt)
    col = mix(col, srgb(0x5b4a36) * (0.8 + 0.4 * fine[:, :, None]), bare)

    h = tuft * 0.5 + blades * 0.4 + fine * 0.2 - bare * 0.3
    rough = 0.85 + 0.1 * bare
    write('grass', col, h, rough, strength=5.0, ao_sigma=2.0, ao_k=3.0)


def gravel(S=1024):
    big, big_c, big_r = bake_layers(S, lambda N: (
        N.voronoi(190, 190, 41, feature='F1'),
        N.voronoi(190, 190, 41, feature='DISTANCE_TO_EDGE'),
        N.voronoi(190, 190, 41, out='Random'),
    )).transpose(2, 0, 1)
    small, small_r, mottle = bake_layers(S, lambda N: (
        N.voronoi(420, 420, 42, feature='F1'),
        N.voronoi(420, 420, 42, out='Random'),
        N.noise(5, 5, 43, detail=5),
    )).transpose(2, 0, 1)

    dome_big = np.sqrt(np.clip(1 - (big / 0.62) ** 2, 0, 1)) * smooth(0.0, 0.08, big_c)
    dome_small = np.sqrt(np.clip(1 - (small / 0.62) ** 2, 0, 1))
    h = np.maximum(dome_big, dome_small * 0.55)
    use_big = dome_big > dome_small * 0.55
    rnd = np.where(use_big, big_r, small_r)
    stone = mix(mix(srgb(0x8f8574), srgb(0xb5ab98), rnd), srgb(0x6e6a64), smooth(0.8, 0.95, rnd))
    col = stone * (0.55 + 0.45 * h[:, :, None]) * (0.9 + 0.2 * mottle[:, :, None])
    rough = 0.8 + 0.12 * (1 - h)
    write('gravel', col, h, rough, strength=7.0, ao_sigma=2.0, ao_k=5.0)


def corrugated(S=512):
    # shipping-container steel: 16 vertical corrugations per tile (U runs along the container)
    rust, dirt, scratch = bake_layers(S, lambda N: (
        N.noise(6, 6, 51, detail=6, rough=0.65, distortion=0.4),
        N.noise(12, 1.5, 52, detail=4),
        N.noise(120, 6, 53, detail=2),
    )).transpose(2, 0, 1)
    u = (np.arange(S) + 0.5) / S
    wave = np.broadcast_to((0.5 + 0.5 * np.sign(np.sin(u * 2 * np.pi * 16)) * np.abs(np.sin(u * 2 * np.pi * 16)) ** 0.5)[None, :], (S, S))
    # the paint is near-white so each instance's colour tints it
    col = np.ones((S, S, 3)) * srgb(0xe6e6e4)
    rs = smooth(0.62, 0.78, rust)
    col = mix(col, srgb(0x7a4a2e), rs * 0.85)
    col = col * (1 - 0.3 * smooth(0.5, 0.8, dirt)[:, :, None])
    sc = smooth(0.7, 0.8, scratch)
    col = mix(col, srgb(0x9a9a98), sc * 0.4)
    h = wave * 1.0 - rs * 0.1
    rough = 0.5 + 0.35 * rs + 0.1 * smooth(0.5, 0.8, dirt) - 0.1 * sc
    metal = 0.3 * (1 - rs)
    write('corrugated', col, h, rough, strength=2.0, metal=metal, ao_sigma=4.0, ao_k=1.0)


RECIPES = {'asphalt': asphalt, 'concrete': concrete, 'yard': yard, 'grass': grass, 'gravel': gravel, 'corrugated': corrugated}

if __name__ == '__main__':
    reset_scene()
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    for name in argv or RECIPES:
        print('==', name)
        RECIPES[name]()
