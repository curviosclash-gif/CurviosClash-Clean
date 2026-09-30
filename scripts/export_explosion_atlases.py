"""Bake source volume lobes and their motion; keep all authoring scenes intact.

Blender: --python scripts/export_explosion_atlases.py -- --tiles <outside-repo> --profiles ground-rocket air-compact
Python/Pillow: scripts/export_explosion_atlases.py --pack --tiles <outside-repo>
"""
import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'assets/vfx/conventional-runtime'
FRAMES = [1, 5, 10, 18, 28, 42, 56, 72]
TILE = 128
PROFILES = [
    ('ground-tnt', 'conventional-explosions/01_tnt_ground.blend'),
    ('ground-grenade', 'conventional-explosions/02_grenade.blend'),
    ('ground-rocket', 'conventional-explosions/03_rocket_impact.blend'),
    ('ground-fuel', 'conventional-explosions/04_fuel_flash.blend'),
    ('ground-breach', 'conventional-explosions/05_breaching_charge.blend'),
    *[(name, f'airburst-explosions/airburst-v{i:02d}/source.blend') for i, name in enumerate(
        ['air-compact', 'air-fragment', 'air-elongated', 'air-fuel', 'air-secondary'], 1)],
]


def layer_of(obj):
    if obj.type != 'MESH':
        return None
    name = obj.name.lower()
    if 'smoke billow' in name:
        return 'smoke'
    if 'flame' in name or 'hot pressure core' in name:
        return 'fire'
    return None


def bake(profile, source, tiles, metadata_only=False):
    import bpy
    from mathutils import Vector
    bpy.ops.wm.open_mainfile(filepath=str(ROOT / 'assets/vfx' / source))
    scene = bpy.context.scene
    objects = [(obj, layer_of(obj)) for obj in scene.objects if layer_of(obj)]
    cards = []
    for obj, layer in objects:
        lo = [min(v.co[a] for v in obj.data.vertices) for a in range(3)]
        hi = [max(v.co[a] for v in obj.data.vertices) for a in range(3)]
        center = Vector([(lo[a]+hi[a])/2 for a in range(3)])
        poses = []
        for frame in FRAMES:
            scene.frame_set(frame)
            p = obj.matrix_world @ center
            # Authoring is Z-up; runtime is Y-up, with the same handedness.
            poses.append([round(v, 5) for v in [p.x, p.z, -p.y,
                (hi[0]-lo[0])*abs(obj.scale.x), (hi[2]-lo[2])*abs(obj.scale.z),
                (hi[1]-lo[1])*abs(obj.scale.y)]])
        cluster = re.search(r'billow (\d+)-', obj.name)
        cards.append(dict(layer=layer, poses=poses,
            delay=int(cluster.group(1))*7 if profile == 'air-secondary' and cluster else 0))
    peak = max(max(p[3], p[4], p[5]) for card in cards if card['layer'] == 'fire' for p in card['poses'])
    payload = dict(source=source, referenceRadius=peak/2, cards=cards)
    (tiles / f'{profile}.json').write_text(json.dumps(payload, separators=(',', ':')), encoding='utf-8')
    if metadata_only:
        return
    for obj in scene.objects:
        if obj.type == 'MESH' or obj.type == 'LIGHT' and obj.data.type == 'POINT':
            obj.hide_render = True
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
    scene.eevee.taa_render_samples = 16
    scene.eevee.volumetric_samples = 48
    scene.eevee.volumetric_tile_size = '2'
    scene.render.resolution_x = scene.render.resolution_y = TILE
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.image_settings.color_depth = '8'
    camera = scene.camera
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = 3.1
    # Two opposing source views; per-camera selection is made in the target shader.
    for layer in ['fire', 'smoke']:
        original = next(obj for obj, role in objects if role == layer)
        node = original.copy()
        node.data = original.data.copy()
        node.animation_data_clear()
        node.data.materials.clear()
        node.data.materials.append(original.data.materials[0].copy())
        for vertex in node.data.vertices:
            vertex.co /= max(v.co.length for v in original.data.vertices)
        scene.collection.objects.link(node)
        node.hide_render = False
        node.location = (0, 0, 0)
        node.scale = (1, 1, 1)
        node.rotation_euler = (0, 0, 0)
        for view in range(2):
            camera.location = (0, -6 if view == 0 else 6, 1.4)
            camera.rotation_euler = (-camera.location).to_track_quat('-Z', 'Y').to_euler()
            for index, frame in enumerate(FRAMES):
                scene.frame_set(frame)
                # Cooling inputs retain the source animation. Turbulence advances without a simulation cache.
                for material_node in node.data.materials[0].node_tree.nodes:
                    if material_node.type == 'TEX_NOISE' and material_node.noise_dimensions == '4D':
                        material_node.inputs['W'].default_value = frame*.035 + (2 if layer == 'smoke' else 0)
                scene.render.filepath = str(tiles / f'{profile}-{layer}-{view}-{index}.png')
                bpy.ops.render.render(write_still=True)
                print(f'BAKED {profile} {layer} {view} {index}', flush=True)
        bpy.data.objects.remove(node, do_unlink=True)


def pack(tiles):
    from PIL import Image
    OUTPUT.mkdir(parents=True, exist_ok=True)
    manifest = dict(tile=TILE, columns=16, rows=10, frames=FRAMES, profiles={})
    for layer in ['fire', 'smoke']:
        atlas = Image.new('RGBA', (TILE*16, TILE*10))
        for row, (name, _) in enumerate(PROFILES):
            metadata = tiles / f'{name}.json'
            if not metadata.exists():
                continue
            manifest['profiles'][name] = dict(row=row, **json.loads(metadata.read_text(encoding='utf-8')))
            for view in range(2):
                for frame in range(8):
                    with Image.open(tiles / f'{name}-{layer}-{view}-{frame}.png') as tile:
                        alpha = tile.getchannel('A')
                        # A hard edge in any tile would be visible on every billboard.
                        edges = [alpha.crop((0, 0, TILE, 2)), alpha.crop((0, TILE-2, TILE, TILE)),
                                 alpha.crop((0, 0, 2, TILE)), alpha.crop((TILE-2, 0, TILE, TILE))]
                        if any(edge.getextrema()[1] > 2 for edge in edges):
                            raise RuntimeError(f'Clipped alpha: {name} {layer} {view} {frame}')
                        atlas.paste(tile, ((view*8+frame)*TILE, row*TILE))
        atlas.save(OUTPUT / f'{layer}-atlas.png', optimize=True)
    (OUTPUT/'profiles.json').write_text(json.dumps(manifest, separators=(',', ':')), encoding='utf-8')
    print('PACKED', ', '.join(manifest['profiles']))


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else sys.argv[1:]
    parser = argparse.ArgumentParser()
    parser.add_argument('--tiles', type=Path, required=True)
    parser.add_argument('--profiles', nargs='*', default=[p[0] for p in PROFILES])
    parser.add_argument('--pack', action='store_true')
    parser.add_argument('--metadata-only', action='store_true')
    options = parser.parse_args(args)
    if options.pack:
        pack(options.tiles)
    else:
        options.tiles.mkdir(parents=True, exist_ok=True)
        for profile, source in PROFILES:
            if profile in options.profiles:
                bake(profile, source, options.tiles, options.metadata_only)
