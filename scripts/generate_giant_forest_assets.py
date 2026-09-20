#!/usr/bin/env python3
"""Generate the two built parts of the giant forest.

Run with Blender 4.2 LTS:

    blender --background --python scripts/generate_giant_forest_assets.py

The forest itself is not built here - it is the ten generated ancient-tree variants, placed by
src/core/config/maps/presets/giant_forest/GiantForestTrees.js. What this script adds is the two
things those trees cannot provide on their own:

  01_forest_floor   the ground between the trunks. Decoration only: the map's collision floor is
                    an authored box, and this mesh is placed flyable, so its surface sits exactly
                    at the collision height and nothing can catch on a bump that is not there.

  02_canopy_walks   four decks and the four bridges between them, at the canopy storey. These are
                    solid - they are what turns "branches you can land on" into a floor you can
                    fight on. Kept coarse on purpose: every triangle here is collision geometry.

Both are authored in map units at true size, centred on the origin, with Z up as Blender has it;
the glTF export turns Z up into Y up, so a Blender Y becomes the map's -Z. Both meshes are
symmetric about both axes, which keeps that conversion from mattering anywhere but here.

The loader stands a model on its own lowest point, so each file is exported with its underside at
Blender Z = 0 and the preset states the height that underside sits at.
"""

from math import atan2, cos, hypot, pi, sin
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "assets" / "maps" / "giant_forest" / "blender"
GLB_DIR = ROOT / "assets" / "maps" / "giant_forest" / "glb"

# Must match GiantForestStructure.js. The floor covers the whole field; the decks sit at the
# canopy storey and are placed by the preset, so only their own size is decided here.
HALF_SIZE = 320.0
DECK_RADIUS = 150.0        # distance of each deck's centre from the middle of the map
DECK_HALF = 28.0           # decks are 56 x 56
DECK_THICKNESS = 3.0
BRIDGE_WIDTH = 14.0
PLANK_GAP = 0.35

FLOOR_CELLS = 16           # 16 x 16 patches of ground, three materials scattered over them
FLOOR_DEPTH = 6.0          # how far the floor slab reaches below its surface

LOAM = (0.12, 0.09, 0.06, 1.0)
MOSS = (0.13, 0.22, 0.09, 1.0)
LEAF_LITTER = (0.25, 0.16, 0.07, 1.0)
BARK = (0.18, 0.12, 0.07, 1.0)
WET_WOOD = (0.11, 0.09, 0.07, 1.0)


def reset_scene(name):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = name
    bpy.context.preferences.filepaths.save_version = 0
    return scene


def material(name, color, roughness=0.9):
    value = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    value.diffuse_color = color
    value.use_nodes = True
    shader = value.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = color
    shader.inputs["Roughness"].default_value = roughness
    metallic = shader.inputs.get("Metallic IOR Level") or shader.inputs.get("Metallic")
    if metallic:
        metallic.default_value = 0.0
    return value


def box(name, centre, size, mat):
    """An axis aligned box, given its centre and its full extents."""
    # A `size=1.0` cube already spans -0.5..0.5, so the scale is the full extent, not half of it.
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=centre)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (size[0], size[1], size[2])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    return obj


def turned_box(name, centre, size, yaw, mat):
    obj = box(name, centre, size, mat)
    obj.rotation_euler = (0.0, 0.0, yaw)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    return obj


def join(objects, name):
    """One object per material keeps the draw calls down; the loader collides per mesh."""
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    joined = bpy.context.active_object
    joined.name = name
    return joined


