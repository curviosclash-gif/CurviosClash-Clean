#!/usr/bin/env python3
"""Generate the animated Neon Carnival setpieces: a night fairground floating in the dark.

Run with Blender 4.2 LTS through the dispatcher:

    npm run maps:generate -- --map neon_carnival

Contract with the map preset (src/core/config/maps/presets/neon_carnival.js):

- One Blender unit is one authored map unit. The preset places every file with scale 1, so the
  runtime multiplies both by MAP_SCALE and nothing is resized behind the author's back.
- The loader puts the centre of a model's bounding box on the slot in X/Z and its floor on the
  slot in Y. Every setpiece is therefore authored with its rest-pose bounds centred on the Blender
  origin and resting on z = 0; export_setpiece refuses a file that breaks this, so the anchor
  coordinates the preset uses stay the plain Blender coordinates below.
- The flight line through a setpiece runs along Blender +Y. Its front faces Blender -Y, which the
  preset turns towards the approaching player.
- Each file carries an Anchor_* empty on its flight line. The contract test loads the placed map
  and checks that these empties land on the authored route.
- The whole fair keeps a three second "waltz" beat. Every loop is a whole number of beats.

Collision: the map runs glbColliderMode 'scene', so every mesh collides unless its name carries
_nocol. Moving parts are coarse boxes and cylinders; everything that only has to look good is a
separate _nocol mesh. export_setpiece joins meshes per parent and per role, so a setpiece costs a
handful of draw calls instead of hundreds, and bakes their transforms so the loader's bounding box
equals the true rest pose.
"""

from math import atan2, cos, pi, radians, sin
from pathlib import Path

import bmesh
import bpy


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "assets" / "maps" / "neon_carnival" / "blender"
GLB_DIR = ROOT / "assets" / "maps" / "neon_carnival" / "glb"
FPS = 30
BEAT_SECONDS = 3
BOUNDS_TOLERANCE = 0.005


# ---------------------------------------------------------------------------------------------
# Scene, materials and primitives
# ---------------------------------------------------------------------------------------------

def reset_scene(name, duration_seconds):
    if duration_seconds % BEAT_SECONDS != 0:
        raise ValueError(f"{name}: {duration_seconds}s is not a whole number of beats")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = name
    scene.render.fps = FPS
    scene.frame_start = 1
    scene.frame_end = 1 + round(duration_seconds * FPS)
    scene["setpiece"] = name
    scene["loop_duration_seconds"] = duration_seconds
    scene["beat_seconds"] = BEAT_SECONDS
    bpy.context.preferences.edit.keyframe_new_interpolation_type = "LINEAR"
    bpy.context.preferences.filepaths.save_version = 0
    return scene


def material(name, color, *, emission=None, strength=0.0, metallic=0.2, roughness=0.5):
    """Painted surfaces keep a readable base colour; neon keeps a near-black base under one
    dominant emission channel so the tone mapper does not wash it out to white."""
    value = bpy.data.materials.new(name)
    value.diffuse_color = color
    value.use_nodes = True
    shader = value.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = color
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Roughness"].default_value = roughness
    if emission is not None and strength > 0:
        shader.inputs["Emission Color"].default_value = emission
        shader.inputs["Emission Strength"].default_value = strength
    return value


def build_materials():
    dark = (0.02, 0.012, 0.03, 1.0)
    return {
        "steel": material("CarnivalSteel", (0.045, 0.04, 0.06, 1.0), metallic=0.8, roughness=0.38),
        "red": material("CarnivalRed", (0.52, 0.035, 0.05, 1.0), metallic=0.1, roughness=0.42),
        "cream": material("CarnivalCream", (0.66, 0.58, 0.44, 1.0), metallic=0.05, roughness=0.55),
        "gold": material("CarnivalGold", (0.62, 0.4, 0.09, 1.0), metallic=0.9, roughness=0.28),
        "wood": material("CarnivalWood", (0.24, 0.1, 0.045, 1.0), metallic=0.0, roughness=0.7),
        "teal": material("CarnivalTeal", (0.02, 0.26, 0.3, 1.0), metallic=0.3, roughness=0.4),
        "pearl": material(
            "CarnivalPearl", (0.7, 0.64, 0.58, 1.0), emission=(1.0, 0.82, 0.66, 1.0), strength=0.35, roughness=0.3,
        ),
        "ink": material("CarnivalInk", (0.012, 0.01, 0.018, 1.0), metallic=0.1, roughness=0.3),
        "orange": material(
            "CarnivalOrange", (0.72, 0.2, 0.02, 1.0), emission=(1.0, 0.28, 0.02, 1.0), strength=0.6,
        ),
        "pink": material("NeonPink", dark, emission=(1.0, 0.07, 0.42, 1.0), strength=1.8),
        "cyan": material("NeonCyan", dark, emission=(0.03, 0.55, 1.0, 1.0), strength=1.7),
        "yellow": material("NeonYellow", dark, emission=(1.0, 0.6, 0.03, 1.0), strength=1.6),
        "lime": material("NeonLime", dark, emission=(0.38, 1.0, 0.04, 1.0), strength=1.4),
        "violet": material("NeonViolet", dark, emission=(0.42, 0.06, 1.0, 1.0), strength=1.7),
        "bulb": material("NeonBulb", dark, emission=(1.0, 0.72, 0.3, 1.0), strength=1.3),
    }


def finish_mesh(obj, name, mat):
    obj.name = name
    obj.data.name = f"{name}_mesh"
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    return obj


def box(name, center, half, mat, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(location=center, rotation=rotation)
    obj = finish_mesh(bpy.context.object, name, mat)
    obj.scale = half
    return obj


def cylinder(name, center, radius, depth, mat, vertices=16, rotation=(0, 0, 0), capped=True):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices, radius=radius, depth=depth, location=center, rotation=rotation,
        end_fill_type="NGON" if capped else "NOTHING",
    )
    return finish_mesh(bpy.context.object, name, mat)


def cone(name, center, radius1, radius2, depth, mat, vertices=16, rotation=(0, 0, 0), capped=True):
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices, radius1=radius1, radius2=radius2, depth=depth, location=center,
        rotation=rotation, end_fill_type="NGON" if capped else "NOTHING",
    )
    return finish_mesh(bpy.context.object, name, mat)


def sphere(name, center, scale, mat, segments=12, rings=6, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=center, rotation=rotation)
    obj = finish_mesh(bpy.context.object, name, mat)
    obj.scale = scale
    return obj


def torus(name, center, major, minor, mat, rotation=(0, 0, 0), major_segments=32, minor_segments=6):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major, minor_radius=minor, major_segments=major_segments,
        minor_segments=minor_segments, location=center, rotation=rotation,
    )
    return finish_mesh(bpy.context.object, name, mat)


def link_mesh(name, mesh, mat):
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    mesh.name = f"{name}_mesh"
    mesh.materials.append(mat)
    return obj


