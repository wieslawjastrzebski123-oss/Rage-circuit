"""
The four cars, modelled in Blender and exported to public/gfx/models/cars.glb.

Each body is lofted from ~50 smooth cross-sections (a rounded lower body plus a greenhouse), then
Blender cuts the wheel arches, details are added (lights, mirrors, wings, bull bar…) and ambient
occlusion is baked into the vertex colours. A shared wheel (tyre + spoked rim) and turret are exported
alongside. Game axes (three.js): +x forward, +y up, +z right; a car is 52 long and 28 wide.

Every body carries glTF extras the game reads: roofY, hoodY, frontX, rearX, exhaustY.

    npm run art:cars              # export
    npm run art:cars -- preview   # also render a contact sheet to art/.cache/cars_preview.png
"""
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(__file__))
from common import PUBLIC, TMP, reset_scene  # noqa: E402
from mesh import TAU, Builder, bake_vertex_ao, to_b  # noqa: E402

WHEEL_X = 14.0
WHEEL_R = 5.5


def from_b(p):
    """Blender (x, y, z) → three (x, y, z)"""
    return (p[0], p[2], -p[1])


def curve(ctrl, x):
    """Catmull-Rom through [(x, y), ...], clamped at the ends."""
    xs = [c[0] for c in ctrl]
    if x <= xs[0]:
        return ctrl[0][1]
    if x >= xs[-1]:
        return ctrl[-1][1]
    i = max(k for k in range(len(xs) - 1) if xs[k] <= x)
    p0 = ctrl[max(i - 1, 0)][1]
    p1, p2 = ctrl[i][1], ctrl[i + 1][1]
    p3 = ctrl[min(i + 2, len(ctrl) - 1)][1]
    t = (x - xs[i]) / (xs[i + 1] - xs[i])
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3)


def spow(v, e):
    return math.copysign(abs(v) ** e, v)


# ================================================================ car specs
SPECS = {
    # low mid-engined supercar: sculpted fenders over a low nose, fastback cabin, rear wing
    'viper': dict(
        W=13.6, pf=2.4, pr=5.0, bottom=3.0, n=2.6, m=2.6, cw=0.64, arch=6.7, track=11.6,
        belt=[(-26, 10.4), (-20, 11.8), (-10, 12.2), (0, 11.6), (10, 10.2), (18, 8.6), (26, 5.6)],
        fender=(3.8, 0.8, 7.0),
        cabin=[(-15, 0), (-10.5, 3.6), (-4, 5.0), (2, 4.8), (8, 2.4), (12, 0)],
        glass=lambda x, k, ch: ch > 1.0 and (k < 0.62 or x > 2.5 or x < -9.5),
        stripe=2.3,
    ),
    # armoured off-roader: slab sides, upright glasshouse, bull bar and roof rack
    'rhino': dict(
        W=14.2, pf=10, pr=12, bottom=4.6, n=9, m=7, cw=0.9, arch=6.9, track=12.4, flare=0.9,
        belt=[(-26, 14.8), (-10, 15.2), (10, 15.2), (18, 14.8), (23, 14.0), (26, 12.0)],
        fender=(0.0, 0.5, 7.0),
        cabin=[(-24.6, 0), (-23.8, 8.0), (4, 8.2), (8, 7.0), (12.5, 0)],
        glass=lambda x, k, ch: ch > 1.5 and (k < 0.7 or x > 5.2 or x < -23.0),
        stripe=0,
    ),
    # sleek prototype: pointed nose, wheel pods, narrow bubble canopy, twin fins
    'spectre': dict(
        W=13.0, pf=1.7, pr=4.5, bottom=2.8, n=2.2, m=2.0, cw=0.42, arch=6.5, track=11.2,
        belt=[(-26, 9.4), (-18, 10.6), (-8, 10.2), (4, 9.0), (14, 8.0), (26, 3.8)],
        fender=(5.2, 0.4, 6.5),
        cabin=[(-13, 0), (-8, 4.2), (-2, 5.4), (4, 4.4), (10, 0)],
        glass=lambda x, k, ch: ch > 0.5,
        stripe=0,
    ),
    # electric hatch: rounded body, tall panoramic glasshouse, light bars
    'volt': dict(
        W=13.4, pf=3.2, pr=6.0, bottom=3.4, n=3.2, m=3.2, cw=0.78, arch=6.7, track=11.6,
        belt=[(-26, 12.6), (-18, 13.4), (0, 13.2), (12, 12.2), (20, 11.0), (26, 8.0)],
        fender=(1.4, 0.6, 7.0),
        cabin=[(-23.5, 0), (-20.5, 6.0), (-12, 6.8), (-2, 6.8), (7, 3.0), (11, 0)],
        glass=lambda x, k, ch: ch > 1.0,
        stripe=0,
    ),
}

