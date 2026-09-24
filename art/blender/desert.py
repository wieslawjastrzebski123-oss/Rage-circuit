"""
Desert scenery for Canyon Run, exported to public/gfx/models/desert.glb:
mesas, buttes and a spire (sandstone cliffs over sandy talus), a natural stone arch, boulders,
saguaro cacti, an oil pumpjack in three moving parts and the giant RAGE CIRCUIT letters.

Same conventions as props.py: modelled in game axes (three.js x, y up, z), sizes in game units
(a car is 52 long), one material per part, vertex colour = baked ambient occlusion.

    npm run art:desert
"""
import math
import os
import random
import sys

import bpy
from mathutils import Vector, noise

sys.path.insert(0, os.path.dirname(__file__))
from common import PUBLIC, reset_scene  # noqa: E402
from mesh import TAU, Builder, bake_vertex_ao  # noqa: E402

ROCK_TILE = 600  # world units per sandstone texture tile (strata 5–27 units thick)
SAND_TILE = 400


def periodic(seed, terms=8, falloff=1.2):
    """A smooth random function of an angle (wraps at 2π)."""
    rng = random.Random(seed)
    parts = [(k, rng.uniform(0, TAU), rng.uniform(0.3, 1.0) / k ** falloff) for k in range(1, terms + 1)]
    norm = sum(a for _, _, a in parts)
    return lambda th: sum(a * math.sin(k * th + ph) for k, ph, a in parts) / norm


def finish(obj, ao_distance, samples=32):
    """Weld the face soup, point every normal outwards, bake occlusion, keep it out of later bakes."""
    bpy.ops.object.select_all(action='DESELECT')
    obj.hide_render = False
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=0.01)
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(34))
    bpy.context.scene.cycles.samples = samples
    bake_vertex_ao(obj, ao_distance)
    obj.hide_render = True
    return obj


# ================================================================ rock formations
# profile: (height fraction, radius scale, part) from the foot of the talus to the caprock
PROFILES = {
    'mesa': [(0, 1.32, 'talus'), (0.07, 1.2, 'talus'), (0.16, 1.08, 'talus'), (0.22, 1.02, 'rock'), (0.46, 1.0, 'rock'),
             (0.48, 0.97, 'rock'), (0.7, 0.96, 'rock'), (0.72, 0.935, 'rock'), (0.9, 0.93, 'rock'), (0.925, 0.975, 'rock'), (1.0, 0.965, 'rock')],
    'butte': [(0, 1.38, 'talus'), (0.1, 1.2, 'talus'), (0.2, 1.06, 'talus'), (0.27, 1.0, 'rock'), (0.55, 0.97, 'rock'),
              (0.57, 0.94, 'rock'), (0.88, 0.92, 'rock'), (0.91, 0.97, 'rock'), (1.0, 0.95, 'rock')],
    'spire': [(0, 1.7, 'talus'), (0.1, 1.35, 'talus'), (0.2, 1.08, 'talus'), (0.28, 1.0, 'rock'), (0.6, 0.86, 'rock'),
              (0.62, 0.8, 'rock'), (0.85, 0.72, 'rock'), (0.88, 0.8, 'rock'), (1.0, 0.76, 'rock')],
}


def profile_at(prof, yf):
    """Radius scale and part at a height, linear between the key rings."""
    for (y0, s0, p0), (y1, s1, _) in zip(prof, prof[1:]):
        if yf <= y1:
            t = (yf - y0) / (y1 - y0) if y1 > y0 else 0
            return s0 + (s1 - s0) * t, p0
    return prof[-1][1], prof[-1][2]


