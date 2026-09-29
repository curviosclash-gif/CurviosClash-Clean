"""Build the editable healing drone and its game-ready GLB with Blender 4.2.

The drone is centred on the origin, uses Blender Z up, and faces +Y. Blender's
glTF export maps that facing direction to Three.js -Z. All visible parts fit
inside the existing 1.25-unit spherical hitbox.
"""

from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


REPO = Path(__file__).resolve().parents[1]
MODEL_DIR = REPO / "assets/models/repair_drone"
ROTOR_POSITIONS = {
    "rotor_front_left": (-0.62, 0.62),
    "rotor_front_right": (0.62, 0.62),
    "rotor_rear_left": (-0.62, -0.62),
    "rotor_rear_right": (0.62, -0.62),
}
PARTS: list[bpy.types.Object] = []
STATIC: list[bpy.types.Object] = []


def material(name: str, color: tuple[float, float, float], metal=0.0, rough=0.4, emission=0.0):
    result = bpy.data.materials.new(name)
    result.use_nodes = True
    node = result.node_tree.nodes.get("Principled BSDF")
    node.inputs["Base Color"].default_value = (*color, 1)
    node.inputs["Metallic"].default_value = metal
    node.inputs["Roughness"].default_value = rough
    node.inputs["Emission Color"].default_value = (*color, 1)
    node.inputs["Emission Strength"].default_value = emission
    result.diffuse_color = (*color, 1)
    return result


def register(obj, mat, *, static=True):
    obj.data.materials.append(mat)
    PARTS.append(obj)
    if static:
        STATIC.append(obj)
    return obj


def bevel(obj, width=0.025, segments=2):
    mod = obj.modifiers.new("soft-machined-edges", "BEVEL")
    mod.width = width
    mod.segments = segments
    mod.affect = "EDGES"
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return obj