NL = 11  # lower-body points per half section
NC = 8  # greenhouse points per half section
STATIONS = 54


def section(sp, x):
    """Half cross-section at x: [(z, y, part)] from the bottom centre round the right side to the roof centre."""
    L = 26.0
    u = x / L
    p = sp['pf'] if u > 0 else sp['pr']
    W = sp['W']
    amp, base, sig = sp['fender']
    bulge = sum(math.exp(-(((x - xw) / sig) ** 2)) for xw in (WHEEL_X, -WHEEL_X))
    hw = W * max(1 - abs(u) ** p, 0) ** (1 / p) + sp.get('flare', 1.2) * bulge
    yb = curve(sp['belt'], x)
    fr = base + amp * bulge
    ybot = sp['bottom']
    yc, hh = (ybot + yb) / 2, (yb - ybot) / 2
    n, m = sp['n'], sp['m']
    ch = max(0.0, curve(sp['cabin'], x)) if sp['cabin'][0][0] < x < sp['cabin'][-1][0] else 0.0
    wc = hw * sp['cw']

    def lower(th):
        z = hw * spow(math.cos(th), 2 / n)
        y = yc + hh * spow(math.sin(th), 2 / n)
        if th > 0:
            y += fr * (z / hw) ** 3 if hw > 0 else 0
        return z, y

    thc = math.acos(min(1.0, (wc / hw) ** (n / 2))) if hw > 0 else 0
    pts = []
    for j in range(NL + 1):
        th = -math.pi / 2 + (thc + math.pi / 2) * j / NL
        z, y = lower(th)
        part = 'under' if th < -math.pi * 0.36 else 'body'
        pts.append((z, y, part))
    zc, yc0 = pts[-1][0], pts[-1][1]
    for k in range(1, NC + 1):
        ph = math.pi / 2 * k / NC
        z = zc * spow(math.cos(ph), 2 / m)
        y = yc0 + ch * spow(math.sin(ph), 2 / m)
        pts.append((z, y, ('cabin', (k - 0.5) / NC, ch)))
    return pts


def body_shell(name, sp):
    B = Builder()
    xs = [26 * 0.997 * math.sin(math.pi / 2 * (-1 + 2 * i / (STATIONS - 1))) for i in range(STATIONS)]
    rings = []
    for x in xs:
        half = section(sp, x)
        right = [(x, y, z) for z, y, _ in half]
        left = [(x, y, -z) for z, y, _ in half[-2:0:-1]]
        rings.append(right + left)
    K = len(rings[0])
    half_n = len(section(sp, 0))

    for i in range(STATIONS - 1):
        xm = (xs[i] + xs[i + 1]) / 2
        hs = section(sp, xm)
        for k in range(K):
            kk = (k + 1) % K
            a, b, c, d = rings[i][k], rings[i + 1][k], rings[i + 1][kk], rings[i][kk]
            # the half-section segment this ring edge belongs to (the left side mirrors the right)
            seg = k if k < half_n - 1 else K - 1 - k
            part = hs[min(seg + 1, half_n - 1)][2]
            zm = (a[2] + c[2]) / 2
            if part == 'under':
                mat = 'dark'
            elif isinstance(part, tuple):
                _, kf, ch = part
                mat = 'glass' if sp['glass'](xm, kf, ch) else 'paint'
            else:
                mat = 'paint'
            if mat == 'paint' and sp['stripe'] and abs(zm) < sp['stripe']:
                ny = (Vector(b) - Vector(a)).cross(Vector(d) - Vector(a)).normalized().y
                if ny > 0.55:
                    mat = 'accent'
            uv = [(p[0] / 52, k / K) for p in (a, b, c, d)]
            B.face([a, b, c, d], mat, uv, smooth=True)
    # end caps
    for ring, sign in ((rings[0], -1), (rings[-1], 1)):
        pts = list(ring)
        nx = sum((pts[j][1] - pts[(j + 1) % K][1]) * (pts[j][2] + pts[(j + 1) % K][2]) for j in range(K))
        if (nx > 0) != (sign > 0):
            pts = pts[::-1]
        B.face(pts, 'paint' if sign > 0 else 'dark', [(0, 0)] * K)
    obj = B.build(name)
    obj.hide_render = False
    weld(obj)
    return obj


