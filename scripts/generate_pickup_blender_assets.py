"""Build the editable Curvios Clash pickup library, runtime GLB, and review render.

Run with Blender 4.2:
  blender --background --python scripts/generate_pickup_blender_assets.py -- [options]
"""

import argparse
import math
from pathlib import Path

import bpy
from mathutils import Vector


SEMANTIC_BASELINES = {
    "SPEED_UP": 1.755, "SLOW_DOWN": 2.404, "THICK": 1.590, "THIN": 1.305,
    "SHIELD": 1.860, "HEALTH": 1.290, "MG_TURRET": 1.874, "ROCKET_TURRET": 1.934,
    "SLOW_TIME": 1.590, "GHOST": 1.860, "INVERT": 1.590, "FOG": 2.053,
    "FAN_3": 2.311, "FAN_4": 2.230, "FAN_5": 2.311, "TRAIL_GAP": 1.603,
    "EMP": 1.860, "MAGNET": 1.350, "DECOY": 1.942, "PURGE": 1.590,
    "SWAP": 1.590, "MINE": 1.739, "ROCKET_WEAK": 1.915, "ROCKET_MEDIUM": 2.176,
    "ROCKET_HEAVY": 2.480, "ROCKET_MEGA": 3.206,
}

LEGACY_EXTENTS = {
    "item_arrow": 1.5, "item_battery": .9, "item_box": 1.5, "item_capsule": 2.0,
    "item_coin": 1.0, "item_crate": 1.0, "item_crystal": 2.4, "item_gem": 1.5,
    "item_health": 1.6, "item_orb": 1.0, "item_pyramid": 1.8, "item_ring": 1.6,
    "item_rocket": 1.6, "item_shield": 1.6, "item_sphere": 2.0,
    "item_star": 1.9022, "item_torus": 1.4,
}

COLORS = {
    "SPEED_UP": (0.0, 1.0, .13, 1), "SLOW_DOWN": (1.0, .04, .03, 1),
    "THICK": (1.0, .55, 0.0, 1), "THIN": (.48, .08, 1.0, 1),
    "SHIELD": (.05, .28, 1.0, 1), "HEALTH": (.05, 1.0, .38, 1),
    "MG_TURRET": (1.0, .42, .08, 1), "ROCKET_TURRET": (1.0, .04, .16, 1),
    "SLOW_TIME": (.04, 1.0, .42, 1), "GHOST": (1.0, .12, .58, 1),
    "INVERT": (1.0, 0.0, 1.0, 1), "FOG": (.62, .68, .76, 1),
    "FAN_3": (.208, .851, 1.0, 1), "FAN_4": (.706, .412, 1.0, 1),
    "FAN_5": (1.0, .769, .278, 1), "TRAIL_GAP": (0.0, .68, .82, 1),
    "EMP": (0.0, .38, 1.0, 1), "MAGNET": (1.0, .04, .18, 1),
    "DECOY": (1.0, .18, .68, 1), "PURGE": (.8, .9, 1.0, 1),
    "SWAP": (.55, .12, 1.0, 1), "MINE": (1.0, .08, .02, 1),
    "ROCKET_WEAK": (1.0, .55, .12, 1), "ROCKET_MEDIUM": (1.0, .25, .03, 1),
    "ROCKET_HEAVY": (1.0, .03, .04, 1), "ROCKET_MEGA": (.55, .0, 1.0, 1),
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
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = color
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Roughness"].default_value = rough
    if "Emission Color" in bsdf.inputs:
        bsdf.inputs["Emission Color"].default_value = color
        bsdf.inputs["Emission Strength"].default_value = emission
    return mat


def make_materials():
    MATS["metal"] = material("Pickup_Metal", (.025, .045, .07, 1), .9, .3, .02)
    MATS["frame"] = material("Pickup_Frame", (.72, .82, .9, 1), .78, .25, .08)
    MATS["accent"] = material("Pickup_Accent", (.08, .55, 1, 1), .58, .24, .3)
    MATS["glow"] = material("Pickup_Glow", (.1, .75, 1, 1), .25, .18, 1.4)


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


def sphere(root, name, loc, radius, role="metal", scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, radius=radius, location=loc)
    obj = bpy.context.object
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    return attach(obj, root, role, name)


def cone(root, name, loc, radius, depth, role="accent", vertices=12, direction="UP"):
    rot = (math.pi, 0, 0) if direction == "DOWN" else (0, 0, 0)
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius, radius2=0, depth=depth, location=loc, rotation=rot)
    obj = attach(bpy.context.object, root, role, name)
    bevel(obj, min(.035, radius * .15), 1)
    return obj


