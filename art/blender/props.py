"""
Track props modelled in Blender and exported to public/assets/models/props.glb, plus the foliage
texture atlas (public/assets/tex/foliage.webp) rendered from scattered leaf and needle meshes.

Geometry is written in the game's axes (three.js: x, y up, z) and converted to Blender's Z-up on the way in;
the glTF exporter converts it back. Sizes are game units (a car is 52 long, a barrier wall 22 high).
Each object keeps one material per part (the game swaps in its own materials by name) and a
COLOR_0 vertex colour holding baked ambient occlusion.

    npm run art:props
"""
import math
import os
import random
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(__file__))
from common import PUBLIC, TMP, blur, reset_scene, save, srgb  # noqa: E402

R = random.Random(1234)
TAU = math.pi * 2


def to_b(p):
    """three (x, y, z) → Blender (x, -z, y)"""
    return (p[0], -p[2], p[1])


class Builder:
    """Collects faces in three.js space; per-corner UVs, normals and colours."""

    def __init__(self):
        self.verts = []
        self.faces = []  # (indices, material, uvs, normals|None, colours|None, smooth)
        self.mats = []

    def mat(self, name):
        if name not in self.mats:
            self.mats.append(name)
        return self.mats.index(name)

    def face(self, pts, mat, uvs, normals=None, colors=None, smooth=False):
        base = len(self.verts)
        self.verts.extend(pts)
        self.faces.append((list(range(base, base + len(pts))), self.mat(mat), uvs, normals, colors, smooth))

    # ---- primitives
    def box(self, c, s, mat, scale=None, rot=0.0):
        """Axis-aligned box (optionally turned about Y). UVs in world units / scale, or 0..1 per face."""
        cx, cy, cz = c
        hx, hy, hz = s[0] / 2, s[1] / 2, s[2] / 2
        co, si = math.cos(rot), math.sin(rot)

        def P(x, y, z):
            return (cx + x * co + z * si, cy + y, cz - x * si + z * co)

        faces = [
            # (corner list in local coords, uv axes)
            ([(hx, -hy, hz), (hx, -hy, -hz), (hx, hy, -hz), (hx, hy, hz)], (2, 1), -1),  # +x
            ([(-hx, -hy, -hz), (-hx, -hy, hz), (-hx, hy, hz), (-hx, hy, -hz)], (2, 1), 1),  # -x
            ([(-hx, hy, hz), (hx, hy, hz), (hx, hy, -hz), (-hx, hy, -hz)], (0, 2), 1),  # +y
            ([(-hx, -hy, -hz), (hx, -hy, -hz), (hx, -hy, hz), (-hx, -hy, hz)], (0, 2), 1),  # -y
            ([(-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz)], (0, 1), 1),  # +z
            ([(hx, -hy, -hz), (-hx, -hy, -hz), (-hx, hy, -hz), (hx, hy, -hz)], (0, 1), -1),  # -z
        ]
        for corners, (a, b), sgn in faces:
            pts = [P(*q) for q in corners]
            if scale:
                uvs = [(sgn * (q[a] + (cx, cy, cz)[a]) / scale, (q[b] + (cx, cy, cz)[b]) / scale) for q in corners]
            else:
                uvs = [(0, 0), (1, 0), (1, 1), (0, 1)]
            self.face(pts, mat, uvs)

    def lathe(self, profile, seg, mat, closed=False, uscale=1.0, smooth=True, center=(0, 0, 0)):
        """Revolve [(radius, y), ...] about the Y axis."""
        rings = []
        for k in range(seg + 1):
            a = k / seg * TAU
            rings.append([(center[0] + r * math.cos(a), center[1] + y, center[2] - r * math.sin(a)) for r, y in profile])
        lens = [0.0]
        for i in range(1, len(profile)):
            lens.append(lens[-1] + math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]))
        tot = lens[-1] or 1
        n = len(profile)
        for k in range(seg):
            for i in range(n - 1 + (1 if closed else 0)):
                j = (i + 1) % n
                pts = [rings[k][i], rings[k + 1][i], rings[k + 1][j], rings[k][j]]
                vj = lens[j] / tot if j else 1.0
                uvs = [(k / seg * uscale, lens[i] / tot), ((k + 1) / seg * uscale, lens[i] / tot), ((k + 1) / seg * uscale, vj), (k / seg * uscale, vj)]
                self.face(pts, mat, uvs, smooth=smooth)

    def tube(self, pts, radii, sides, mat, cap=True, uscale=1.0):
        """Tube along a polyline in three space."""
        rings = []
        up = Vector((0, 1, 0))
        for i, p in enumerate(pts):
            p = Vector(p)
            d = (Vector(pts[min(i + 1, len(pts) - 1)]) - Vector(pts[max(i - 1, 0)])).normalized()
            side = d.cross(up if abs(d.dot(up)) < 0.95 else Vector((1, 0, 0))).normalized()
            other = side.cross(d).normalized()
            rings.append([tuple(p + (side * math.cos(a) + other * math.sin(a)) * radii[i]) for a in (k / sides * TAU for k in range(sides))])
        for i in range(len(pts) - 1):
            for k in range(sides):
                kk = (k + 1) % sides
                q = [rings[i][k], rings[i + 1][k], rings[i + 1][kk], rings[i][kk]]
                self.face(q, mat, [(k / sides * uscale, i), (k / sides * uscale, i + 1), ((k + 1) / sides * uscale, i + 1), ((k + 1) / sides * uscale, i)], smooth=True)
        if cap:
            top = rings[-1]
            self.face(top[::-1], mat, [(0.5, 0.5)] * sides)

    # ---- to Blender
    def build(self, name, bake_ao=None):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata([to_b(v) for v in self.verts], [], [f[0] for f in self.faces])
        uv = mesh.uv_layers.new(name='UV')
        col = mesh.color_attributes.new('AO', 'FLOAT_COLOR', 'CORNER')
        custom = any(f[3] for f in self.faces)
        loop_normals = []
        li = 0
        for poly, (idx, mi, uvs, normals, colors, smooth) in zip(mesh.polygons, self.faces):
            poly.material_index = mi
            poly.use_smooth = smooth or bool(normals)
            for k in range(len(idx)):
                uv.data[li].uv = uvs[k]
                c = colors[k] if colors else 1.0
                col.data[li].color = (c, c, c, 1)
                if custom:
                    n = normals[k] if normals else None
                    loop_normals.append(to_b(n) if n else (0, 0, 0))
                li += 1
        mesh.update()
        if custom:
            # zero vectors keep the automatic normal
            auto = [tuple(l.normal) for l in mesh.loops]
            mesh.normals_split_custom_set([n if any(n) else a for n, a in zip(loop_normals, auto)])
        for m in self.mats:
            mesh.materials.append(bpy.data.materials.get(m) or bpy.data.materials.new(m))
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        mesh.color_attributes.active_color = col
        if bake_ao:
            bake_vertex_ao(obj, bake_ao)
        # keep finished props out of the next prop's occlusion bake (they all sit at the origin)
        obj.hide_render = True
        return obj


