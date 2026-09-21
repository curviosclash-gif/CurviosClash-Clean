"""Export a compact, game-ready Hydra V3 with independent action clips.

Run from the source .blend with Blender 4.2:
  blender -b hydra_v3.blend --python-exit-code 1 --python export_game.py -- OUT.glb
The source file is never saved by this script.
"""

import bpy
import math
import sys
from collections import defaultdict
from pathlib import Path
from mathutils import Matrix, Vector


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
require(len(args) == 1, "Expected one output GLB path after --")
output = Path(args[0]).resolve()
output.parent.mkdir(parents=True, exist_ok=True)
scene = bpy.context.scene
rig = bpy.data.objects["HYDRA | skeleton"]
arm = rig.data

# Exclude the cinematic set and its old frame-by-frame breath particles.
for obj in list(scene.objects):
    if obj.name.startswith(("STAGE", "breath", "BREATH")) or obj.type in {"CAMERA", "LIGHT"}:
        bpy.data.objects.remove(obj, do_unlink=True)
scene.camera = None

heads = [bpy.data.objects[f"head {i} | intent and gaze"] for i in range(1, 6)]
jaws = [bpy.data.objects[f"head {i} | jaw"] for i in range(1, 6)]
feet = [bpy.data.objects[f"foot {i} | ground contact"] for i in range(4)]

# Exported sockets follow the actual head controls, while host-side gameplay uses
# the corresponding fixed local offsets and never depends on the renderer.
for i, head in enumerate(heads, 1):
    socket = bpy.data.objects.new(f"Mouth_{i}", None)
    scene.collection.objects.link(socket)
    socket.parent = head
    socket.location = (0, -1.18, -0.34)

# Material textures are a deterministic, tileable bake of the source's fine
# noise-and-scale motif. Unlike its Blender shader nodes these survive glTF.
def baked_texture(name, rgb, scale):
    size = 256
    image = bpy.data.images.new(name, width=size, height=size, alpha=True)
    pixels = [0.0] * (size * size * 4)
    for y in range(size):
        for x in range(size):
            u, v = x / size, y / size
            cell_x, cell_y = (u * scale) % 1, (v * scale) % 1
            edge = min(cell_x, 1 - cell_x, cell_y, 1 - cell_y)
            relief = min(1.0, edge * scale * 0.8)
            variation = 0.76 + 0.15 * math.sin(2 * math.pi * (u * 5 + v * 3))
            variation += 0.09 * math.sin(2 * math.pi * (u * 11 - v * 7))
            factor = max(0.4, min(1.4, variation + relief * 0.16))
            at = (y * size + x) * 4
            pixels[at:at + 4] = [min(1, rgb[0] * factor), min(1, rgb[1] * factor),
                                   min(1, rgb[2] * factor), 1]
    image.pixels[:] = pixels
    image.pack()
    return image


for name, color, scale in (
    ("deep petrol scales", (0.018, 0.13, 0.15), 31),
    ("raised scales", (0.035, 0.22, 0.22), 24),
    ("bronze ventral armor", (0.28, 0.19, 0.11), 16),
):
    mat = bpy.data.materials[name]
    image = baked_texture(f"{name} | baked color", color, scale)
    nodes = mat.node_tree.nodes
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Metallic"].default_value = 0.08
    bsdf.inputs["Roughness"].default_value = 0.46
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = image
    mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    mat.node_tree.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

meshes = [obj for obj in scene.objects if obj.type == "MESH"]
for obj in meshes:
    if not obj.data.uv_layers:
        uv = obj.data.uv_layers.new(name="GameUV")
        for poly in obj.data.polygons:
            for loop_index in poly.loop_indices:
                vertex = obj.data.vertices[obj.data.loops[loop_index].vertex_index].co
                uv.data[loop_index].uv = (vertex.x * 0.25, vertex.y * 0.25)
    # Subdivision at export time multiplies the runtime triangle count.
    for mod in list(obj.modifiers):
        if mod.type == "SUBSURF":
            obj.modifiers.remove(mod)
    if len(obj.data.polygons) > 220:
        decimate = obj.modifiers.new("Game decimation", "DECIMATE")
        decimate.ratio = 0.418 if len(obj.data.polygons) > 1000 else 0.578
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.ops.object.modifier_apply(modifier=decimate.name)