def formation(name, kind, seed, R, H, n=96):
    B = Builder()
    shape = periodic(seed, 14, 0.85)
    gully = periodic(seed + 7, 40, 0.3)
    prof = PROFILES[kind]
    # the key rings plus extra levels in between, so the cliffs can be broken up
    levels = sorted({yf for yf, _, _ in prof} | {k / 30 for k in range(31)})
    rings = []
    for yf in levels:
        sc, part = profile_at(prof, yf)
        y = H * yf
        ring = []
        for k in range(n + 1):
            th = k / n * TAU
            r = R * sc * (1 + 0.32 * shape(th))
            # vertical gullies score the cliffs; the talus is smoother
            r *= 1 - (0.07 if part == 'rock' else 0.02) * (0.5 + 0.5 * gully(th))
            # blocky erosion: 3D noise that is mostly constant along bands of height
            q = Vector((math.cos(th) * 4 + seed, math.sin(th) * 4, yf * 3))
            r *= 1 + (0.06 if part == 'rock' else 0.03) * noise.noise(q) + 0.025 * noise.noise(q * 3.1)
            ring.append((r * math.cos(th), y, -r * math.sin(th), r))
        rings.append((ring, part))
    for i in range(len(rings) - 1):
        (lo, part), (hi, _) = rings[i], rings[i + 1]
        tile = ROCK_TILE if part == 'rock' else SAND_TILE
        for k in range(n):
            a, b, c, d = lo[k], lo[k + 1], hi[k + 1], hi[k]
            uv = [(k / n * TAU * R / tile, a[1] / tile), ((k + 1) / n * TAU * R / tile, b[1] / tile),
                  ((k + 1) / n * TAU * R / tile, c[1] / tile), (k / n * TAU * R / tile, d[1] / tile)]
            B.face([a[:3], b[:3], c[:3], d[:3]], part, uv, smooth=True)
    top, _ = rings[-1]
    centre = (0, H + 3, 0)
    for k in range(n):
        a, b = top[k], top[k + 1]
        B.face([a[:3], b[:3], centre], 'talus', [(a[0] / SAND_TILE, a[2] / SAND_TILE), (b[0] / SAND_TILE, b[2] / SAND_TILE), (0, 0)])
    return finish(B.build(name), H * 0.25)


def arch(name='arch', span=1150, height=430, seed=5):
    """A natural sandstone arch: legs at x = ±span/2, the road passes along z underneath."""
    B = Builder()
    steps, sides = 44, 11
    wob = periodic(seed, 6, 1.0)
    rings = []
    for i in range(steps + 1):
        t = i / steps
        x = -span / 2 + span * t
        y = height * math.sin(math.pi * t) ** 0.7
        # tangent of the centre line
        t2 = min(1, t + 0.01)
        t1 = max(0, t - 0.01)
        dx = span * (t2 - t1)
        dy = height * (math.sin(math.pi * t2) ** 0.7 - math.sin(math.pi * t1) ** 0.7)
        tl = math.hypot(dx, dy)
        nx, ny = -dy / tl, dx / tl  # in-plane normal
        leg = 1 - math.sin(math.pi * t)  # 1 at the feet, 0 at the top
        thick = 62 + 80 * leg ** 1.5
        depth = 90 + 60 * leg ** 1.5
        ring = []
        for k in range(sides + 1):
            ph = k / sides * TAU
            bump = 1 + 0.16 * wob(ph + t * 9) + 0.14 * noise.noise(Vector((t * 7, math.cos(ph) * 2, math.sin(ph) * 2 + seed)))
            px = x + nx * thick * math.cos(ph) * bump
            py = max(-8, y + ny * thick * math.cos(ph) * bump)
            pz = depth * math.sin(ph) * bump
            ring.append((px, py, pz))
        rings.append((ring, t * span))
    for i in range(steps):
        (lo, s0), (hi, s1) = rings[i], rings[i + 1]
        for k in range(sides):
            quad = [lo[k], hi[k], hi[k + 1], lo[k + 1]]
            uv = [(s0 / ROCK_TILE, k / sides), (s1 / ROCK_TILE, k / sides), (s1 / ROCK_TILE, (k + 1) / sides), (s0 / ROCK_TILE, (k + 1) / sides)]
            B.face(quad, 'rock', uv, smooth=True)
    obj = B.build(name)
    # rubble mounds round both feet
    feet = []
    for sx in (-1, 1):
        for j in range(3):
            feet.append(boulder_mesh(f'{name}_foot{sx}{j}', seed + j * 3 + (sx > 0) * 11, 70 + j * 25, (sx * (span / 2 + 20 - j * 40), 0, (j - 1) * 110)))
    bpy.ops.object.select_all(action='DESELECT')
    for f in feet:
        f.hide_render = False
        f.select_set(True)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.join()
    return finish(obj, 150)