def bake_vertex_ao(obj, distance):
    """Ambient occlusion into the AO colour attribute, with a ground plane underneath."""
    sc = bpy.context.scene
    sc.world = sc.world or bpy.data.worlds.new('w')
    sc.world.light_settings.distance = distance
    sc.cycles.samples = 64
    bpy.ops.mesh.primitive_plane_add(size=2000, location=(obj.location.x, obj.location.y, -0.01))
    ground = bpy.context.active_object
    for m in obj.data.materials:
        m.use_nodes = True
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')
    bpy.data.objects.remove(ground)
    # keep contact shading gentle: the game adds its own occlusion from the ground bake
    col = obj.data.color_attributes['AO']
    for d in col.data:
        v = 0.35 + 0.65 * d.color[0]
        d.color = (v, v, v, 1)


# ================================================================ foliage atlas
def render_foliage():
    """1024×512 RGBA atlas: left = broadleaf cluster, right = fir branch (trunk end on the left)."""
    size = 512
    out = np.zeros((size, size * 2, 4), dtype=np.float32)
    for half, make in enumerate((leaf_cluster, fir_branch)):
        reset_scene()
        sc = bpy.context.scene
        sc.cycles.samples = 16
        sc.render.film_transparent = True
        sc.render.resolution_x = sc.render.resolution_y = size
        sc.view_settings.view_transform = 'Standard'
        make()
        cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
        cam.data.type = 'ORTHO'
        cam.data.ortho_scale = 1.0
        cam.location = (0.5, 0.5, 5)
        sc.collection.objects.link(cam)
        sc.camera = cam
        path = os.path.join(TMP, f'foliage_{half}.png')
        sc.render.filepath = path
        sc.render.image_settings.file_format = 'PNG'
        sc.render.image_settings.color_mode = 'RGBA'
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(path)
        px = np.empty(size * size * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        out[:, half * size:(half + 1) * size] = px.reshape(size, size, 4)
    rgb, a = out[:, :, :3], out[:, :, 3]
    # bleed colour into the transparent area so mipmaps don't get dark fringes
    for sigma in (2, 6, 18):
        fill = blur(rgb * a[:, :, None], sigma) / np.maximum(blur(a, sigma)[:, :, None], 1e-4)
        rgb = np.where(a[:, :, None] > 0.5, rgb, fill)
    save('tex/foliage', rgb, quality=90, alpha=a)


def emissive_mesh(verts, faces, colors, name):
    """Flat unlit mesh with one colour per face (the render is an albedo map)."""
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    col = mesh.color_attributes.new('C', 'FLOAT_COLOR', 'CORNER')
    li = 0
    for poly, c in zip(mesh.polygons, colors):
        for _ in poly.loop_indices:
            col.data[li].color = (*c, 1)
            li += 1
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    at = nt.nodes.new('ShaderNodeAttribute')
    at.attribute_name = 'C'
    em = nt.nodes.new('ShaderNodeEmission')
    o = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(at.outputs['Color'], em.inputs['Color'])
    nt.links.new(em.outputs[0], o.inputs['Surface'])
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)


