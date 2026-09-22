"""Bake sixteen smoke shapes, each lit from six directions, from the authored volume noise.
Run with Blender 4.2 in background mode. Outputs two 1024px RGBA atlases (4x4 tiles of
256px): smoke-light-a.png holds the light from right, top and back, smoke-light-b.png from
left, bottom and front, both with the same alpha; plus the editable bake scene. The runtime
mixes the six by the sun direction, so a card lights correctly however it is turned.
`-- --tiles N` bakes only the first N tiles, for a quick look at the light balance.

Tile families, one row each counted from the bottom of the image, so the runtime can
pick a shape by the role of a card:
  row 0  rounded billows      cap, rolled rim and bloom lobes
  row 1  upright column parts the stem and its side plumes (taller than wide)
  row 2  torn wisps           streams, shed edge vortices, entrained air
  row 3  holed billows        fine surface detail
Every tile is centred with a fully transparent border, so mipmaps never bleed.
"""
from pathlib import Path
import sys
import tempfile
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/vfx/torus-explosions/smoke'
TILE = 256
GRID = 4

# (stretch x, depth y, height z), noise scale, roughness gain, warp, hole threshold, lobe gain,
# density. Image x is object X and image y is object Z (the camera looks along +Y). Lobes are
# the coarse bulges that make a cauliflower outline; holes cut soft gaps into the body. Thin
# and holed shapes get more density so their remaining smoke is as opaque as a billow's.
FAMILIES = (
    ((0.92, 0.92, 0.86), 2.6, 0.85, 0.35, 0.00, 0.80, 9),
    ((0.52, 0.56, 1.00), 2.6, 1.10, 0.55, 0.00, 0.95, 12),
    ((1.02, 0.60, 0.46), 3.4, 1.10, 1.00, 0.52, 0.70, 26),
    ((0.90, 0.90, 0.86), 3.0, 0.95, 0.45, 0.57, 0.65, 30),
)
# Six-way lighting: each tile is rendered once per sun direction. The name says where the light
# comes from as seen by the camera (image right, image top, behind the smoke, ...); the vector is
# the direction the sun shines in, in object space (camera looks along +Y, image up is +Z).
SIX_WAY_PASSES = (
    ('right', (-1, 0, 0)), ('left', (1, 0, 0)),
    ('top', (0, 0, -1)), ('bottom', (0, 0, 1)),
    ('back', (0, -1, 0)), ('front', (0, 1, 0)),
)
ATLAS_CHANNELS = {'a': ('right', 'top', 'back'), 'b': ('left', 'bottom', 'front')}
SUN_STRENGTH = 4.0

# Small per-tile variation inside a family, so neighbouring cards never repeat.
VARIANTS = ((1.00, 1.00, 0.00), (0.92, 1.06, 1.70), (1.05, 0.94, 3.10), (0.97, 1.02, 4.60))