# Remove the film's single timeline. The clips below are authored independently.
scene.frame_set(1)
for obj in scene.objects:
    if obj.animation_data:
        obj.animation_data_clear()
for action in list(bpy.data.actions):
    if action.users == 0:
        bpy.data.actions.remove(action)

# Joining only equal parent/material/modifier groups preserves every animated
# pivot and skin binding. Objects with their own animation are left separate.
groups = defaultdict(list)
for obj in [o for o in scene.objects if o.type == "MESH"]:
    key = (
        obj.parent.name if obj.parent else "",
        tuple(m.name for m in obj.data.materials),
        tuple((m.type, m.object.name if m.type == "ARMATURE" and m.object else "") for m in obj.modifiers),
    )
    groups[key].append(obj)
for group in groups.values():
    if len(group) < 2:
        continue
    active = group[0]
    bpy.ops.object.select_all(action="DESELECT")
    for obj in group:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = active
    bpy.ops.object.join()

rests = {bone.name: bone.matrix_local.copy() for bone in arm.bones}
chains = {}
for bone in arm.bones:
    prefix = bone.name.rsplit(".", 1)[0]
    chains.setdefault(prefix, []).append(bone.name)
for names in chains.values():
    names.sort()

bases = [Vector(((i - 2) * 0.48, -0.85 + abs(i - 2) * 0.14, 2.42)) for i in range(5)]
tips = [Vector(v) for v in (
    (-3.15, -2.55, 5.8), (-1.55, -1.55, 6.85), (0, -2.15, 7.7),
    (1.65, -1.0, 6.7), (3.15, -2.30, 5.65),
)]
leg_specs = [(side, rear) for side in (-1, 1) for rear in (False, True)]


def swing_points(i, phase, amount=0.13, lunge=0.0, spit=0.0):
    end = tips[i] + Vector((amount * math.sin(phase + i), 0.1 * math.cos(phase + i), 0))
    end += Vector((0, -2.4 * lunge - 0.55 * spit, -0.25 * lunge + 0.2 * spit))
    direction = Vector((0.14 * (i - 2), -1, 0.12 * spit)).normalized()
    start = bases[i]
    b = start + Vector(((i - 2) * 0.31, 0.10, 1.9))
    c = end - direction * 1.32
    points = []
    for j in range(15):
        u = j / 14
        v = 1 - u
        points.append(start * v ** 3 + b * 3 * v * v * u
                      + c * 3 * v * u * u + end * u ** 3)
    return points


def leg_points(i, phase, walking):
    side, rear = leg_specs[i]
    y = 1.48 if rear else -1.12
    hip = Vector((side * 1.0, y, 1.85))
    foot = Vector((side * 1.58, y - 0.37, 0.21))
    if walking:
        gait = phase + (math.pi if i in (1, 2) else 0)
        foot.y += 0.95 * math.cos(gait)
        foot.z += 0.38 * max(0, math.sin(gait))
    knee = hip.lerp(foot, 0.52) + Vector((side * 0.23, 0.35 if rear else -0.22, 0.05))
    return [hip, knee, foot]


def tail_points(phase):
    return [Vector((0.25 * u + 0.23 * u * u * math.sin(phase - u * 2.2),
                    1.9 + 4.1 * u, 1.62 - 0.7 * math.sin(math.pi * u) + 0.45 * u * u))
            for u in [j / 14 for j in range(15)]]


def set_chain(label, points, frame):
    names = chains[label]
    parent_pose = None
    parent_rest = None
    for j, name in enumerate(names):
        delta = points[j + 1] - points[j]
        rest_direction = (arm.bones[name].tail_local - arm.bones[name].head_local).normalized()
        swing = rest_direction.rotation_difference(delta.normalized())
        rotation = (swing @ rests[name].to_quaternion()).to_matrix().to_4x4()
        stretch = delta.length / arm.bones[name].length
        desired = Matrix.Translation(points[j]) @ rotation @ Matrix.Diagonal((stretch, stretch, stretch, 1))
        basis = (rests[name].inverted() @ desired if j == 0 else
                 rests[name].inverted() @ parent_rest @ parent_pose.inverted() @ desired)
        pose = rig.pose.bones[name]
        pose.rotation_mode = "QUATERNION"
        pose.matrix_basis = basis
        for channel in ("location", "rotation_quaternion", "scale"):
            pose.keyframe_insert(data_path=channel, frame=frame, group=label)
        parent_pose, parent_rest = desired, rests[name]


