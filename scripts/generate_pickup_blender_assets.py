"""Build the editable Curvios Clash pickup library, runtime GLB, and review render.

Run with Blender 4.2:
  blender --background --python scripts/generate_pickup_blender_assets.py -- [options]
"""

import argparse
import math
from pathlib import Path

import bpy
from mathutils import Color, Vector


SEMANTIC_BASELINES = {
    "SPEED_UP": 1.755, "SLOW_DOWN": 2.404, "THICK": 1.590, "THIN": 1.305,
    "SHIELD": 1.860, "HEALTH": 1.290, "MG_TURRET": 1.874, "ROCKET_TURRET": 1.934,
    "SLOW_TIME": 1.590, "GHOST": 1.860, "INVERT": 1.590, "FOG": 2.053,
    "FAN_3": 2.311, "FAN_4": 2.230, "FAN_5": 2.311, "TRAIL_GAP": 1.603,
    "EMP": 1.860, "MAGNET": 1.350, "DECOY": 1.942, "PURGE": 1.590,
    "SWAP": 1.590, "MINE": 1.739, "ROCKET_WEAK": 1.915, "ROCKET_MEDIUM": 2.176,
    "ROCKET_HEAVY": 2.480, "ROCKET_MEGA": 3.206, "ROCKET_GUIDED": 3.206,
    "FLAMETHROWER": 1.915, "LIGHTNING": 1.860, "RAILGUN": 2.230,
    "REPAIR_DRONE": 1.860, "BOMBER_STRIKE": 2.240,
}

LEGACY_EXTENTS = {
    "item_arrow": 1.5, "item_battery": .9, "item_box": 1.5, "item_capsule": 2.0,
    "item_coin": 1.0, "item_crate": 1.0, "item_crystal": 2.4, "item_gem": 1.5,
    "item_health": 1.6, "item_orb": 1.0, "item_pyramid": 1.8, "item_ring": 1.6,
    "item_rocket": 1.6, "item_shield": 1.6, "item_sphere": 2.0,
    "item_star": 1.9022, "item_torus": 1.4,
}

COLORS = {
    "SPEED_UP": (0.0, 1.0, .4, 1), "SLOW_DOWN": (1.0, .04, .03, 1),
    "THICK": (1.0, .55, 0.0, 1), "THIN": (.48, .08, 1.0, 1),
    "SHIELD": (.267, .533, 1.0, 1), "HEALTH": (.267, 1.0, .533, 1),
    "MG_TURRET": (1.0, .42, .08, 1), "ROCKET_TURRET": (1.0, .04, .16, 1),
    "SLOW_TIME": (.04, 1.0, .42, 1), "GHOST": (1.0, .12, .58, 1),
    "INVERT": (1.0, 0.0, 1.0, 1), "FOG": (.62, .68, .76, 1),
    "FAN_3": (.208, .851, 1.0, 1), "FAN_4": (.706, .412, 1.0, 1),
    "FAN_5": (1.0, .769, .278, 1), "TRAIL_GAP": (0.0, .68, .82, 1),
    "EMP": (0.0, .38, 1.0, 1), "MAGNET": (1.0, .04, .18, 1),
    "DECOY": (1.0, .18, .68, 1), "PURGE": (.8, .9, 1.0, 1),
    "SWAP": (.55, .12, 1.0, 1), "MINE": (1.0, .08, .02, 1),
    "ROCKET_WEAK": (1.0, .55, .12, 1), "ROCKET_MEDIUM": (1.0, .25, .03, 1),
    "ROCKET_HEAVY": (1.0, .2, .267, 1), "ROCKET_MEGA": (.55, .0, 1.0, 1), "ROCKET_GUIDED": (.63, .2, 1.0, 1),
    "FLAMETHROWER": (1.0, .48, .10, 1),
    "LIGHTNING": (.72, .84, 1.0, 1), "RAILGUN": (.5, .9, 1.0, 1),
    "REPAIR_DRONE": (.33, .94, .64, 1), "BOMBER_STRIKE": (1.0, .61, .26, 1),
}

ROOTS = {}
MATS = {}


def parse_args():
    repo = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-blend", type=Path, default=repo / "assets/items/blender/pickup_library.blend")
    parser.add_argument("--output-glb", type=Path, default=repo / "assets/items/glb/pickup_library.glb")
    parser.add_argument("--preview-dir", type=Path,
                        default=Path(__import__("tempfile").gettempdir()) / "curvios-pickup-preview")
    argv = []
    if "--" in __import__("sys").argv:
        argv = __import__("sys").argv[__import__("sys").argv.index("--") + 1:]
    return parser.parse_args(argv)


def reset():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for block in list(datablocks):
            datablocks.remove(block)


def material(name, color, metal=.65, rough=.28, emission=.0):
    rgb = Color(color[:3]).from_srgb_to_scene_linear()
    linear = (*rgb, color[3])
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = linear
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = linear
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Roughness"].default_value = rough
    if "Emission Color" in bsdf.inputs:
        bsdf.inputs["Emission Color"].default_value = linear
        bsdf.inputs["Emission Strength"].default_value = emission
    return mat


def make_materials():
    MATS["metal"] = material("Pickup_Metal", (0x52/255, 0x64/255, 0x77/255, 1), .35, .35, .015)
    MATS["frame"] = material("Pickup_Frame", (0xdb/255, 0xe5/255, 0xea/255, 1), .08, .38, .015)
    MATS["accent"] = material("Pickup_Accent", (.267, .533, 1, 1), .15, .32, .08)
    MATS["glow"] = material("Pickup_Glow", (.267, .533, 1, 1), .08, .24, .6)
    MATS["matte"] = material("Pickup_Matte", (.68, .74, .79, 1), .04, .72, .01)


def attach(obj, root, role, name):
    obj.name = name
    obj.parent = root
    obj.data.materials.append(MATS[role])
    obj["pickupMaterialRole"] = role
    target = root.users_collection[0]
    for current in list(obj.users_collection):
        current.objects.unlink(obj)
    target.objects.link(obj)
    return obj


def bevel(obj, amount=.08, segments=2):
    modifier = obj.modifiers.new("soft bevel", "BEVEL")
    modifier.width = amount
    modifier.segments = segments
    modifier.limit_method = "ANGLE"
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=modifier.name)


def box(root, name, loc, dims, role="metal", bevel_size=.06, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(location=loc, rotation=rot)
    obj = bpy.context.object
    obj.dimensions = dims
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel_size:
        bevel(obj, min(bevel_size, min(dims) * .22), 2)
    return attach(obj, root, role, name)


def cylinder(root, name, loc, radius, depth, role="metal", vertices=12, axis="Z"):
    rotation = (math.pi / 2, 0, 0) if axis == "Y" else (0, math.pi / 2, 0) if axis == "X" else (0, 0, 0)
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc, rotation=rotation)
    obj = attach(bpy.context.object, root, role, name)
    bevel(obj, min(.06, radius * .18), 2)
    return obj


def sphere(root, name, loc, radius, role="metal", scale=(1, 1, 1), ring_count=8):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=ring_count, radius=radius, location=loc)
    obj = bpy.context.object
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    return attach(obj, root, role, name)


