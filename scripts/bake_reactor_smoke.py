"""Bake sixteen softly lit smoke shapes from the authored Blender volume noise.
Run with Blender 4.2 in background mode. Outputs a 1024px RGBA atlas (4x4 tiles of
256px) and the editable bake scene.

Tile families, one row each counted from the bottom of the image, so the runtime can
pick a shape by the role of a card:
  row 0  rounded billows      cap, rolled rim and bloom lobes
  row 1  upright column parts the stem and its side plumes (taller than wide)
  row 2  torn wisps           streams, shed edge vortices, entrained air
  row 3  holed billows        fine surface detail
Every tile is centred with a fully transparent border, so mipmaps never bleed.
"""
from pathlib import Path
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
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
    scene.eevee.taa_render_samples = 32
    scene.eevee.volumetric_samples = 64
    scene.eevee.volumetric_tile_size = '2'
    scene.eevee.volumetric_start, scene.eevee.volumetric_end = .1, 12
    scene.eevee.use_volumetric_shadows = True
    scene.render.resolution_x = scene.render.resolution_y = TILE
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.view_settings.view_transform = 'Standard'
    scene.world = bpy.data.worlds.new('Neutral bake world'); scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.3, .3, .3, 1)
    mat = build_material(roughness, detail)
    bpy.ops.mesh.primitive_cube_add(size=3)
    bpy.context.object.name = 'Smoke bake domain'
    bpy.context.object.data.materials.append(mat)
    bpy.ops.object.camera_add(location=(0, -5, 0)); cam = bpy.context.object
    cam.rotation_euler = (Vector((0, 0, 0)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = 3; scene.camera = cam
    for pos, power in [((-3, -4, 5), 650), ((3, -2, 1), 180)]:
        data = bpy.data.lights.new('Soft smoke key', 'AREA'); data.energy = power; data.size = 4
        obj = bpy.data.objects.new(data.name, data); scene.collection.objects.link(obj); obj.location = pos
        obj.rotation_euler = (-obj.location).to_track_quat('-Z', 'Y').to_euler()

    side = TILE * GRID
    atlas = bpy.data.images.new('Smoke atlas', width=side, height=side, alpha=True)
    pixels = [0.0] * (side * side * 4)
    for tile in range(GRID * GRID):
        family, variant = divmod(tile, GRID)
        configure(mat, family, variant, tile)
        # Render result is saved outside the repository; load the written PNG because
        # background EEVEE does not expose Render Result pixels reliably.
        tile_path = Path(tempfile.gettempdir()) / f'curvios-smoke-bake-{tile}.png'
        scene.render.filepath = str(tile_path); bpy.ops.render.render(write_still=True)
        image = bpy.data.images.load(str(tile_path), check_existing=False); rgba = list(image.pixels[:])
        alpha = rgba[3::4]
        edge = alpha[:TILE] + alpha[-TILE:] + alpha[::TILE] + alpha[TILE - 1::TILE]
        assert max(edge) < .001, f'Atlas tile {tile} touches its border'
        assert sum(.02 < a < .94 for a in alpha) > 1000, f'Tile {tile} needs graded transparency'
        # Blender pixels and three.js UVs both start at the bottom row: tile t sits in
        # column t % 4 and row t // 4 counted upwards, which is how the shader finds it.
        row = tile // GRID
        for y in range(TILE):
            src = y * TILE * 4
            dst = ((y + row * TILE) * side + (tile % GRID) * TILE) * 4
            pixels[dst:dst + TILE * 4] = rgba[src:src + TILE * 4]
        bpy.data.images.remove(image)
    atlas.pixels[:] = pixels
    atlas.filepath_raw = str(OUT / 'smoke-atlas.png'); atlas.file_format = 'PNG'; atlas.save()
    atlas.pack()
    scene['atlas_layout'] = ('4x4, 256px tiles; rows bottom to top: billows, upright column parts, '
                             'torn wisps, holed billows; straight alpha; neutral lit smoke')
    scene.render.filepath = '//smoke-preview.png'
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'smoke-bake.blend'), compress=True)


if __name__ == '__main__':
    main()