def leaf_cluster():
    verts, faces, cols = [], [], []
    # twigs
    twig = srgb(0x4a3a2a)
    for k in range(7):
        a = k / 7 * TAU + R.uniform(-0.3, 0.3)
        L = R.uniform(0.25, 0.4)
        x1, y1 = 0.5 + math.cos(a) * L, 0.5 + math.sin(a) * L
        nx, ny = -math.sin(a) * 0.006, math.cos(a) * 0.006
        b = len(verts)
        verts += [(0.5 - nx, 0.5 - ny, 0), (0.5 + nx, 0.5 + ny, 0), (x1 + nx * 0.3, y1 + ny * 0.3, 0), (x1 - nx * 0.3, y1 - ny * 0.3, 0)]
        faces.append((b, b + 1, b + 2, b + 3))
        cols.append(tuple(twig))
    # leaves: pointed ellipses, deeper layers darker
    greens = [srgb(0x3b5a22), srgb(0x4f7a2c), srgb(0x6a8f35), srgb(0x7f9a3e), srgb(0x2f4a1c)]
    n = 700
    for i in range(n):
        layer = i / n
        r = 0.43 * math.sqrt(R.random())
        a = R.random() * TAU
        cx, cy = 0.5 + math.cos(a) * r, 0.5 + math.sin(a) * r
        rot = R.random() * TAU
        ln = R.uniform(0.05, 0.08)
        wd = ln * R.uniform(0.38, 0.5)
        shade = 0.55 + 0.45 * layer + R.uniform(-0.08, 0.08)
        c = greens[R.randrange(len(greens))] * shade
        outline = []
        for k in range(12):
            t = k / 12 * TAU
            px = math.cos(t) * ln / 2
            py = math.sin(t) * wd / 2 * (1 - 0.35 * max(math.cos(t), 0))  # narrower towards the tip
            outline.append((cx + px * math.cos(rot) - py * math.sin(rot), cy + px * math.sin(rot) + py * math.cos(rot), 0.01 + layer * 0.5))
        b = len(verts)
        verts += outline
        faces.append(tuple(range(b, b + 12)))
        cols.append(tuple(np.clip(c, 0, 1)))
    emissive_mesh(verts, faces, cols, 'leaves')