def add_track(obj, clip, action, length):
    data = obj.animation_data_create()
    data.action = None
    track = data.nla_tracks.new()
    track.name = clip
    strip = track.strips.new(clip, 1, action)
    strip.action_frame_start = 1
    strip.action_frame_end = length
    strip.frame_end = length
    track.mute = False


clips = [("Idle", 49, None, None), ("Walk", 25, None, None)]
clips += [(f"Snap_{i}", 39, "snap", i - 1) for i in range(1, 6)]
clips += [(f"Spit_{i}", 32, "spit", i - 1) for i in range(1, 6)]
animated = [rig, *heads, *jaws, *feet]
for clip, length, attack, attacker in clips:
    actions = {obj.name: bpy.data.actions.new(f"{clip} | {obj.name}") for obj in animated}
    for obj in animated:
        obj.animation_data_create().action = actions[obj.name]
    for frame in range(1, length + 1):
        t = (frame - 1) / (length - 1)
        phase = t * 2 * math.pi
        # Closed-loop endpoints for both ambient clips. Attacks return to rest.
        lunge = math.sin(math.pi * max(0, min(1, (t - 0.44) / 0.35))) ** 2 if attack == "snap" and 0.44 <= t <= 0.79 else 0
        spit = math.sin(math.pi * max(0, min(1, (t - 0.38) / 0.45))) ** 2 if attack == "spit" and 0.38 <= t <= 0.83 else 0
        for i, head in enumerate(heads):
            points = swing_points(i, phase if attack is None else 0,
                                  amount=0.10 if attack is None else 0,
                                  lunge=lunge if attacker == i else 0,
                                  spit=spit if attacker == i else 0)
            set_chain(f"neck{i}", points, frame)
            direction = (points[-1] - points[-2]).normalized()
            head.location = points[-1]
            head.rotation_mode = "QUATERNION"
            head.rotation_quaternion = direction.to_track_quat("-Y", "Z")
            head.keyframe_insert(data_path="location", frame=frame)
            head.keyframe_insert(data_path="rotation_quaternion", frame=frame)
            jaw = jaws[i]
            jaw.rotation_euler.x = (0.65 * lunge + 0.45 * spit) if attacker == i else 0.055
            jaw.keyframe_insert(data_path="rotation_euler", frame=frame)
        set_chain("tail", tail_points(phase if attack is None else 0), frame)
        for i, foot in enumerate(feet):
            points = leg_points(i, phase, clip == "Walk")
            set_chain(f"leg{i}", points, frame)
            foot.location = points[-1]
            foot.keyframe_insert(data_path="location", frame=frame)
            for toe in range(3):
                x = (toe - 1) * 0.23
                a = points[-1] + Vector((x, -0.30, -0.03))
                curl = 0.16 * max(0, math.sin(phase + (math.pi if i in (1, 2) else 0))) if clip == "Walk" else 0
                b = a + Vector((0, -0.24 * math.cos(curl), 0.24 * math.sin(curl)))
                c = b + Vector((0, -0.23 * math.cos(curl * 1.6), -0.08 + 0.23 * math.sin(curl * 1.6)))
                set_chain(f"toe{i}_{toe}", [a, b, c], frame)
    for obj in animated:
        add_track(obj, clip, actions[obj.name], length)

for obj in scene.objects:
    obj.select_set(obj.type in {"MESH", "ARMATURE", "EMPTY"})
bpy.context.view_layer.objects.active = rig
scene.frame_start = 1
scene.frame_end = 49
scene.render.fps = 24
bpy.ops.export_scene.gltf(
    filepath=str(output), export_format="GLB", use_selection=True,
    export_animations=True, export_nla_strips=True,
    export_force_sampling=True, export_yup=True,
    export_cameras=False, export_lights=False,
)
print("HYDRA_GAME_EXPORT", output, output.stat().st_size,
      "meshes", sum(o.type == "MESH" for o in scene.objects),
      "clips", [c[0] for c in clips], flush=True)
