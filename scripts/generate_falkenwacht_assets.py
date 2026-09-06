#!/usr/bin/env python3
"""Author Falkenwacht from primitives: blender --background --python scripts/generate_falkenwacht_assets.py.

All design coordinates are map X, height, Z (south is positive Z). The existing
batched Blender canvas supplies geometry/export primitives; no downloaded architecture.
The generated placement module is runtime asset data, including conservative fallback
boxes from the SAME solid boxes as the art. No fallback box spans an arch opening.
"""
import json
import sys
from math import pi, sin, cos
from pathlib import Path

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import generate_eiffel_tower_assets as toolkit

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'assets/maps/burg_falkenwacht'
PRESET = ROOT / 'src/core/config/maps/presets/burg_falkenwacht'
FPS = 30
MATERIALS = {
    'Stone': ((0.48, 0.43, 0.34, 1), 0, 0),
    'Ashlar': ((0.64, 0.57, 0.45, 1), 0, 0),
    'Mortar': ((0.35, 0.32, 0.27, 1), 0, 0),
    'Roof': ((0.39, 0.095, 0.045, 1), 0, 0),
    'RoofLight': ((0.53, 0.17, 0.075, 1), 0, 0),
    'Wood': ((0.19, 0.095, 0.043, 1), 0, 0),
    'Planks': ((0.36, 0.21, 0.10, 1), 0, 0),
    'Iron': ((0.12, 0.13, 0.14, 1), 0, 0.7),
    'Grass': ((0.22, 0.29, 0.105, 1), 0, 0),
    'Earth': ((0.32, 0.26, 0.16, 1), 0, 0),
    'Paving': ((0.47, 0.43, 0.35, 1), 0, 0),
    'Blue': ((0.045, 0.15, 0.37, 1), 0, 0),
    'Red': ((0.48, 0.045, 0.026, 1), 0, 0),
    'Gold': ((0.86, 0.56, 0.12, 1), 0, 0.15),
    'Flame': ((1, 0.34, 0.035, 1), 2.8, 0),
}
toolkit.MATERIAL_COLORS.update(MATERIALS)
fallback = []
models = []


def xyz(p):
    return (p[0], -p[2], p[1])


def box(c, material, p, size, decorative=False, collision=True):
    c.box(material, xyz(p), (size[0], size[2], size[1]), decorative=decorative)
    if collision and not decorative:
        fallback.append({'pos': list(p), 'size': list(size)})