def fir_branch():
    verts, faces, cols = [], [], []
    bark = srgb(0x3e3024)
    needle_cols = [srgb(0x1f3a1e), srgb(0x2a4a24), srgb(0x36592c), srgb(0x44683a)]

    def strip(x0, y0, x1, y1, w0, w1, z, c):
        dx, dy = x1 - x0, y1 - y0
        L = math.hypot(dx, dy) or 1
        nx, ny = -dy / L, dx / L
        b = len(verts)
        verts.extend([(x0 - nx * w0, y0 - ny * w0, z), (x0 + nx * w0, y0 + ny * w0, z), (x1 + nx * w1, y1 + ny * w1, z), (x1 - nx * w1, y1 - ny * w1, z)])
        faces.append((b, b + 1, b + 2, b + 3))
        cols.append(tuple(np.clip(c, 0, 1)))

    # main twig along +x, side twigs, then needles along all of them
    twigs = [(0.02, 0.5, 0.97, 0.5)]
    for k in range(9):
        for s in (-1, 1):
            x = 0.12 + k * 0.09 + R.uniform(-0.025, 0.025)
            L = (0.3 * (1 - x) + 0.05) * R.uniform(0.8, 1.1)
            ang = R.uniform(0.75, 1.0)
            twigs.append((x, 0.5, x + L * math.cos(ang), 0.5 + s * L * math.sin(ang)))
    for (x0, y0, x1, y1) in twigs:
        strip(x0, y0, x1, y1, 0.006, 0.002, 0.0, bark)
    for ti, (x0, y0, x1, y1) in enumerate(twigs):
        L = math.hypot(x1 - x0, y1 - y0)
        dx, dy = (x1 - x0) / L, (y1 - y0) / L
        count = int(L * 260)
        for k in range(count):
            t = k / count
            px, py = x0 + dx * L * t, y0 + dy * L * t
            for s in (-1, 1):
                ang = math.atan2(dy, dx) + s * R.uniform(0.7, 1.1)
                nl = R.uniform(0.025, 0.04) * (1 - 0.4 * t)
                shade = 0.7 + 0.3 * t + R.uniform(-0.1, 0.1)
                c = needle_cols[R.randrange(len(needle_cols))] * shade
                strip(px, py, px + math.cos(ang) * nl, py + math.sin(ang) * nl, 0.0025, 0.0012, 0.01 + R.random() * 0.3, c)
    emissive_mesh(verts, faces, cols, 'needles')


# ================================================================ props
def container():
    B = Builder()
    L, W, H = 110.0, 40.0, 26.0
    T = 52.0  # corrugation tile size
    B.box((0, H / 2, 0), (L - 3, H - 2.4, W - 1.2), 'body', scale=T)
    for y in (1.2, H - 1.2):
        for z in (-(W / 2 - 0.9), W / 2 - 0.9):
            B.box((0, y, z), (L - 2, 2.4, 1.8), 'frame', scale=20)
        for x in (-(L / 2 - 1.0), L / 2 - 1.0):
            B.box((x, y, 0), (2.0, 2.4, W - 2), 'frame', scale=20)
    # corner posts, a touch proud of the rails like the castings they end in
    for x in (-(L / 2 - 1.4), L / 2 - 1.4):
        for z in (-(W / 2 - 1.4), W / 2 - 1.4):
            B.box((x, H / 2, z), (3.0, H, 3.0), 'frame', scale=20)
    # doors: centre seam, four locking bars with cams and handles
    xd = L / 2 - 1.2
    B.box((xd, H / 2, 0), (0.8, H - 3, 0.9), 'frame', scale=20)
    for z in (-15, -5, 5, 15):
        B.tube([(xd + 0.3, 2.2, z), (xd + 0.3, H - 2.2, z)], [0.45, 0.45], 4, 'frame', cap=False)
        B.box((xd + 0.6, H * 0.42, z + 1.6), (0.6, 0.8, 3.4), 'frame', scale=20)
    return B.build('container', bake_ao=40)


def tyre():
    B = Builder()
    # stacked tyres hide each other's top and bottom, so the section is mostly tread and inner lip
    prof = [(3.6, 0.2), (5.9, 0.0), (6.6, 1.6), (6.6, 5.4), (5.9, 7.0), (3.6, 6.8), (3.1, 3.5)]
    B.lathe(prof, 12, 'rubber', closed=True)
    return B.build('tyre', bake_ao=6)


def drum():
    B = Builder()
    # rolling hoops and the lid rim; the bottom is never seen
    prof = [(4.0, 0.0), (4.0, 3.4), (4.25, 3.6), (4.0, 3.8), (4.0, 7.2), (4.25, 7.4), (4.0, 7.6), (4.05, 11.0), (3.6, 10.8), (0, 10.8)]
    B.lathe(prof, 10, 'paint')
    return B.build('drum', bake_ao=8)


