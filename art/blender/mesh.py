"""Mesh building helpers shared by the Blender art scripts (props, cars)."""
import math

import bpy
from mathutils import Vector

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