def prism(name, points_xz, y0, y1, mat):
    """Extrudes a convex or concave outline drawn in the XZ plane along Y."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    front = [bm.verts.new((x, y0, z)) for x, z in points_xz]
    back = [bm.verts.new((x, y1, z)) for x, z in points_xz]
    bm.faces.new(list(reversed(front)))
    bm.faces.new(back)
    count = len(points_xz)
    for index in range(count):
        following = (index + 1) % count
        bm.faces.new((front[index], front[following], back[following], back[index]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    return link_mesh(name, mesh, mat)


def ring_prism(name, outer_xz, inner_xz, y0, y1, mat):
    """A slab with a hole: outer and inner outline need the same number of points, taken at
    matching angles, so each pair of neighbours spans one quad of the face."""
    if len(outer_xz) != len(inner_xz):
        raise ValueError(f"{name}: outer and inner outlines differ in length")
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    layers = []
    for y in (y0, y1):
        layers.append((
            [bm.verts.new((x, y, z)) for x, z in outer_xz],
            [bm.verts.new((x, y, z)) for x, z in inner_xz],
        ))
    count = len(outer_xz)
    (front_outer, front_inner), (back_outer, back_inner) = layers
    for index in range(count):
        n = (index + 1) % count
        bm.faces.new((front_outer[index], front_inner[index], front_inner[n], front_outer[n]))
        bm.faces.new((back_outer[index], back_outer[n], back_inner[n], back_inner[index]))
        bm.faces.new((front_outer[index], front_outer[n], back_outer[n], back_outer[index]))
        bm.faces.new((front_inner[index], back_inner[index], back_inner[n], front_inner[n]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    return link_mesh(name, mesh, mat)


def ellipse(center_xz, radius_x, radius_z, count, start=0.0, end=2 * pi, closed=True):
    steps = count if closed else count - 1
    return [
        (center_xz[0] + radius_x * cos(start + (end - start) * i / steps),
         center_xz[1] + radius_z * sin(start + (end - start) * i / steps))
        for i in range(count)
    ]


def text(name, body, center, size, mat, extrude=0.1):
    """Upright lettering facing Blender -Y, i.e. towards an approaching player."""
    bpy.ops.object.text_add(location=center, rotation=(pi / 2, 0, 0))
    obj = bpy.context.object
    obj.data.body = body
    obj.data.size = size
    obj.data.extrude = extrude
    obj.data.resolution_u = 2
    obj.data.align_x = "CENTER"
    obj.data.align_y = "CENTER"
    bpy.ops.object.convert(target="MESH")
    return finish_mesh(bpy.context.object, name, mat)


def stripe(obj, mats, stripes):
    """Paints alternating bands around the local Z axis, face by face."""
    obj.data.materials.clear()
    for entry in mats:
        obj.data.materials.append(entry)
    for polygon in obj.data.polygons:
        angle = atan2(polygon.center.y, polygon.center.x)
        band = int(((angle + pi) / (2 * pi)) * stripes) % stripes
        polygon.material_index = band % len(mats)
    return obj


def striped_solid(make, name, mats, stripes):
    """A striped body as two meshes: the painted one only draws, a plain closed copy only
    collides. The runtime decides "inside or outside" per material primitive by counting ray
    crossings, so a body split into stripe materials is a set of open shells and would report
    phantom walls far away along the test ray."""
    visual = stripe(make(f"{name}_nocol", mats[0]), mats, stripes)
    body = make(f"{name}_colonly", mats[0])
    return [visual, body]


def frustum_shell(name, radius_bottom, radius_top, z_bottom, z_top, thickness, mat, segments=24):
    """A closed, hollow cone band (open at both ends like a lampshade, but solid in section),
    so a roof with a hole in it can still collide correctly."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    rings = [
        (radius_bottom, z_bottom), (radius_top, z_top),
        (radius_top - thickness, z_top), (radius_bottom - thickness, z_bottom),
    ]
    verts = [[bm.verts.new((r * cos(2 * pi * i / segments), r * sin(2 * pi * i / segments), z))
              for i in range(segments)] for r, z in rings]
    for ring in range(4):
        a, b = verts[ring], verts[(ring + 1) % 4]
        for i in range(segments):
            n = (i + 1) % segments
            bm.faces.new((a[i], a[n], b[n], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    return link_mesh(name, mesh, mat)


def bulbs(prefix, points, mat, size=0.22):
    return [
        box(f"{prefix}_{index}_nocol", point, (size, size, size), mat, rotation=(pi / 4, pi / 4, 0))
        for index, point in enumerate(points)
    ]


def empty(name, location=(0, 0, 0)):
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = "PLAIN_AXES"
    obj.location = location
    bpy.context.collection.objects.link(obj)
    return obj


def anchor(name, location):
    """Marks a point on the flight line. Exported as a plain glTF node."""
    return empty(f"Anchor_{name}", location)


def parent_keep_world(child, parent):
    bpy.context.view_layer.update()
    world = child.matrix_world.copy()
    child.parent = parent
    child.matrix_world = world


def rig(name, location, children):
    node = empty(name, location)
    for child in children:
        parent_keep_world(child, node)
    return node


def keyframe(obj, frame, *, location=None, rotation=None, scale=None):
    if location is not None:
        obj.location = location
        obj.keyframe_insert("location", frame=frame)
    if rotation is not None:
        obj.rotation_mode = "XYZ"
        obj.rotation_euler = rotation
        obj.keyframe_insert("rotation_euler", frame=frame)
    if scale is not None:
        obj.scale = scale
        obj.keyframe_insert("scale", frame=frame)


def beat_frame(scene, beats):
    return scene.frame_start + round(beats * BEAT_SECONDS * FPS)


def spin(scene, obj, axis, turns, beats, base=(0.0, 0.0, 0.0)):
    """A constant spin over the whole loop. The exporter samples every frame, so a single
    pair of keys from 0 to a full turn survives the conversion to quaternions."""
    end = list(base)
    end[axis] += turns * 2 * pi
    keyframe(obj, beat_frame(scene, 0), rotation=tuple(base))
    keyframe(obj, beat_frame(scene, beats), rotation=tuple(end))


def timeline(scene, obj, prop, keys):
    """keys: (beats, value) pairs for one property."""
    for beats, value in keys:
        keyframe(obj, beat_frame(scene, beats), **{prop: value})


# ---------------------------------------------------------------------------------------------
# 01 Marquee arch: the gate into the fair. Nothing on it moves into the lane.
# ---------------------------------------------------------------------------------------------

def build_marquee_arch(scene, m):
    box("arch_deck", (0, 0, 1), (15, 4.25, 1), m["steel"])
    box("arch_deck_edge_nocol", (0, -4.15, 1.6), (14.9, 0.1, 0.22), m["pink"])
    for side in (-1, 1):
        striped_solid(lambda name, mat, s=side: cylinder(name, (s * 12, 0, 12), 1.3, 20, mat, vertices=12),
                      f"arch_pillar_{side}", (m["red"], m["cream"]), 12)
        box(f"arch_pillar_foot_{side}", (side * 12, 0, 2.6), (1.9, 1.9, 0.6), m["gold"])
        bulbs(f"arch_pillar_bulbs_{side}",
              [(side * 10.55, -0.9, 3.5 + i * 1.5) for i in range(12)], m["bulb"])
    box("arch_beam", (0, 0, 23.5), (13.6, 1.5, 1.5), m["gold"])
    box("arch_sign", (0, 0, 29), (11, 0.5, 4), m["ink"])
    for z in (25.1, 32.9):
        box(f"arch_sign_neon_h_{z:.0f}_nocol", (0, -0.62, z), (10.9, 0.08, 0.14), m["cyan"])
    for side in (-1, 1):
        box(f"arch_sign_neon_v_{side}_nocol", (side * 10.9, -0.62, 29), (0.14, 0.08, 3.9), m["cyan"])
    text("arch_title_nocol", "JAHRMARKT", (0, -0.68, 29.2), 3.2, m["yellow"])
    bulbs("arch_beam_bulbs", [(-10 + i * 1.25, -1.6, 21.95) for i in range(17)], m["bulb"])

    # A sunburst turns behind the sign. Its inner end hides in the beam, so no ray reaches down
    # into the opening the player flies through.
    rays = []
    for index in range(16):
        angle = index * 2 * pi / 16
        rays.append(box(
            f"arch_ray_{index}_nocol", (6.75 * cos(angle), 0.9, 31 + 6.75 * sin(angle)),
            (2.25, 0.08, 0.28), m["pink"] if index % 2 == 0 else m["violet"], rotation=(0, -angle, 0),
        ))
    burst = rig("ArchSunburst", (0, 0.9, 31), rays)
    spin(scene, burst, 1, 1 / 8, 1)

    star = [(1.7 * cos(pi / 2 + i * pi / 5) * (1 if i % 2 == 0 else 0.42),
             1.7 * sin(pi / 2 + i * pi / 5) * (1 if i % 2 == 0 else 0.42)) for i in range(10)]
    for side, name in ((-1, "L"), (1, "R")):
        piece = prism(f"arch_star_{name}_nocol", [(x + side * 12, z + 23.5) for x, z in star],
                      -1.95, -1.6, m["yellow"])
        spinner = rig(f"ArchStar{name}", (side * 12, -1.75, 23.5), [piece])
        spin(scene, spinner, 1, side / 5, 1)
    anchor("Pass", (0, 0, 14))


# ---------------------------------------------------------------------------------------------
# 02 Clown gate: fly through the mouth while it is open.
# ---------------------------------------------------------------------------------------------

def build_clown_gate(scene, m):
    box("clown_deck", (0, 0, 1), (10, 5, 1), m["steel"])
    box("clown_neck", (0, 0, 3.6), (4.5, 1.2, 1.6), m["cream"])
    mouth_center = (0, 14)
    ring_prism("clown_face", ellipse((0, 18), 15, 15, 32, start=-pi / 2),
               ellipse(mouth_center, 7, 4.5, 32, start=-pi / 2), -1.5, 1.5, m["cream"])
    ring_prism("clown_lips_nocol", ellipse(mouth_center, 8.4, 5.7, 32, start=-pi / 2),
               ellipse(mouth_center, 7.0, 4.5, 32, start=-pi / 2), -1.95, -1.45, m["pink"])
    for side in (-1, 1):
        cylinder(f"clown_cheek_{side}_nocol", (side * 9.6, -1.55, 15.5), 2.0, 0.16, m["pink"],
                 vertices=16, rotation=(pi / 2, 0, 0))
        sphere(f"clown_eye_white_{side}_nocol", (side * 5.2, -1.3, 24.5), (2.4, 0.6, 2.9), m["cream"], 16, 8)
        ring_prism(f"clown_eye_rim_{side}_nocol", ellipse((side * 5.2, 24.5), 2.9, 3.4, 20),
                   ellipse((side * 5.2, 24.5), 2.35, 2.85, 20), -1.95, -1.55, m["violet"])
        box(f"clown_brow_{side}_nocol", (side * 5.4, -1.7, 29.2), (2.6, 0.2, 0.35), m["violet"],
            rotation=(0, side * 0.25, 0))
        sphere(f"clown_hair_{side}", (side * 14.6, 0, 19), (3.4, 2.6, 4.4), m["orange"], 12, 6)
        pupil = sphere(f"clown_pupil_{side}_nocol", (side * 5.2 + 1.0, -1.95, 24.5), (0.85, 0.3, 0.85),
                       m["ink"], 10, 5)
        glint = sphere(f"clown_glint_{side}_nocol", (side * 5.2 + 1.2, -2.2, 24.8), (0.25, 0.1, 0.25),
                       m["cyan"], 8, 4)
        eye = rig(f"ClownEye{'L' if side < 0 else 'R'}", (side * 5.2, -1.95, 24.5), [pupil, glint])
        spin(scene, eye, 1, 1, 1)
    torus("clown_ruff_nocol", (0, 0, 4.2), 6.2, 1.3, m["cream"], major_segments=24).scale = (1, 0.62, 1)
    striped_solid(lambda name, mat: cone(name, (0, 0, 37.5), 5.6, 0.4, 11, mat, vertices=16),
                  "clown_hat", (m["violet"], m["ink"]), 16)
    sphere("clown_pompom", (0, 0, 43.6), (1.4, 1.4, 1.4), m["pink"], 12, 6)

    # The nose pulses on the beat and collides: bumping it is part of the joke.
    nose = sphere("clown_nose", (0, -2.2, 21.6), (2.2, 2.2, 2.2), m["pink"], 14, 7)
    timeline(scene, nose, "scale", ((0, (1, 1, 1)), (0.5, (1.14, 1.14, 1.14)), (1, (1, 1, 1))))

    # The mouth is two half-ellipse plates, a little wider than the hole, that retract into the
    # face. Both stay inside the face thickness (|y| <= 1.0 < 1.5) at every point of the loop.
    upper = prism("clown_jaw_upper", ellipse(mouth_center, 7.2, 4.7, 17, 0, pi, closed=False),
                  -1.0, 1.0, m["red"])
    lower = prism("clown_jaw_lower", ellipse(mouth_center, 7.2, 4.7, 17, pi, 2 * pi, closed=False),
                  -1.0, 1.0, m["red"])
    upper_teeth = [box(f"clown_tooth_up_{i}_nocol", (-5.4 + i * 1.8, -1.2, 14.45), (0.7, 0.12, 0.45), m["cream"])
                   for i in range(7)]
    lower_teeth = [box(f"clown_tooth_low_{i}_nocol", (-4.5 + i * 1.8, -1.2, 13.55), (0.7, 0.12, 0.45), m["cream"])
                   for i in range(6)]
    jaw_up = rig("ClownJawUpper", (0, 0, 14), [upper, *upper_teeth])
    jaw_low = rig("ClownJawLower", (0, 0, 14), [lower, *lower_teeth])
    for node, open_z in ((jaw_up, 18.9), (jaw_low, 9.1)):
        timeline(scene, node, "location", (
            (0, (0, 0, 14)), (0.15, (0, 0, 14)), (0.35, (0, 0, open_z)), (0.6, (0, 0, open_z)), (0.8, (0, 0, 14)),
            (1, (0, 0, 14)),
        ))
    anchor("Pass", (0, 0, 14))


# ---------------------------------------------------------------------------------------------
# 03 Hammer: "Hau den Lukas". A drop hammer slams on the anvil across the whole lane.
# ---------------------------------------------------------------------------------------------

def build_hammer_strike(scene, m):
    box("hammer_deck", (0, 0, 1), (12, 4, 1), m["steel"])
    box("hammer_anvil", (0, 0, 4), (7.6, 2.6, 2), m["steel"])
    box("hammer_anvil_plate_nocol", (0, 0, 6.05), (7.2, 2.2, 0.08), m["yellow"])
    for side in (-1, 1):
        box(f"hammer_column_{side}", (side * 9.5, 0, 16), (1.3, 1.3, 14), m["red"])
        box(f"hammer_column_cap_{side}", (side * 9.5, 0, 2.6), (1.7, 1.7, 0.6), m["gold"])
    box("hammer_beam", (0, 0, 31.5), (11, 1.6, 1.5), m["gold"])
    text("hammer_title_nocol", "HAU DEN LUKAS", (0, -1.7, 31.5), 1.55, m["ink"], extrude=0.06)
    for index in range(11):
        tone = m["cyan"] if index < 4 else (m["yellow"] if index < 8 else m["pink"])
        box(f"hammer_scale_{index}_nocol", (-9.5, -1.38, 4 + index * 2.2), (0.8, 0.08, 0.35), tone)
    cone("hammer_bell_nocol", (-9.5, -1.9, 29.2), 0.9, 0.3, 0.9, m["gold"], vertices=12)
    star = [(1.1 * cos(pi / 2 + i * pi / 5) * (1 if i % 2 == 0 else 0.42),
             1.1 * sin(pi / 2 + i * pi / 5) * (1 if i % 2 == 0 else 0.42)) for i in range(10)]
    prism("hammer_star_nocol", [(x + 9.5, z + 20) for x, z in star], -1.62, -1.38, m["yellow"])

    # Raised the head clears the lane (bottom 21.8), slammed it rests on the anvil (bottom 6).
    head = cylinder("hammer_head", (0, 0, 25), 3.2, 15.6, m["steel"], vertices=12, rotation=(0, pi / 2, 0))
    bands = [torus(f"hammer_band_{side}_nocol", (side * 6.2, 0, 25), 3.25, 0.22, m["pink"],
                   rotation=(0, pi / 2, 0), major_segments=16, minor_segments=4) for side in (-1, 1)]
    caps = [cylinder(f"hammer_face_{side}_nocol", (side * 7.85, 0, 25), 2.4, 0.12, m["yellow"],
                     vertices=12, rotation=(0, pi / 2, 0)) for side in (-1, 1)]
    hammer = rig("HammerHead", (0, 0, 25), [head, *bands, *caps])
    timeline(scene, hammer, "location", (
        (0, (0, 0, 25)), (0.55, (0, 0, 25)), (0.62, (0, 0, 9.2)), (0.75, (0, 0, 9.2)), (1, (0, 0, 25)),
    ))
    # The rope is scaled, not moved: it hangs from the beam and stretches to the head's top.
    rope_mesh = cylinder("hammer_rope_nocol", (0, 0, 29.1), 0.35, 1.8, m["gold"], vertices=8)
    rope = rig("HammerRope", (0, 0, 30), [rope_mesh])
    stretched = (30 - 12.4) / 1.8
    timeline(scene, rope, "scale", (
        (0, (1, 1, 1)), (0.55, (1, 1, 1)), (0.62, (1, 1, stretched)), (0.75, (1, 1, stretched)), (1, (1, 1, 1)),
    ))
    puck_mesh = box("hammer_puck_nocol", (-9.5, -1.6, 3.5), (0.9, 0.3, 0.6), m["pink"])
    puck = rig("HammerPuck", (-9.5, -1.6, 3.5), [puck_mesh])
    timeline(scene, puck, "location", (
        (0, (-9.5, -1.6, 3.5)), (0.62, (-9.5, -1.6, 3.5)), (0.72, (-9.5, -1.6, 27.4)),
        (0.8, (-9.5, -1.6, 27.4)), (1, (-9.5, -1.6, 3.5)),
    ))
    anchor("Pass", (0, 0, 12))


# ---------------------------------------------------------------------------------------------
# 04 Duck gallery: three rows of ducks slide across the shooting booth window.
# ---------------------------------------------------------------------------------------------

def build_duck_gallery(scene, m):
    box("duck_deck", (0, 0, 1), (13, 7, 1), m["steel"])
    outer = [(-12, 2), (12, 2), (12, 24), (-12, 24)]
    inner = [(-9, 5), (9, 5), (9, 19), (-9, 19)]
    ring_prism("duck_front_wall", outer, inner, -6, -5, m["red"])
    ring_prism("duck_back_wall", outer, inner, 5, 6, m["red"])
    for side in (-1, 1):
        box(f"duck_side_wall_{side}", (side * 11.5, 0, 13), (0.5, 5, 11), m["cream"])
    box("duck_roof", (0, 0, 25), (12.5, 6.8, 1), m["teal"])
    for index in range(12):
        tone = m["red"] if index % 2 == 0 else m["cream"]
        box(f"duck_awning_{index}_nocol", (-11 + index * 2, -6.85, 23.4), (1.0, 0.12, 0.9), tone)
    box("duck_sign", (0, -5.5, 28), (8.5, 0.4, 2), m["ink"])
    text("duck_title_nocol", "SCHIESSBUDE", (0, -5.95, 28), 1.8, m["lime"], extrude=0.06)
    ring_prism("duck_window_neon_nocol", [(-9.4, 4.6), (9.4, 4.6), (9.4, 19.4), (-9.4, 19.4)],
               inner, -6.2, -6.0, m["cyan"])
    for side in (-1, 1):
        for level, z in enumerate((8, 16)):
            for radius, tone in ((1.6, "pink"), (1.05, "cream"), (0.5, "pink")):
                cylinder(f"duck_target_{side}_{level}_{radius:.1f}_nocol", (side * 10.95, 0, z), radius,
                         0.1 + (1.6 - radius) * 0.1, m[tone], vertices=16, rotation=(0, pi / 2, 0))

    # Flat tin ducks in profile, like the real thing. The silhouette itself is the collider:
    # thin, but a player crossing its plane still meets it.
    silhouette = [(-1.3, -0.9), (1.0, -0.9), (1.35, -0.4), (1.2, 0.2), (0.9, 0.35), (1.0, 0.9), (0.75, 1.3),
                  (0.3, 1.35), (0.05, 1.0), (0.1, 0.45), (-0.6, 0.35), (-1.2, 0.6), (-1.35, 0.1)]
    beak = [(1.0, 1.1), (1.7, 0.98), (1.0, 0.82)]
    duck_scale = 1.2
    rows = ((7.5, -2.5, 1), (12, 0, -1), (16.5, 2.5, 1))
    for row_index, (z, y, direction) in enumerate(rows):
        parts = []
        for slot, x in enumerate((-6, 0, 6)):
            def outline(points):
                points = [(x + direction * px * duck_scale, z + pz * duck_scale) for px, pz in points]
                return points if direction > 0 else list(reversed(points))
            parts.append(prism(f"duck_{row_index}_{slot}", outline(silhouette), y - 0.2, y + 0.2, m["yellow"]))
            parts.append(prism(f"duck_{row_index}_{slot}_beak_nocol", outline(beak), y - 0.15, y + 0.15, m["orange"]))
            parts.append(cylinder(f"duck_{row_index}_{slot}_eye_nocol",
                                  (x + direction * 0.72 * duck_scale, y - 0.22, z + 1.02 * duck_scale), 0.14, 0.05,
                                  m["ink"], vertices=8, rotation=(pi / 2, 0, 0)))
            for radius, tone in ((0.55, "pink"), (0.3, "cream")):
                parts.append(cylinder(f"duck_{row_index}_{slot}_target_{radius:.1f}_nocol",
                                      (x - 0.15 * direction, y - 0.23 - (0.55 - radius) * 0.1, z - 0.2), radius,
                                      0.05, m[tone], vertices=12, rotation=(pi / 2, 0, 0)))
            parts.append(box(f"duck_{row_index}_{slot}_stand_nocol", (x, y, z - 1.35), (0.12, 0.12, 0.35), m["gold"]))
        # The rail stays put and ends inside the side walls; only the ducks travel.
        box(f"duck_rail_{row_index}_nocol", (0, y, z - 1.75), (10.8, 0.12, 0.1), m["gold"])
        row = rig(f"DuckRow{row_index}", (0, y, z), parts)
        swing = 3 * direction
        timeline(scene, row, "location", (
            (0, (swing, y, z)), (1, (-swing, y, z)), (2, (swing, y, z)),
        ))
    anchor("Pass", (0, 0, 12))


# ---------------------------------------------------------------------------------------------
# 05 Swing ride: chairs fly round on chains through the lane.
# ---------------------------------------------------------------------------------------------

def build_swing_ride(scene, m):
    cylinder("swing_base", (0, 0, 1), 4.5, 2, m["steel"], vertices=20)
    torus("swing_base_neon_nocol", (0, 0, 2.05), 4.3, 0.12, m["pink"], major_segments=24, minor_segments=4)
    striped_solid(lambda name, mat: cylinder(name, (0, 0, 15), 1.6, 26, mat, vertices=12),
                  "swing_tower", (m["cream"], m["red"]), 12)
    bulbs("swing_tower_bulbs", [(1.75 * cos(i * 0.9), 1.75 * sin(i * 0.9), 3 + i * 1.0) for i in range(24)],
          m["bulb"], 0.18)

    chain_length = 12.0
    tilt = radians(35)
    hub_radius = 6.2
    reach = hub_radius + chain_length * sin(tilt)
    drop = chain_length * cos(tilt)
    parts = [cylinder("swing_crown", (0, 0, 29), 6.5, 1.4, m["gold"], vertices=24)]
    parts += striped_solid(lambda name, mat: cone(name, (0, 0, 32.2), 7.0, 0.6, 5.0, mat, vertices=16),
                           "swing_roof", (m["red"], m["cream"]), 16)
    parts.append(sphere("swing_finial_nocol", (0, 0, 35.2), (0.6, 0.6, 0.6), m["yellow"], 10, 5))
    parts += bulbs("swing_crown_bulbs", [(6.6 * cos(i * pi / 12), 6.6 * sin(i * pi / 12), 28.3) for i in range(24)],
                   m["bulb"], 0.2)
    for index in range(6):
        angle = index * pi / 3
        radial = (cos(angle), sin(angle))
        top = (hub_radius * radial[0], hub_radius * radial[1], 28.3)
        seat = (reach * radial[0], reach * radial[1], 28.3 - drop)
        middle = tuple((a + b) / 2 for a, b in zip(top, seat))
        orient = (0, -tilt, angle)
        parts.append(cylinder(f"swing_chain_{index}_nocol", middle, 0.07, chain_length, m["gold"],
                              vertices=4, rotation=orient))
        parts.append(box(f"swing_chair_{index}", seat, (0.9, 0.9, 1.0), m["teal"], rotation=orient))
        parts.append(sphere(f"swing_rider_{index}_nocol",
                            (seat[0] - 0.35 * radial[0], seat[1] - 0.35 * radial[1], seat[2] + 1.45),
                            (0.45, 0.45, 0.5), m["cream"], 8, 4))
        parts.append(box(f"swing_chair_neon_{index}_nocol",
                         (seat[0], seat[1], seat[2] - 1.05), (0.85, 0.85, 0.08),
                         m["cyan"] if index % 2 == 0 else m["pink"], rotation=orient))
    crown = rig("SwingCrown", (0, 0, 29), parts)
    keyframe(crown, beat_frame(scene, 0), location=(0, 0, 29), rotation=(0, 0, 0))
    keyframe(crown, beat_frame(scene, 0.5), location=(0, 0, 30.2))
    keyframe(crown, beat_frame(scene, 1), location=(0, 0, 29))
    keyframe(crown, beat_frame(scene, 1.5), location=(0, 0, 30.2))
    keyframe(crown, beat_frame(scene, 2), location=(0, 0, 29), rotation=(0, 0, 2 * pi))
    anchor("Pass", (-4, 0, 19))


# ---------------------------------------------------------------------------------------------
# 06 Ferris wheel: fly through its lower half between the sweeping lantern paddles.
# ---------------------------------------------------------------------------------------------

def build_ferris_wheel(scene, m):
    hub = 26.0
    box("wheel_deck", (0, 0, 1), (10, 7, 1), m["steel"])
    for y in (-4.2, 4.2):
        for sx in (-1, 1):
            dx, dz = -sx * 9.0, hub - 2.0
            length = (dx * dx + dz * dz) ** 0.5
            box(f"wheel_leg_{sx}_{'f' if y < 0 else 'b'}", (sx * 9 + dx / 2, y, 2 + dz / 2),
                (0.6, 0.6, length / 2), m["red"], rotation=(0, atan2(dx, dz), 0))
        box(f"wheel_leg_brace_{'f' if y < 0 else 'b'}", (0, y, 12), (5.5, 0.35, 0.35), m["gold"])
    cylinder("wheel_axle", (0, 0, hub), 1.3, 9, m["gold"], vertices=12, rotation=(pi / 2, 0, 0))

    parts = []
    for y in (-1.8, 1.8):
        parts.append(torus(f"wheel_rim_{y:+.0f}", (0, y, hub), 18, 0.4, m["gold"], rotation=(pi / 2, 0, 0),
                           major_segments=32, minor_segments=5))
        parts.append(torus(f"wheel_inner_{y:+.0f}_nocol", (0, y, hub), 10, 0.22, m["cyan"],
                           rotation=(pi / 2, 0, 0), major_segments=24, minor_segments=4))
        for index in range(8):
            angle = index * pi / 4
            parts.append(box(f"wheel_spoke_{index}_{y:+.0f}", (9 * cos(angle), y, hub + 9 * sin(angle)),
                             (9, 0.22, 0.22), m["cream"], rotation=(0, -angle, 0)))
    for index in range(4):
        angle = pi / 4 + index * pi / 2
        parts.append(box(f"wheel_paddle_{index}", (9 * cos(angle), 0, hub + 9 * sin(angle)),
                         (4, 0.3, 1.7), m["ink"], rotation=(0, -angle, 0)))
        parts.append(box(f"wheel_paddle_neon_{index}_nocol", (9 * cos(angle), -0.36, hub + 9 * sin(angle)),
                         (3.7, 0.06, 1.4), m["pink"] if index % 2 == 0 else m["violet"], rotation=(0, -angle, 0)))
    parts += bulbs("wheel_rim_bulbs", [(18.55 * cos(i * pi / 16), -2.3, hub + 18.55 * sin(i * pi / 16))
                                       for i in range(32)], m["bulb"], 0.24)
    rotor = rig("WheelRotor", (0, 0, hub), parts)
    spin(scene, rotor, 1, 1, 4)

    for index in range(8):
        angle = pi / 8 + index * pi / 4
        pivot = (18 * cos(angle), 0, hub + 18 * sin(angle))
        tone = ("pink", "cyan", "yellow", "lime")[index % 4]
        cabin = [
            box(f"gondola_{index}", (pivot[0], 0, pivot[2] - 2.2), (1.5, 1.1, 1.3), m["cream"]),
            box(f"gondola_{index}_band_nocol", (pivot[0], 0, pivot[2] - 1.5), (1.56, 1.16, 0.18), m[tone]),
            cone(f"gondola_{index}_roof_nocol", (pivot[0], 0, pivot[2] - 0.55), 1.8, 0.2, 0.7, m["red"], vertices=8),
            cylinder(f"gondola_{index}_hanger_nocol", (pivot[0], 0, pivot[2] - 0.1), 0.1, 0.4, m["gold"], vertices=6),
        ]
        gondola = rig(f"Gondola{index}", pivot, cabin)
        parent_keep_world(gondola, rotor)
        # Counter-rotation keeps each cabin hanging level while the wheel turns.
        spin(scene, gondola, 1, -1, 4)
    anchor("Pass", (0, 0, hub - 9))


# ---------------------------------------------------------------------------------------------
# 07 Coaster loop: a looping with a train that never leaves the rails. Its centre stays free.
# ---------------------------------------------------------------------------------------------

def build_coaster_loop(scene, m):
    center = 19.0
    radius = 13.0
    box("loop_deck", (0, 0, 1), (16, 4, 1), m["steel"])
    for y in (-1.0, 1.0):
        torus(f"loop_rail_{y:+.0f}", (0, y, center), radius, 0.28, m["cyan"], rotation=(pi / 2, 0, 0),
              major_segments=40, minor_segments=5)
    torus("loop_spine", (0, 0, center), radius + 0.9, 0.45, m["red"], rotation=(pi / 2, 0, 0),
          major_segments=32, minor_segments=5)
    for index in range(24):
        angle = index * pi / 12
        box(f"loop_tie_{index}_nocol", ((radius + 0.35) * cos(angle), 0, center + (radius + 0.35) * sin(angle)),
            (0.12, 1.15, 0.12), m["gold"], rotation=(0, -angle, 0))
    for side in (-1, 1):
        box(f"loop_post_{side}", (side * 14.5, 0, 10.5), (0.6, 0.6, 8.5), m["red"])
    box("loop_post_centre", (0, 0, 4.3), (0.6, 0.6, 2.3), m["red"])

    chase = bulbs("loop_chase", [(14.6 * cos(i * pi / 12), -1.4, center + 14.6 * sin(i * pi / 12))
                                 for i in range(24)], m["bulb"], 0.26)
    chase_rig = rig("LoopChase", (0, -1.4, center), chase)
    spin(scene, chase_rig, 1, -1, 2)

    car_radius = radius - 0.28 - 0.85
    parts = []
    for index, offset in enumerate((-1.5, -0.5, 0.5, 1.5)):
        angle = -pi / 2 + offset * radians(14)
        heading = (0, -(angle + pi / 2), 0)
        at = (car_radius * cos(angle), 0, center + car_radius * sin(angle))
        tone = m["pink"] if index % 2 == 0 else m["yellow"]
        parts.append(box(f"coaster_car_{index}", at, (1.3, 0.95, 0.75), m["red"], rotation=heading))
        parts.append(box(f"coaster_car_{index}_trim_nocol",
                         ((car_radius - 0.6) * cos(angle), 0, center + (car_radius - 0.6) * sin(angle)),
                         (1.32, 0.97, 0.12), tone, rotation=heading))
        for seat in (-0.45, 0.45):
            parts.append(sphere(f"coaster_rider_{index}_{seat:+.0f}_nocol",
                                ((car_radius - 1.15) * cos(angle), seat, center + (car_radius - 1.15) * sin(angle)),
                                (0.32, 0.32, 0.32), m["cream"], 8, 4))
    train = rig("CoasterTrain", (0, 0, center), parts)
    spin(scene, train, 1, 1, 2)
    anchor("Pass", (0, 0, center))


# ---------------------------------------------------------------------------------------------
# 08 Horse carousel: fly flat through it, between floor and canopy, past the galloping horses.
# ---------------------------------------------------------------------------------------------

def build_horse_carousel(scene, m):
    cylinder("carousel_plinth", (0, 0, 0.5), 16, 1, m["steel"], vertices=32)
    torus("carousel_plinth_neon_nocol", (0, 0, 1.02), 15.9, 0.14, m["cyan"], major_segments=32, minor_segments=4)
    cylinder("carousel_column", (0, 0, 6.5), 2.4, 11, m["gold"], vertices=12)
    for index in range(6):
        angle = index * pi / 3
        box(f"carousel_mirror_{index}_nocol", (2.45 * cos(angle), 2.45 * sin(angle), 6.5), (0.06, 1.0, 3.6),
            m["cyan"], rotation=(0, 0, angle))

    parts = striped_solid(lambda name, mat: cylinder(name, (0, 0, 1.3), 15.2, 0.6, mat, vertices=32),
                          "carousel_floor", (m["wood"], m["red"]), 16)
    parts.append(cylinder("carousel_canopy", (0, 0, 12.5), 15.8, 1.0, m["gold"], vertices=32))
    parts += striped_solid(lambda name, mat: cone(name, (0, 0, 15.75), 15.8, 1.2, 5.5, mat, vertices=24),
                           "carousel_roof", (m["red"], m["cream"]), 24)
    parts.append(sphere("carousel_finial_nocol", (0, 0, 19.0), (1.1, 1.1, 1.1), m["gold"], 12, 6))
    parts.append(cone("carousel_pennant_nocol", (0, 0, 20.4), 0.5, 0.0, 1.8, m["pink"], vertices=8))
    for index in range(24):
        angle = (index + 0.5) * pi / 12
        parts.append(box(f"carousel_valance_{index}_nocol", (15.55 * cos(angle), 15.55 * sin(angle), 11.55),
                         (2.0, 0.1, 0.5), m["pink"] if index % 2 == 0 else m["cream"], rotation=(0, 0, angle + pi / 2)))
    parts += bulbs("carousel_bulbs", [(15.9 * cos(i * pi / 16), 15.9 * sin(i * pi / 16), 12.5) for i in range(32)],
                   m["bulb"], 0.22)
    rotor = rig("CarouselRotor", (0, 0, 0), parts)
    spin(scene, rotor, 2, 1, 4)

    horse_z = 6.8
    for ring, (radius, count, phase) in enumerate(((11.0, 6, 0.0), (6.5, 6, pi / 6))):
        for index in range(count):
            angle = phase + index * 2 * pi / count
            at = (radius * cos(angle), radius * sin(angle))
            heading = angle + pi / 2
            pole = cylinder(f"carousel_pole_{ring}_{index}", (at[0], at[1], 6.8), 0.28, 10.4, m["gold"], vertices=8)
            parent_keep_world(pole, rotor)
            tx, ty = cos(heading), sin(heading)
            tone = m["pink"] if (index + ring) % 2 == 0 else m["cyan"]
            horse = [
                box(f"horse_{ring}_{index}", (at[0], at[1], horse_z), (1.4, 0.45, 0.9), m["pearl"],
                    rotation=(0, 0, heading)),
                sphere(f"horse_{ring}_{index}_body_nocol", (at[0], at[1], horse_z), (1.45, 0.5, 0.62), m["pearl"], 10, 5,
                       rotation=(0, 0, heading)),
                box(f"horse_{ring}_{index}_neck_nocol", (at[0] + 1.1 * tx, at[1] + 1.1 * ty, horse_z + 0.8),
                    (0.35, 0.28, 0.75), m["pearl"], rotation=(0, 0, heading)),
                box(f"horse_{ring}_{index}_head_nocol", (at[0] + 1.55 * tx, at[1] + 1.55 * ty, horse_z + 1.4),
                    (0.55, 0.24, 0.26), m["pearl"], rotation=(0, 0, heading)),
                box(f"horse_{ring}_{index}_mane_nocol", (at[0] + 0.95 * tx, at[1] + 0.95 * ty, horse_z + 1.05),
                    (0.5, 0.08, 0.5), tone, rotation=(0, 0, heading)),
                box(f"horse_{ring}_{index}_saddle_nocol", (at[0], at[1], horse_z + 0.58), (0.55, 0.52, 0.1), tone,
                    rotation=(0, 0, heading)),
                cone(f"horse_{ring}_{index}_tail_nocol", (at[0] - 1.6 * tx, at[1] - 1.6 * ty, horse_z + 0.2), 0.25,
                     0.05, 0.9, tone, vertices=6, rotation=(0, pi / 2 + 0.6, heading)),
            ]
            for leg, (along, lift) in enumerate(((0.9, 1), (0.9, -1), (-0.9, 1), (-0.9, -1))):
                horse.append(box(f"horse_{ring}_{index}_leg_{leg}_nocol",
                                 (at[0] + along * tx, at[1] + along * ty, horse_z - 0.9), (0.12, 0.12, 0.5),
                                 m["pearl"], rotation=(0.35 * lift, 0, heading)))
            node = rig(f"Horse{ring}{index}", (at[0], at[1], horse_z), horse)
            parent_keep_world(node, rotor)
            lift = 1.1 if (index + ring) % 2 == 0 else -1.1
            keys = []
            for beat in range(5):
                keys.append((beat, (at[0], at[1], horse_z - lift)))
                if beat < 4:
                    keys.append((beat + 0.5, (at[0], at[1], horse_z + lift)))
            timeline(scene, node, "location", keys)
    anchor("Pass", (8.75, 0, 6.8))


# ---------------------------------------------------------------------------------------------
# 09 Drop tower: the cabin crawls up through the lane and plunges back down.
# ---------------------------------------------------------------------------------------------

def build_drop_tower(scene, m):
    box("tower_deck", (0, 0, 1), (7, 7, 1), m["steel"])
    for sx in (-1, 1):
        for sy in (-1, 1):
            box(f"tower_column_{sx}_{sy}", (sx * 5, sy * 5, 22), (0.6, 0.6, 20), m["red"])
            bulbs(f"tower_bulbs_{sx}_{sy}", [(sx * 5.65, sy * 5.65, 4 + i * 2.5) for i in range(15)],
                  m["bulb"] if (sx * sy) > 0 else m["pink"], 0.2)
        for level in range(4):
            z0 = 4 + level * 9.5
            for direction in (-1, 1):
                box(f"tower_brace_{sx}_{level}_{direction}_nocol", (sx * 5, 0, z0 + 4.75), (0.14, 0.14, 6.8),
                    m["gold"], rotation=(direction * 0.78, 0, 0))
    box("tower_cap", (0, 0, 43.5), (6, 6, 1.5), m["gold"])
    text("tower_title_nocol", "FREIER FALL", (0, -6.08, 43.5), 1.5, m["ink"], extrude=0.06)
    beacon_parts = [
        box("tower_beacon_x_nocol", (0, 0, 45.6), (3, 0.25, 0.25), m["pink"]),
        box("tower_beacon_y_nocol", (0, 0, 45.6), (0.25, 3, 0.25), m["cyan"]),
        sphere("tower_beacon_core_nocol", (0, 0, 45.8), (0.6, 0.6, 0.6), m["yellow"], 10, 5),
    ]
    beacon = rig("TowerBeacon", (0, 0, 45.6), beacon_parts)
    spin(scene, beacon, 2, 1, 2)

    cabin_parts = [box("tower_cabin", (0, 0, 5), (3.8, 3.8, 3), m["teal"])]
    for z in (3.2, 6.8):
        cabin_parts.append(box(f"tower_cabin_band_{z:.0f}_nocol", (0, 0, z), (3.86, 3.86, 0.14), m["yellow"]))
    for side in (-1, 1):
        for seat in range(3):
            cabin_parts.append(sphere(f"tower_rider_{side}_{seat}_nocol", (-2.4 + seat * 2.4, side * 3.95, 5.9),
                                      (0.4, 0.3, 0.4), m["cream"], 8, 4))
    cabin = rig("DropCabin", (0, 0, 5), cabin_parts)
    timeline(scene, cabin, "location", (
        (0, (0, 0, 5)), (1.2, (0, 0, 36)), (1.6, (0, 0, 36)), (1.72, (0, 0, 5)), (2, (0, 0, 5)),
    ))
    anchor("Pass", (0, 0, 20))


# ---------------------------------------------------------------------------------------------
# 10 Big top: the finale. Dive through the crown while its petals are open; the finish ring
# hangs inside the tent. Four entrances keep nobody locked in once the race is over.
# ---------------------------------------------------------------------------------------------

def build_big_top(scene, m):
    cylinder("bigtop_floor", (0, 0, 1), 24, 2, m["steel"], vertices=32)
    torus("bigtop_ring_nocol", (0, 0, 2.1), 8, 0.35, m["red"], major_segments=32, minor_segments=4)
    torus("bigtop_ring_neon_nocol", (0, 0, 2.3), 8, 0.12, m["yellow"], major_segments=32, minor_segments=4)
    entrances = {0, 5, 6, 11, 12, 17, 18, 23}
    for index in range(24):
        angle = (index + 0.5) * pi / 12
        at = (22 * cos(angle), 22 * sin(angle), 8)
        if index in entrances:
            continue
        box(f"bigtop_wall_{index}", at, (2.9, 0.4, 6), m["red"] if index % 2 == 0 else m["cream"],
            rotation=(0, 0, angle + pi / 2))
    for index in range(4):
        angle = index * pi / 2
        box(f"bigtop_lintel_{index}", (22 * cos(angle), 22 * sin(angle), 13.2), (0.5, 5.9, 0.8), m["gold"],
            rotation=(0, 0, angle))
        box(f"bigtop_lintel_neon_{index}_nocol", (22.55 * cos(angle), 22.55 * sin(angle), 12.3),
            (0.06, 5.6, 0.12), m["cyan"], rotation=(0, 0, angle))
    roof = cone("bigtop_roof_nocol", (0, 0, 20), 23, 7, 12, m["red"], vertices=24, capped=False)
    stripe(roof, (m["red"], m["cream"]), 24)
    # The canvas is a single open surface, which cannot tell inside from outside. A closed band
    # just under it carries the collision and keeps the crown open.
    frustum_shell("bigtop_roof_colonly", 23, 7, 14, 26, 0.5, m["steel"])
    torus("bigtop_crown", (0, 0, 26), 7, 0.4, m["gold"], major_segments=24, minor_segments=5)
    text("bigtop_title_nocol", "ZIRKUS", (0, -23.2, 16.2), 3.4, m["yellow"])
    for index in range(8):
        angle = index * pi / 4 + pi / 8
        for flag in range(5):
            t = (flag + 0.5) / 5
            radius = 7.5 + t * 15.5
            z = 26.3 - t * 12.4
            box(f"bigtop_pennant_{index}_{flag}_nocol", (radius * cos(angle), radius * sin(angle), z - 0.45),
                (0.35, 0.05, 0.45), (m["pink"], m["cyan"], m["yellow"], m["lime"], m["violet"])[(index + flag) % 5],
                rotation=(0, 0, angle + pi / 2))
    crown_lights = bulbs("bigtop_crown_bulbs", [(7.7 * cos(i * pi / 8), 7.7 * sin(i * pi / 8), 26.5)
                                                 for i in range(16)], m["bulb"], 0.26)
    chase = rig("BigTopChase", (0, 0, 26.5), crown_lights)
    spin(scene, chase, 2, 1 / 8, 2)

    # Petals close the crown into a cone and open outwards like a flower. The geometry is
    # authored upright in the petal's own frame (radial +X, tangent +Y) and tilted by its rig.
    closed, opened = radians(-76), radians(55)
    petal_outline = [(0, 0), (0.2, 0), (0.2, 7.2), (0, 7.2)]
    for index in range(8):
        angle = index * pi / 4
        hinge = (7 * cos(angle), 7 * sin(angle), 26)
        plate = prism(f"bigtop_petal_{index}", [(-2.7, 0), (2.7, 0), (0.6, 7.2), (-0.6, 7.2)],
                      -0.2, 0.2, m["violet"])
        # prism draws in XZ and extrudes along Y; turn it so its width runs along the tangent.
        plate.rotation_euler = (0, 0, pi / 2)
        edge = prism(f"bigtop_petal_{index}_edge_nocol",
                     [(x - 0.1, z) for x, z in petal_outline], -0.26, -0.21, m["pink"])
        edge.rotation_euler = (0, 0, pi / 2)
        bpy.context.view_layer.update()
        petal = empty(f"Petal{index}", (0, 0, 0))
        plate.parent = petal
        edge.parent = petal
        petal.location = hinge
        timeline(scene, petal, "rotation", (
            (0, (0, closed, angle)), (0.6, (0, closed, angle)), (0.9, (0, opened, angle)),
            (1.7, (0, opened, angle)), (2, (0, closed, angle)),
        ))
    anchor("Crown", (0, 0, 26))
    anchor("Finish", (0, 0, 16))
    anchor("Pass", (0, 0, 26))


SETPIECES = (
    ("01_marquee_arch", "MarqueeArchLoop", 3, build_marquee_arch),
    ("02_clown_gate", "ClownGateLoop", 3, build_clown_gate),
    ("03_hammer_strike", "HammerStrikeLoop", 3, build_hammer_strike),
    ("04_duck_gallery", "DuckGalleryLoop", 6, build_duck_gallery),
    ("05_swing_ride", "SwingRideLoop", 6, build_swing_ride),
    ("06_ferris_wheel", "FerrisWheelLoop", 12, build_ferris_wheel),
    ("07_coaster_loop", "CoasterLoopLoop", 6, build_coaster_loop),
    ("08_horse_carousel", "HorseCarouselLoop", 12, build_horse_carousel),
    ("09_drop_tower", "DropTowerLoop", 6, build_drop_tower),
    ("10_big_top", "BigTopLoop", 6, build_big_top),
)


# ---------------------------------------------------------------------------------------------
# Consolidation, checks and export
# ---------------------------------------------------------------------------------------------

def snake(name):
    out = []
    for index, char in enumerate(name):
        if char.isupper() and index > 0 and not name[index - 1].isupper():
            out.append("_")
        out.append(char.lower())
    return "".join(out)


def select_only(objs):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objs:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def consolidate(prefix):
    """Joins meshes that share a parent and a role into one mesh, then bakes its transform into
    the vertices. Meshes that carry their own animation keep their identity."""
    groups = {}
    for obj in list(bpy.data.objects):
        if obj.type != "MESH":
            continue
        if obj.animation_data and obj.animation_data.action:
            continue
        lowered = obj.name.lower()
        role = "detail_noshadow_nocol" if "_nocol" in lowered else ("hull_colonly" if "_colonly" in lowered else "body")
        key = (obj.parent.name if obj.parent else "", role)
        groups.setdefault(key, []).append(obj)
    for (parent_name, role), objs in groups.items():
        select_only(objs)
        if len(objs) > 1:
            bpy.ops.object.join()
        joined = bpy.context.view_layer.objects.active
        select_only([joined])
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        base = snake(parent_name) if parent_name else f"{prefix}_static"
        joined.name = f"{base}_{role}"
        joined.data.name = f"{joined.name}_mesh"


def rest_bounds(scene):
    scene.frame_set(scene.frame_start)
    bpy.context.view_layer.update()
    low = [float("inf")] * 3
    high = [float("-inf")] * 3
    for obj in scene.objects:
        if obj.type != "MESH":
            continue
        matrix = obj.matrix_world
        for vertex in obj.data.vertices:
            world = matrix @ vertex.co
            for axis in range(3):
                low[axis] = min(low[axis], world[axis])
                high[axis] = max(high[axis], world[axis])
    return low, high


def check_rest_pose(scene, file_stem):
    """The preset's anchor maths assumes that the loader's placement point is the Blender origin.
    Every ancestor of a mesh has to be unrotated at rest as well, or three.js would widen the
    box it computes from the rotated local bounds."""
    scene.frame_set(scene.frame_start)
    for obj in scene.objects:
        if obj.type == "EMPTY" and not obj.name.startswith("Anchor_"):
            if max(abs(value) for value in obj.rotation_euler) > 1e-6 and not obj.name.startswith("Petal"):
                raise ValueError(f"{file_stem}: rig {obj.name} is rotated at rest")
    low, high = rest_bounds(scene)
    centre = ((low[0] + high[0]) / 2, (low[1] + high[1]) / 2)
    if abs(centre[0]) > BOUNDS_TOLERANCE or abs(centre[1]) > BOUNDS_TOLERANCE or abs(low[2]) > BOUNDS_TOLERANCE:
        raise ValueError(
            f"{file_stem}: rest bounds {low} .. {high} are not centred on the origin and resting on z=0"
        )
    return low, high


def report(scene, file_stem, low, high, glb_path):
    triangles = 0
    meshes = 0
    for obj in scene.objects:
        if obj.type == "MESH":
            meshes += 1
            triangles += sum(len(polygon.vertices) - 2 for polygon in obj.data.polygons)
    anchors = {obj.name: tuple(round(value, 3) for value in obj.location)
               for obj in scene.objects if obj.name.startswith("Anchor_")}
    size = glb_path.stat().st_size / 1024
    print(
        f"{file_stem}: meshes={meshes} triangles={triangles} size={size:.1f}KiB "
        f"bounds=({low[0]:.2f},{low[1]:.2f},{low[2]:.2f})..({high[0]:.2f},{high[1]:.2f},{high[2]:.2f}) "
        f"anchors={anchors}"
    )


def export_setpiece(file_stem, clip_name, duration, builder):
    scene = reset_scene(clip_name, duration)
    builder(scene, build_materials())
    consolidate(file_stem.split("_", 1)[1])
    low, high = check_rest_pose(scene, file_stem)
    scene.frame_set(scene.frame_start)
    blend_path = SOURCE_DIR / f"{file_stem}.blend"
    glb_path = GLB_DIR / f"{file_stem}.glb"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path), check_existing=False)
    bpy.ops.export_scene.gltf(
        filepath=str(glb_path),
        export_format="GLB",
        export_animations=True,
        # SCENE mode exports exactly one clip named after the scene, which is the name the
        # preset's animation clock asks for.
        export_animation_mode="SCENE",
        export_anim_scene_split_object=False,
        export_anim_slide_to_zero=True,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
        export_extras=True,
        export_apply=True,
    )
    report(scene, file_stem, low, high, glb_path)


def main():
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    GLB_DIR.mkdir(parents=True, exist_ok=True)
    for setpiece in SETPIECES:
        export_setpiece(*setpiece)


if __name__ == "__main__":
    main()