def build_material(roughness, detail):
    mat = bpy.data.materials.new('Baked smoke | source billow noise')
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()

    def calc(op, a, b=0):
        node = nodes.new('ShaderNodeMath'); node.operation = op
        for value, socket in zip((a, b), node.inputs):
            if isinstance(value, (int, float)): socket.default_value = value
            else: links.new(value, socket)
        return node.outputs[0]

    def vec(op, a, b=None):
        node = nodes.new('ShaderNodeVectorMath'); node.operation = op
        links.new(a, node.inputs[0])
        if b is not None:
            if isinstance(b, tuple): node.inputs[1].default_value = b
            else: links.new(b, node.inputs[1])
        return node

    coord = nodes.new('ShaderNodeTexCoord')
    stretch = nodes.new('ShaderNodeCombineXYZ'); stretch.name = 'Stretch'
    shaped = vec('DIVIDE', coord.outputs['Object'], stretch.outputs[0])
    warp_noise = nodes.new('ShaderNodeTexNoise'); warp_noise.name = 'Warp'
    warp_noise.noise_dimensions = '4D'; warp_noise.inputs['Scale'].default_value = 1.6
    links.new(shaped.outputs[0], warp_noise.inputs['Vector'])
    centred = vec('SUBTRACT', warp_noise.outputs['Color'], (0.5, 0.5, 0.5))
    warp_amount = nodes.new('ShaderNodeValue'); warp_amount.name = 'Warp amount'
    scaled = vec('SCALE', centred.outputs[0])
    links.new(warp_amount.outputs[0], scaled.inputs['Scale'])
    warped = vec('ADD', shaped.outputs[0], scaled.outputs[0])

    tex = nodes.new('ShaderNodeTexNoise'); tex.name = 'Rolling billows'; tex.noise_dimensions = '4D'
    links.new(warped.outputs[0], tex.inputs['Vector'])
    tex.inputs['Detail'].default_value = detail
    tex.inputs['Roughness'].default_value = roughness
    gain = nodes.new('ShaderNodeValue'); gain.name = 'Roughness gain'
    lobes = nodes.new('ShaderNodeTexNoise'); lobes.name = 'Lobes'; lobes.noise_dimensions = '4D'
    lobes.inputs['Scale'].default_value = 1.3; lobes.inputs['Detail'].default_value = 1
    links.new(warped.outputs[0], lobes.inputs['Vector'])
    lobe_gain = nodes.new('ShaderNodeValue'); lobe_gain.name = 'Lobe gain'
    dist = vec('LENGTH', warped.outputs[0])
    noisy = calc('ADD', dist.outputs['Value'],
                 calc('MULTIPLY', calc('SUBTRACT', tex.outputs['Fac'], .5), gain.outputs[0]))
    noisy = calc('ADD', noisy,
                 calc('MULTIPLY', calc('SUBTRACT', lobes.outputs['Fac'], .5), lobe_gain.outputs[0]))
    density_gain = nodes.new('ShaderNodeValue'); density_gain.name = 'Density'
    density = calc('MULTIPLY', calc('MAXIMUM', calc('SUBTRACT', 1, noisy), 0), density_gain.outputs[0])

    # Holes: a second, coarser noise cuts soft gaps where it falls below the threshold.
    holes = nodes.new('ShaderNodeTexNoise'); holes.name = 'Holes'; holes.noise_dimensions = '4D'
    holes.inputs['Scale'].default_value = 2.4; holes.inputs['Detail'].default_value = 2
    links.new(warped.outputs[0], holes.inputs['Vector'])
    threshold = nodes.new('ShaderNodeValue'); threshold.name = 'Hole threshold'
    keep = calc('MINIMUM', calc('MAXIMUM',
                calc('MULTIPLY', calc('SUBTRACT', holes.outputs['Fac'], threshold.outputs[0]), 12), 0), 1)
    density = calc('MULTIPLY', density, keep)

    volume = nodes.new('ShaderNodeVolumePrincipled')
    volume.inputs['Color'].default_value = (.75, .75, .75, 1)
    links.new(density, volume.inputs['Density'])
    out = nodes.new('ShaderNodeOutputMaterial')
    links.new(volume.outputs['Volume'], out.inputs['Volume'])
    return mat


