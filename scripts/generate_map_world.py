"""Build static Blender worlds from the runtime's own obstacle tessellation.

Invoked by maps:generate; stdin carries the selected preset and compiled geometry.
The existing batched architecture canvas keeps detail cheap and sources editable.
Moving machines remain separate assets, with their existing animation and collision.
"""
import json
import random
import sys
from math import cos, sin, pi
from pathlib import Path

import bpy
from mathutils import Matrix, Vector
import generate_eiffel_tower_assets as canvas_tools

STYLES = {
    'standard': {
        'floor': (0.12, 0.18, 0.25), 'body': (0.67, 0.74, 0.79),
        'panel': (0.10, 0.17, 0.23), 'trim': (0.91, 0.56, 0.16),
        'signal': (1.0, 0.55, 0.10), 'foam': (0.10, 0.64, 0.57),
        'tile': 8, 'roughness': 0.62,
    },
    'wind_cathedral': {
        'floor': (0.36, 0.45, 0.49), 'body': (0.80, 0.77, 0.64),
        'panel': (0.30, 0.40, 0.44), 'trim': (0.70, 0.51, 0.24),
        'signal': (0.32, 0.85, 0.94), 'foam': (0.14, 0.55, 0.64),
        'tile': 12, 'roughness': 0.88,
    },
    'chrono_forge_nexus': {
        'floor': (0.19, 0.20, 0.23), 'body': (0.48, 0.36, 0.23),
        'panel': (0.15, 0.20, 0.25), 'trim': (0.71, 0.45, 0.19),
        'signal': (0.06, 0.63, 0.85), 'foam': (0.10, 0.52, 0.50),
        'tile': 20, 'roughness': 0.71,
    },
    'maze': {
        'floor': (0.14, 0.18, 0.21), 'body': (0.55, 0.60, 0.61),
        'panel': (0.11, 0.20, 0.24), 'trim': (0.88, 0.58, 0.23),
        'signal': (0.18, 0.72, 0.86), 'foam': (0.13, 0.58, 0.54),
        'tile': 8, 'roughness': 0.72,
    },
    'complex': {
        'floor': (0.12, 0.16, 0.22), 'body': (0.48, 0.57, 0.70),
        'panel': (0.10, 0.17, 0.29), 'trim': (0.54, 0.72, 0.93),
        'signal': (0.26, 0.82, 1.00), 'foam': (0.10, 0.48, 0.62),
        'tile': 9, 'roughness': 0.58,
    },
    'pyramid': {
        'floor': (0.34, 0.27, 0.18), 'body': (0.73, 0.58, 0.35),
        'panel': (0.31, 0.22, 0.13), 'trim': (0.94, 0.72, 0.35),
        'signal': (1.00, 0.52, 0.12), 'foam': (0.18, 0.57, 0.50),
        'tile': 10, 'roughness': 0.86,
    },
    'vertical_maze': {
        'floor': (0.13, 0.19, 0.23), 'body': (0.58, 0.64, 0.67),
        'panel': (0.10, 0.22, 0.27), 'trim': (0.76, 0.58, 0.32),
        'signal': (0.18, 0.76, 0.94), 'foam': (0.12, 0.58, 0.57),
        'tile': 10, 'roughness': 0.70,
    },
    'trench': {
        'floor': (0.18, 0.17, 0.16), 'body': (0.48, 0.42, 0.35),
        'panel': (0.17, 0.20, 0.20), 'trim': (0.77, 0.50, 0.24),
        'signal': (0.95, 0.47, 0.12), 'foam': (0.12, 0.50, 0.47),
        'tile': 10, 'roughness': 0.82,
    },
}


def xyz(point):
    return (point[0], -point[2], point[1])


def box(canvas, material, point, size, angle=0):
    canvas.box(material, xyz(point), (size[0], size[2], size[1]),
               rotation=(0, 0, angle), decorative=True)


def rosette(canvas, center, radius, points, material, width):
    for i in range(points):
        a = i * 2 * pi / points
        b = (i + 1) * 2 * pi / points
        start = (center[0] + radius * cos(a), center[1], center[2] + radius * sin(a))
        end = (center[0] + radius * cos(b), center[1], center[2] + radius * sin(b))
        canvas.beam(material, xyz(start), xyz(end), width, decorative=True)