def pallet():
    B = Builder()
    for z in (-5.3, 0, 5.3):
        B.box((0, 1.25, z), (14, 1.3, 1.3), 'wood', scale=8)
    for k in range(6):
        x = -6.2 + k * 2.48
        B.box((x, 2.2, 0), (1.9, 0.55, 12), 'wood', scale=8)
    for x in (-6.2, 0, 6.2):
        B.box((x, 0.3, 0), (1.9, 0.6, 12), 'wood', scale=8)
    return B.build('pallet', bake_ao=5)


def crate():
    B = Builder()
    B.box((0, 5, 0), (9.2, 9.6, 9.2), 'wood', scale=10)
    t = 1.0
    for a in (-1, 1):
        for b in (-1, 1):
            B.box((a * 4.6, 5, b * 4.6), (t * 1.3, 10, t * 1.3), 'wood', scale=10)
            B.box((a * 4.6, 5 + b * 4.5, 0), (t, t, 9.6), 'wood', scale=10)
            B.box((0, 5 + b * 4.5, a * 4.6), (9.6, t, t), 'wood', scale=10)
    # diagonal braces on two faces
    for s in (-1, 1):
        B.box((0, 5, s * 4.75), (12.2, 0.9, 0.5), 'wood', scale=10, rot=0)
    return B.build('crate', bake_ao=6)


def lamp():
    B = Builder()
    B.box((0, 1, 0), (7, 2, 7), 'metal', scale=10)
    B.tube([(0, 0, 0), (0, 60, 0), (0, 93, 0)], [2.3, 1.9, 1.5], 8, 'metal', cap=False)
    arm = [(0, 93, 0)]
    for k in range(1, 9):
        t = k / 8
        a = t * math.pi / 2
        arm.append((math.sin(a) * 8 + t * 24, 93 + (1 - math.cos(a)) * -1 + math.sin(a) * 5.5, 0))
    B.tube(arm, [1.2] * len(arm), 6, 'metal')
    hx = arm[-1][0] + 3
    hy = arm[-1][1] - 0.5
    B.box((hx, hy, 0), (14, 3, 7), 'metal', scale=10)
    B.box((hx - 1, hy - 1.6, 0), (11, 0.4, 5.2), 'glow', scale=10)
    return B.build('lamp', bake_ao=12)


# ---- foliage
def card(B, center, normal_hint, size, uv_rect, mat, crown_c, crown_r, rot=0.0, colour=None):
    """A square leaf card roughly facing normal_hint; normals point away from the crown centre."""
    n = Vector(normal_hint).normalized()
    t = n.cross(Vector((0, 1, 0)) if abs(n.y) < 0.9 else Vector((1, 0, 0))).normalized()
    b = n.cross(t).normalized()
    t, b = t * math.cos(rot) + b * math.sin(rot), -t * math.sin(rot) + b * math.cos(rot)
    c = Vector(center)
    h = size / 2
    corners = [c - t * h - b * h, c + t * h - b * h, c + t * h + b * h, c - t * h + b * h]
    u0, v0, u1, v1 = uv_rect
    uvs = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
    normals, cols = [], []
    for p in corners:
        d = (p - Vector(crown_c))
        nn = Vector((d.x / crown_r[0], d.y / crown_r[1], d.z / crown_r[2]))
        depth = min(nn.length, 1.2)
        normals.append(tuple((nn.normalized() * 0.8 + n * 0.2).normalized()))
        cols.append(colour if colour is not None else 0.45 + 0.55 * min(depth, 1.0) ** 1.5)
    B.face([tuple(p) for p in corners], mat, uvs, normals=normals, colors=cols)


LEAF_UV = (0.0, 0.0, 0.5, 1.0)
FIR_UV = (0.5, 0.0, 1.0, 1.0)