# ================================================================ blender helpers
def weld(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=0.001)
    bpy.ops.object.mode_set(mode='OBJECT')


def cut_arches(obj, sp):
    """Boolean the wheel arches out of the body sides; the cut surfaces become dark wheel wells."""
    dark = bpy.data.materials.get('dark') or bpy.data.materials.new('dark')
    for x in (WHEEL_X, -WHEEL_X):
        for s in (-1, 1):
            bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=sp['arch'], depth=12, location=to_b((x, WHEEL_R, s * (sp['track'] + 4.5))), rotation=(math.pi / 2, 0, 0))
            cyl = bpy.context.active_object
            cyl.data.materials.append(dark)
            mod = obj.modifiers.new('arch', 'BOOLEAN')
            mod.operation = 'DIFFERENCE'
            mod.solver = 'EXACT'
            mod.material_mode = 'TRANSFER'
            mod.object = cyl
            bpy.context.view_layer.objects.active = obj
            bpy.ops.object.modifier_apply(modifier=mod.name)
            bpy.data.objects.remove(cyl)


def ray(obj, origin, direction):
    """Ray cast in three.js space; returns the hit point (three.js) or None."""
    hit, loc, _, _ = obj.ray_cast(Vector(to_b(origin)), Vector(to_b(direction)).normalized())
    return from_b(loc) if hit else None


def surface_front(obj, y, z):
    p = ray(obj, (60, y, z), (-1, 0, 0))
    return p[0] if p else 20.0


def surface_rear(obj, y, z):
    p = ray(obj, (-60, y, z), (1, 0, 0))
    return p[0] if p else -24.0


def surface_top(obj, x, z):
    p = ray(obj, (x, 60, z), (0, -1, 0))
    return p[1] if p else 10.0


def surface_side(obj, x, y):
    p = ray(obj, (x, y, 60), (0, 0, -1))
    return p[2] if p else 13.0


def join(target, others):
    bpy.ops.object.select_all(action='DESELECT')
    for o in others:
        o.hide_render = False
        o.select_set(True)
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.join()


# ================================================================ details per car
def lights_front(B, obj, sp, ys, zs, size, mat='head'):
    for y in ys:
        for z in zs:
            x = surface_front(obj, y, z)
            B.box((x - size[0] / 2 + 0.35, y, z), size, mat)


def lights_rear(B, obj, ys, zs, size, mat='tail'):
    for y in ys:
        for z in zs:
            x = surface_rear(obj, y, z)
            B.box((x + size[0] / 2 - 0.35, y, z), size, mat)


def mirrors(B, obj, sp, x):
    for s in (-1, 1):
        y = surface_top(obj, x, s * sp['W'] * sp['cw'] * 1.02) + 1.2
        z = s * (sp['W'] * sp['cw'] + 2.0)
        B.box((x, y, z), (1.4, 1.3, 2.4), 'paint')
        B.box((x - 0.3, y - 0.8, s * (sp['W'] * sp['cw'] + 1.0)), (0.6, 0.6, 1.4), 'dark')