def torus(root, name, loc, major, minor, role="accent", rot=(math.pi / 2, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=16,
                                    minor_segments=6, location=loc, rotation=rot)
    return attach(bpy.context.object, root, role, name)


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
    box(root, "arrow_shaft", (x, 0, z), (.26*scale, .34*scale, .85*scale), role)
    cone(root, "arrow_head", (x, 0, z + direction*.62*scale), .42*scale, .62*scale, role,
         direction="UP" if direction > 0 else "DOWN")


def build_speed(root):
    arrow(root, -.38, -.08, 1, "glow", .78)
    arrow(root, .38, .08, 1, "accent", .78)
    box(root, "thruster_frame", (0, .04, -.72), (1.25, .38, .22), "frame")
    cone(root, "exhaust_left", (-.38, 0, -1.0), .18, .46, "glow", direction="DOWN")
    cone(root, "exhaust_right", (.38, 0, -1.0), .18, .46, "glow", direction="DOWN")


def build_slow(root):
    cylinder(root, "brake_disc", (0, 0, 0), .83, .28, "metal", 16, "Y")
    cylinder(root, "brake_hub", (0, -.18, 0), .28, .22, "glow", 12, "Y")
    for x in (-.78, .78):
        box(root, "brake_pad", (x, 0, 0), (.33, .48, 1.12), "accent", .09)
    box(root, "stop_bar", (0, -.31, .02), (1.22, .12, .2), "frame", .04)


def build_trail(root, thin=False, gap=False):
    width = .18 if thin else .62
    if gap:
        for x in (-.72, .72):
            box(root, "broken_trail", (x, 0, 0), (.72, .42, .42), "accent", .12)
            box(root, "broken_core", (x, -.24, 0), (.5, .1, .2), "glow", .03)
        for x, direction in ((-.27, -1), (.27, 1)):
            cone(root, "fracture", (x, 0, 0), .2, .34, "frame", direction="DOWN" if direction < 0 else "UP")
    else:
        box(root, "trail_cartridge", (0, 0, 0), (1.72, .5, width), "accent", .12)
        box(root, "trail_core", (0, -.3, 0), (1.3, .12, width*.45), "glow", .03)
        for x in (-.78, .78):
            cylinder(root, "cartridge_cap", (x, 0, 0), max(.15, width*.62), .18, "frame", 12, "X")


def build_shield(root):
    cylinder(root, "hex_shield", (0, 0, 0), .9, .32, "accent", 6, "Y")
    cylinder(root, "hex_inset", (0, -.2, .02), .62, .12, "metal", 6, "Y")
    box(root, "shield_spine", (0, -.3, -.05), (.16, .12, 1.05), "glow", .04)
    box(root, "shield_chevron", (0, -.31, -.38), (.65, .1, .16), "frame", .04, rot=(0, .45, 0))


def build_health(root):
    cylinder(root, "capsule", (0, 0, 0), .52, 1.25, "metal", 16, "Z")
    sphere(root, "capsule_top", (0, 0, .63), .52, "frame", (1, .75, .55))
    sphere(root, "capsule_bottom", (0, 0, -.63), .52, "accent", (1, .75, .55))
    box(root, "cross_vertical", (0, -.5, 0), (.22, .12, .72), "glow", .05)
    box(root, "cross_horizontal", (0, -.5, 0), (.72, .12, .22), "glow", .05)


def build_turret(root, rocket=False):
    cylinder(root, "turret_base", (0, 0, -.55), .72, .3, "metal", 12)
    cylinder(root, "turret_ring", (0, 0, -.32), .52, .18, "accent", 12)
    sphere(root, "turret_head", (0, 0, .08), .55, "frame", (1, .78, .75))
    if rocket:
        for x in (-.25, .25):
            cylinder(root, "rocket_tube", (x, -.68, .2), .18, 1.15, "accent", 12, "Y")
            cylinder(root, "tube_muzzle", (x, -1.25, .2), .22, .12, "glow", 12, "Y")
    else:
        cylinder(root, "mg_barrel", (0, -.78, .2), .12, 1.5, "metal", 12, "Y")
        cylinder(root, "mg_shroud", (0, -1.52, .2), .2, .28, "glow", 12, "Y")
        box(root, "ammo_box", (.56, 0, -.06), (.35, .52, .5), "accent", .06)


def build_hourglass(root):
    torus(root, "time_top", (0, 0, .72), .55, .09, "frame")
    torus(root, "time_bottom", (0, 0, -.72), .55, .09, "frame")
    cone(root, "upper_sand", (0, 0, .29), .4, .72, "accent", direction="DOWN")
    cone(root, "lower_sand", (0, 0, -.29), .4, .72, "glow")
    for x in (-.5, .5):
        box(root, "time_post", (x, 0, 0), (.11, .22, 1.38), "metal", .04)


def build_ghost(root):
    sphere(root, "phase_body", (0, 0, .15), .75, "accent", (1, .7, 1.05))
    for x in (-.48, 0, .48):
        sphere(root, "phase_tail", (x, 0, -.58), .28, "glow", (1, .75, 1))
    for x in (-.25, .25):
        sphere(root, "phase_eye", (x, -.55, .28), .11, "frame", (1, .45, 1))
    torus(root, "phase_arc", (0, .15, .05), .9, .055, "glow", rot=(math.pi/2, .45, 0))


def build_fog(root):
    for x, z, radius in ((-.62,-.15,.55),(0,.2,.72),(.66,-.1,.58),(-.18,-.52,.52),(.42,-.48,.48)):
        sphere(root, "fog_lobe", (x, 0, z), radius, "frame", (1, .72, .8))
    for x in (-.55, 0, .55):
        box(root, "fog_scan", (x, -.58, -.72), (.42, .08, .09), "glow", .03)


def build_crossed_arrows(root, swap=False):
    if swap:
        arrow(root, -.45, 0, 1, "accent", .7)
        arrow(root, .45, 0, -1, "glow", .7)
        box(root, "swap_bridge", (0, .1, 0), (.75, .25, .16), "frame", .04)
    else:
        first = box(root, "invert_arrow_a", (0, 0, 0), (.24, .34, 1.25), "accent", .06, rot=(0, .65, 0))
        second = box(root, "invert_arrow_b", (0, .04, 0), (.24, .34, 1.25), "glow", .06, rot=(0, -.65, 0))
        for x, z, direction in ((-.62,.48,1),(.62,.48,1),(-.62,-.48,-1),(.62,-.48,-1)):
            cone(root, "invert_head", (x, 0, z), .28, .42, "frame", direction="UP" if direction > 0 else "DOWN")


def build_emp(root):
    cylinder(root, "emp_core", (0, 0, 0), .34, 1.15, "metal", 12)
    for z, radius in ((-.55,.48),(-.25,.62),(.08,.68),(.4,.58),(.65,.42)):
        torus(root, "emp_coil", (0, 0, z), radius, .075, "glow")
    sphere(root, "emp_charge", (0, 0, .04), .22, "accent")


def build_magnet(root):
    for x in (-.5, .5):
        box(root, "magnet_leg", (x, 0, .25), (.38, .45, 1.18), "accent", .13)
        box(root, "magnet_pole", (x, 0, .91), (.46, .52, .28), "frame", .08)
    for i in range(5):
        angle = math.pi + i * math.pi / 4
        x, z = math.cos(angle)*.5, math.sin(angle)*.5 - .28
        box(root, "magnet_curve", (x, 0, z), (.4, .44, .4), "accent", .12)


def build_decoy(root):
    for x, z, role in ((-.38,.18,"accent"),(.38,-.18,"glow")):
        sphere(root, "decoy_body", (x, 0, z), .52, role, (1, .7, 1.15))
        box(root, "decoy_fin", (x, 0, z-.52), (.68, .3, .18), "frame", .05)
        sphere(root, "decoy_eye", (x, -.38, z+.12), .1, "frame", (1,.5,1))
    box(root, "decoy_offset", (0, .18, 0), (.16, .18, 1.2), "metal", .04, rot=(0,.55,0))


def build_purge(root):
    for radius, rot in ((.45,(math.pi/2,0,0)),(.68,(math.pi/2,.65,0)),(.88,(math.pi/2,-.65,0))):
        torus(root, "cleanse_ring", (0, 0, 0), radius, .07, "glow", rot)
    sphere(root, "cleanse_core", (0, 0, 0), .25, "frame")


def build_mine(root):
    sphere(root, "mine_body", (0, 0, 0), .65, "metal")
    cylinder(root, "mine_band", (0, 0, 0), .72, .2, "accent", 12, "Y")
    for i in range(8):
        angle = i * math.tau / 8
        x, z = math.cos(angle)*.88, math.sin(angle)*.88
        spike = cone(root, "mine_spike", (x, 0, z), .18, .58, "frame")
        spike.rotation_euler.y = angle + math.pi/2
    sphere(root, "mine_trigger", (0, -.62, 0), .18, "glow", (1,.55,1))


def build_rocket(root, tier="WEAK"):
    marker_count = {"WEAK":0,"MEDIUM":1,"HEAVY":2,"MEGA":3}[tier]
    size = {"WEAK":.82,"MEDIUM":.94,"HEAVY":1.06,"MEGA":1.2}[tier]
    cylinder(root, "rocket_body", (0, 0, 0), .27*size, 1.5*size, "accent", 14)
    cone(root, "rocket_nose", (0, 0, 1.02*size), .3*size, .58*size, "frame")
    cylinder(root, "rocket_exhaust", (0, 0, -.82*size), .2*size, .22*size, "metal", 12)
    cone(root, "rocket_flame", (0, 0, -1.15*size), .18*size, .55*size, "glow", direction="DOWN")
    for angle in (0, math.pi/2, math.pi, math.pi*1.5):
        x, y = math.cos(angle)*.34*size, math.sin(angle)*.34*size
        fin = box(root, "rocket_fin", (x, y, -.56*size), (.42*size,.12*size,.46*size), "metal", .04)
        fin.rotation_euler.z = angle
    for i in range(marker_count):
        torus(root, "tier_marker", (0, 0, -.3*size + i*.3*size), .38*size, .055*size, "frame")
    root["rocketTier"] = tier
    root["tierMarkers"] = marker_count


DIGITS = {
    3: ("t","m","b","rt","rb"), 4: ("m","lt","rt","rb"),
    5: ("t","m","b","lt","rb"),
}


def label_bar(root, label, name, x, z, w, h, angle=0):
    obj = box(root, name, (x, -.58, z), (w, .09, h), "frame", .025)
    obj.rotation_euler.y = angle
    obj.parent = label
    obj.matrix_parent_inverse = label.matrix_world.inverted()


def build_fan(root, count):
    cylinder(root, "fan_hub", (0, 0, -.2), .48, .4, "metal", 12, "Y")
    for i in range(count):
        angle = -.65 + 1.3 * i / (count-1)
        x, z = math.sin(angle)*.88, math.cos(angle)*.88 - .12
        shaft = box(root, "projectile_marker", (x, 0, z), (.13,.28,.72), "glow", .04)
        shaft.rotation_euler.y = angle
        cone_obj = cone(root, "projectile_tip", (math.sin(angle)*1.18, 0, math.cos(angle)*1.18-.12), .16, .36, "accent")
        cone_obj.rotation_euler.y = angle
    label = bpy.data.objects.new("weaponFanLabel", None)
    root.users_collection[0].objects.link(label)
    label.parent = root
    label["weaponFanLabel"] = True
    label["markerText"] = f"×{count}"
    for angle in (-.75, .75):
        label_bar(root, label, "multiply", -.52, -1.1, .1, .5, angle)
    segments = DIGITS[count]
    for seg in segments:
        horizontal = seg in ("t","m","b")
        x = .38 if horizontal else (.18 if seg.startswith("l") else .58)
        z = {"t":- .82,"m":-1.08,"b":-1.34}.get(seg, -.95 if seg.endswith("t") else -1.22)
        label_bar(root, label, "digit", x, z, .42 if horizontal else .1, .1 if horizontal else .3)
    root["fanProjectiles"] = count
    root["markerText"] = f"×{count}"


def build_legacy(root, identifier):
    if identifier in ("item_arrow", "item_battery"):
        arrow(root, 0, 0, 1, "accent", 1.0)
        if identifier == "item_battery":
            box(root, "battery_case", (0, .12, -.3), (.95,.46,1.35), "metal", .12)
    elif identifier in ("item_box", "item_crate"):
        box(root, "cargo_body", (0,0,0), (1.45,1.15,1.45), "accent", .16)
        for angle in (-.72,.72): box(root,"cargo_brace",(0,-.62,0),(.16,.1,1.72),"frame",.03,rot=(0,angle,0))
    elif identifier == "item_capsule": build_health(root)
    elif identifier == "item_coin":
        cylinder(root,"coin",(0,0,0),.82,.25,"accent",16,"Y"); cylinder(root,"coin_inset",(0,-.18,0),.52,.1,"glow",12,"Y")
    elif identifier in ("item_crystal","item_gem"):
        cone(root,"gem_upper",(0,0,.45),.72,1.25,"accent",8); cone(root,"gem_lower",(0,0,-.45),.72,.65,"glow",8,direction="DOWN")
    elif identifier == "item_health": build_health(root)
    elif identifier in ("item_orb","item_sphere"):
        sphere(root,"orb",(0,0,0),.78,"accent"); torus(root,"orb_band",(0,0,0),.86,.06,"frame",(math.pi/2,.55,0))
    elif identifier == "item_pyramid": cone(root,"pyramid",(0,0,0),.92,1.75,"accent",4)
    elif identifier in ("item_ring","item_torus"):
        torus(root,"ring",(0,0,0),.72,.2,"accent"); torus(root,"ring_core",(0,0,0),.72,.06,"glow")
    elif identifier == "item_rocket": build_rocket(root,"MEDIUM")
    elif identifier == "item_shield": build_shield(root)
    elif identifier == "item_star":
        for angle in (0, math.pi/2, math.pi/4, -math.pi/4):
            box(root,"star_ray",(0,0,0),(.28,.38,1.75),"accent",.06,rot=(0,angle,0))
        sphere(root,"star_core",(0,-.12,0),.35,"glow",(1,.55,1))


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
    if label:
        join_meshes(list(label.children), "weaponFanLabelGeometry", label, "frame")
    for role in ("metal", "frame", "accent", "glow"):
        role_objects = [obj for obj in root.children
                        if obj.type == "MESH" and obj.get("pickupMaterialRole") == role]
        join_meshes(role_objects, f"{root.name}_{role}", root, role)


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
        "ROCKET_HEAVY": lambda r: build_rocket(r,"HEAVY"), "ROCKET_MEGA": lambda r: build_rocket(r,"MEGA"),
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


def render_preview(args):
    args.preview_dir.mkdir(parents=True, exist_ok=True)
    active = list(SEMANTIC_BASELINES)
    for i, identifier in enumerate(active):
        col, row = i % 7, i // 7
        root = ROOTS[identifier]
        root.location = ((col - 3) * 5.4, 0, (1.5 - row) * 5.0)
        root.scale = tuple(value * .72 for value in root.scale)
        root.rotation_euler.z = -.18 if i % 2 else .18
        preview_color = COLORS[identifier]
        preview_accent = material(f"Preview_{identifier}_Accent", preview_color, .55, .24, .25)
        preview_glow = material(f"Preview_{identifier}_Glow", preview_color, .18, .18, 1.1)
        for obj in root.children_recursive:
            if obj.type != "MESH":
                continue
            role = obj.get("pickupMaterialRole", "")
            if role in ("accent", "glow"):
                obj.data.materials.clear()
                obj.data.materials.append(preview_glow if role == "glow" else preview_accent)

        bpy.ops.object.text_add(location=(root.location.x, -1.15, root.location.z - 2.0), rotation=(math.pi/2,0,0))
        label = bpy.context.object
        label.data.body = identifier.replace("ROCKET_", "R_").replace("_TURRET", "_TUR")
        label.data.align_x = "CENTER"
        label.data.align_y = "CENTER"
        label.data.size = .38
        label.data.extrude = .012
        label.data.materials.append(MATS["frame"])
    for identifier in LEGACY_EXTENTS:
        ROOTS[identifier].hide_render = True
        for obj in ROOTS[identifier].children_recursive:
            obj.hide_render = True

    bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 1.25, -10.3), rotation=(math.pi/2,0,0))
    backdrop = bpy.context.object
    backdrop.data.materials.append(material("Preview_Backdrop", (.012,.02,.035,1), .1, .42))

    bpy.ops.object.camera_add(location=(0, -46, 4.0))
    camera = bpy.context.object
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 39
    aim(camera, (0,0,-1.2))
    bpy.context.scene.camera = camera

    bpy.ops.object.light_add(type="AREA", location=(-12,-12,15))
    bpy.context.object.data.energy = 1900
    bpy.context.object.data.shape = "DISK"
    bpy.context.object.data.size = 12
    aim(bpy.context.object, (0,0,0))
    bpy.ops.object.light_add(type="AREA", location=(14,-5,5))
    bpy.context.object.data.energy = 1200
    bpy.context.object.data.size = 10
    aim(bpy.context.object, (0,0,0))

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.studio_light = "basic.sl"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_shadows = False
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "WORLD"
    scene.display.shading.background_type = "VIEWPORT"
    scene.display.shading.background_color = (.018, .028, .05)
    scene.render.resolution_x = 1800
    scene.render.resolution_y = 1150
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(args.preview_dir / "pickup-library-overview.png")
    scene.render.film_transparent = False
    scene.world.color = (.008,.012,.025)
    bpy.ops.render.render(write_still=True)


def main():
    args = parse_args()
    reset()
    make_materials()
    build_all()
    export_assets(args)
    render_preview(args)
    print(f"PICKUP_LIBRARY_BLEND={args.output_blend}")
    print(f"PICKUP_LIBRARY_GLB={args.output_glb}")
    print(f"PICKUP_LIBRARY_PREVIEW={args.preview_dir / 'pickup-library-overview.png'}")


if __name__ == "__main__":
    main()
