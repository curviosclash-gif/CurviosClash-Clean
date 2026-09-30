"""Generate the static "Giant Nursery" (Riesen-Kinderzimmer) map, key toybox_titan.

Contract (game coordinates: X/Z horizontal, Y up; Blender is Z-up, so
Blender X = game X, Blender Y = -game Z, Blender Z = game Y before
export_yup=True bakes the axis swap into the GLB):

- Scale 1, preset position [0, 0, 0]. The loader centers the bounding box on
  X/Z and rests it on Y=0, so the scene must be symmetric in X/Z: floor and
  wall inner faces sit at exactly -60..+60.
- Floor: 120x120 wood-plank slab, top surface at game Y=0 (box from Y=-1 to
  Y=0), planks alternate two materials as colour variants.
- Four walls at +/-60 (inner face), 2 thick, 40 tall, pastel blue, with a
  striped wallpaper decal (_nocol) just inside each inner face and a
  moonlit window decal (_nocol, dark base + emission) on the north wall.
  A baseboard trim runs along every wall, <=1.5 deep.
- Centre: a flat round rug (r=22) with a rainbow toy-block castle on top,
  solid, contained within radius 10 of the origin, with a fly-through arch.
- Quadrant (+30, z=-30): a lopsided stack of giant books plus one tilted
  book acting as a ramp, solid, within radius 12 of the quadrant centre.
- Quadrant (-30, -30): a wooden train track ring (_nocol, flat) carrying a
  solid locomotive and two solid wagons.
- Quadrant (+30, +30): three standing giant hexagonal pencils plus one
  tilted pencil ramp, solid, within radius 12.
- Quadrant (-30, +30): a low-poly (<=16 segments per sphere) sitting teddy
  bear built from spheres, solid, ~16-18 tall, within radius 12.
- Nothing solid within radius 6 of the spawn points (0,*,44), (0,*,-44),
  (44,*,0), (-44,*,0) up to height 10, and nothing solid at |x|>52 or
  |z|>52 except the walls and their baseboard.
- No roof/ceiling.
- Names use only [A-Za-z0-9_]; deco meshes carry _nocol or
  _noshadow_nocol, solid meshes carry no marker.
- Budget: <=25000 triangles total, GLB <=600 KiB.
- Export: export_yup=True, export_apply=True, export_lights=False,
  export_cameras=False, export_animations=False (static scene).
"""
import random
from math import cos, pi, radians, sin
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "assets" / "maps" / "toybox_titan" / "blender"
GLB_DIR = ROOT / "assets" / "maps" / "toybox_titan" / "glb"
SETPIECES = (("toybox_titan",),)

SEED = 20260928
rng = random.Random(SEED)

_MATERIALS = {}


def material(name, color, roughness=0.85, emission_color=None, emission_strength=0.0):
    if name in _MATERIALS:
        return _MATERIALS[name]
    value = bpy.data.materials.new(name)
    value.diffuse_color = (*color, 1)
    value.use_nodes = True
    shader = value.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Roughness"].default_value = roughness
    if emission_color is not None:
        shader.inputs["Emission Color"].default_value = (*emission_color, 1)
        shader.inputs["Emission Strength"].default_value = emission_strength
    _MATERIALS[name] = value
    return value


def add_cube(name, location, dims, surface, rotation=(0.0, 0.0, 0.0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    value = bpy.context.object
    value.name = name
    value.dimensions = dims
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    value.rotation_euler = rotation
    value.data.materials.append(surface)
    value.data.name = name
    return value


def add_cylinder(name, location, radius, depth, surface, vertices=12, rotation=(0.0, 0.0, 0.0)):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation,
    )
    value = bpy.context.object
    value.name = name
    value.data.materials.append(surface)
    value.data.name = name
    return value


def add_cone(name, location, radius1, depth, surface, vertices=6, rotation=(0.0, 0.0, 0.0)):
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices, radius1=radius1, radius2=0.0, depth=depth, location=location,
        rotation=rotation,
    )
    value = bpy.context.object
    value.name = name
    value.data.materials.append(surface)
    value.data.name = name
    return value


def add_sphere(name, location, radius, surface, scale=(1.0, 1.0, 1.0), segments=12, rings=8):
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments, ring_count=rings, radius=radius, location=location,
    )
    value = bpy.context.object
    value.name = name
    value.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    value.data.materials.append(surface)
    value.data.name = name
    return value