def details(name, obj, sp):
    B = Builder()
    rear = surface_rear(obj, 7, 0)
    front = surface_front(obj, sp['bottom'] + 2, 0)
    if name == 'viper':
        lights_front(B, obj, sp, [7.2], [-9.2, 9.2], (1.2, 1.3, 4.6))
        lights_rear(B, obj, [9.6], [-8.5, -3.2, 3.2, 8.5], (0.8, 1.0, 4.4))
        B.box((front - 2.2, sp['bottom'] + 0.3, 0), (2.4, 0.6, 19), 'dark')  # splitter
        B.box((rear + 1.2, sp['bottom'] + 1.4, 0), (3, 2.6, 18), 'dark')  # diffuser
        for z in (-4.5, -2, 2, 4.5):
            B.tube([(rear + 1.0, 5.0, z), (rear - 1.2, 5.0, z)], [0.8, 0.8], 8, 'chrome')
        wing_y = surface_top(obj, -22, 0) + 5.5
        B.box((-22.5, wing_y, 0), (5.5, 0.9, 27), 'dark')
        for s in (-1, 1):
            B.box((-22.5, wing_y, s * 13.6), (6.5, 3.2, 0.6), 'dark')  # end plates
            B.box((-21.5, wing_y - 2.6, s * 7), (2.2, 5.2, 1.0), 'dark')  # posts
            z = surface_side(obj, -5, 9.5)
            B.box((-5, 9.2, s * (z - 0.2)), (6, 2.6, 1.0), 'dark')  # side intakes
        mirrors(B, obj, sp, 6.0)
    elif name == 'rhino':
        lights_front(B, obj, sp, [11.4], [-10.2, 10.2], (1.2, 2.6, 3.6))
        lights_rear(B, obj, [12.4], [-11.5, 11.5], (0.8, 3.6, 2.0))
        # bumpers
        B.box((front + 0.6, 6.4, 0), (3.0, 3.4, 27), 'dark')
        B.box((rear - 0.4, 6.4, 0), (3.0, 3.4, 27), 'dark')
        # bull bar
        bx = front + 3.2
        for z in (-8.5, 8.5):
            B.tube([(bx - 1.5, 5, z), (bx, 7, z), (bx, 13.5, z), (bx - 2.5, 15.2, z)], [0.8] * 4, 8, 'chrome')
        B.tube([(bx, 13.5, -8.5), (bx, 13.5, 8.5)], [0.8, 0.8], 8, 'chrome')
        B.tube([(bx, 9.5, -8.5), (bx, 9.5, 8.5)], [0.7, 0.7], 8, 'chrome')
        # roof rack
        ry = surface_top(obj, -8, 0) + 1.6
        for z in (-8, 8):
            B.box((-8, ry, z), (26, 0.9, 0.9), 'dark')
        for x in (-19, -12, -5, 2):
            B.box((x, ry + 0.2, 0), (0.9, 0.9, 17), 'dark')
        # armour plates on the doors and a spare wheel on the tailgate
        for s in (-1, 1):
            z = surface_side(obj, -3, 9)
            B.box((-3, 9.6, s * (z + 0.3)), (15, 5.6, 0.7), 'accent')
            for x in (-8.5, 2.5):
                B.box((x, 9.6, s * (z + 0.7)), (1.0, 1.0, 0.4), 'chrome')
        B.tube([(rear - 0.2, 13, 0), (rear - 3.4, 13, 0)], [5.0, 5.0], 16, 'tire_dark')
        mirrors(B, obj, sp, 7.5)
    elif name == 'spectre':
        lights_front(B, obj, sp, [5.8], [-7.2, 7.2], (1.2, 0.9, 5.2))
        lights_rear(B, obj, [8.8], [-6, 6], (0.8, 0.9, 7.0))
        B.box((front - 2.5, sp['bottom'] + 0.2, 0), (5.5, 0.7, 26), 'dark')  # front wing
        B.box((rear + 1.2, sp['bottom'] + 1.4, 0), (3, 2.6, 14), 'dark')
        B.tube([(rear + 1.0, 5.2, 0), (rear - 1.4, 5.2, 0)], [1.3, 1.3], 10, 'chrome')
        for s in (-1, 1):
            # thin twin fins, one quad per face so both sides show
            top = surface_top(obj, -19, s * 6)
            fin = [(-24.5, top - 0.5, s * 6.2), (-14, top - 0.5, s * 6.2), (-19.5, top + 7.5, s * 7.2), (-25.5, top + 7.8, s * 7.4)]
            B.face(fin, 'accent', [(0, 0), (1, 0), (1, 1), (0, 1)])
            B.face(fin[::-1], 'accent', [(0, 1), (1, 1), (1, 0), (0, 0)])
        mirrors(B, obj, sp, 3.0)
    else:  # volt
        # full-width light bars
        y_f = 8.4
        x = surface_front(obj, y_f, 0)
        B.box((x - 0.2, y_f, 0), (1.0, 0.8, 21), 'head')
        y_r = 11.2
        x = surface_rear(obj, y_r, 0)
        B.box((x + 0.2, y_r, 0), (1.0, 0.9, 22), 'tail')
        B.box((front + 0.2, sp['bottom'] + 1.6, 0), (2.2, 2.4, 22), 'dark')
        B.box((rear - 0.1, sp['bottom'] + 1.6, 0), (2.2, 2.4, 22), 'dark')
        # three coils standing across the roof, clear of the turret at x = -3
        for cx in (-19.0, -14.5, -10.0):
            roof = surface_top(obj, cx, 0)
            R0, r0 = 3.6, 0.65
            for k in range(16):
                for j in range(6):
                    a0, a1 = k / 16 * TAU, (k + 1) / 16 * TAU
                    b0, b1 = j / 6 * TAU, (j + 1) / 6 * TAU

                    def P(a, b):
                        rr = R0 + r0 * math.cos(b)
                        return (cx + r0 * math.sin(b), roof + 2.4 + rr * math.sin(a), rr * math.cos(a))
                    B.face([P(a0, b0), P(a0, b1), P(a1, b1), P(a1, b0)], 'coil', [(0, 0)] * 4, smooth=True)
        mirrors(B, obj, sp, 4.0)
    extra = B.build(name + '_details')
    extra.hide_render = False
    weld(extra)
    return extra


