"""Build the Curvios Clash map unit model library (tank parts) as an editable blend and a GLB.

Run with Blender 4.2:
  blender --background --python scripts/generate_map_unit_blender_assets.py -- [options]

The library is a parts list, not a finished vehicle: the runtime builds the tank from the named
nodes so the turret can turn on its own. Everything is authored in GROUND SPACE - the origin of the
file is the point the tank stands on - and the runtime lifts the turret parts onto its head pivot by
subtracting the known turret height. That keeps the blend readable as a whole tank.

Axes: the game model faces +Z. Blender exports its -Y as glTF +Z, so the barrel points along -Y
here. Blender x stays x (width) and Blender z becomes the game's y (height).

Sizes follow the box model this replaces, so hit radius, turret height and the health bar above the
hull all keep working: hull 4.6 wide, 6.8 long, tracks at x = +-2.75, turret ring at z = 2.1.
"""

import argparse
import math
from pathlib import Path

import bpy

# The box model these parts replace, in game units.
HULL_WIDTH = 4.6
HULL_LENGTH = 6.8
TRACK_X = 2.75
TURRET_HEIGHT = 2.1

MATERIALS = {}


def parse_args():
    parser = argparse.ArgumentParser()
    argv = []
    import sys
    if "--" in sys.argv:
        argv = sys.argv[sys.argv.index("--") + 1:]
    parser.add_argument("--output-blend", type=Path, default=Path("assets/models/map_units/blender/map_units.blend"))
    parser.add_argument("--output-glb", type=Path, default=Path("assets/models/map_units/map_unit_library.glb"))
    return parser.parse_args(argv)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MATERIALS.clear()


def material(name, colour, roughness, metallic):
    if name in MATERIALS:
        return MATERIALS[name]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*colour, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    MATERIALS[name] = mat
    return mat


def make_materials():
    # Dark base colours on purpose: the renderer tone maps the scene, and a bright hull washes the
    # shape out. No emission anywhere on a tank.
    material("TankHull", (0.068, 0.082, 0.052), 0.86, 0.25)
    material("TankTurret", (0.082, 0.098, 0.062), 0.78, 0.32)
    material("TankTrack", (0.018, 0.020, 0.024), 0.95, 0.12)
    material("TankSteel", (0.045, 0.047, 0.050), 0.62, 0.55)
    material("TankWreck", (0.026, 0.023, 0.020), 1.0, 0.18)


def box(size, location, mat, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location, rotation=rotation)
    part = bpy.context.object
    part.scale = (size[0], size[1], size[2])
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    part.data.materials.append(MATERIALS[mat])
    return part


def cylinder(radius, depth, location, mat, rotation=(0, 0, 0), vertices=12):
    bpy.ops.mesh.primitive_cylinder_add(
        radius=radius, depth=depth, location=location, rotation=rotation, vertices=vertices,
    )
    part = bpy.context.object
    # Rotation and scale are baked in right away: an unapplied rotation on the first part of a join
    # becomes the local frame of the whole joined object, and the barrel ends up pointing up.
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    part.data.materials.append(MATERIALS[mat])
    return part


def join(parts, name):
    """Joins meshes into one object whose origin sits at the file origin (the ground point)."""
    bpy.ops.object.select_all(action="DESELECT")
    for part in parts:
        part.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    joined = bpy.context.object
    joined.name = name
    joined.data.name = f"{name}_mesh"
    # Bake the whole transform, so the node is the identity and the mesh holds ground space. Simply
    # setting the location to zero would drag the part off the tank instead.
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return joined


def bevel(obj, width=0.04, segments=2):
    bpy.context.view_layer.objects.active = obj
    modifier = obj.modifiers.new("Bevel", "BEVEL")
    modifier.width = width
    modifier.segments = segments
    modifier.limit_method = "ANGLE"
    modifier.angle_limit = math.radians(40)
    bpy.ops.object.modifier_apply(modifier="Bevel")


def build_hull():
    """Slab hull with a sloped glacis at the front (-Y) and a sloped plate at the back."""
    parts = [
        box((HULL_WIDTH, HULL_LENGTH * 0.78, 1.05), (0, 0, 1.0), "TankHull"),
        # Glacis: a plate tipped forward, so the front reads as armour and not as a wall.
        box((HULL_WIDTH, 1.9, 0.5), (0, -HULL_LENGTH * 0.44, 0.92), "TankHull", rotation=(math.radians(-38), 0, 0)),
        box((HULL_WIDTH, 1.4, 0.5), (0, HULL_LENGTH * 0.42, 1.06), "TankHull", rotation=(math.radians(30), 0, 0)),
        # Fenders over the tracks.
        box((HULL_WIDTH + 1.6, HULL_LENGTH * 0.86, 0.16), (0, 0, 1.47), "TankHull"),
        # Exhaust and stowage, so the back is not a blank face.
        box((0.6, 0.9, 0.42), (1.45, HULL_LENGTH * 0.4, 1.78), "TankSteel"),
        box((2.2, 0.7, 0.34), (-0.6, HULL_LENGTH * 0.38, 1.72), "TankSteel"),
    ]
    hull = join(parts, "tank_hull")
    bevel(hull, 0.06)
    return hull