def build_ground(canvases, size, style, key, rng):
    sx, _, sz = size
    step = style['tile']
    nx, nz = max(2, round(sx / step)), max(2, round(sz / step))
    dx, dz = sx / nx, sz / nz
    # Four floor quadrants fix the loader origin to the arena centre and -0.12 m.
    # Every raised motif stays within the 0.03 m ground skin.
    for (east, south), canvas in canvases.items():
        box(canvas, 'Floor', ((1 if east else -1)*sx/4, -.056, (1 if south else -1)*sz/4),
            (sx/2, .128, sz/2))
    for ix in range(nx):
        for iz in range(nz):
            x, z = -sx / 2 + (ix + .5) * dx, -sz / 2 + (iz + .5) * dz
            canvas = canvases[(x >= 0, z >= 0)]
            # The ground skin needs a top face, not six faces per paving stone.
            # Vertex tint keeps the alternating stones in the same material batch.
            vertices = [xyz((x + ax*(dx-.09)/2, .021, z + az*(dz-.09)/2))
                        for ax, az in [(-1, -1), (-1, 1), (1, 1), (1, -1)]]
            canvas._add('Floor', True, vertices, [(0, 1, 2, 3)], Matrix.Identity(4))
            colors = canvas.buckets[('Floor', True)][2]
            shade = 1 if rng.random() > .18 else .82
            for i in range(len(colors)-4, len(colors)):
                colors[i] = tuple(v*shade for v in colors[i][:3]) + (1,)
    if key == 'standard':
        for x in (-12, 12):
            for z in (-12, 12):
                c = canvases[(x >= 0, z >= 0)]
                box(c, 'Trim', (x, .025, z), (18, .008, .15))
                box(c, 'Trim', (x, .025, z), (.15, .008, 18))
                rosette(c, (x * 2.3, .025, z * 2.3), 5, 16, 'Signal', .045)
    elif key == 'wind_cathedral':
        c = canvases[(True, True)]
        for radius in (17, 18, 34, 36):
            rosette(c, (0, .025, 0), radius, 32, 'Trim', .06)
        for angle in range(12):
            a = angle * pi / 6
            c.beam('Trim', xyz((18*cos(a), .025, 18*sin(a))),
                                    xyz((34*cos(a), .025, 34*sin(a))), .07, decorative=True)
    else:
        for side in (-1, 1):
            c = canvases[(side > 0, True)]
            box(c, 'Signal', (side * sx * .24, .025, 0), (sx * .38, .008, .14))


def detail_box(canvas, obstacle, key, arena_size):
    if obstacle.get('tunnel') or obstacle.get('shape') or obstacle.get('rotateY'):
        return
    x, y, z = obstacle['pos']
    w, h, d = obstacle['size']
    if min(w, h, d) < .8:
        return
    limit_x, limit_z = arena_size[0] / 2, arena_size[2] / 2

    def x_face_fits(side, offset, thickness):
        return abs(x + side * (w / 2 + offset)) + thickness / 2 <= limit_x + .001

    def z_face_fits(side, offset, thickness):
        return abs(z + side * (d / 2 + offset)) + thickness / 2 <= limit_z + .001

    # Shallow cladding only: never place a decorative solid across a flight gap.
    if h > max(w, d) * 1.4:
        for side in (-1, 1):
            for fraction in (-.28, .28):
                if z_face_fits(side, .012, .02):
                    box(canvas, 'Panel', (x + fraction*w, y, z + side*(d/2+.012)),
                        (max(.08, w*.07), h*.8, .02))
                if x_face_fits(side, .012, .02):
                    box(canvas, 'Panel', (x + side*(w/2+.012), y, z + fraction*d),
                        (.02, h*.8, max(.08, d*.07)))
        for level in (-.40, .36):
            for side in (-1, 1):
                if z_face_fits(side, .014, .025):
                    box(canvas, 'Trim', (x, y + h*level, z + side*(d/2+.014)), (w, .12, .025))
                if x_face_fits(side, .014, .025):
                    box(canvas, 'Trim', (x + side*(w/2+.014), y+h*level, z), (.025, .12, d))
        if key != 'wind_cathedral':
            for side in (-1, 1):
                if z_face_fits(side, .015, .025):
                    box(canvas, 'Signal', (x, y+h*.23, z+side*(d/2+.015)), (w*.6, .14, .025))
    else:
        for side in (-1, 1):
            if z_face_fits(side, .012, .02):
                box(canvas, 'Trim', (x, y+h*.24, z+side*(d/2+.012)), (w, .12, .02))
            if x_face_fits(side, .012, .02):
                box(canvas, 'Trim', (x+side*(w/2+.012), y+h*.24, z), (.02, .12, d))