def wheel():
    B = Builder()
    # tyre: revolve a section round the axle, which runs along z
    # section scaled to the wheel radius: sidewall bulge, rounded shoulders, flat tread
    prof = [(r * WHEEL_R / 6, h) for r, h in [(4.1, -2.2), (5.3, -2.6), (5.85, -2.4), (6.0, -1.6), (6.05, 0), (6.0, 1.6), (5.85, 2.4), (5.3, 2.6), (4.1, 2.2)]]
    seg = 28

    def axle(r, h, a):
        return (r * math.cos(a), r * math.sin(a), h)

    for k in range(seg):
        a0, a1 = k / seg * TAU, (k + 1) / seg * TAU
        for i in range(len(prof) - 1):
            (r0, h0), (r1, h1) = prof[i], prof[i + 1]
            B.face([axle(r0, h0, a0), axle(r0, h0, a1), axle(r1, h1, a1), axle(r1, h1, a0)], 'tire', [(0, 0)] * 4, smooth=True)
    # rim: dished face with five spokes on both sides, barrel inside
    for side in (-1, 1):
        h = side * 1.9
        for k in range(seg):
            a0, a1 = k / seg * TAU, (k + 1) / seg * TAU
            k6 = WHEEL_R / 6
            q = [axle(4.15 * k6, side * 2.2, a0), axle(4.15 * k6, side * 2.2, a1), axle(3.6 * k6, h, a1), axle(3.6 * k6, h, a0)]
            B.face(q if side > 0 else q[::-1], 'rim', [(0, 0)] * 4, smooth=True)
            hub = [axle(1.3, h + side * 0.4, a0), axle(1.3, h + side * 0.4, a1), axle(0, h + side * 0.6, a1)]
            B.face(hub if side > 0 else hub[::-1], 'rim', [(0, 0)] * 3)
        for s in range(5):
            a = s / 5 * TAU
            d = (math.cos(a), math.sin(a))
            c = (d[0] * 2.2, d[1] * 2.2, h)
            # spoke as a thin box along its radius
            ln, wd, th = 2.6, 0.9, 0.6
            t = (-d[1], d[0])
            corners = []
            for u, v, w in [(-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)]:
                corners.append((c[0] + d[0] * u * ln / 2 + t[0] * v * wd / 2, c[1] + d[1] * u * ln / 2 + t[1] * v * wd / 2, c[2] + w * th / 2))
            for f in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (1, 2, 6, 5), (0, 4, 7, 3)):
                B.face([corners[i] for i in f], 'rim', [(0, 0)] * 4)
    # dark disc behind the spokes, visible from both sides
    disc = [axle(3.8 * WHEEL_R / 6, 0, k / seg * TAU) for k in range(seg)]
    B.face(disc, 'tire', [(0, 0)] * seg)
    B.face(disc[::-1], 'tire', [(0, 0)] * seg)
    w = B.build('wheel')
    w.hide_render = False
    weld(w)
    bake_vertex_ao(w, 4)
    w.hide_render = True
    return w


