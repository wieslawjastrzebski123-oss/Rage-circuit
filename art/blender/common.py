"""Shared helpers for the Blender art scripts (run headless: blender -b -P <script>)."""
import math
import os
import subprocess

import bpy
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PUBLIC = os.path.join(ROOT, 'public', 'assets')
TMP = os.environ.get('ART_TMP', os.path.join(ROOT, 'art', '.cache'))
os.makedirs(TMP, exist_ok=True)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    return sc


# ---------------------------------------------------------------- node helpers
class Nodes:
    """Tiny wrapper that keeps node-graph code short: sockets or plain numbers are accepted everywhere."""

    def __init__(self, tree):
        self.t = tree
        self.n = tree.nodes
        self.l = tree.links

    def _in(self, sock, v):
        if hasattr(v, 'is_output'):
            self.l.new(v, sock)
        elif v is not None:
            sock.default_value = v

    def math(self, op, a, b=None):
        m = self.n.new('ShaderNodeMath')
        m.operation = op
        self._in(m.inputs[0], a)
        if b is not None:
            self._in(m.inputs[1], b)
        return m.outputs[0]

    def add(self, a, b):
        return self.math('ADD', a, b)

    def mul(self, a, b):
        return self.math('MULTIPLY', a, b)

    def xyz(self, x, y, z):
        c = self.n.new('ShaderNodeCombineXYZ')
        for s, v in zip(c.inputs, (x, y, z)):
            self._in(s, v)
        return c.outputs[0]

    def uv(self):
        tc = self.n.new('ShaderNodeTexCoord')
        sep = self.n.new('ShaderNodeSeparateXYZ')
        self.l.new(tc.outputs['UV'], sep.inputs[0])
        return sep.outputs[0], sep.outputs[1]

    def torus(self, su, sv, seed=0.0):
        """Seamless 4D coordinates: u and v each wrap around a circle, so the pattern tiles perfectly.
        su / sv = how many unit-size features fit across the tile in U / V."""
        u, v = self.uv()
        au = self.mul(u, 2 * math.pi)
        av = self.mul(v, 2 * math.pi)
        ru = su / (2 * math.pi)
        rv = sv / (2 * math.pi)
        vec = self.xyz(
            self.add(self.mul(self.math('COSINE', au), ru), seed * 17.3),
            self.add(self.mul(self.math('SINE', au), ru), seed * 5.1),
            self.add(self.mul(self.math('COSINE', av), rv), seed * 11.7),
        )
        w = self.add(self.mul(self.math('SINE', av), rv), seed * 3.9)
        return vec, w

    def noise(self, su, sv, seed=0.0, detail=4.0, rough=0.55, distortion=0.0, kind='FBM'):
        vec, w = self.torus(su, sv, seed)
        nz = self.n.new('ShaderNodeTexNoise')
        nz.noise_dimensions = '4D'
        nz.noise_type = kind
        self.l.new(vec, nz.inputs['Vector'])
        self.l.new(w, nz.inputs['W'])
        nz.inputs['Scale'].default_value = 1.0
        nz.inputs['Detail'].default_value = detail
        nz.inputs['Roughness'].default_value = rough
        nz.inputs['Distortion'].default_value = distortion
        return nz.outputs['Fac']

    def voronoi(self, su, sv, seed=0.0, feature='F1', rand=1.0, out='Distance', warp=0.0, warp_scale=4.0):
        vec, w = self.torus(su, sv, seed)
        if warp:
            # bend the straight cell edges with a noise offset (cracks, irregular stones)
            nz = self.n.new('ShaderNodeTexNoise')
            nz.noise_dimensions = '4D'
            self.l.new(vec, nz.inputs['Vector'])
            self.l.new(w, nz.inputs['W'])
            nz.inputs['Scale'].default_value = warp_scale
            nz.inputs['Detail'].default_value = 4.0
            off = self.n.new('ShaderNodeVectorMath')
            off.operation = 'MULTIPLY_ADD'
            self.l.new(nz.outputs['Color'], off.inputs[0])
            off.inputs[1].default_value = (warp, warp, warp)
            off.inputs[2].default_value = (-warp / 2, -warp / 2, -warp / 2)
            add = self.n.new('ShaderNodeVectorMath')
            add.operation = 'ADD'
            self.l.new(vec, add.inputs[0])
            self.l.new(off.outputs[0], add.inputs[1])
            vec = add.outputs[0]
        vo = self.n.new('ShaderNodeTexVoronoi')
        vo.voronoi_dimensions = '4D'
        vo.feature = feature
        self.l.new(vec, vo.inputs['Vector'])
        self.l.new(w, vo.inputs['W'])
        vo.inputs['Scale'].default_value = 1.0
        vo.inputs['Randomness'].default_value = rand
        if out == 'Random':
            sep = self.n.new('ShaderNodeSeparateColor')
            self.l.new(vo.outputs['Color'], sep.inputs[0])
            return sep.outputs[0]
        return vo.outputs[out]