def cone(root, name, loc, radius, depth, role="accent", vertices=12, direction="UP", rot=None):
    if rot is None:
        rot = (math.pi, 0, 0) if direction == "DOWN" else (0, 0, 0)
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius, radius2=0, depth=depth, location=loc, rotation=rot)
    obj = attach(bpy.context.object, root, role, name)
    bevel(obj, min(.035, radius * .15), 1)
    return obj


def torus(root, name, loc, major, minor, role="accent", rot=(math.pi / 2, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=16,
                                    minor_segments=6, location=loc, rotation=rot)
    return attach(bpy.context.object, root, role, name)


def polygon_prism(root, name, contour, depth, role="accent", bevel_size=.06,
                  loc=(0, 0, 0), rot=(0, 0, 0)):
    """Create a closed, beveled silhouette in the X/Z plane with real thickness along Y."""
    contour = list(contour)
    signed_area = sum(
        x * contour[(index + 1) % len(contour)][1]
        - contour[(index + 1) % len(contour)][0] * z
        for index, (x, z) in enumerate(contour)
    ) / 2
    if abs(signed_area) < 1e-8:
        raise ValueError(f"{name} contour must enclose a non-zero area")
    # Faces below expect clockwise X/Z contours. Normalize here because mirrored
    # silhouettes otherwise export with inward-facing caps and side walls.
    if signed_area > 0:
        contour.reverse()
    half = depth / 2
    vertices = [(x, -half, z) for x, z in contour] + [(x, half, z) for x, z in contour]
    count = len(contour)
    faces = [tuple(range(count - 1, -1, -1)), tuple(range(count, count * 2))]
    for index in range(count):
        following = (index + 1) % count
        faces.append((index, following, following + count, index + count))
    mesh = bpy.data.meshes.new(f"{name}_mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    obj.location = loc
    obj.rotation_euler = rot
    root.users_collection[0].objects.link(obj)
    if bevel_size:
        bevel(obj, bevel_size, 3)
    return attach(obj, root, role, name)


def lathe_profile(root, name, profile, role="accent", segments=18, loc=(0, 0, 0),
                  cap_start=True, cap_end=True):
    """Revolve a radius/Z profile for smooth missile bodies, noses, and nozzles."""
    vertices = []
    for radius, z in profile:
        for index in range(segments):
            angle = math.tau * index / segments
            vertices.append((radius * math.cos(angle), radius * math.sin(angle), z))
    faces = []
    rings = len(profile)
    for ring in range(rings - 1):
        for index in range(segments):
            following = (index + 1) % segments
            a = ring * segments + index
            b = ring * segments + following
            c = (ring + 1) * segments + following
            d = (ring + 1) * segments + index
            faces.append((a, b, c, d))
    if cap_start and profile[0][0] > 0:
        faces.append(tuple(range(segments - 1, -1, -1)))
    if cap_end and profile[-1][0] > 0:
        faces.append(tuple((rings - 1) * segments + i for i in range(segments)))
    mesh = bpy.data.meshes.new(f"{name}_mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    obj.location = loc
    root.users_collection[0].objects.link(obj)
    for poly in mesh.polygons:
        poly.use_smooth = True
    return attach(obj, root, role, name)


def tube_path(root, name, points, radius, role="accent", closed=False):
    """Build a smooth connected tube through X/Y/Z points and convert it to exportable mesh."""
    curve = bpy.data.curves.new(f"{name}_curve", "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 2
    curve.bevel_depth = radius
    curve.bevel_resolution = 2
    curve.resolution_u = 2
    spline = curve.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for point, coordinates in zip(spline.bezier_points, points):
        point.co = coordinates
        point.handle_left_type = "AUTO"
        point.handle_right_type = "AUTO"
    spline.use_cyclic_u = closed
    obj = bpy.data.objects.new(name, curve)
    root.users_collection[0].objects.link(obj)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    obj.select_set(False)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return attach(obj, root, role, name)


def arc_points(radius, start, end, count, y=0, center=(0, 0)):
    cx, cz = center
    return [(cx + math.cos(start + (end-start)*index/(count-1))*radius,
             y,
             cz + math.sin(start + (end-start)*index/(count-1))*radius)
            for index in range(count)]


def root_for(identifier, color=None):
    collection = bpy.data.collections.new(f"MODEL_{identifier}")
    bpy.context.scene.collection.children.link(collection)
    root = bpy.data.objects.new(f"pickup_{identifier}", None)
    collection.objects.link(root)
    root["blenderPickupModel"] = identifier
    root["saveVersion"] = 0
    root["semanticColor"] = list(color or (.2, .7, 1, 1))[:3]
    ROOTS[identifier] = root
    return root


def arrow(root, x=0, z=0, direction=1, role="accent", scale=1):
    contour = [(-.18, -.62), (.18, -.62), (.18, .18), (.46, .18),
               (0, .72), (-.46, .18), (-.18, .18)]
    if direction < 0:
        contour = [(px, -pz) for px, pz in reversed(contour)]
    return polygon_prism(root, "direction_arrow", [(x + px*scale, z + pz*scale)
                                                     for px, pz in contour],
                         .3*scale, role, .055*scale)


def build_speed(root):
    bolt = [(-.08, 1.15), (.62, 1.15), (.18, .26), (.62, .26),
            (-.42, -1.15), (-.14, -.2), (-.58, -.2)]
    trim = [(x * 1.12, z * 1.06) for x, z in bolt]
    spine = [(x * .42 + .01, z * .74 + .08) for x, z in bolt]
    polygon_prism(root, "lightning_trim", trim, .38, "frame", .08, loc=(0, .06, 0))
    polygon_prism(root, "lightning_body", bolt, .34, "accent", .07, loc=(0, -.1, 0))
    polygon_prism(root, "lightning_spine", spine, .08, "frame", .025, loc=(0, -.32, 0))
    polygon_prism(root, "lightning_body_back", bolt, .08, "accent", .04, loc=(0, .29, 0))
    polygon_prism(root, "lightning_spine_back", spine, .055, "frame", .018, loc=(0, .36, 0))


def build_slow(root):
    foot = [(-1.02, -.5), (.72, -.5), (1.0, -.34), (.9, -.12),
            (.4, -.04), (-.72, -.06), (-1.04, -.22)]
    head = [(.52, -.08), (.88, -.02), (1.02, .24), (.95, .48),
            (.62, .5), (.4, .3)]
    polygon_prism(root, "snail_connected_foot", foot, .42, "accent", .09)
    polygon_prism(root, "snail_head", head, .42, "accent", .08)
    cylinder(root, "snail_spiral_shell", (-.25, 0, .28), .68, .46, "frame", 18, "Y")
    tube_path(root, "snail_shell_spiral",
              [(-.25 + math.cos(t)*(.52 - .055*t), -.27, .28 + math.sin(t)*(.52 - .055*t))
               for t in [index*math.tau*1.55/15 for index in range(16)]],
              .065, "accent")
    for x in (.7, .96):
        tube_path(root, "snail_antenna", [(x, 0, .4), (x+.04, 0, .72), (x+.1, 0, .86)], .045, "frame")
        sphere(root, "snail_feeler", (x+.1, 0, .86), .085, "accent", (1, .8, 1))


def build_trail(root, thin=False, gap=False):
    if gap:
        left = [(-1.02, -.34), (-.2, -.34), (-.4, -.06), (-.18, .2), (-1.02, .2)]
        right = [(1.02, -.34), (.2, -.34), (.4, -.06), (.18, .2), (1.02, .2)]
        for name, contour in (("broken_trail_left", left), ("broken_trail_right", right)):
            polygon_prism(root, name, contour, .42, "accent", .07)
        box(root, "broken_trail_frame", (0, .08, -.07), (2.2, .22, .72), "metal", .1)
        for x in (-.73, .73):
            box(root, "broken_trail_highlight", (x, -.25, -.07), (.5, .07, .12), "frame", .025)
    else:
        strip_height = .58 if not thin else .26
        box(root, "trail_module_housing", (0, .08, 0), (2.05, .42, .9), "metal", .12)
        box(root, "trail_raised_strip", (0, -.2, 0), (1.68, .18, strip_height), "accent", .07)
        box(root, "trail_strip_back", (0, .31, 0), (1.68, .06, strip_height), "accent", .04)
        arrow_group = bpy.data.objects.new("trailWidthArrowAssembly", None)
        root.users_collection[0].objects.link(arrow_group)
        arrow_group.parent = root
        arrow_group["trailWidthArrowAssembly"] = True
        arrow_group["trailArrowMode"] = "inward" if thin else "outward"
        for face, face_y, view_sign in (("front", -.36, 1), ("back", .40, -1)):
            for side, view_x in (("left", -.66), ("right", .66)):
                # The rear is viewed along -Y, so its screen-space left/right axes are
                # the inverse of Blender X. Mirror both placement and direction to keep
                # THICK visibly expanding and THIN visibly contracting on either face.
                x = view_x * view_sign
                view_direction = (1 if side == "right" else -1) * (-1 if thin else 1)
                world_direction = view_direction * view_sign
                arrow_shape = [(-.2, -.12), (.03, -.12), (.03, -.25), (.28, 0),
                               (.03, .25), (.03, .12), (-.2, .12)]
                if world_direction < 0:
                    arrow_shape = [(-px, pz) for px, pz in reversed(arrow_shape)]
                arrow_obj = polygon_prism(
                    root, f"trail_width_arrow_{face}_{side}",
                    [(x+px, pz) for px, pz in arrow_shape],
                    .075, "frame", .025, loc=(0, face_y, 0),
                )
                arrow_obj["trailArrowFace"] = face
                arrow_obj["trailArrowSide"] = side
                arrow_obj["trailArrowDirection"] = "right" if view_direction > 0 else "left"
                arrow_obj["trailArrowWorldDirection"] = "right" if world_direction > 0 else "left"
                arrow_obj.parent = arrow_group
                arrow_obj.matrix_parent_inverse = arrow_group.matrix_world.inverted()


def build_shield(root):
    outer = [(-.88, .68), (-.55, 1.0), (.55, 1.0), (.88, .68),
             (.72, -.32), (0, -1.12), (-.72, -.32)]
    inner = [(-.69, .6), (-.45, .8), (.45, .8), (.69, .6),
             (.56, -.24), (0, -.88), (-.56, -.24)]
    polygon_prism(root, "shield_back", [(x*1.04, z*1.03) for x, z in outer], .42,
                  "metal", .08, loc=(0, .08, 0))
    polygon_prism(root, "shield_continuous_rim", outer, .34, "frame", .075, loc=(0, -.08, 0))
    polygon_prism(root, "shield_armor", inner, .16, "accent", .06, loc=(0, -.27, .01))
    polygon_prism(root, "shield_rim_back", outer, .08, "frame", .045, loc=(0, .34, 0))
    polygon_prism(root, "shield_armor_back", inner, .07, "accent", .035, loc=(0, .41, .01))


def build_health(root):
    box(root, "case_shadow", (0, .08, -.18), (1.92, .48, 1.34), "metal", .18)
    box(root, "medical_case", (0, -.16, -.16), (1.78, .34, 1.2), "frame", .16)
    box(root, "case_inset", (0, -.35, -.16), (1.48, .08, .91), "metal", .11)
    for x in (-.46, .46):
        box(root, "handle_post", (x, -.08, .72), (.22, .32, .62), "frame", .08)
    box(root, "handle_grip", (0, -.08, .98), (1.05, .32, .2), "frame", .08)
    box(root, "case_seam", (0, -.405, -.16), (1.42, .035, .07), "metal", .015)
    box(root, "medical_cross_v", (0, -.43, -.15), (.25, .09, .68), "accent", .045)
    box(root, "medical_cross_h", (0, -.43, -.15), (.68, .09, .25), "accent", .045)
    box(root, "case_back_lid", (0, .37, -.16), (1.78, .08, 1.2), "frame", .14)
    box(root, "case_back_inset", (0, .425, -.16), (1.48, .045, .91), "metal", .1)
    box(root, "medical_cross_v_back", (0, .47, -.15), (.25, .07, .68), "accent", .04)
    box(root, "medical_cross_h_back", (0, .47, -.15), (.68, .07, .25), "accent", .04)


def build_turret(root, rocket=False):
    cylinder(root, "turret_stable_base", (0, 0, -.62), .76, .26, "metal", 16)
    cylinder(root, "turret_swivel_ring", (0, 0, -.4), .55, .2, "accent", 16)
    if rocket:
        box(root, "rocket_pod", (0, -.1, .06), (1.18, .72, .74), "frame", .14)
        for x, z in ((-.3,-.08),(.3,-.08),(-.3,.25),(.3,.25)):
            cylinder(root, "rocket_pod_tube", (x, -.5, z), .14, .3, "metal", 12, "Y")
            cylinder(root, "rocket_pod_muzzle", (x, -.68, z), .105, .035, "glow", 12, "Y")
    else:
        box(root, "mg_swivel_head", (0, -.05, .08), (.92, .72, .68), "frame", .13)
        cylinder(root, "mg_barrel", (0, -.88, .14), .105, 1.35, "metal", 14, "Y")
        cylinder(root, "mg_barrel_jacket", (0, -.95, .14), .17, .54, "accent", 14, "Y")
        cylinder(root, "mg_muzzle", (0, -1.58, .14), .15, .18, "metal", 14, "Y")
        box(root, "mg_ammo_box", (.58, -.04, -.02), (.34, .58, .48), "accent", .07)


def build_hourglass(root):
    for z in (-.82, .82):
        box(root, "hourglass_cap", (0, 0, z), (1.32, .42, .2), "frame", .07)
    for x in (-.54, .54):
        box(root, "hourglass_sidepost", (x, .02, 0), (.16, .34, 1.48), "metal", .055)
    upper = [(-.43, .66), (.43, .66), (.17, .12), (.07, .02), (-.07, .02), (-.17, .12)]
    lower = [(-.07, -.02), (.07, -.02), (.18, -.16), (.42, -.66), (-.42, -.66), (-.18, -.16)]
    polygon_prism(root, "hourglass_upper_sand", upper, .26, "accent", .035)
    polygon_prism(root, "hourglass_lower_sand", lower, .26, "accent", .035)
    sphere(root, "hourglass_pinched_flow", (0, -.17, 0), .075, "glow", (1, .55, 1.5))


def build_ghost(root):
    outline = [(-.72, -.68), (-.68, .25), (-.55, .7), (-.28, .96),
               (0, 1.04), (.28, .96), (.55, .7), (.68, .25), (.72, -.68),
               (.46, -.48), (.2, -.72), (0, -.48), (-.2, -.72), (-.46, -.48)]
    polygon_prism(root, "classic_ghost_body", outline, .48, "accent", .1)
    for x in (-.25, .25):
        box(root, "ghost_recessed_eye", (x, -.3, .3), (.17, .06, .31), "metal", .06)
        box(root, "ghost_recessed_eye_back", (-x, .3, .3), (.17, .06, .31), "metal", .06)
    tube_path(root, "ghost_hem_highlight", [(-.55,-.3,-.47),(-.32,-.3,-.58),(0,-.3,-.48),
                                             (.32,-.3,-.58),(.55,-.3,-.47)], .045, "frame")


def build_fog(root):
    for x, z, radius in ((-.68,-.1,.58),(-.25,.28,.72),(.3,.34,.76),(.72,-.08,.6),
                         (-.35,-.42,.58),(.25,-.44,.62)):
        sphere(root, "connected_cloud_lobe", (x, 0, z), radius, "matte", (1, .72, .82))
    box(root, "cloud_connected_base", (0, 0, -.43), (1.62, .7, .42), "matte", .18)
    tube_path(root, "cloud_silver_lining", [(-.78,-.42,-.3),(-.4,-.44,-.5),(0,-.44,-.42),
                                              (.4,-.44,-.5),(.78,-.42,-.3)], .055, "frame")


def build_crossed_arrows(root, swap=False):
    if swap:
        top = [(-.92, .16), (-.3, .16), (-.06, .42), (.48, .42), (.48, .66),
               (1.02, .28), (.48, -.1), (.48, .14), (.06, .14), (-.18, -.12), (-.92, -.12)]
        bottom = [(-x, -z) for x, z in reversed(top)]
        polygon_prism(root, "swap_interlock_top", top, .38, "accent", .065, loc=(0, -.04, 0))
        polygon_prism(root, "swap_interlock_bottom", bottom, .38, "frame", .065, loc=(0, .04, 0))
        tube_path(root, "swap_center_bridge", [(-.3,-.23,.1),(0,-.25,0),(.3,-.23,-.1)], .055, "metal")
    else:
        contour = [(-.18, -.72), (.18, -.72), (.18, .22), (.45, .22),
                   (0, .78), (-.45, .22), (-.18, .22)]
        def rotated(points, angle):
            cosine, sine = math.cos(angle), math.sin(angle)
            return [(x*cosine + z*sine, -x*sine + z*cosine) for x, z in points]

        polygon_prism(root, "invert_cross_arrow_a", rotated(contour, -.72), .3,
                      "accent", .055, loc=(0, -.08, 0))
        polygon_prism(root, "invert_cross_arrow_b", rotated(contour, .72), .3,
                      "frame", .055, loc=(0, .08, 0))
        cylinder(root, "invert_crossing_pin", (0, -.24, 0), .13, .07, "metal", 12, "Y")


def build_emp(root):
    cylinder(root, "emp_impulse_puck", (0, 0, -.25), .78, .34, "metal", 18, "Y")
    cylinder(root, "emp_raised_center", (0, -.22, -.25), .36, .16, "accent", 16, "Y")
    cylinder(root, "emp_center_insert", (0, -.33, -.25), .17, .04, "glow", 14, "Y")
    for radius in (.62, .96):
        points = arc_points(radius, math.radians(22), math.radians(158), 7, -.27, (0, -.12))
        tube_path(root, "emp_wave_arc", points, .065, "frame")
        points_back = [(-x, .27, z) for x, _y, z in reversed(points)]
        tube_path(root, "emp_wave_arc_back", points_back, .055, "frame")


def build_magnet(root):
    horseshoe = [(-.68,0,.72),(-.68,0,.1),(-.56,0,-.46),(-.28,0,-.76),
                 (0,0,-.84),(.28,0,-.76),(.56,0,-.46),(.68,0,.1),(.68,0,.72)]
    tube_path(root, "continuous_horseshoe", horseshoe, .22, "accent")
    for x in (-.68, .68):
        box(root, "magnet_pale_endcap", (x, 0, .78), (.5, .5, .28), "frame", .08)
        box(root, "magnet_back_endcap", (x, .26, .78), (.42, .05, .21), "frame", .035)
    tube_path(root, "magnet_inner_highlight",
              [(-.48,-.2,.52),(-.46,-.2,-.2),(-.2,-.2,-.54),(0,-.2,-.61),
               (.2,-.2,-.54),(.46,-.2,-.2),(.48,-.2,.52)], .045, "glow")


def build_decoy(root):
    aircraft = [(0, .78), (.2, .22), (.7, -.02), (.67, -.25), (.18, -.14),
                (.28, -.72), (0, -.54), (-.28, -.72), (-.18, -.14), (-.67, -.25),
                (-.7, -.02), (-.2, .22)]
    front = [(x-.33, z+.2) for x, z in aircraft]
    rear = [(x*.78+.46, z*.78-.3) for x, z in aircraft]
    polygon_prism(root, "decoy_front_aircraft", front, .34, "accent", .055, loc=(0, -.12, 0))
    tube_path(root, "decoy_rear_signal_outline", [(x,.2,z) for x,z in rear], .065, "frame", closed=True)
    for radius in (.35, .55):
        tube_path(root, "decoy_signal_arc", arc_points(radius, math.radians(205), math.radians(320), 6,
                                                        .24, (.48,-.3)), .035, "glow")


def build_purge(root):
    droplet = [(0, 1.02), (.22, .58), (.53, .08), (.62, -.3), (.5, -.66),
               (.22, -.9), (0, -.96), (-.22, -.9), (-.5, -.66), (-.62, -.3),
               (-.53, .08), (-.22, .58)]
    rim = [(x*1.12, z*1.08) for x,z in droplet]
    polygon_prism(root, "purge_droplet_rim", rim, .4, "frame", .08)
    polygon_prism(root, "purge_droplet", droplet, .3, "accent", .07, loc=(0,-.12,0))
    star = []
    for index in range(10):
        angle = math.pi/2 + index*math.pi/5
        radius = .3 if index % 2 == 0 else .13
        star.append((math.cos(angle)*radius, math.sin(angle)*radius-.18))
    polygon_prism(root, "purge_clean_star", star, .055, "glow", .018, loc=(0,-.34,0))
    polygon_prism(root, "purge_clean_star_back",
                  [(-x, z) for x, z in reversed(star)], .05, "glow", .018,
                  loc=(0,.34,0))
    tube_path(root, "purge_gleam", [(-.22,-.33,.54),(-.34,-.34,.18),(-.29,-.34,-.15)], .055, "glow")


def build_mine(root):
    lathe_profile(root, "mine_squat_armored_body",
                  [(.48,-.48),(.7,-.28),(.76,0),(.7,.28),(.48,.48)], "metal", 18)
    cylinder(root, "mine_armor_seam", (0, 0, 0), .78, .12, "accent", 18, "Y")
    for i in range(8):
        angle = i * math.tau / 8
        direction = Vector((math.cos(angle), 0, math.sin(angle)))
        center = direction * .88
        spike = cone(root, "mine_short_radial_fuse", center, .13, .42, "frame", 10)
        spike.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
    cylinder(root, "mine_red_trigger", (0, -.57, .04), .2, .12, "glow", 14, "Y")


def build_pilot_rocket(root, tier="HEAVY"):
    marker_count = {"WEAK":0,"MEDIUM":1,"HEAVY":2,"MEGA":3}[tier]
    size = {"WEAK":.82,"MEDIUM":.94,"HEAVY":1.06,"MEGA":1.2}[tier]
    body_profile = [(.22*size, -.76*size), (.34*size, -.64*size), (.41*size, -.38*size),
                    (.43*size, .24*size), (.39*size, .58*size)]
    nose_profile = [(.39*size, .57*size), (.36*size, .7*size), (.29*size, .86*size),
                    (.19*size, 1.0*size), (.08*size, 1.1*size), (.006*size, 1.14*size)]
    nozzle_profile = [(.2*size, -1.04*size), (.33*size, -1.0*size), (.38*size, -.9*size),
                      (.3*size, -.76*size), (.25*size, -.62*size)]
    lathe_profile(root, "rocket_curved_body", body_profile, "accent", 20)
    lathe_profile(root, "rocket_ogive_nose", nose_profile, "frame", 20)
    nozzle_group = bpy.data.objects.new("rocketNozzleAssembly", None)
    root.users_collection[0].objects.link(nozzle_group)
    nozzle_group.parent = root
    nozzle_group["rocketNozzleAssembly"] = True
    nozzle = lathe_profile(root, "rocket_recessed_nozzle", nozzle_profile, "metal", 18,
                           cap_start=False, cap_end=True)
    nozzle["rocketNozzle"] = True
    nozzle.parent = nozzle_group
    nozzle.matrix_parent_inverse = nozzle_group.matrix_world.inverted()

    fin_contour = [(0.2*size, -.35*size), (.76*size, -.72*size),
                   (.68*size, -1.02*size), (.2*size, -.8*size)]
    left_contour = [(-x, z) for x, z in reversed(fin_contour)]
    polygon_prism(root, "rocket_fin_right", fin_contour, .13*size, "metal", .035)
    polygon_prism(root, "rocket_fin_left", left_contour, .13*size, "metal", .035)
    polygon_prism(root, "rocket_fin_front", fin_contour, .13*size, "metal", .035,
                  rot=(0, 0, math.pi/2))
    polygon_prism(root, "rocket_fin_back", left_contour, .13*size, "metal", .035,
                  rot=(0, 0, math.pi/2))
    glow = cylinder(root, "nozzle_glow", (0, 0, -.99*size), .145*size, .035*size,
                    "glow", 16, "Z")
    glow["rocketNozzleGlow"] = True
    glow.parent = nozzle_group
    glow.matrix_parent_inverse = nozzle_group.matrix_world.inverted()
    marker_group = bpy.data.objects.new("rocketTierCollars", None)
    root.users_collection[0].objects.link(marker_group)
    marker_group.parent = root
    marker_group["rocketTierCollars"] = True
    marker_group["tierMarkerCount"] = marker_count
    for i in range(marker_count):
        marker = torus(root, "tier_collar", (0, 0, -.22*size + i*.32*size), .44*size,
                       .045*size, "frame", rot=(0, 0, 0))
        marker.parent = marker_group
        marker.matrix_parent_inverse = marker_group.matrix_world.inverted()
    root["rocketTier"] = tier
    root["tierMarkers"] = marker_count


def build_flamethrower(root):
    # A tank on the back, a short barrel with a nozzle in front and a flame tongue leaving it:
    # readable as "fire sprayer" at pickup size, like the machine gun turret reads as a gun.
    # Laid out along X so the profile faces the viewer, like the rockets stand along Z.
    cylinder(root, "flame_tank", (.55, 0, 0), .34, 1.05, "metal", 14, "X")
    torus(root, "flame_tank_band", (.55, 0, 0), .36, .05, "frame", rot=(0, math.pi / 2, 0))
    box(root, "flame_grip", (.05, 0, -.3), (.42, .22, .3), "frame", .05)
    cylinder(root, "flame_barrel", (-.42, 0, .05), .1, .9, "metal", 12, "X")
    cylinder(root, "flame_nozzle", (-.95, 0, .05), .17, .22, "accent", 12, "X")
    # The tongue points along -X, out of the nozzle.
    cone(root, "flame_tongue", (-1.32, 0, .05), .2, .5, "glow", 12, rot=(0, -math.pi / 2, 0))


def build_rocket(root, tier="WEAK"):
    build_pilot_rocket(root, tier)


DIGITS = {
    3: ("t","m","b","rt","rb"), 4: ("m","lt","rt","rb"),
    5: ("t","m","b","lt","rb"),
}


def label_bar(root, label, name, x, y, z, w, h, angle=0):
    obj = box(root, name, (x, y, z), (w, .07, h), "frame", 0)
    obj.rotation_euler.y = angle
    obj.parent = label
    obj.matrix_parent_inverse = label.matrix_world.inverted()
    return obj


def connector_box(root, name, start, end, width, depth, role="metal"):
    """Create a closed box whose local Z axis joins two X/Z points."""
    dx, dz = end[0] - start[0], end[1] - start[1]
    length = math.hypot(dx, dz)
    return box(
        root, name, ((start[0] + end[0]) / 2, 0, (start[1] + end[1]) / 2),
        (width, depth, length), role, 0,
        rot=(0, math.atan2(dx, dz), 0),
    )


def build_fan_label_surface(root, label, count, side):
    """Build one raised label, mirrored so the rear reads correctly from behind."""
    front = side == "front"
    mirror = 1 if front else -1
    y = -.345 if front else .345
    pieces = []
    for x, z, w, h in (
        (0, -.56, 1.55, .045), (0, -.84, 1.55, .045),
        (-.775, -.70, .045, .32), (.775, -.70, .045, .32),
    ):
        pieces.append(label_bar(root, label, "label_border", mirror*x, y, z, w, h))
    for angle in (-.72, .72):
        pieces.append(label_bar(root, label, "multiply", mirror*-.52, y, -.565,
                                .075, .32, mirror*angle))
    for segment in DIGITS[count]:
        horizontal = segment in ("t", "m", "b")
        x = .37 if horizontal else (.20 if segment.startswith("l") else .54)
        z = {"t":-.43, "m":-.565, "b":-.70}.get(
            segment, -.497 if segment.endswith("t") else -.632,
        )
        pieces.append(label_bar(
            root, label, "digit", mirror*x, y, z,
            .34 if horizontal else .07, .07 if horizontal else .17,
        ))
    surface = join_meshes(pieces, f"weaponFanLabelSurface_{side}", label, "frame")
    surface["weaponFanLabelSurface"] = True
    surface["labelSide"] = side
    surface["markerText"] = f"×{count}"
    return surface


def build_fan(root, count):
    base = box(root, "fan_closed_base", (0, 0, -.56), (2.02, .62, .68), "metal", .12)
    base["weaponFanClosedBase"] = True
    cluster = bpy.data.objects.new("weaponFanProjectileCluster", None)
    root.users_collection[0].objects.link(cluster)
    cluster.parent = root
    cluster["weaponFanProjectileCluster"] = True
    cluster["projectileCount"] = count
    projectiles = []
    tips = []
    connector_group = bpy.data.objects.new("weaponFanConnectorAssembly", None)
    root.users_collection[0].objects.link(connector_group)
    connector_group.parent = root
    connector_group["weaponFanConnectorAssembly"] = True
    connector_group["connectorCount"] = count
    connectors = []
    projectile_shape = [(-.12,-.38),(.12,-.38),(.15,.18),(0,.48),(-.15,.18)]
    for i in range(count):
        angle = -.62 + 1.24 * i / (count-1)
        x, z = math.sin(angle)*.72, math.cos(angle)*.72 + .02
        projectile = polygon_prism(root, "fan_stout_projectile", projectile_shape, .28,
                                  "accent", .045, loc=(x, 0, z), rot=(0, angle, 0))
        projectile.parent = cluster
        projectile.matrix_parent_inverse = cluster.matrix_world.inverted()
        projectiles.append(projectile)
        tip = sphere(root, "fan_projectile_insert",
                     (math.sin(angle)*.96, -.16, math.cos(angle)*.96+.02), .075,
                     "glow", (1,.55,1), ring_count=7)
        tip.parent = cluster
        tip.matrix_parent_inverse = cluster.matrix_world.inverted()
        tips.append(tip)
        connector = connector_box(
            root, "fan_projectile_connector",
            (math.sin(angle)*.22, -.25),
            (math.sin(angle)*.34, math.cos(angle)*.34+.02),
            .13, .3,
        )
        connector.parent = connector_group
        connector.matrix_parent_inverse = connector_group.matrix_world.inverted()
        connectors.append(connector)
    join_meshes(projectiles, "weaponFanProjectileGeometry", cluster, "accent")
    join_meshes(tips, "weaponFanProjectileInsertGeometry", cluster, "glow")
    connector_geometry = join_meshes(connectors, "weaponFanConnectorGeometry", connector_group, "metal")
    connector_geometry["weaponFanConnectorGeometry"] = True
    label = bpy.data.objects.new("weaponFanLabel", None)
    root.users_collection[0].objects.link(label)
    label.parent = root
    label["weaponFanLabel"] = True
    label["markerText"] = f"×{count}"
    build_fan_label_surface(root, label, count, "front")
    build_fan_label_surface(root, label, count, "back")
    root["fanProjectiles"] = count
    root["markerText"] = f"×{count}"


def build_legacy(root, identifier):
    if identifier == "item_arrow":
        contour = [(-.2,-.7),(.2,-.7),(.2,.12),(.52,.12),(0,.78),(-.52,.12),(-.2,.12)]
        polygon_prism(root, "legacy_arrow_frame", [(x*1.12,z*1.1) for x,z in contour], .4, "frame", .07)
        polygon_prism(root, "legacy_arrow", contour, .28, "accent", .06, loc=(0,-.12,0))
    elif identifier == "item_battery":
        box(root, "battery_case", (0,0,-.06), (1.0,.48,1.45), "metal", .14)
        box(root, "battery_face", (0,-.28,-.06), (.78,.08,1.18), "frame", .09)
        box(root, "battery_terminal", (0,0,.76), (.42,.38,.2), "frame", .05)
        for z in (-.42,-.07,.28):
            box(root, "battery_charge_bar", (0,-.35,z), (.58,.06,.18), "accent", .04)
    elif identifier in ("item_box", "item_crate"):
        box(root, "cargo_body", (0,0,0), (1.45,1.15,1.45), "metal", .16)
        box(root, "cargo_front_panel", (0,-.62,0), (1.12,.08,1.12), "accent", .11)
        for angle in (-.72,.72):
            box(root,"cargo_brace",(0,-.69,0),(.16,.08,1.5),"frame",.03,rot=(0,angle,0))
    elif identifier == "item_capsule": build_health(root)
    elif identifier == "item_coin":
        cylinder(root,"coin_rim",(0,0,0),.82,.28,"frame",18,"Y")
        cylinder(root,"coin_face",(0,-.19,0),.63,.08,"accent",18,"Y")
        cylinder(root,"coin_back",(0,.19,0),.63,.08,"accent",18,"Y")
        polygon_prism(root,"coin_chevron",[(-.18,-.32),(.28,0),(-.18,.32),(-.05,0)],.055,"metal",.02,loc=(0,-.27,0))
    elif identifier in ("item_crystal","item_gem"):
        gem = [(0,1.0),(.62,.42),(.5,-.45),(0,-1.0),(-.5,-.45),(-.62,.42)]
        polygon_prism(root,"gem_frame",[(x*1.1,z*1.06) for x,z in gem],.46,"frame",.055)
        polygon_prism(root,"gem_body",gem,.34,"accent",.045,loc=(0,-.1,0))
        tube_path(root,"gem_facet",[(0,-.3,.86),(-.23,-.31,.25),(0,-.31,-.78),(.23,-.31,.25),(0,-.31,.86)],.025,"glow")
    elif identifier == "item_health": build_health(root)
    elif identifier in ("item_orb","item_sphere"):
        sphere(root,"orb_core",(0,0,0),.76,"accent")
        torus(root,"orb_orbit_a",(0,0,0),.84,.055,"frame",(math.pi/2,.55,0))
        torus(root,"orb_orbit_b",(0,0,0),.84,.04,"frame",(math.pi/2,-.55,0))
    elif identifier == "item_pyramid":
        cone(root,"pyramid_body",(0,0,0),.92,1.75,"accent",4)
        box(root,"pyramid_base",(0,0,-.82),(1.42,1.42,.14),"frame",.04)
    elif identifier in ("item_ring","item_torus"):
        torus(root,"ring_body",(0,0,0),.72,.2,"frame")
        torus(root,"ring_core",(0,-.1,0),.72,.07,"accent")
    elif identifier == "item_rocket": build_rocket(root,"MEDIUM")
    elif identifier == "item_shield": build_shield(root)
    elif identifier == "item_star":
        star = []
        for index in range(10):
            angle = math.pi/2 + index*math.pi/5
            radius = .92 if index % 2 == 0 else .42
            star.append((math.cos(angle)*radius, math.sin(angle)*radius))
        polygon_prism(root,"star_frame",[(x*1.1,z*1.1) for x,z in star],.42,"frame",.055)
        polygon_prism(root,"star_body",star,.3,"accent",.045,loc=(0,-.12,0))
        sphere(root,"star_core",(0,-.31,0),.2,"glow",(1,.45,1))


def bounds(root):
    bpy.context.view_layer.update()
    points = []
    for obj in root.children_recursive:
        if obj.type != "MESH": continue
        points.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
    if not points: return 1.0
    mins = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    maxs = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    return max(maxs - mins)


def normalize(root, target):
    current = bounds(root)
    root.scale = (target/current,)*3
    root["targetLargestDimension"] = target


def join_meshes(objects, name, parent, role):
    objects = [obj for obj in objects if obj.type == "MESH"]
    if not objects:
        return None
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    if len(objects) > 1:
        bpy.ops.object.join()
    joined = objects[0]
    joined.name = name
    joined.parent = parent
    joined["pickupMaterialRole"] = role
    return joined


def consolidate(root):
    """Keep each pickup to four material batches plus the optional fan label batch."""
    label = next((child for child in root.children if child.get("weaponFanLabel") is True), None)
    if label and not any(child.get("weaponFanLabelSurface") is True for child in label.children):
        join_meshes(list(label.children), "weaponFanLabelGeometry", label, "frame")
    collar_group = next((child for child in root.children if child.get("rocketTierCollars") is True), None)
    if collar_group:
        join_meshes(list(collar_group.children), "rocketTierCollarGeometry", collar_group, "frame")
    for role in ("metal", "frame", "accent", "glow", "matte"):
        role_objects = [obj for obj in root.children
                        if obj.type == "MESH" and obj.get("pickupMaterialRole") == role]
        join_meshes(role_objects, f"{root.name}_{role}", root, role)


def build_lightning(root):
    # A big storm cloud with a short, broad bolt below it. The cloud leads, so the item never reads
    # as the green speed bolt: "strike from the sky" rather than "go fast".
    sphere(root, "strike_cloud", (0, 0, .55), .5, "frame", scale=(1.5, 1, .75))
    sphere(root, "strike_cloud_left", (-.62, 0, .42), .36, "frame")
    sphere(root, "strike_cloud_right", (.62, 0, .46), .38, "frame")
    sphere(root, "strike_cloud_top", (.15, 0, .85), .34, "frame")
    bolt = [(.12, .2), (-.28, -.38), (-.02, -.38), (-.24, -1.0), (.34, -.16), (.08, -.16), (.3, .2)]
    polygon_prism(root, "strike_bolt", bolt, .24, "accent", .04, loc=(0, 0, 0))


def build_railgun(root):
    # Two rails around a thin glowing core, three coils and a stock: a long charged gun, laid out
    # along X like the flamethrower so its profile faces the viewer.
    box(root, "rail_top", (0, 0, .19), (2.0, .2, .12), "metal", .03)
    box(root, "rail_bottom", (0, 0, -.19), (2.0, .2, .12), "metal", .03)
    cylinder(root, "rail_core", (0, 0, 0), .09, 2.0, "glow", 10, "X")
    for index, x in enumerate((-.6, -.15, .3)):
        torus(root, f"rail_coil_{index}", (x, 0, 0), .3, .06, "accent", rot=(0, math.pi / 2, 0))
    box(root, "rail_stock", (1.0, 0, -.08), (.6, .34, .5), "frame", .05)
    sphere(root, "rail_emitter", (-1.08, 0, 0), .16, "glow")


def build_repair_drone(root):
    # Compact medical quadcopter: one protected core, four arms and four visible rotor rings.
    sphere(root, "repair_core", (0, 0, 0), .42, "frame", scale=(1.25, .8, .55))
    box(root, "repair_cross_x", (0, 0, 0), (1.7, .16, .16), "metal", .04)
    box(root, "repair_cross_z", (0, 0, 0), (.16, .16, 1.7), "metal", .04)
    for index, (x, z) in enumerate(((-.75, -.75), (.75, -.75), (.75, .75), (-.75, .75))):
        torus(root, f"repair_rotor_{index}", (x, 0, z), .27, .055, "accent", rot=(math.pi / 2, 0, 0))
        box(root, f"repair_blade_{index}", (x, 0, z), (.42, .035, .07), "glow", .02)
    box(root, "repair_mark_vertical", (0, -.43, 0), (.14, .05, .52), "glow", .02)
    box(root, "repair_mark_horizontal", (0, -.43, 0), (.52, .05, .14), "glow", .02)


def build_bomber_strike(root):
    # Readable top-view bomber silhouette: long hull, swept wings, twin engines and hot bomb bay.
    sphere(root, "bomber_hull", (0, 0, 0), .48, "frame", scale=(.55, .5, 1.8))
    polygon_prism(root, "bomber_wings", [
        (-1.15, .25), (-.25, .62), (0, .85), (.25, .62), (1.15, .25),
        (.92, -.18), (.24, .08), (0, -.72), (-.24, .08), (-.92, -.18),
    ], .18, "metal", .04)
    for index, x in enumerate((-.48, .48)):
        cylinder(root, f"bomber_engine_{index}", (x, 0, .02), .18, .72, "accent", 12, "Z")
        sphere(root, f"bomber_exhaust_{index}", (x, 0, -.42), .13, "glow", scale=(1, .7, .75))
    sphere(root, "bomber_payload", (0, -.34, -.05), .22, "glow", scale=(.75, .7, 1.25))

def build_all():
    builders = {
        "SPEED_UP": build_speed, "SLOW_DOWN": build_slow,
        "THICK": lambda r: build_trail(r), "THIN": lambda r: build_trail(r, thin=True),
        "SHIELD": build_shield, "HEALTH": build_health,
        "MG_TURRET": lambda r: build_turret(r), "ROCKET_TURRET": lambda r: build_turret(r, True),
        "SLOW_TIME": build_hourglass, "GHOST": build_ghost,
        "INVERT": lambda r: build_crossed_arrows(r), "FOG": build_fog,
        "FAN_3": lambda r: build_fan(r,3), "FAN_4": lambda r: build_fan(r,4), "FAN_5": lambda r: build_fan(r,5),
        "TRAIL_GAP": lambda r: build_trail(r, gap=True), "EMP": build_emp, "MAGNET": build_magnet,
        "DECOY": build_decoy, "PURGE": build_purge, "SWAP": lambda r: build_crossed_arrows(r, True),
        "MINE": build_mine, "ROCKET_WEAK": lambda r: build_rocket(r,"WEAK"),
        "ROCKET_MEDIUM": lambda r: build_rocket(r,"MEDIUM"),
        "ROCKET_HEAVY": lambda r: build_pilot_rocket(r,"HEAVY"), "ROCKET_MEGA": lambda r: build_rocket(r,"MEGA"), "ROCKET_GUIDED": lambda r: build_rocket(r,"MEGA"),
        "FLAMETHROWER": build_flamethrower,
        "LIGHTNING": build_lightning, "RAILGUN": build_railgun,
        "REPAIR_DRONE": build_repair_drone, "BOMBER_STRIKE": build_bomber_strike,
    }
    for identifier, builder in builders.items():
        root = root_for(identifier, COLORS[identifier])
        builder(root)
        consolidate(root)
        normalize(root, SEMANTIC_BASELINES[identifier] * 1.75)
    for identifier, extent in LEGACY_EXTENTS.items():
        root = root_for(identifier)
        build_legacy(root, identifier)
        consolidate(root)
        normalize(root, extent * 1.5 * 1.75)


def export_assets(args):
    args.output_blend.parent.mkdir(parents=True, exist_ok=True)
    args.output_glb.parent.mkdir(parents=True, exist_ok=True)
    bpy.context.scene["pickupLibrarySaveVersion"] = 0
    bpy.context.scene["generator"] = "scripts/generate_pickup_blender_assets.py"
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(args.output_blend), check_existing=False)
    bpy.ops.export_scene.gltf(filepath=str(args.output_glb), export_format="GLB", export_extras=True,
                              export_yup=True, export_apply=False, export_animations=False,
                              export_cameras=False, export_lights=False)


def aim(obj, target=(0,0,0)):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def apply_preview_color(root, identifier, color):
    preview_accent = material(f"Preview_{identifier}_Accent", color, .15, .32, .08)
    preview_glow = material(f"Preview_{identifier}_Glow", color, .08, .24, .6)
    preview_matte = material(f"Preview_{identifier}_Matte", color, .04, .72, .01)
    for obj in root.children_recursive:
        if obj.type != "MESH":
            continue
        role = obj.get("pickupMaterialRole", "")
        if role in ("accent", "glow", "matte"):
            obj.data.materials.clear()
            preview_material = preview_glow if role == "glow" else preview_matte if role == "matte" else preview_accent
            obj.data.materials.append(preview_material)


def render_overview(args):
    preview_objects = []
    identifiers = list(SEMANTIC_BASELINES) + list(LEGACY_EXTENTS)
    legacy_palette = ((.208,.851,1,1), (.267,1,.533,1), (1,.769,.278,1), (.706,.412,1,1))
    for index, identifier in enumerate(identifiers):
        column, row = index % 7, index // 7
        root = ROOTS[identifier]
        target = float(root.get("targetLargestDimension", 1))
        presentation_scale = 2.35 / target
        root.scale = tuple(value * presentation_scale for value in root.scale)
        root.location = ((column - 3) * 4.2, 0, (3 - row) * 4.2 + .35)
        root.hide_render = False
        for obj in root.children_recursive:
            obj.hide_render = False
        color = COLORS.get(identifier, legacy_palette[(index-len(SEMANTIC_BASELINES)) % len(legacy_palette)])
        apply_preview_color(root, identifier, color)
        bpy.ops.object.text_add(location=(root.location.x, -1.0, root.location.z - 1.72),
                                rotation=(math.pi/2,0,0))
        label = bpy.context.object
        label.name = f"overview_label_{identifier}"
        label.data.body = identifier
        label.data.align_x = "CENTER"
        label.data.align_y = "CENTER"
        label.data.size = .26 if len(identifier) < 15 else .21
        label.data.extrude = .01
        label.data.materials.append(MATS["frame"])
        preview_objects.append(label)

    bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 1.4, 0), rotation=(math.pi/2,0,0))
    backdrop = bpy.context.object
    backdrop.name = "overview_backdrop"
    backdrop.data.materials.append(material("Overview_Backdrop", (.018,.035,.06,1), .02, .58))
    preview_objects.append(backdrop)

    bpy.ops.object.camera_add(location=(0, -42, 0))
    camera = bpy.context.object
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 35.5
    aim(camera, (0,0,0))
    bpy.context.scene.camera = camera
    preview_objects.append(camera)

    for location, energy, size, color in (
        ((-12,-12,16), 1700, 10, (1,.9,.78)),
        ((14,-8,8), 1350, 9, (.52,.7,1)),
        ((0,3,14), 1500, 10, (.4,.6,1)),
    ):
        bpy.ops.object.light_add(type="AREA", location=location)
        light = bpy.context.object
        light.data.energy = energy
        light.data.size = size
        light.data.color = color
        aim(light, (0,0,0))
        preview_objects.append(light)

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 2400
    scene.render.resolution_y = 2100
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(args.preview_dir / "pickup-library-pbr-v2.png")
    scene.render.film_transparent = False
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (.006,.014,.03,1)
    background.inputs["Strength"].default_value = .24
    scene.view_settings.look = "AgX - Medium High Contrast"
    bpy.ops.render.render(write_still=True)
    for obj in preview_objects:
        obj.hide_render = True


def render_preview(args):
    args.preview_dir.mkdir(parents=True, exist_ok=True)
    pilots = ["SPEED_UP", "SHIELD", "HEALTH", "ROCKET_HEAVY"]
    for identifier, root in ROOTS.items():
        hidden = identifier not in pilots
        root.hide_render = hidden
        for obj in root.children_recursive:
            obj.hide_render = hidden

    for i, identifier in enumerate(pilots):
        root = ROOTS[identifier]
        root.location = ((i - 1.5) * 3.7, 0, .15)
        apply_preview_color(root, identifier, COLORS[identifier])

        bpy.ops.object.text_add(location=(root.location.x, -1.1, -2.18), rotation=(math.pi/2,0,0))
        label = bpy.context.object
        label.data.body = identifier
        label.data.align_x = "CENTER"
        label.data.align_y = "CENTER"
        label.data.size = .3
        label.data.extrude = .012
        label.data.materials.append(MATS["frame"])
    bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, -2.35))
    floor = bpy.context.object
    floor.data.materials.append(material("Preview_Floor", (.025, .045, .075, 1), .05, .52))

    bpy.ops.object.camera_add(location=(0, -22, 4.0))
    camera = bpy.context.object
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 15.5
    aim(camera, (0,0,0))
    bpy.context.scene.camera = camera

    for location, energy, size, color in (
        ((-7, -9, 11), 1150, 7, (1.0, .91, .8)),
        ((8, -4, 6), 900, 6, (.55, .72, 1.0)),
        ((0, 4, 9), 1200, 5, (.35, .58, 1.0)),
    ):
        bpy.ops.object.light_add(type="AREA", location=location)
        light = bpy.context.object
        light.data.energy = energy
        light.data.shape = "DISK"
        light.data.size = size
        light.data.color = color
        aim(light, (0,0,0))

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(args.preview_dir / "pickup-pilot-pbr-series.png")
    scene.render.film_transparent = False
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (.008, .018, .035, 1)
    background.inputs["Strength"].default_value = .28
    scene.view_settings.look = "AgX - Medium High Contrast"
    bpy.ops.render.render(write_still=True)


def main():
    args = parse_args()
    reset()
    make_materials()
    build_all()
    export_assets(args)
    render_overview(args)
    render_preview(args)
    print(f"PICKUP_LIBRARY_BLEND={args.output_blend}")
    print(f"PICKUP_LIBRARY_GLB={args.output_glb}")
    print(f"PICKUP_LIBRARY_OVERVIEW={args.preview_dir / 'pickup-library-pbr-v2.png'}")
    print(f"PICKUP_LIBRARY_PREVIEW={args.preview_dir / 'pickup-pilot-pbr-series.png'}")


if __name__ == "__main__":
    main()