def scatter(seed):
    """The same deterministic 0..1 the preset uses, so ground and trees agree about randomness."""
    value = sin(seed * 127.1 + 311.7) * 43758.5453
    return value - int(value // 1)


def build_forest_floor():
    """A flat slab in three shades, scattered in patches, with its surface at Z = 0."""
    materials = {
        "loam": material("forest_floor_loam", LOAM),
        "moss": material("forest_floor_moss", MOSS),
        "litter": material("forest_floor_litter", LEAF_LITTER),
    }
    groups = {key: [] for key in materials}
    cell = (HALF_SIZE * 2.0) / FLOOR_CELLS
    for row in range(FLOOR_CELLS):
        for column in range(FLOOR_CELLS):
            x = -HALF_SIZE + cell * (column + 0.5)
            y = -HALF_SIZE + cell * (row + 0.5)
            roll = scatter(row * 53 + column * 17)
            key = "moss" if roll < 0.33 else ("litter" if roll < 0.66 else "loam")
            # One flat surface at Z = 0 and one flat underside: the variation here is in colour,
            # not in height. A bump would stand above the collision floor the map authors, and a
            # ragged underside would move the model's lowest point, which is what the loader
            # stands it on.
            groups[key].append(box(
                f"floor_{key}_{row:02d}_{column:02d}",
                (x, y, -FLOOR_DEPTH / 2.0),
                (cell, cell, FLOOR_DEPTH),
                materials[key],
            ))
    return [join(objects, f"forest_floor_{key}_nocol") for key, objects in groups.items() if objects]


def deck(index, angle, materials):
    """One canopy deck: planks in one direction, two kerbs, all of it solid."""
    centre_x = cos(angle) * DECK_RADIUS
    centre_y = sin(angle) * DECK_RADIUS
    parts = []
    plank_count = 7
    plank_width = (DECK_HALF * 2.0) / plank_count - PLANK_GAP
    for plank in range(plank_count):
        offset = -DECK_HALF + (DECK_HALF * 2.0 / plank_count) * (plank + 0.5)
        parts.append(box(
            f"deck_{index}_plank_{plank}",
            (centre_x + offset, centre_y, DECK_THICKNESS / 2.0),
            (plank_width, DECK_HALF * 2.0, DECK_THICKNESS),
            materials["wood"],
        ))
    # Kerbs on two sides: enough to read where the deck ends without walling the storey in.
    for side in (-1, 1):
        parts.append(box(
            f"deck_{index}_kerb_{side}",
            (centre_x, centre_y + side * DECK_HALF, DECK_THICKNESS + 1.2),
            (DECK_HALF * 2.0, 1.6, 2.4),
            materials["bark"],
        ))
    return parts


def bridge(index, from_angle, to_angle, materials):
    """A walkway between two decks, turned to lie along the line between them."""
    x0, y0 = cos(from_angle) * DECK_RADIUS, sin(from_angle) * DECK_RADIUS
    x1, y1 = cos(to_angle) * DECK_RADIUS, sin(to_angle) * DECK_RADIUS
    centre_x = (x0 + x1) / 2.0
    centre_y = (y0 + y1) / 2.0
    yaw = atan2(y1 - y0, x1 - x0)
    # Shortened by most of a deck at each end, so the walkway meets the decks instead of lying on
    # top of them - overlapping solids would give the same spot two colliders.
    span = hypot(x1 - x0, y1 - y0) - DECK_HALF * 1.6
    parts = [turned_box(
        f"bridge_{index}_deck",
        (centre_x, centre_y, DECK_THICKNESS / 2.0),
        (span, BRIDGE_WIDTH, DECK_THICKNESS),
        yaw,
        materials["wood"],
    )]
    # The rails sit half a width to either side, measured across the walkway's own direction.
    across_x = cos(yaw + pi / 2.0) * (BRIDGE_WIDTH / 2.0)
    across_y = sin(yaw + pi / 2.0) * (BRIDGE_WIDTH / 2.0)
    for side in (-1, 1):
        parts.append(turned_box(
            f"bridge_{index}_rail_{'a' if side < 0 else 'b'}",
            (centre_x + across_x * side, centre_y + across_y * side, DECK_THICKNESS + 1.0),
            (span, 1.2, 2.0),
            yaw,
            materials["bark"],
        ))
    return parts


def build_canopy_walks():
    materials = {
        "wood": material("canopy_wood", WET_WOOD, roughness=0.75),
        "bark": material("canopy_bark", BARK),
    }
    angles = [-pi / 2.0, 0.0, pi / 2.0, pi]
    parts = []
    for index, angle in enumerate(angles):
        parts.extend(deck(index, angle, materials))
    for index in range(len(angles)):
        parts.extend(bridge(index, angles[index], angles[(index + 1) % len(angles)], materials))
    wood = [obj for obj in parts if obj.data.materials[0].name == "canopy_wood"]
    bark = [obj for obj in parts if obj.data.materials[0].name == "canopy_bark"]
    return [join(wood, "canopy_walk_wood"), join(bark, "canopy_walk_bark")]


def export(file_stem, builder):
    scene = reset_scene(file_stem)
    builder()
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    GLB_DIR.mkdir(parents=True, exist_ok=True)
    blend_path = SOURCE_DIR / f"{file_stem}.blend"
    glb_path = GLB_DIR / f"{file_stem}.glb"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path), check_existing=False)
    bpy.ops.export_scene.gltf(
        filepath=str(glb_path),
        export_format="GLB",
        export_animations=False,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
        export_extras=True,
        export_apply=True,
    )
    triangles = sum(
        sum(max(0, len(polygon.vertices) - 2) for polygon in obj.data.polygons)
        for obj in scene.objects if obj.type == "MESH"
    )
    print(f"generated {glb_path.relative_to(ROOT)} ({triangles} triangles)")


def main():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    export("01_forest_floor", build_forest_floor)
    export("02_canopy_walks", build_canopy_walks)


if __name__ == "__main__":
    main()