def masonry(c, p, size):
    """Solid substrate plus shallow, staggered face stones batched into one mesh."""
    box(c, 'Stone', p, size)
    x, y, z = p
    w, h, d = size
    along_x = w >= d
    length = w if along_x else d
    for row in range(int(h // 5)):
        height = y - h / 2 + 2.5 + row * 5
        offset = 5.6 if row % 2 else 0
        for col in range(int(length // 11.2)):
            u = -length / 2 + 5.6 + col * 11.2 + offset
            if u + 5.5 > length / 2:
                continue
            for sign in (-1, 1):
                pos = (x + u, height, z + sign * (d / 2 + .035)) if along_x else (
                    x + sign * (w / 2 + .035), height, z + u)
                dims = (10.9, 4.8, .12) if along_x else (.12, 4.8, 10.9)
                box(c, 'Ashlar' if (col + row) % 4 else 'Mortar', pos, dims, True)


def wall(c, x, z, length, base=12, height=32, axis='x'):
    dims = (length, height, 6) if axis == 'x' else (6, height, length)
    masonry(c, (x, base + height / 2, z), dims)
    for i in range(int(length // 9)):
        u = -length / 2 + 4.5 + i * 9
        p = (x + u, base + height + 2, z) if axis == 'x' else (x, base + height + 2, z + u)
        box(c, 'Ashlar', p, (4.5, 4, 6) if axis == 'x' else (6, 4, 4.5))


def arch(c, x, z, width=36, base=12, spring=19, depth=6, axis='x'):
    """Open round arch; width is the clear opening, local U runs across the gate."""
    r = width / 2
    def point(u, y, v):
        return (x + u, y, z + v) if axis == 'x' else (x + v, y, z + u)
    for sign in (-1, 1):
        dims = (5, spring, depth) if axis == 'x' else (depth, spring, 5)
        masonry(c, point(sign * (r + 2.5), base + spring / 2, 0), dims)
    # Wedge voussoirs form the visible AND collidable vault; no box across the opening.
    verts, faces = [], []
    for i in range(16):
        a, b = pi * i / 16, pi * (i + 1) / 16
        o = len(verts)
        for v in (-depth / 2, depth / 2):
            for radius, angle in ((r, a), (r + 4, a), (r + 4, b), (r, b)):
                verts.append(xyz(point(radius * cos(angle), base + spring + radius * sin(angle), v)))
        faces.extend(tuple(o + k for k in f) for f in toolkit.CUBE_FACES)
    from mathutils import Matrix
    c._add('Ashlar', False, verts, faces, Matrix.Identity(4))


def roof(c, x, z, w, d, y, rise):
    # Roof ridge runs along Z; an actual pitched solid, not an enclosing box.
    verts = [xyz(v) for v in [(x-w/2,y,z-d/2),(x+w/2,y,z-d/2),(x,y+rise,z-d/2),
                             (x-w/2,y,z+d/2),(x+w/2,y,z+d/2),(x,y+rise,z+d/2)]]
    from mathutils import Matrix
    c._add('Roof', False, verts, [(2,1,0),(3,4,5),(0,1,4,3),(1,2,5,4),(2,0,3,5)], Matrix.Identity(4))
    for i in range(1, 9):
        t = i / 9
        for sign in (-1, 1):
            c.beam('RoofLight', xyz((x + sign*w/2*(1-t), y+rise*t+.15, z-d/2)),
                   xyz((x + sign*w/2*(1-t), y+rise*t+.15, z+d/2)), .18, decorative=True)


def tower(c, x, z, height=66):
    # Square medieval mural tower with a transverse upper passage and corbelled crown.
    masonry(c, (x, 12 + (height-26)/2, z), (25, height-26, 25))
    for dx in (-10, 10):
        for dz in (-10, 10):
            masonry(c, (x+dx, height-1, z+dz), (5, 26, 5))
    box(c, 'Ashlar', (x, height+13, z), (29, 3, 29))
    roof(c, x, z, 33, 33, height+14.5, 17)
    for dx in (-10, 10):
        box(c, 'Wood', (x+dx, 30, z+12.7), (1, 5, .2), True)


def terrain(c):
    box(c, 'Grass', (0, 1, 0), (456, 2, 356))
    box(c, 'Earth', (0, 5, 0), (318, 6, 222))
    box(c, 'Paving', (0, 10, 53), (288, 4, 130))
    box(c, 'Paving', (0, 14, -58), (288, 8, 106))
    # Southern apron ends before the moat; lateral causeways supply permanent alternatives.
    box(c, 'Earth', (0, 7, 164), (180, 10, 28))
    for x in (-184, 184):
        box(c, 'Earth', (x, 5, 0), (24, 6, 310))
    for z in (-144, 136):
        for x in range(-210, 220, 14):
            if z > 0 and abs(x) < 30:
                continue
            box(c, 'Ashlar', (x, 3, z), (5, 2, 7), True)


def curtain(c):
    for x in (-145, 145):
        wall(c, x, 0, 236, axis='z')
    wall(c, 0, -118, 290)
    for x in (-91, 91):
        wall(c, x, 118, 108)


def gatehouse(c):
    for x in (-31, 31):
        tower(c, x, 118, 65)
    arch(c, 0, 118, 36, spring=21, depth=16)
    # Upper chamber sits above the rounded arch crown.
    masonry(c, (0, 64, 118), (39, 14, 19))
    roof(c, 0, 118, 43, 23, 71, 12)
    for x in (-19, 19):
        box(c, 'Iron', (x, 34, 127), (1, 28, 1), True)


def outer_buildings(c):
    # Stable: north and south portals, open central flight aisle.
    for x in (-107, -63):
        masonry(c, (x, 30.5, 45), (4, 37, 54))
    for z in (18, 72):
        arch(c, -85, z, 36, spring=14, depth=4)
    roof(c, -85, 45, 52, 62, 49, 14)
    for z in (27, 43, 59):
        for x in (-104, -66):
            box(c, 'Wood', (x, 20, z), (2, 16, 2))
    # Smithy has open sides below the supported roof and a clearly solid chimney.
    for x in (70, 108):
        for z in (43, 78):
            box(c, 'Wood', (x, 25, z), (3, 26, 3))
    roof(c, 89, 60, 48, 45, 39, 15)
    masonry(c, (113, 33, 78), (9, 42, 9))
    box(c, 'Iron', (108, 17, 69), (7, 6, 4))


def inner_wall(c):
    for x in (-88, 88):
        wall(c, x, 0, 114, base=18, height=32)
    arch(c, 0, 0, 36, base=18, spring=20, depth=9)
    for x in (-25, 25):
        masonry(c, (x, 43, 0), (10, 50, 13))
    box(c, 'Wood', (0, 69, 0), (60, 3, 17))
    roof(c, 0, 0, 64, 21, 71, 13)


def palas(c):
    masonry(c, (80, 38.5, -34), (88, 41, 4))
    masonry(c, (63, 38.5, -78), (54, 41, 4))
    arch(c, 108, -78, 28, base=18, spring=18, depth=4)
    for x in (36, 124):
        arch(c, x, -56, 36, base=18, spring=18, depth=4, axis='z')
    roof(c, 80, -56, 96, 52, 59, 23)
    # Buttresses are outside the longitudinal flight aisle.
    for x in (46, 67, 88, 109):
        for z in (-81, -31):
            masonry(c, (x, 30, z), (4, 24, 4))


def arcade(c):
    # North gallery is open along X; repeated arches face both courtyards.
    for x in (40, 70, 100):
        for z in (-92, -112):
            arch(c, x, z, 22, base=18, spring=16, depth=3)
    box(c, 'Ashlar', (70, 50, -102), (91, 3, 25))
    for x in (26, 114):
        box(c, 'Ashlar', (x, 53, -102), (3, 3, 25))


def towers(c):
    for x in (-145, 145):
        for z in (-118, 118):
            tower(c, x, z)


def keep(c):
    # Bergfried: a massive base, two open transverse galleries, and the tallest roof.
    x, z = -64, -78
    masonry(c, (x, 33, z), (44, 30, 44))
    for dx in (-19, 19):
        for dz in (-19, 19):
            masonry(c, (x+dx, 76, z+dz), (6, 56, 6))
    for y in (72, 103):
        box(c, 'Ashlar', (x, y, z), (47, 3, 47))
    roof(c, x, z, 53, 53, 105, 26)
    for sign in (-1, 1):
        box(c, 'Wood', (x+sign*22.2, 34, z), (.3, 6, 1), True)


def rig(name, position):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.location = xyz(position)
    return obj


def key(obj, prop, second):
    obj.keyframe_insert(data_path=prop, frame=1+round(second*FPS))


def drawbridge():
    pivot = rig('drawbridge_hinge', (0, 12, 118))
    deck = toolkit.Canvas()
    box(deck, 'Planks', (0, 0, 17), (34, 3, 34), collision=False)
    for x in (-15, 15):
        box(deck, 'Iron', (x, .1, 17), (.7, 3.4, 34), collision=False)
        deck.beam('Iron', xyz((x, 0, 32)), xyz((x, 29, 0)), .5, decorative=True)
    for z in range(2, 34, 3):
        box(deck, 'Wood', (0, 1.55, z), (33, .1, .2), True)
    deck.emit('drawbridge', pivot)
    for t, angle in ((0,0),(8,0),(12,-pi/2),(20,-pi/2),(24,0)):
        pivot.rotation_euler.x = angle
        key(pivot, 'rotation_euler', t)


def portcullis():
    lift = rig('portcullis_lift', (0, 18, 0))
    grating = toolkit.Canvas()
    # The clear gap stays narrower than the standard aircraft diameter. A closed
    # gate cannot be bypassed by slipping between two otherwise decorative bars.
    for x in range(-17, 18):
        box(grating, 'Iron', (x, 12, 0), (.55, 24, 1.2), collision=False)
    for y in (2, 8, 14, 20, 24):
        box(grating, 'Wood', (0, y, 0), (35, 1.3, 1.7), collision=False)
    grating.emit('portcullis', lift)
    weight = rig('gate_counterweights', (0, 18, 0))
    cw = toolkit.Canvas()
    for x in (-25, 25):
        box(cw, 'Iron', (x, 0, 0), (3, 5, 3), True)
        box(cw, 'Iron', (x, 12, 0), (.4, 24, .4), True)
    cw.emit('counterweights', weight)
    for t, raised in ((0,26),(4,26),(6,0),(10,0),(12,26)):
        lift.location.z = 18 + raised
        weight.location.z = 55 - raised
        key(lift, 'location', t)
        key(weight, 'location', t)


def banners():
    for index, (x,y,z,color) in enumerate(((-31,83,118,'Blue'),(31,83,118,'Blue'),
                                          (-64,131,-78,'Red'),(-145,98,-118,'Red'),(145,98,-118,'Red'))):
        pole = toolkit.Canvas()
        box(pole, 'Wood', (x, y+5, z), (.6, 10, .6), True)
        pole.emit(f'pole_{index}')
        parent = rig(f'banner_{index}', (x,y+8,z))
        cloth = toolkit.Canvas()
        box(cloth, color, (4,-2,0), (8,4,.15), True)
        box(cloth, 'Gold', (4,-2,-.1), (.7,3,.1), True)
        cloth.emit(f'flag_{index}', parent)
        for t, angle in ((0,0),(1,.16),(2,0),(3,-.16),(4,0)):
            parent.rotation_euler.z = angle
            key(parent, 'rotation_euler', t)
    flames = toolkit.Canvas()
    for x,y,z in ((-18,30,127),(18,30,127),(-24,34,8),(24,34,8),(55,34,-33),(100,34,-33)):
        box(flames, 'Iron', (x,y-2,z), (1,4,1), True)
        flames.frustum('Flame', xyz((x,y+1,z)), 1.2, 0, 4, 7, decorative=True)
    flames.emit('torches')


def export(stem, builder, clip=None, duration=0):
    scene = toolkit.reset_scene(clip or stem, duration)
    if clip:
        builder()
    else:
        canvas = toolkit.Canvas()
        builder(canvas)
        canvas.emit(stem)
    scene.frame_set(1)
    bpy.context.view_layer.update()
    for material in bpy.data.materials:
        if material.use_nodes:
            material.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value = .86
    lows, highs = toolkit.scene_bounds()
    position = [(lows[0]+highs[0])/2, lows[2], -(lows[1]+highs[1])/2]
    models.append({'id': f'falkenwacht-{stem}', 'url': f'assets/maps/burg_falkenwacht/glb/{stem}.glb',
                   'position': [round(v, 5) for v in position], 'rotation': [0,0,0], 'scale': 1,
                   **({'animationClock': {'clipName': clip, 'phaseOffsetBeats': 0}} if clip else {})})
    triangles = toolkit.triangle_count()
    assert triangles <= (6000 if clip else 18000), (stem, triangles)
    bpy.ops.wm.save_as_mainfile(filepath=str(ASSETS/'blender'/f'{stem}.blend'), check_existing=False)
    bpy.ops.export_scene.gltf(filepath=str(ASSETS/'glb'/f'{stem}.glb'), export_format='GLB',
        export_animations=bool(clip), export_animation_mode='SCENE', export_anim_scene_split_object=False,
        export_anim_slide_to_zero=True, export_yup=True, export_cameras=False, export_lights=False,
        export_extras=True, export_apply=True)
    print(f'{stem}: {triangles} triangles, placement {position}')


def main():
    for directory in (ASSETS/'blender', ASSETS/'glb', PRESET):
        directory.mkdir(parents=True, exist_ok=True)
    for stem, builder in [('01_terrain',terrain),('02_curtain',curtain),('03_gatehouse',gatehouse),
                          ('04_outer_buildings',outer_buildings),('05_inner_wall',inner_wall),
                          ('06_palas',palas),('07_arcade',arcade),('08_towers',towers),('09_keep',keep)]:
        export(stem, builder)
    export('10_drawbridge', drawbridge, 'DrawbridgeLoop', 24)
    export('11_portcullis', portcullis, 'PortcullisLoop', 12)
    export('12_banners', banners, 'BannersLoop', 4)
    header = '// Generated runtime asset placement and fallback collision by scripts/generate_falkenwacht_assets.py.\n'
    (PRESET/'FalkenwachtModels.js').write_text(header +
        'export const FALKENWACHT_MODELS = ' + json.dumps(models, indent=4) + ';\n\n' +
        'export const FALKENWACHT_OBSTACLES = [\n' +
        ''.join('    ' + json.dumps(b) + ',\n' for b in fallback) + '];\n', encoding='utf-8')


if __name__ == '__main__':
    main()