def tree():
    B = Builder()
    # trunk with a slight lean and root flare, then a few limbs into the crown
    trunk = [(0, 0, 0), (0.3, 8, 0.2), (0.8, 20, -0.3), (0.6, 32, 0.2)]
    B.tube(trunk, [3.6, 2.8, 2.3, 1.7], 7, 'bark')
    for k in range(5):
        a = k / 5 * TAU + R.uniform(-0.3, 0.3)
        y0 = R.uniform(22, 31)
        L = R.uniform(12, 17)
        end = (math.cos(a) * L * 0.8, y0 + L * 0.7, math.sin(a) * L * 0.8)
        B.tube([(0.5, y0, 0), end], [1.2, 0.4], 5, 'bark')
    cc, cr = (0, 46, 0), (23, 19, 23)
    for i in range(46):
        # points biased towards the crown surface
        while True:
            d = Vector((R.uniform(-1, 1), R.uniform(-1, 1), R.uniform(-1, 1)))
            if 0.05 < d.length <= 1:
                break
        r = d.length ** 0.45
        d = d.normalized()
        p = (cc[0] + d.x * cr[0] * r * 0.85, cc[1] + d.y * cr[1] * r * 0.85, cc[2] + d.z * cr[2] * r * 0.85)
        hint = (d + Vector((R.uniform(-0.6, 0.6), R.uniform(-0.6, 0.6), R.uniform(-0.6, 0.6)))).normalized()
        card(B, p, hint, R.uniform(17, 23), LEAF_UV, 'leaves', cc, cr, rot=R.uniform(0, TAU))
    return B.build('tree')


def fir():
    B = Builder()
    B.tube([(0, 0, 0), (0, 40, 0), (0, 78, 0)], [2.8, 1.8, 0.4], 6, 'bark', cap=False)
    tiers = 7
    for t in range(tiers):
        y = 14 + t * 8.5
        reach = 25 * (1 - t / (tiers + 0.6)) + 4
        count = 7 if t < tiers - 2 else 5
        off = R.uniform(0, TAU)
        for k in range(count):
            a = off + k / count * TAU + R.uniform(-0.2, 0.2)
            dirv = Vector((math.cos(a), 0, math.sin(a)))
            droop = -0.38 - 0.1 * R.random()
            tip = Vector((0, y, 0)) + dirv * reach + Vector((0, reach * droop, 0))
            base = Vector((0, y + 1.5, 0))
            side = Vector((-math.sin(a), 0, math.cos(a))) * reach * 0.36
            # a card lying along the branch, trunk end at u = 0.5
            corners = [base - side * 0.3, tip - side * 0.9, tip + side * 0.9, base + side * 0.3]
            uvs = [(0.5, 0.35), (1.0, 0.0), (1.0, 1.0), (0.5, 0.65)]
            n_out = (dirv + Vector((0, 0.9, 0))).normalized()
            depth = 0.55 + 0.45 * (t / tiers)
            B.face([tuple(c) for c in corners], 'needles', uvs, normals=[tuple(n_out)] * 4, colors=[0.5, 0.55 + 0.45 * depth, 0.55 + 0.45 * depth, 0.5])
    # leader
    for k in range(3):
        a = k / 3 * math.pi
        dirv = Vector((math.cos(a), 0, math.sin(a)))
        corners = [Vector((0, 70, 0)) - dirv * 5, Vector((0, 70, 0)) + dirv * 5, Vector((0, 86, 0)) + dirv * 0.5, Vector((0, 86, 0)) - dirv * 0.5]
        B.face([tuple(c) for c in corners], 'needles', [(0.5, 0.2), (0.5, 0.8), (1.0, 0.55), (1.0, 0.45)], normals=[(0, 1, 0)] * 4, colors=[0.7, 0.7, 1, 1])
    return B.build('fir')


def bush():
    B = Builder()
    cc, cr = (0, 5, 0), (16, 9, 14)
    for i in range(13):
        a = R.uniform(0, TAU)
        e = R.uniform(0.0, 1.2)
        d = Vector((math.cos(a) * math.cos(e), math.sin(e), math.sin(a) * math.cos(e)))
        p = (d.x * cr[0] * 0.55, cc[1] + d.y * cr[1] * 0.45, d.z * cr[2] * 0.55)
        card(B, p, d, R.uniform(12, 16), LEAF_UV, 'leaves', cc, cr, rot=R.uniform(0, TAU))
    return B.build('bush')


def main():
    render_foliage()
    reset_scene()
    for make in (container, tyre, drum, pallet, crate, lamp, tree, fir, bush):
        print('== prop', make.__name__)
        make()
    bpy.ops.object.select_all(action='SELECT')
    dst = os.path.join(PUBLIC, 'models', 'props.glb')
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=dst,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_normals=True,
        export_texcoords=True,
        export_materials='EXPORT',
        export_vertex_color='ACTIVE',
        export_all_vertex_colors=False,
    )
    print('wrote', dst, os.path.getsize(dst) // 1024, 'KB')


main()