def join_all(objects, name):
    # The GLB collider lookup keys off the exported node name, which Blender's glTF exporter
    # takes from the mesh *data-block* name for a joined/renamed mesh, not the object name -
    # so both must be kept in sync or the runtime loses track of which part is which.
    if len(objects) == 1:
        objects[0].name = name
        objects[0].data.name = name
        return objects[0]
    bpy.ops.object.select_all(action="DESELECT")
    for value in objects:
        value.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    joined = bpy.context.object
    joined.name = name
    joined.data.name = name
    return joined


def game_to_blender(x, z):
    """Map game-space X/Z to a Blender X/Y location (height handled separately)."""
    return x, -z


def build_floor():
    wood_light = material("wood_light", (0.62, 0.43, 0.26))
    wood_dark = material("wood_dark", (0.42, 0.27, 0.15))
    light_strips = []
    dark_strips = []
    for index, center in enumerate(range(-55, 60, 10)):
        strip = add_cube(
            f"Floor_strip_{index:02d}", (center, 0, -0.5), (10, 120, 1),
            wood_light if index % 2 == 0 else wood_dark,
        )
        (light_strips if index % 2 == 0 else dark_strips).append(strip)
    join_all(light_strips, "Floor_planks_light")
    join_all(dark_strips, "Floor_planks_dark")


def build_walls():
    wall_blue = material("wall_pastel_blue", (0.66, 0.80, 0.88))
    baseboard_white = material("baseboard_white", (0.93, 0.90, 0.84))
    stripe_a = material("wallpaper_stripe_light", (0.90, 0.94, 0.97))
    stripe_b = material("wallpaper_stripe_dark", (0.55, 0.73, 0.86))
    window_glow = material(
        "window_moonlight", (0.02, 0.02, 0.03),
        emission_color=(0.55, 0.75, 1.0), emission_strength=0.75,
    )

    # Inner face of each wall sits at |x| or |y| = 60; walls extend outward by their 2-unit
    # thickness so the whole scene stays symmetric in X/Y for the loader's bounding-box centring.
    walls = {
        "Wall_north": {"loc": (0, 61, 20), "dims": (124, 2, 40), "inner_y_sign": 1},
        "Wall_south": {"loc": (0, -61, 20), "dims": (124, 2, 40), "inner_y_sign": -1},
        "Wall_east": {"loc": (61, 0, 20), "dims": (2, 124, 40), "inner_x_sign": 1},
        "Wall_west": {"loc": (-61, 0, 20), "dims": (2, 124, 40), "inner_x_sign": -1},
    }
    for name, spec in walls.items():
        add_cube(name, spec["loc"], spec["dims"], wall_blue)

    baseboards = []
    baseboards.append(add_cube("Wall_baseboard_a", (0, 59.25, 1.5), (124, 1.5, 3), baseboard_white))
    baseboards.append(add_cube("Wall_baseboard_b", (0, -59.25, 1.5), (124, 1.5, 3), baseboard_white))
    baseboards.append(add_cube("Wall_baseboard_c", (59.25, 0, 1.5), (1.5, 124, 3), baseboard_white))
    baseboards.append(add_cube("Wall_baseboard_d", (-59.25, 0, 1.5), (1.5, 124, 3), baseboard_white))
    join_all(baseboards, "Wall_baseboard")

    bands = ((6.5, 13, stripe_a), (19.5, 13, stripe_b), (32.5, 13, stripe_a))
    for wall_name, (x, y, sign_axis) in {
        "north": (0, 59.85, "y"),
        "south": (0, -59.85, "y"),
        "east": (59.85, 0, "x"),
        "west": (-59.85, 0, "x"),
    }.items():
        stripes = []
        for index, (center_z, height, mat) in enumerate(bands):
            if sign_axis == "y":
                dims = (124, 0.1, height)
                loc = (x, y, center_z)
            else:
                dims = (0.1, 124, height)
                loc = (x, y, center_z)
            stripes.append(add_cube(f"WallDeco_{wall_name}_band_{index}_nocol", loc, dims, mat))
        join_all(stripes, f"WallDeco_{wall_name}_stripes_nocol")

    add_cube("WallWindow_north_nocol", (0, 59.8, 24), (20, 0.1, 14), window_glow)