def turret():
    B = Builder()
    B.lathe([(0, 0), (5.4, 0), (5.2, 1.4), (4.4, 2.4), (0, 2.4)], 16, 'turret')
    # armoured housing with a sloped front
    hx0, hx1, hy0, hy1, hz = -4.0, 4.5, 2.2, 5.6, 3.4
    pts = [(hx0, hy0, -hz), (hx1, hy0, -hz), (hx1 - 1.5, hy1, -hz * 0.8), (hx0 + 0.5, hy1, -hz * 0.8), (hx0, hy0, hz), (hx1, hy0, hz), (hx1 - 1.5, hy1, hz * 0.8), (hx0 + 0.5, hy1, hz * 0.8)]
    for f in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (1, 2, 6, 5), (0, 4, 7, 3)):
        B.face([pts[i] for i in f], 'turret', [(0, 0)] * 4)
    for z in (-1.5, 1.5):
        B.tube([(2.5, 3.6, z), (15.5, 3.6, z)], [0.95, 0.8], 10, 'barrel')
        B.tube([(13.8, 3.6, z), (16.2, 3.6, z)], [1.25, 1.25], 10, 'accent')
    return B.build('turret', bake_ao=6)


MAT_PREVIEW = {
    'dark': ((0.03, 0.032, 0.036), 0.0, 0.6),
    'glass': ((0.01, 0.015, 0.02), 0.9, 0.05),
    'chrome': ((0.8, 0.8, 0.82), 1.0, 0.18),
    'tire': ((0.02, 0.02, 0.022), 0.0, 0.85),
    'tire_dark': ((0.02, 0.02, 0.022), 0.0, 0.85),
    'rim': ((0.6, 0.62, 0.65), 1.0, 0.25),
    'turret': ((0.08, 0.085, 0.09), 0.6, 0.45),
    'barrel': ((0.4, 0.42, 0.45), 0.9, 0.3),
}
CAR_COLOURS = {'viper': (0xff2d55, 0xffd23f), 'rhino': (0x7dff4a, 0x2b3a1a), 'spectre': (0xb04dff, 0x00e5ff), 'volt': (0x00e5ff, 0x0a2a55)}


def lin(hexc, k=1.0):
    v = [((hexc >> s) & 255) / 255 for s in (16, 8, 0)]
    return tuple(k * (c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4) for c in v)


def set_principled(name, col, metal, rough, emit=None, coat=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*col, 1)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    b.inputs['Coat Weight'].default_value = coat
    if emit:
        b.inputs['Emission Color'].default_value = (*emit, 1)
        b.inputs['Emission Strength'].default_value = 4.0