def build_track(side, name):
    x = TRACK_X * side
    parts = [box((1.1, 7.2, 0.85), (x, 0, 0.62), "TankTrack")]
    # Road wheels: six per side, plus a drive sprocket at each end.
    for index in range(6):
        y = -2.55 + index * 1.02
        parts.append(cylinder(0.44, 0.7, (x, y, 0.55), "TankSteel", rotation=(0, math.radians(90), 0), vertices=10))
    for y, radius in ((-3.25, 0.52), (3.25, 0.52)):
        parts.append(cylinder(radius, 0.76, (x, y, 0.62), "TankSteel", rotation=(0, math.radians(90), 0), vertices=10))
    # Upper track run over the wheels.
    parts.append(box((1.02, 7.0, 0.22), (x, 0, 1.18), "TankTrack"))
    track = join(parts, name)
    return track


def build_turret():
    """Faceted turret around the head pivot, authored at its real height above the ground."""
    parts = [
        box((2.9, 3.0, 0.95), (0, 0.1, TURRET_HEIGHT + 0.42), "TankTurret"),
        # Sloped cheeks front and back turn the box into a wedge.
        box((2.9, 1.25, 0.6), (0, -1.35, TURRET_HEIGHT + 0.36), "TankTurret", rotation=(math.radians(-32), 0, 0)),
        box((2.7, 1.1, 0.55), (0, 1.5, TURRET_HEIGHT + 0.44), "TankTurret", rotation=(math.radians(26), 0, 0)),
        # Mantlet the barrel comes out of.
        box((1.5, 0.7, 0.85), (0, -1.62, TURRET_HEIGHT + 0.36), "TankSteel"),
        # Commander cupola.
        cylinder(0.52, 0.42, (0.65, 0.75, TURRET_HEIGHT + 1.08), "TankTurret", vertices=12),
        # Turret ring, so the turret does not float over the hull when it turns.
        cylinder(1.45, 0.3, (0, 0, TURRET_HEIGHT - 0.02), "TankSteel", vertices=16),
    ]
    turret = join(parts, "tank_turret")
    bevel(turret, 0.05)
    return turret


def build_barrel():
    """Tapered gun with a muzzle brake, pointing along -Y (the game's +Z)."""
    parts = [
        cylinder(0.26, 3.4, (0, -3.1, TURRET_HEIGHT + 0.36), "TankSteel", rotation=(math.radians(90), 0, 0), vertices=12),
        cylinder(0.33, 0.9, (0, -1.75, TURRET_HEIGHT + 0.36), "TankSteel", rotation=(math.radians(90), 0, 0), vertices=12),
        box((0.78, 0.62, 0.62), (0, -4.42, TURRET_HEIGHT + 0.36), "TankSteel"),
        box((0.78, 0.26, 0.62), (0, -4.86, TURRET_HEIGHT + 0.36), "TankSteel"),
    ]
    return join(parts, "tank_barrel")


def build_wreck():
    """What is left after the tank blows up: a burnt hull, no turret, one track thrown off."""
    parts = [
        box((HULL_WIDTH, HULL_LENGTH * 0.78, 0.95), (0, 0, 0.78), "TankWreck", rotation=(0, math.radians(-6), 0)),
        box((HULL_WIDTH, 1.7, 0.45), (0, -HULL_LENGTH * 0.43, 0.7), "TankWreck", rotation=(math.radians(-34), 0, 0)),
        box((1.1, 7.0, 0.8), (TRACK_X, 0, 0.5), "TankWreck"),
        # The other track is torn loose and lies beside the hull.
        box((1.1, 4.6, 0.3), (-TRACK_X - 1.1, 0.9, 0.16), "TankWreck", rotation=(0, 0, math.radians(14))),
        # The turret was thrown off and sits upside down on the hull.
        box((2.7, 2.8, 0.9), (0.5, 0.4, 1.62), "TankWreck", rotation=(math.radians(18), math.radians(-24), math.radians(34))),
    ]
    wreck = join(parts, "tank_wreck")
    bevel(wreck, 0.05)
    return wreck


def build_all():
    build_hull()
    build_track(-1, "tank_track_left")
    build_track(1, "tank_track_right")
    build_turret()
    build_barrel()
    build_wreck()


def export(args):
    args.output_blend.parent.mkdir(parents=True, exist_ok=True)
    args.output_glb.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(args.output_blend.resolve()))
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=str(args.output_glb.resolve()),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
    )


def main():
    args = parse_args()
    reset()
    make_materials()
    build_all()
    export(args)
    for obj in bpy.data.objects:
        if obj.type == "MESH":
            obj.data.calc_loop_triangles()
    triangles = sum(len(obj.data.loop_triangles) for obj in bpy.data.objects if obj.type == "MESH")
    print(f"MAP_UNIT_LIBRARY_BLEND={args.output_blend}")
    print(f"MAP_UNIT_LIBRARY_GLB={args.output_glb}")
    print(f"MAP_UNIT_LIBRARY_TRIANGLES={triangles}")


if __name__ == "__main__":
    main()
