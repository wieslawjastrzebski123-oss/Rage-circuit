"""
Bakes a track's ground lighting (see src/game/render/groundBake.ts for the channel layout).
Input comes from art/export-track-layout.ts; run both with `npm run art:ground -- <track>`.
"""
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(__file__))
from common import TMP, blur, reset_scene, save, smooth  # noqa: E402

AO_DISTANCE = 110  # world units (~10 m)


def use_gpu(sc):
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for kind in ('METAL', 'OPTIX', 'CUDA', 'HIP'):
        try:
            prefs.compute_device_type = kind
        except TypeError:
            continue
        prefs.get_devices()
        gpus = [d for d in prefs.devices if d.type == kind]
        if gpus:
            for d in prefs.devices:
                d.use = d.type == kind
            sc.cycles.device = 'GPU'
            print('baking on', gpus[0].name)
            return


def main():
    sc = reset_scene()
    use_gpu(sc)
    track = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'industrial'
    area = json.load(open(os.path.join(TMP, f'{track}_layout.json')))
    x0, z0, W, H, px, py = (area[k] for k in ('x0', 'z0', 'width', 'height', 'px', 'py'))
    # the game's sun (src/game/render/environments.ts)
    sun_el = math.radians(area['sunElevation'])
    sun_az = math.radians(area['sunAzimuth'])

    bpy.ops.wm.obj_import(filepath=os.path.join(TMP, f'{track}_layout.obj'), forward_axis='NEGATIVE_Z', up_axis='Y')

    # receiver: the ground seen from above, UVs matching the game's lookup
    corners = [(x0, z0), (x0 + W, z0), (x0 + W, z0 + H), (x0, z0 + H)]
    mesh = bpy.data.meshes.new('ground')
    mesh.from_pydata([(x, -z, 0.3) for x, z in corners], [], [(0, 1, 2, 3)])
    uv = mesh.uv_layers.new()
    for li, loop in enumerate(mesh.loops):
        x, z = corners[loop.vertex_index]
        uv.data[li].uv = ((x - x0) / W, 1 - (z - z0) / H)
    if mesh.polygons[0].normal.z < 0:
        mesh.flip_normals()
    ground = bpy.data.objects.new('ground', mesh)
    sc.collection.objects.link(ground)

    mat = bpy.data.materials.new('ground')
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (1, 1, 1, 1)
    bsdf.inputs['Roughness'].default_value = 1
    img = bpy.data.images.new('bake', px, py, float_buffer=True, alpha=False)
    img.colorspace_settings.name = 'Non-Color'
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    nt.nodes.active = tex
    mesh.materials.append(mat)

    world = bpy.data.worlds.new('w')
    sc.world = world
    world.light_settings.distance = AO_DISTANCE

    # sun matching the game: three's (x, y, z) direction becomes Blender's (x, -z, y)
    phi = math.pi / 2 - sun_el
    d3 = (math.sin(phi) * math.sin(sun_az), math.cos(phi), math.sin(phi) * math.cos(sun_az))
    sun_dir = Vector((d3[0], -d3[2], d3[1])).normalized()
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 1.0
    sun.data.angle = math.radians(1.2)
    sun.rotation_mode = 'QUATERNION'
    sun.rotation_quaternion = sun_dir.to_track_quat('Z', 'Y')
    sc.collection.objects.link(sun)

    bpy.ops.object.select_all(action='DESELECT')
    ground.select_set(True)
    bpy.context.view_layer.objects.active = ground
    sc.render.bake.margin = 0

    def bake(kind, samples, **kw):
        sc.cycles.samples = samples
        bpy.ops.object.bake(type=kind, **kw)
        a = np.empty(px * py * 4, dtype=np.float32)
        img.pixels.foreach_get(a)
        return a.reshape(py, px, 4)[:, :, 0].copy()

    print('== ambient occlusion')
    ao = bake('AO', 96)
    print('== sun shadow')
    # direct diffuse light on a white, flat receiver, divided by its unshadowed value
    sc.render.bake.use_pass_direct = True
    sc.render.bake.use_pass_indirect = False
    sc.render.bake.use_pass_color = False
    lit = bake('DIFFUSE', 24, pass_filter={'DIRECT'})
    shadow = np.clip(lit / max(np.percentile(lit, 99.5), 1e-4), 0, 1)

    # ---- large-scale variation + rubbered-in racing line
    rng = np.random.default_rng(3)
    n1 = blur(rng.standard_normal((py, px)), 70)
    n2 = blur(rng.standard_normal((py, px)), 18)
    n3 = blur(rng.standard_normal((py, px)), 4)
    norm = lambda a: a / (a.std() + 1e-9)
    macro = 0.5 + 0.055 * norm(n1) + 0.03 * norm(n2)
    dist = np.fromfile(os.path.join(TMP, f'{track}_rubber.f32'), dtype=np.float32).reshape(py, px)
    breakup = smooth(-1.2, 1.0, norm(n2) + 0.6 * norm(n3))
    rubber = np.exp(-((dist / 17.0) ** 2)) * (0.45 + 0.55 * breakup)
    macro = macro - 0.16 * rubber

    # neutral border so clamped lookups outside the area stay clean
    yy, xx = np.mgrid[0:py, 0:px]
    edge = np.minimum(np.minimum(xx, px - 1 - xx), np.minimum(yy, py - 1 - yy))
    fade = smooth(0, 40, edge)
    ao = 1 - (1 - np.clip(ao, 0, 1)) * fade
    shadow = 1 - (1 - shadow) * fade
    macro = 0.5 + (macro - 0.5) * fade

    out = np.stack([ao, shadow, np.clip(macro, 0, 1)], axis=2)
    print('ao mean %.3f shadow mean %.3f' % (ao.mean(), shadow.mean()))
    save(f'tex/bake_{track}', out, quality=90)


main()