def boulder_mesh(name, seed, r, at=(0, 0, 0)):
    """Lumpy rock: an icosphere pushed about by noise, flattened a little and sunk into the ground."""
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=1)
    obj = bpy.context.active_object
    obj.name = name
    rng = random.Random(seed)
    sq = (rng.uniform(0.8, 1.2), rng.uniform(0.8, 1.2), rng.uniform(0.55, 0.8))  # Blender z is up
    off = Vector((seed * 1.7, seed * 0.3, seed * 2.1))
    for v in obj.data.vertices:
        p = v.co
        n = noise.noise(p * 1.6 + off) * 0.28 + noise.noise(p * 4 + off) * 0.08
        p2 = p * (1 + n)
        v.co = Vector((p2.x * sq[0], p2.y * sq[1], p2.z * sq[2] + 0.25)) * r
    # three.js (x, y, z) → Blender (x, -z, y)
    obj.location = Vector((at[0], -at[2], at[1]))
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.data.materials.append(bpy.data.materials.get('rock') or bpy.data.materials.new('rock'))
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.cube_project(cube_size=r * 2 / 1.2 if r else 1)
    bpy.ops.object.mode_set(mode='OBJECT')
    obj.data.color_attributes.new('AO', 'FLOAT_COLOR', 'CORNER')
    obj.data.color_attributes.active_color = obj.data.color_attributes['AO']
    return obj


def boulder(name, seed):
    return finish(boulder_mesh(name, seed, 1.0), 1.5)


# ================================================================ plants & machines
def ribbed(B, path, radii, mat, ribs=12, sides=24, cap=True):
    """A cactus limb: a tube along `path` with a fluted cross-section and a domed tip."""
    pts = [Vector(p) for p in path]
    rings = []
    for i, p in enumerate(pts):
        d = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        side = d.cross(Vector((1, 0, 0)) if abs(d.x) < 0.9 else Vector((0, 0, 1))).normalized()
        other = d.cross(side).normalized()
        ring = []
        for k in range(sides + 1):
            a = k / sides * TAU
            r = radii[i] * (0.9 + 0.1 * math.cos(ribs * a))
            ring.append(p + (side * math.cos(a) + other * math.sin(a)) * r)
        rings.append(ring)
    if cap:
        # dome over the tip
        tip, d = pts[-1], (pts[-1] - pts[-2]).normalized()
        for j in range(1, 4):
            f = math.cos(j / 4 * math.pi / 2)
            ring = [tip + (q - tip) * f + d * radii[-1] * math.sin(j / 4 * math.pi / 2) for q in rings[-1]]
            rings.append(ring)
        rings.append([tip + d * radii[-1]] * (sides + 1))
    for i in range(len(rings) - 1):
        for k in range(sides):
            q = [tuple(rings[i][k]), tuple(rings[i][k + 1]), tuple(rings[i + 1][k + 1]), tuple(rings[i + 1][k])]
            B.face(q, mat, [(k / sides, i / 8), ((k + 1) / sides, i / 8), ((k + 1) / sides, (i + 1) / 8), (k / sides, (i + 1) / 8)], smooth=True)


def saguaro(name, seed):
    rng = random.Random(seed)
    B = Builder()
    H = rng.uniform(70, 95)
    ribbed(B, [(0, -2, 0), (0, H * 0.5, 0), (0.6, H, 0.3)], [6.8, 6.4, 5.8], 'cactus')
    for a in range(rng.choice([1, 2, 2, 3])):
        ang = rng.uniform(0, TAU)
        dx, dz = math.cos(ang), math.sin(ang)
        y0 = rng.uniform(H * 0.3, H * 0.55)
        out = rng.uniform(11, 16)
        up = rng.uniform(18, 34)
        path = [(dx * 4, y0, dz * 4), (dx * out * 0.7, y0 + 1, dz * out * 0.7), (dx * out, y0 + 6, dz * out), (dx * out * 1.05, y0 + up, dz * out * 1.05)]
        ribbed(B, path, [4.4, 4.2, 4.1, 3.8], 'cactus')
    return finish(B.build(name), 12)