def configure(mat, family, variant, tile):
    (sx, sy, sz), scale, gain, warp, hole, lobe, density = FAMILIES[family]
    size, tall, seed = VARIANTS[variant]
    nodes = mat.node_tree.nodes
    stretch = nodes['Stretch']
    stretch.inputs[0].default_value = sx * size
    stretch.inputs[1].default_value = sy * size
    stretch.inputs[2].default_value = sz * size * tall
    nodes['Rolling billows'].inputs['Scale'].default_value = scale
    nodes['Rolling billows'].inputs['W'].default_value = tile * 2.73 + 3 + seed
    nodes['Warp'].inputs['W'].default_value = tile * 1.91 + 11
    nodes['Holes'].inputs['W'].default_value = tile * 3.37 + 29
    nodes['Lobes'].inputs['W'].default_value = tile * 4.13 + 47
    nodes['Lobe gain'].outputs[0].default_value = lobe
    nodes['Density'].outputs[0].default_value = density
    nodes['Warp amount'].outputs[0].default_value = warp
    nodes['Roughness gain'].outputs[0].default_value = gain
    nodes['Hole threshold'].outputs[0].default_value = hole


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.open_mainfile(filepath=str(ROOT / 'assets/vfx/torus-explosions/torus-explosion-v01/source.blend'))
    source = bpy.data.materials['Torus smoke | animated physical coordinates']
    roughness = source.node_tree.nodes['Rolling billows'].inputs['Roughness'].default_value
    detail = source.node_tree.nodes['Rolling billows'].inputs['Detail'].default_value
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    # Cycles, not EEVEE: EEVEE's camera-aligned volume shadow grid lets no side light reach
    # the smoke (right/left/top/bottom baked black), and six-way light needs all six.
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 64
    scene.cycles.use_denoising = True
    scene.cycles.volume_step_rate = 1.0
    scene.cycles.max_bounces = 4
    scene.cycles.volume_bounces = 1
    scene.cycles.seed = 7
    scene.render.resolution_x = scene.render.resolution_y = TILE
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.view_settings.view_transform = 'Standard'
    # No ambient light: every pass sees exactly one sun, so each channel is how much of
    # that one direction reaches the camera through the smoke's own shadow.
    scene.world = bpy.data.worlds.new('Dark bake world'); scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value = (0, 0, 0, 1)
    mat = build_material(roughness, detail)
    bpy.ops.mesh.primitive_cube_add(size=3)
    bpy.context.object.name = 'Smoke bake domain'
    bpy.context.object.data.materials.append(mat)
    bpy.ops.object.camera_add(location=(0, -5, 0)); cam = bpy.context.object
    cam.rotation_euler = (Vector((0, 0, 0)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = 3; scene.camera = cam
    sun_data = bpy.data.lights.new('Six-way sun', 'SUN'); sun_data.energy = SUN_STRENGTH
    sun_data.angle = 0.2
    sun = bpy.data.objects.new(sun_data.name, sun_data); scene.collection.objects.link(sun)

    side = TILE * GRID
    atlases = {name: [0.0] * (side * side * 4) for name in ('a', 'b')}
    tiles = int(sys.argv[sys.argv.index('--') + 2]) if '--tiles' in sys.argv else GRID * GRID
    for tile in range(tiles):
        family, variant = divmod(tile, GRID)
        configure(mat, family, variant, tile)
        lit, alphas = {}, []
        for name, shine in SIX_WAY_PASSES:
            sun.rotation_euler = Vector(shine).to_track_quat('-Z', 'Y').to_euler()
            # Render result is saved outside the repository; load the written PNG because
            # background EEVEE does not expose Render Result pixels reliably.
            tile_path = Path(tempfile.gettempdir()) / f'curvios-smoke-bake-{tile}-{name}.png'
            scene.render.filepath = str(tile_path); bpy.ops.render.render(write_still=True)
            image = bpy.data.images.load(str(tile_path), check_existing=False); rgba = list(image.pixels[:])
            bpy.data.images.remove(image)
            lit[name] = rgba[0::4]
            alphas.append(rgba[3::4])
        # Density does not depend on the light; Cycles only adds sampling noise per pass.
        alpha = [sum(values) / len(values) for values in zip(*alphas)]
        for pass_alpha in alphas:
            drift = sum(abs(p - q) for p, q in zip(alpha, pass_alpha)) / len(alpha)
            assert drift < .01, f'density differs between passes on tile {tile}: {drift:.4f}'
        edge = alpha[:TILE] + alpha[-TILE:] + alpha[::TILE] + alpha[TILE - 1::TILE]
        assert max(edge) < .001, f'Atlas tile {tile} touches its border'
        assert sum(.02 < a < .94 for a in alpha) > 1000, f'Tile {tile} needs graded transparency'
        print(f'tile {tile}: ' + ' '.join(
            f'{name}={sum(v * a for v, a in zip(lit[name], alpha)) / max(1e-6, sum(alpha)):.3f}'
            for name, _ in SIX_WAY_PASSES))
        # Blender pixels and three.js UVs both start at the bottom row: tile t sits in
        # column t % 4 and row t // 4 counted upwards, which is how the shader finds it.
        row = tile // GRID
        for atlas_name, channels in ATLAS_CHANNELS.items():
            pixels = atlases[atlas_name]
            for y in range(TILE):
                for x in range(TILE):
                    src = y * TILE + x
                    dst = ((y + row * TILE) * side + (tile % GRID) * TILE + x) * 4
                    for channel, name in enumerate(channels):
                        pixels[dst + channel] = lit[name][src]
                    pixels[dst + 3] = alpha[src]
    for atlas_name in ATLAS_CHANNELS:
        image = bpy.data.images.new(f'Smoke light {atlas_name}', width=side, height=side, alpha=True)
        image.pixels[:] = atlases[atlas_name]
        image.filepath_raw = str(OUT / f'smoke-light-{atlas_name}.png'); image.file_format = 'PNG'; image.save()
        image.pack()
    scene['atlas_layout'] = ('4x4, 256px tiles; rows bottom to top: billows, upright column parts, '
                             'torn wisps, holed billows; straight alpha. smoke-light-a RGB = lit from '
                             'right, top, back; smoke-light-b RGB = lit from left, bottom, front')
    scene.render.filepath = '//smoke-preview.png'
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'smoke-bake.blend'), compress=True)


if __name__ == '__main__':
    main()