def generate(key, output_dir=None):
    payload = json.load(sys.stdin)
    if payload.get('key') != key or key not in STYLES:
        raise ValueError('World input must match the selected registered map.')
    style = STYLES[key]
    definition = payload['definition']
    size = definition['size']
    scene = canvas_tools.reset_scene(key)
    scene['map_key'] = key
    scene['layout_version'] = definition.get('layoutVersion', 1)
    scene['seed'] = str(payload['seed'])
    scene['geometry_digest'] = payload['geometryDigest']
    rng = random.Random(payload['seed'])
    for name, field in [('Floor', 'floor'), ('Body', 'body'), ('Panel', 'panel'),
                        ('Trim', 'trim'), ('Signal', 'signal'), ('Foam', 'foam')]:
        canvas_tools.MATERIAL_COLORS[name] = ((*style[field], 1), .65 if name == 'Signal' else 0,
                                             .35 if name == 'Trim' else .05)
    canvases = {(x, z): canvas_tools.Canvas() for x in (False, True) for z in (False, True)}
    build_ground(canvases, size, style, key, rng)
    for mesh in payload['meshes']:
        positions, indices = mesh['positions'], mesh['indices']
        vertices = [xyz(positions[i:i+3]) for i in range(0, len(positions), 3)]
        faces = [indices[i:i+3] for i in range(0, len(indices), 3)]
        center = sum((Vector(v) for v in vertices), Vector()) / len(vertices)
        canvas = canvases[(center.x >= 0, center.y <= 0)]
        canvas._add('Foam' if mesh['kind'] == 'foam' else 'Body', True, vertices, faces, Matrix.Identity(4))
        detail_box(canvas, mesh['authored'], key, size)
    meshes = []
    for (east, south), canvas in canvases.items():
        meshes.extend(canvas.emit(f'world_{int(east)}{int(south)}'))
    for material in bpy.data.materials:
        material.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value = style['roughness']
        material.use_backface_culling = True
    # Bake only fixed surroundings. The animated assets never pass through this exporter.
    canvas_tools.AO_DISTANCE = 3
    canvas_tools.AO_EDGE = 8
    canvas_tools.AO_MIN_FACE_AREA = 400
    canvas_tools.bake_ambient_occlusion(meshes, distance=3, samples=32)
    canvas_tools.prune_neutral_vertex_colors()
    for obj in meshes:
        if any(token in obj.name for token in ('floor', 'tile', 'signal', 'trim', 'panel')):
            obj.name = obj.name.replace('_nocol', '_noshadow_nocol')
    bpy.context.view_layer.update()
    lows, highs = canvas_tools.scene_bounds()
    model = next((entry for entry in definition.get('glbModels', ())
                  if f'/maps/{key}/' in entry.get('url', '')), None)
    authored_floor = float(model.get('position', (0, -.12, 0))[1]) if model else -.12
    expected = (-size[0]/2, -size[2]/2, authored_floor)
    if any(abs(lows[i]-expected[i]) > .002 for i in range(3)):
        raise ValueError(f'World exceeds its stable placement bounds: {lows}, expected {expected}')
    if abs(highs[0]-size[0]/2) > .002 or abs(highs[1]-size[2]/2) > .002:
        raise ValueError('World geometry extends beyond the authored arena.')
    triangles = canvas_tools.triangle_count()
    if triangles > 30000 or len(meshes) > 32:
        raise ValueError(f'World budget exceeded: {triangles} triangles, {len(meshes)} draws')
    root = (output_dir or Path(__file__).resolve().parents[1]).resolve()
    directory = root / 'assets/maps' / key
    for child in ('blender', 'glb'):
        (directory / child).mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(directory/'blender/01_world.blend'), check_existing=False)
    bpy.ops.export_scene.gltf(filepath=str(directory/'glb/01_world.glb'), export_format='GLB',
        export_animations=False, export_yup=True, export_cameras=False, export_lights=False,
        export_extras=True, export_apply=True, export_vertex_color='ACTIVE', export_all_vertex_colors=False)
    print(f'{key}: {triangles} triangles, {len(meshes)} draws, placement [0, -0.12, 0]')