def pumpjack():
    """Base (static), walking beam (rocks about its pivot) and crank (turns) as separate objects."""
    PIVOT = (0, 44, 0)
    CRANK = (-24, 14, 0)
    base = Builder()
    base.box((0, 1.5, 0), (84, 3, 16), 'steel_dark')
    for s in (-1, 1):
        # samson post legs leaning in to the pivot
        base.tube([(-10, 3, s * 6), (0, 43, s * 1.5)], [1.1, 1.1], 6, 'steel', cap=False)
        base.tube([(10, 3, s * 6), (0, 43, s * 1.5)], [1.1, 1.1], 6, 'steel', cap=False)
    base.box((-24, 8, 0), (14, 12, 12), 'steel')  # gearbox
    base.box((-36, 7, 0), (10, 8, 9), 'steel_dark')  # motor
    base.tube([(34, 3, 0), (34, 12, 0)], [2.2, 2.2], 10, 'steel_dark')  # wellhead
    base.tube([(34, 12, 0), (34, 20, 0)], [0.5, 0.5], 6, 'steel_dark', cap=False)
    b = base.build('pumpjack_base')
    beam = Builder()
    # geometry relative to the pivot so the game can rock it about its origin
    beam.box((4, 0, 0), (66, 4.5, 3.2), 'steel')
    beam.box((0, -2.2, 0), (5, 3, 6), 'steel_dark')
    head = []
    for k in range(9):
        a = -math.pi / 2 + k / 8 * math.pi * 0.9
        head.append((37 + math.cos(a) * 9, math.sin(a) * 11, 0))
    for k in range(8):
        a0, a1 = head[k], head[k + 1]
        beam.box(((a0[0] + a1[0]) / 2, (a0[1] + a1[1]) / 2, 0), (3.2, 3.2, 5.2), 'steel')
    beam.box((-26, -6, 0), (3, 12, 3), 'steel_dark')  # pitman arm hanger
    bm = beam.build('pumpjack_beam')
    crank = Builder()
    for s in (-1, 1):
        crank.box((0, 0, s * 8.5), (22, 3, 1.5), 'steel_dark')
        crank.box((-11, 0, s * 8.5), (9, 12, 2.4), 'weight')
    cr = crank.build('pumpjack_crank')
    for o, d in ((b, 10), (bm, 10), (cr, 10)):
        finish(o, d, samples=16)
    bm['pivot'] = list(PIVOT)
    cr['pivot'] = list(CRANK)
    return b, bm, cr


def sign():
    """RAGE CIRCUIT in letters ~120 units tall, standing in the x/y plane and facing +z."""
    bpy.ops.object.text_add()
    t = bpy.context.active_object
    t.data.body = 'RAGE CIRCUIT'
    t.data.align_x = 'CENTER'
    t.data.extrude = 0.08
    t.data.bevel_depth = 0.01
    bpy.ops.object.convert(target='MESH')
    obj = bpy.context.active_object
    obj.name = 'sign'
    # Blender text lies in its XY plane; stand it up so it faces Blender -Y (= three.js +z)
    obj.rotation_euler = (math.pi / 2, 0, 0)
    obj.scale = (170, 170, 170)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.data.materials.clear()
    obj.data.materials.append(bpy.data.materials.get('sign') or bpy.data.materials.new('sign'))
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.cube_project(cube_size=100)
    bpy.ops.object.mode_set(mode='OBJECT')
    obj.data.color_attributes.new('AO', 'FLOAT_COLOR', 'CORNER')
    obj.data.color_attributes.active_color = obj.data.color_attributes['AO']
    return finish(obj, 20, samples=16)


def main():
    reset_scene()
    made = []
    made.append(formation('mesa_a', 'mesa', 3, 700, 620))
    made.append(formation('mesa_b', 'mesa', 17, 520, 480))
    made.append(formation('mesa_c', 'mesa', 29, 900, 520))
    made.append(formation('butte_a', 'butte', 41, 260, 760))
    made.append(formation('butte_b', 'butte', 53, 200, 620))
    made.append(formation('spire', 'spire', 67, 120, 820))
    made.append(arch())
    for i in range(3):
        made.append(boulder(f'boulder_{i}', 100 + i * 13))
    made.append(saguaro('saguaro_a', 7))
    made.append(saguaro('saguaro_b', 19))
    made.extend(pumpjack())
    made.append(sign())
    bpy.ops.object.select_all(action='DESELECT')
    for o in made:
        o.select_set(True)
        print(' ', o.name, 'tris', sum(len(p.vertices) - 2 for p in o.data.polygons))
    dst = os.path.join(PUBLIC, 'models', 'desert.glb')
    bpy.ops.export_scene.gltf(
        filepath=dst,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_normals=True,
        export_extras=True,
        export_materials='EXPORT',
        export_vertex_color='ACTIVE',
        export_all_vertex_colors=False,
    )
    print('wrote', dst, os.path.getsize(dst) // 1024, 'KB')


main()