def preview(cars, wheel_obj, turret_obj):
    """Contact sheet: every car from a front three-quarter and from the chase camera's angle."""
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = 560, 360
    sc.cycles.samples = 48
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'AgX'
    world = sc.world
    world.use_nodes = True
    nt = world.node_tree
    bg = nt.nodes['Background']
    sky = nt.nodes.new('ShaderNodeTexSky')
    nt.links.new(sky.outputs[0], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = 0.35
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 4.0
    sun.rotation_euler = (math.radians(50), 0, math.radians(35))
    sc.collection.objects.link(sun)
    bpy.ops.mesh.primitive_plane_add(size=400)
    floor = bpy.context.active_object
    fm = bpy.data.materials.new('floor')
    fm.use_nodes = True
    fm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.16, 0.16, 0.17, 1)
    floor.data.materials.append(fm)
    for k, (c, mt, r) in MAT_PREVIEW.items():
        set_principled(k, c, mt, r)
    set_principled('head', (1, 0.95, 0.8), 0, 0.2, emit=(1, 0.95, 0.8))
    set_principled('tail', (0.8, 0.02, 0.04), 0, 0.3, emit=(1, 0.02, 0.05))
    set_principled('coil', (0.2, 0.9, 1.0), 0, 0.3, emit=(0.2, 0.9, 1.0))
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.lens = 50
    sc.collection.objects.link(cam)
    sc.camera = cam
    wheel_obj.hide_render = True
    turret_obj.hide_render = True
    # temporary wheels and a turret for the pictures
    shots = []
    for name, obj in cars.items():
        body_col, acc = CAR_COLOURS[name]
        set_principled('paint', lin(body_col, 0.8), 0.35, 0.35, coat=1.0)
        set_principled('accent', lin(acc, 0.85), 0.3, 0.4)
        temps = []
        track = SPECS[name]['track']
        for x in (WHEEL_X, -WHEEL_X):
            for z in (-track, track):
                w = wheel_obj.copy()
                w.hide_render = False
                w.location = Vector(to_b((x, WHEEL_R, z)))
                sc.collection.objects.link(w)
                temps.append(w)
        t = turret_obj.copy()
        t.hide_render = False
        t.location = Vector(to_b((-3, obj['roofY'], 0)))
        sc.collection.objects.link(t)
        temps.append(t)
        for o in cars.values():
            o.hide_render = o is not obj
        for pos in ((62, 30, 58), (-78, 52, -30)):
            cam.location = Vector(to_b(pos))
            d = Vector(to_b((0, 8, 0))) - cam.location
            cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
            path = os.path.join(TMP, f'car_{name}_{len(shots)}.png')
            sc.render.filepath = path
            bpy.ops.render.render(write_still=True)
            shots.append(path)
        for o in temps:
            bpy.data.objects.remove(o)
    # contact sheet
    ims = []
    for p in shots:
        im = bpy.data.images.load(p)
        a = np.empty(im.size[0] * im.size[1] * 4, dtype=np.float32)
        im.pixels.foreach_get(a)
        ims.append(a.reshape(im.size[1], im.size[0], 4))
    rows = [np.concatenate(ims[i:i + 2], axis=1) for i in range(0, len(ims), 2)]
    sheet = np.concatenate(rows[::-1], axis=0)
    out = bpy.data.images.new('sheet', sheet.shape[1], sheet.shape[0])
    out.pixels.foreach_set(sheet.ravel())
    out.filepath_raw = os.path.join(TMP, 'cars_preview.png')
    out.file_format = 'PNG'
    out.save()
    print('preview', out.filepath_raw)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    sc = reset_scene()
    cars = {}
    for name, sp in SPECS.items():
        print('== car', name)
        obj = body_shell(name, sp)
        cut_arches(obj, sp)
        extra = details(name, obj, sp)
        join(obj, [extra])
        bake_vertex_ao(obj, 10)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(38))
        obj['roofY'] = round(surface_top(obj, -3, 0), 2)
        obj['hoodY'] = round(surface_top(obj, 15, 0), 2)
        obj['hoodSlope'] = round((surface_top(obj, 19, 0) - surface_top(obj, 11, 0)) / 8, 3)
        obj['frontX'] = round(surface_front(obj, sp['bottom'] + 3, 0), 2)
        obj['rearX'] = round(surface_rear(obj, sp['bottom'] + 3, 0), 2)
        obj['exhaustY'] = 5.0
        obj['track'] = sp['track']
        obj['wheelR'] = WHEEL_R
        obj.hide_render = True
        cars[name] = obj
        print('  extras', {k: obj[k] for k in ('roofY', 'hoodY', 'frontX', 'rearX')}, 'tris', sum(len(p.vertices) - 2 for p in obj.data.polygons))
    w = wheel()
    t = turret()
    bpy.ops.object.select_all(action='DESELECT')
    for o in list(cars.values()) + [w, t]:
        o.select_set(True)
    dst = os.path.join(PUBLIC, 'models', 'cars.glb')
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
    if 'preview' in argv:
        preview(cars, w, t)


main()