def build_center_castle():
    rug_material = material("rug_red", (0.78, 0.24, 0.21))
    add_cylinder("Rug_center", (0, 0, 0.05), 22, 0.1, rug_material, vertices=32)

    castle_red = material("block_red", (0.85, 0.18, 0.18))
    castle_blue = material("block_blue", (0.18, 0.38, 0.85))
    castle_yellow = material("block_yellow", (0.95, 0.80, 0.14))
    castle_green = material("block_green", (0.22, 0.72, 0.34))

    add_cube("Block_castle_pillar_left_lower", (-6, 0, 2.5), (5, 5, 5), castle_red)
    add_cube("Block_castle_pillar_left_upper", (-6, 0, 7.5), (5, 5, 5), castle_blue)
    add_cube("Block_castle_pillar_right_lower", (6, 0, 2.5), (5, 5, 5), castle_yellow)
    add_cube("Block_castle_pillar_right_upper", (6, 0, 7.5), (5, 5, 5), castle_green)
    add_cube("Block_castle_lintel", (0, 0, 12), (17, 5, 4), castle_red)


def build_book_quadrant():
    center_x, center_y = game_to_blender(30, -30)
    maroon = material("book_maroon", (0.50, 0.15, 0.16))
    navy = material("book_navy", (0.15, 0.20, 0.52))
    forest = material("book_forest", (0.16, 0.46, 0.26))
    mustard = material("book_mustard", (0.72, 0.56, 0.11))
    palette = (maroon, navy, forest, mustard)

    stack = []
    heights = (1.3, 1.2, 1.1, 1.0)
    sizes = ((7, 5), (6.4, 4.6), (5.8, 4.1), (5.0, 3.5))
    z_cursor = 0.0
    for index, (thickness, (length, width)) in enumerate(zip(heights, sizes)):
        jitter_x = rng.uniform(-0.4, 0.4)
        jitter_rot = rng.uniform(-0.08, 0.08)
        z_center = z_cursor + thickness / 2
        stack.append(add_cube(
            f"Book_stack_{index:02d}", (center_x + jitter_x, center_y, z_center),
            (length, width, thickness), palette[index % len(palette)],
            rotation=(0, 0, jitter_rot),
        ))
        z_cursor += thickness
    join_all(stack, "Book_stack")

    ramp_len, ramp_w, ramp_t = 9.0, 4.0, 0.4
    top = z_cursor
    add_cube(
        "Book_ramp", (center_x + 5.5, center_y, top / 2), (ramp_len, ramp_w, ramp_t), navy,
        rotation=(0, -0.47, 0),
    )


def build_train_quadrant():
    center_x, center_y = game_to_blender(-30, -30)
    rail_gray = material("rail_gray", (0.36, 0.31, 0.28))
    loco_red = material("loco_red", (0.80, 0.16, 0.15))
    wagon_blue = material("wagon_blue", (0.20, 0.40, 0.72))
    wagon_green = material("wagon_green", (0.24, 0.62, 0.34))
    stack_black = material("loco_stack_black", (0.08, 0.08, 0.09))

    segments = 48
    radius = 10.0
    vertices = []
    faces = []
    for ring_radius in (9.3, 10.7):
        for index in range(segments):
            angle = 2 * pi * index / segments
            vertices.append((
                center_x + ring_radius * cos(angle), center_y + ring_radius * sin(angle), 0.05,
            ))
    for index in range(segments):
        following = (index + 1) % segments
        faces.append((index, following, segments + following, segments + index))
    mesh = bpy.data.meshes.new("Train_rail_ring_nocol")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    ring = bpy.data.objects.new("Train_rail_ring_nocol", mesh)
    bpy.context.collection.objects.link(ring)
    ring.data.materials.append(rail_gray)

    def on_ring(angle_degrees):
        angle = radians(angle_degrees)
        return (
            center_x + radius * cos(angle), center_y + radius * sin(angle), angle + pi / 2,
        )

    lx, ly, lrot = on_ring(0)
    loco_body = add_cube("Train_loco_body", (lx, ly, 1.5), (5, 3, 3), loco_red, rotation=(0, 0, lrot))
    add_cube(
        "Train_loco_stack_noshadow_nocol", (lx, ly, 3.6), (0.8, 0.8, 1.2), stack_black,
        rotation=(0, 0, lrot),
    )
    join_all([loco_body], "Train_loco")

    wx, wy, wrot = on_ring(26)
    add_cube("Train_wagon_01", (wx, wy, 1.25), (4, 3, 2.5), wagon_blue, rotation=(0, 0, wrot))
    wx2, wy2, wrot2 = on_ring(52)
    add_cube("Train_wagon_02", (wx2, wy2, 1.25), (4, 3, 2.5), wagon_green, rotation=(0, 0, wrot2))