_plane = None


def bake_layers(size, build):
    """Bakes up to three procedural scalar fields (returned by build(Nodes)) into a float array (size, size, 3).
    Row 0 of the array is the bottom of the texture (v = 0), like Blender's pixel buffer."""
    global _plane
    sc = bpy.context.scene
    sc.cycles.samples = 4
    sc.render.bake.margin = 0
    if _plane is None or _plane.name not in bpy.data.objects:
        bpy.ops.mesh.primitive_plane_add(size=1)
        _plane = bpy.context.active_object
    mat = bpy.data.materials.new('bake')
    mat.use_nodes = True
    tree = mat.node_tree
    tree.nodes.clear()
    N = Nodes(tree)
    socks = list(build(N))
    while len(socks) < 3:
        socks.append(0.0)
    comb = tree.nodes.new('ShaderNodeCombineColor')
    for s, v in zip(comb.inputs, socks):
        N._in(s, v)
    em = tree.nodes.new('ShaderNodeEmission')
    tree.links.new(comb.outputs[0], em.inputs['Color'])
    out = tree.nodes.new('ShaderNodeOutputMaterial')
    tree.links.new(em.outputs[0], out.inputs['Surface'])
    img = bpy.data.images.new('bake', size, size, float_buffer=True, alpha=False)
    img.colorspace_settings.name = 'Non-Color'
    it = tree.nodes.new('ShaderNodeTexImage')
    it.image = img
    tree.nodes.active = it
    _plane.data.materials.clear()
    _plane.data.materials.append(mat)
    bpy.ops.object.select_all(action='DESELECT')
    _plane.select_set(True)
    bpy.context.view_layer.objects.active = _plane
    bpy.ops.object.bake(type='EMIT')
    px = np.empty(size * size * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    bpy.data.materials.remove(mat)
    return px.reshape(size, size, 4)[:, :, :3].copy()


# ---------------------------------------------------------------- numpy helpers
def blur(a, sigma):
    """Gaussian blur with wrap-around (keeps tiling seamless)."""
    h, w = a.shape[:2]
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.fftfreq(w)[None, :]
    k = np.exp(-2 * (math.pi * sigma) ** 2 * (fx * fx + fy * fy))
    if a.ndim == 3:
        return np.stack([np.real(np.fft.ifft2(np.fft.fft2(a[:, :, i]) * k)) for i in range(a.shape[2])], axis=2)
    return np.real(np.fft.ifft2(np.fft.fft2(a) * k))


def normal_from_height(h, strength):
    """Tangent-space (OpenGL, +Y = +V) normal map from a seamless height field, encoded 0..1."""
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5 * strength
    dy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.5 * strength
    n = np.stack([-dx, -dy, np.ones_like(h)], axis=2)
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return n * 0.5 + 0.5


def cavity(h, sigma, k):
    """Cheap ambient occlusion: pixels lower than their surroundings get darker."""
    return np.clip(1 - k * np.maximum(blur(h, sigma) - h, 0), 0, 1)


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def mix(a, b, t):
    t = np.asarray(t)
    if t.ndim == 2 and np.ndim(a) >= 1 and (np.ndim(a) == 3 or np.ndim(b) == 3 or np.shape(a) == (3,) or np.shape(b) == (3,)):
        t = t[:, :, None]
    return a * (1 - t) + b * t


def srgb(c):
    """Hex colour → linear RGB triple."""
    v = np.array([(c >> 16) & 255, (c >> 8) & 255, c & 255], dtype=np.float32) / 255
    return np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)


def to_srgb(lin):
    lin = np.clip(lin, 0, 1)
    return np.where(lin <= 0.0031308, lin * 12.92, 1.055 * lin ** (1 / 2.4) - 0.055)


def save(rel, rgb, quality=88, color=False, alpha=None):
    """Writes a PNG preview to art/.cache and a WebP into public/assets/<rel>.webp."""
    data = to_srgb(rgb) if color else np.clip(rgb, 0, 1)
    if data.ndim == 2:
        data = np.stack([data] * 3, axis=2)
    h, w = data.shape[:2]
    a = np.ones((h, w, 1), dtype=np.float32) if alpha is None else np.clip(alpha, 0, 1)[:, :, None]
    rgba = np.concatenate([data, a], axis=2).astype(np.float32)
    img = bpy.data.images.new('out', w, h, alpha=alpha is not None, float_buffer=False)
    img.colorspace_settings.name = 'Non-Color'
    img.pixels.foreach_set(rgba.ravel())
    png = os.path.join(TMP, rel.replace('/', '_') + '.png')
    img.filepath_raw = png
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)
    dst = os.path.join(PUBLIC, rel + '.webp')
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    args = ['cwebp', '-quiet', '-q', str(quality), '-m', '6']
    if alpha is not None:
        args += ['-alpha_q', '100', '-exact']
    subprocess.run(args + [png, '-o', dst], check=True)
    print('wrote', dst, os.path.getsize(dst) // 1024, 'KB')