def box(name, loc, scale, mat, *, bevel_width=0.0, static=True, angle=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.rotation_euler.z = angle
    if bevel_width:
        bevel(obj, bevel_width)
    return register(obj, mat, static=static)


def cylinder(name, loc, radius, depth, mat, *, vertices=20, static=True, rotation=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc)
    obj = bpy.context.object
    obj.name = name
    if rotation:
        obj.rotation_euler = rotation
    return register(obj, mat, static=static)


def torus(name, loc, major, minor, mat, *, static=True):
    bpy.ops.mesh.primitive_torus_add(major_segments=28, minor_segments=6,
                                     location=loc, major_radius=major, minor_radius=minor)
    obj = bpy.context.object
    obj.name = name
    return register(obj, mat, static=static)


def duct(name, x, y, mat):
    """A closed annular shroud, leaving real open space for the rotor."""
    n = 28
    inner, outer, bottom, top = 0.205, 0.272, -0.095, 0.095
    vertices = []
    for z, radius in ((bottom, outer), (top, outer), (bottom, inner), (top, inner)):
        vertices.extend((x + radius * math.cos(2 * math.pi * i / n),
                         y + radius * math.sin(2 * math.pi * i / n), z + 0.13)
                        for i in range(n))
    faces = []
    for i in range(n):
        j = (i + 1) % n
        faces.extend(((i, j, n + j, n + i),
                      (2*n + j, 2*n + i, 3*n + i, 3*n + j),
                      (n + i, n + j, 3*n + j, 3*n + i),
                      (j, i, 2*n + i, 2*n + j)))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return register(obj, mat)


def connect(name, start, end, thickness, mat):
    midpoint = (Vector(start) + Vector(end)) / 2
    delta = Vector(end) - Vector(start)
    obj = box(name, midpoint, (thickness, delta.length, thickness), mat,
              bevel_width=0.012)
    obj.rotation_euler = delta.to_track_quat("Y", "Z").to_euler()
    return obj


def join_named(name, objects):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    objects[0].name = name
    return objects[0]


def make_drone():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.unit_settings.scale_length = 1.0

    ceramic = material("01_White_Ceramic", (0.70, 0.84, 0.81), 0.22, 0.34)
    dark = material("02_Graphite_Metal", (0.055, 0.085, 0.10), 0.70, 0.32)
    steel = material("03_Brushed_Steel", (0.27, 0.36, 0.38), 0.78, 0.27)
    green = material("04_Medical_Green", (0.015, 0.68, 0.34), 0.32, 0.28)
    glow = material("05_Repair_Emitter", (0.04, 0.92, 0.48), 0.05, 0.22, 2.2)
    glass = material("06_Sensor_Glass", (0.015, 0.16, 0.22), 0.10, 0.12)

    # Compact layered fuselage; all appendages remain within the 1.25 m hit sphere.
    box("chassis", (0, 0, 0), (0.82, 0.98, 0.31), dark, bevel_width=0.11)
    box("upper_ceramic_shell", (0, -0.02, 0.18), (0.75, 0.89, 0.20), ceramic,
        bevel_width=0.09)
    box("lower_service_hatch", (0, -0.10, -0.20), (0.57, 0.64, 0.09), steel,
        bevel_width=0.035)
    box("nose_wedge", (0, 0.47, 0.02), (0.51, 0.19, 0.22), ceramic,
        bevel_width=0.055)
    box("central_spine", (0, -0.25, 0.30), (0.13, 0.42, 0.055), steel,
        bevel_width=0.02)

    # Medical cross is raised and visible from gameplay's overhead camera.
    box("medical_cross_long", (0, 0.015, 0.292), (0.115, 0.42, 0.032), glow,
        bevel_width=0.01)
    box("medical_cross_short", (0, 0.015, 0.294), (0.42, 0.115, 0.032), glow,
        bevel_width=0.01)
    for side in (-1, 1):
        box(f"hull_status_rail_{side}", (side * 0.35, -0.12, 0.255),
            (0.045, 0.53, 0.025), green, bevel_width=0.008)
        box(f"landing_skid_{side}", (side * 0.29, -0.06, -0.31),
            (0.08, 0.59, 0.065), dark, bevel_width=0.02)
        connect(f"skid_strut_{side}", (side * 0.26, -0.14, -0.13),
                (side * 0.29, -0.14, -0.30), 0.07, steel)

    # Four protected fans. Each independently named rotor is a real movable mesh.
    rotor_objects = []
    for name, (x, y) in ROTOR_POSITIONS.items():
        connect(f"arm_{name}", (x * 0.39, y * 0.39, 0.045),
                (x, y, 0.11), 0.105, steel)
        duct(f"duct_{name}", x, y, dark)
        torus(f"rim_{name}", (x, y, 0.23), 0.238, 0.010, green)
        cylinder(f"motor_{name}", (x, y, 0.125), 0.10, 0.12, steel)
        blade_parts = []
        for blade in range(3):
            angle = 2 * math.pi * blade / 3
            length = 0.125
            blade_parts.append(box(f"{name}_blade_{blade}",
                (x + length * math.cos(angle) / 2,
                 y + length * math.sin(angle) / 2, 0.145),
                (length, 0.060, 0.018), ceramic, bevel_width=0.008,
                static=False, angle=angle))
        blade_parts.append(cylinder(f"{name}_hub", (x, y, 0.157),
                                    0.055, 0.045, green, static=False))
        rotor = join_named(name, blade_parts)
        bpy.context.scene.cursor.location = (x, y, 0.15)
        bpy.ops.object.origin_set(type="ORIGIN_CURSOR", center="MEDIAN")
        rotor["repairDroneRotor"] = True
        rotor_objects.append(rotor)

    # Actual repair hardware: lower manipulator, enclosed emitter, and two sensors.
    cylinder("repair_mount", (0, 0.19, -0.245), 0.19, 0.105, steel)
    box("repair_tool_carriage", (0, 0.40, -0.27), (0.28, 0.36, 0.15), dark,
        bevel_width=0.03)
    cylinder("repair_nozzle", (0, 0.62, -0.27), 0.103, 0.18, steel,
             rotation=(math.pi / 2, 0, 0))
    cylinder("repair_nozzle_core", (0, 0.725, -0.27), 0.057, 0.012, glow,
             rotation=(math.pi / 2, 0, 0))
    for side in (-1, 1):
        connect(f"manipulator_{side}", (side * 0.12, 0.45, -0.27),
                (side * 0.22, 0.63, -0.31), 0.055, steel)
        box(f"tool_tip_{side}", (side * 0.22, 0.67, -0.31),
            (0.045, 0.12, 0.055), green, bevel_width=0.01)
        cylinder(f"optical_sensor_{side}", (side * 0.19, 0.55, 0.07),
                 0.075, 0.055, glass, vertices=16,
                 rotation=(math.pi / 2, 0, 0))

    authoring_body = bpy.data.collections.new("01_Editable_Body")
    authoring_rotors = bpy.data.collections.new("02_Editable_Rotors")
    bpy.context.scene.collection.children.link(authoring_body)
    bpy.context.scene.collection.children.link(authoring_rotors)
    for obj in STATIC:
        for collection in tuple(obj.users_collection):
            collection.objects.unlink(obj)
        authoring_body.objects.link(obj)
    for obj in rotor_objects:
        for collection in tuple(obj.users_collection):
            collection.objects.unlink(obj)
        authoring_rotors.objects.link(obj)
    return rotor_objects


def consolidate_for_export():
    # The .blend keeps named parts. Only the runtime GLB joins static material groups.
    grouped = {}
    for obj in STATIC:
        grouped.setdefault(obj.data.materials[0].name, []).append(obj)
    for name, objects in grouped.items():
        join_named("body_" + name, objects)

    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    assert len(meshes) <= 12, f"Too many drone meshes: {len(meshes)}"
    assert sum(obj.name in ROTOR_POSITIONS for obj in meshes) == 4
    max_radius = max((obj.matrix_world @ vertex.co).length
                     for obj in meshes for vertex in obj.data.vertices)
    assert max_radius <= 1.25, f"Drone extends beyond hitbox: {max_radius:.3f}"
    for obj in meshes:
        obj.data.calc_loop_triangles()
    triangles = sum(len(obj.data.loop_triangles) for obj in meshes)
    assert triangles < 12000, f"Drone is too dense: {triangles}"
    print(f"Repair drone: {len(meshes)} meshes, <= {triangles} triangles, radius {max_radius:.3f} m")
    return meshes


def aim(camera, target=(0, 0, 0)):
    camera.rotation_euler = (Vector(target) - camera.location).to_track_quat("-Z", "Y").to_euler()


def preview(output_dir: Path):
    output_dir.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 24
    scene.render.resolution_x = 640
    scene.render.resolution_y = 640
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.view_settings.view_transform = "AgX"
    world = bpy.data.worlds.new("preview_environment")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.15, 0.20, 0.24, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.6
    scene.world = world
    for name, location, energy, color, size in (
        ("key", (3, 1, 5), 450, (0.82, 1.0, 0.93), 4),
        ("fill", (-3, 0, 2), 300, (0.46, 0.71, 1.0), 3),
        ("rim", (1, -3, 3), 500, (0.75, 1.0, 0.79), 2),
    ):
        data = bpy.data.lights.new(name, "AREA")
        data.energy = energy
        data.color = color
        data.shape = "DISK"
        data.size = size
        obj = bpy.data.objects.new(name, data)
        scene.collection.objects.link(obj)
        obj.location = location
        aim(obj)
    camera_data = bpy.data.cameras.new("QA_camera")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 3.1
    camera = bpy.data.objects.new("QA_camera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    for name, location in (
        ("hero", (2.8, 3.8, 2.9)),
        ("front", (0, 4.5, 1.2)),
        ("side", (4.5, 0, 1.2)),
        ("rear", (0, -4.5, 1.2)),
        ("top", (0, 0.1, 5)),
    ):
        camera.location = location
        aim(camera)
        scene.render.filepath = str(output_dir / f"repair_drone_{name}.png")
        bpy.ops.render.render(write_still=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-blend", type=Path, default=MODEL_DIR / "blender/repair_drone.blend")
    parser.add_argument("--output-glb", type=Path, default=MODEL_DIR / "glb/repair_drone.glb")
    parser.add_argument("--preview-dir", type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    make_drone()
    args.output_blend.parent.mkdir(parents=True, exist_ok=True)
    args.output_glb.parent.mkdir(parents=True, exist_ok=True)
    bpy.context.scene["generator"] = "scripts/generate_repair_drone_blender_asset.py"
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(args.output_blend), check_existing=False)
    meshes = consolidate_for_export()
    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.export_scene.gltf(filepath=str(args.output_glb), export_format="GLB",
                              use_selection=True, export_yup=True, export_extras=True,
                              export_animations=False, export_cameras=False, export_lights=False)
    if args.preview_dir:
        preview(args.preview_dir)


if __name__ == "__main__":
    main()