def build_pencil_quadrant():
    center_x, center_y = game_to_blender(30, 30)
    yellow = material("pencil_yellow", (0.95, 0.76, 0.10))
    pink = material("pencil_pink", (0.92, 0.46, 0.61))
    teal = material("pencil_teal", (0.20, 0.66, 0.66))
    graphite = material("pencil_graphite", (0.16, 0.16, 0.17))
    bodies = (yellow, pink, teal)

    offsets = ((-4, -3), (4, -2), (0, 4))
    for index, ((ox, oy), body) in enumerate(zip(offsets, bodies)):
        x, y = center_x + ox, center_y + oy
        cyl = add_cylinder(
            f"Pencil_standing_{index:02d}_body", (x, y, 6), 1.1, 12, body, vertices=6,
        )
        tip = add_cone(
            f"Pencil_standing_{index:02d}_tip", (x, y, 13.5), 1.1, 3, graphite, vertices=6,
        )
        join_all([cyl, tip], f"Pencil_standing_{index:02d}")

    rx, ry = center_x + 6, center_y + 6
    ramp_cyl = add_cylinder(
        "Pencil_ramp_body", (rx, ry, 2.0), 1.1, 12, pink, vertices=6, rotation=(0, 1.15, 0),
    )
    ramp_tip = add_cone(
        "Pencil_ramp_tip", (rx - 5.1, ry, 3.9), 1.1, 3, graphite, vertices=6, rotation=(0, 1.15, 0),
    )
    join_all([ramp_cyl, ramp_tip], "Pencil_ramp")


def build_teddy_quadrant():
    center_x, center_y = game_to_blender(-30, 30)
    fur = material("teddy_fur", (0.62, 0.43, 0.24))
    dark = material("teddy_dark", (0.06, 0.06, 0.07))

    parts = []
    parts.append(add_sphere(
        "Teddy_leg_left", (center_x - 2.4, center_y + 1.6, 1.6), 2.0, fur, scale=(1.0, 1.3, 0.85),
    ))
    parts.append(add_sphere(
        "Teddy_leg_right", (center_x + 2.4, center_y + 1.6, 1.6), 2.0, fur, scale=(1.0, 1.3, 0.85),
    ))
    parts.append(add_sphere(
        "Teddy_body", (center_x, center_y, 7.0), 5.0, fur, scale=(1.0, 0.95, 1.1),
    ))
    parts.append(add_sphere(
        "Teddy_arm_left", (center_x - 5.4, center_y, 7.5), 1.7, fur, scale=(0.85, 0.85, 1.5),
    ))
    parts.append(add_sphere(
        "Teddy_arm_right", (center_x + 5.4, center_y, 7.5), 1.7, fur, scale=(0.85, 0.85, 1.5),
    ))
    parts.append(add_sphere("Teddy_head", (center_x, center_y - 0.5, 13.2), 3.6, fur))
    parts.append(add_sphere(
        "Teddy_ear_left", (center_x - 2.6, center_y - 0.5, 16.0), 1.1, fur,
    ))
    parts.append(add_sphere(
        "Teddy_ear_right", (center_x + 2.6, center_y - 0.5, 16.0), 1.1, fur,
    ))
    parts.append(add_sphere(
        "Teddy_snout", (center_x, center_y - 3.4, 12.3), 1.4, fur, scale=(1.0, 0.8, 0.85),
    ))
    parts.append(add_sphere("Teddy_nose", (center_x, center_y - 4.5, 12.5), 0.5, dark))

    join_all(parts, "Teddy_bear")


def export_setpiece(stem):
    if stem != "toybox_titan":
        raise ValueError(f"Unknown toybox_titan part: {stem}")
    bpy.ops.wm.read_factory_settings(use_empty=True)

    build_floor()
    build_walls()
    build_center_castle()
    build_book_quadrant()
    build_train_quadrant()
    build_pencil_quadrant()
    build_teddy_quadrant()

    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    GLB_DIR.mkdir(parents=True, exist_ok=True)
    blend_path = SOURCE_DIR / f"{stem}.blend"
    glb_path = GLB_DIR / f"{stem}.glb"
    bpy.context.scene.frame_set(1)
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=str(glb_path), export_format="GLB", use_selection=True,
        export_yup=True, export_apply=True, export_lights=False, export_cameras=False,
        export_animations=False,
    )

    mesh_objects = [obj for obj in bpy.data.objects if obj.type == "MESH"]
    triangle_count = 0
    for obj in mesh_objects:
        obj.data.calc_loop_triangles()
        triangle_count += len(obj.data.loop_triangles)
    print(f"[toybox_titan] meshes={len(mesh_objects)} triangles={triangle_count} -> {glb_path}")
