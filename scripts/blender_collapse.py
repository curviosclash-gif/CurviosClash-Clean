"""Rigid-body collapse scaffolding shared by the destructible map packs.

Everything a baked collapse needs that is not about one particular structure lives here: the
rigid body world and its solver settings, proxy bodies built as convex hulls from point clouds,
the constraints that hold a stack together until a joint fails, the plane lock that keeps a piece
on its authored fall line, sampling the solver frame by frame, the determinism replay, and cutting
the clip once everything has come to rest.

What stays in each generator is the structure: its mass model, where its joints are and how much
bending they carry, and the cuts the hit makes in what the structure stands on. The Eiffel Tower
siege (generate_eiffel_tower_siege_assets) and the reactor site (generate_reactor_site_assets)
both run on this module; the numbers below are the ones the tower was tuned with and the reactor
inherits them unchanged.

Why a simulation at all, and why these settings, is written up in the siege generator's module
docstring. The short form: hand-written integrators teleport, Bullet does not, and Bullet is
deterministic here - two runs of the same scene produce bit-identical samples, which
`replay_matches` checks rather than assumes.
"""

from math import pi, radians

import bmesh
import bpy
from mathutils import Quaternion

# --- Physics constants ----------------------------------------------------------------------------
GRAVITY = 9.81                 # m/s^2, and the rigid body world's own gravity
SUBSTEPS = 12                  # Bullet substeps per frame: 360 integration steps a second at 30 fps
SOLVER_ITERATIONS = 24
FRICTION = 0.6                 # iron or concrete on stone, and on itself
RESTITUTION = 0.05             # wreckage is about as bouncy as a sack of bricks
LINEAR_DAMPING = 0.05
ANGULAR_DAMPING = 0.1
# What counts as standing still, per frame, and how long it has to hold before the clip is cut.
REST_TRANSLATION = 0.05        # m
REST_ROTATION = radians(0.5)
REST_FRAMES = 30
TAIL_SECONDS = 1.0             # still frames after the clip is cut, so it does not end on a jump


def tilt_of(rotation):
    """A quaternion's turn, folded into 0..180 degrees."""
    angle = rotation.angle % (2.0 * pi)
    return angle if angle <= pi else 2.0 * pi - angle


# --- Proxy bodies -----------------------------------------------------------------------------------


def hull_object(name, points, location=(0.0, 0.0, 0.0)):
    """One convex hull mesh object, built from a point cloud."""
    mesh = bpy.data.meshes.new(f"{name}_mesh")
    mesh.from_pydata(points, [], [])
    mesh.update()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.convex_hull(bm, input=bm.verts, use_existing_faces=False)
    bmesh.ops.delete(bm, geom=[vert for vert in bm.verts if not vert.link_faces], context="VERTS")
    bm.to_mesh(mesh)
    bm.free()
    mesh.validate()
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    obj.location = location
    obj.rotation_mode = "QUATERNION"
    bpy.context.collection.objects.link(obj)
    return obj


def box_object(name, half_span, low, high):
    """An axis-aligned slab as a hull, so it collides where it is drawn.

    Not Blender's BOX shape: that is the object's bounding box centred on the object's *origin*,
    so a slab drawn from -30 to 0 would collide from -15 to +15 and a whole pack would come to
    rest fifteen metres in the air.
    """
    points = [(sign_x * half_span, sign_y * half_span, height)
              for height in (low, high) for sign_x in (-1.0, 1.0) for sign_y in (-1.0, 1.0)]
    return hull_object(name, points)


# --- The world ---------------------------------------------------------------------------------------


def rigid_world(scene, frames):
    bpy.ops.rigidbody.world_add()
    world = scene.rigidbody_world
    world.substeps_per_frame = SUBSTEPS
    world.solver_iterations = SOLVER_ITERATIONS
    world.time_scale = 1.0
    world.point_cache.frame_start = scene.frame_start
    world.point_cache.frame_end = scene.frame_start + frames - 1
    scene.gravity = (0.0, 0.0, -GRAVITY)
    scene.use_gravity = True
    return world


def add_body(obj, kind, shape, mass=1.0):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.rigidbody.object_add(type=kind)
    body = obj.rigid_body
    body.collision_shape = shape
    body.friction = FRICTION
    body.restitution = RESTITUTION
    if kind == "ACTIVE":
        # Tonnes rather than kilogrammes. A collapse driven by gravity and contact alone is
        # invariant under a uniform scaling of every mass, and keeping the numbers near 10^3 rather
        # than 10^6 keeps Bullet's impulses in a range its floats resolve comfortably.
        body.mass = mass
        body.linear_damping = LINEAR_DAMPING
        body.angular_damping = ANGULAR_DAMPING
        # Bullet puts a body to sleep below 0.4 m/s and 0.5 rad/s. Those are thresholds for props:
        # a three-hundred-metre tower turning at a fifth of that is travelling ten metres a second
        # at its tip, and letting it sleep froze a 58 m stack in mid-air halfway through going over.
        # Nothing here sleeps; the clip is cut on measured stillness instead.
        body.use_deactivation = False
    return body


def add_plane_lock(name, proxy, anchor, fall_yaw=pi / 4.0):
    """Hold one proxy's travel in the fall plane. Its turning stays free.

    The map turns the whole slot about the structure's own axis, so the direction a scene falls in
    is authored rather than simulated. Left free, a piece does not keep to it: a convex hull's
    triangulation is not mirror symmetric, so a tumbling piece picks up a few degrees of drift off
    every bounce and the summit of the tower's 23_topple_summit came to rest thirty-two degrees off
    the diagonal it was authored on. The preset states one baked heading per scene and the contract
    test measures it off the file, so that drift is not cosmetic - it is the map placing a collapse
    that lands somewhere else.

    Only the sideways *travel* is held. Locking the two out-of-plane rotations as well was tried
    first and Bullet threw the summit into orbit: a generic six-degree-of-freedom constraint
    resolves its angular limits through an Euler decomposition, which stops meaning anything once a
    body has turned past a right angle, and these bodies turn several times.

    `fall_yaw` is the angle of the fall line about Z, measured from +X: the tower falls along its
    diagonal (a quarter of pi), the reactor's structures along +X (zero).
    """
    empty = bpy.data.objects.new(name, None)
    empty.empty_display_type = "PLAIN_AXES"
    empty.location = proxy.location
    # Local X along the fall, local Y along the hinge, local Z up.
    empty.rotation_euler = (0.0, 0.0, fall_yaw)
    bpy.context.collection.objects.link(empty)
    bpy.ops.object.select_all(action="DESELECT")
    empty.select_set(True)
    bpy.context.view_layer.objects.active = empty
    bpy.ops.rigidbody.constraint_add(type="GENERIC")
    lock = empty.rigid_body_constraint
    lock.object1 = anchor
    lock.object2 = proxy
    # The anchor is the ground, and the piece has to keep landing on it.
    lock.disable_collisions = False
    for axis, free in (("lin_x", True), ("lin_y", False), ("lin_z", True),
                       ("ang_x", True), ("ang_y", True), ("ang_z", True)):
        setattr(lock, f"use_limit_{axis}", not free)
        if not free:
            setattr(lock, f"limit_{axis}_lower", 0.0)
            setattr(lock, f"limit_{axis}_upper", 0.0)
    return empty


def add_constraint(name, location, below, above):
    """A FIXED joint between two proxies, at the break line it stands for."""
    empty = bpy.data.objects.new(name, None)
    empty.empty_display_type = "PLAIN_AXES"
    empty.location = location
    bpy.context.collection.objects.link(empty)
    bpy.ops.object.select_all(action="DESELECT")
    empty.select_set(True)
    bpy.context.view_layer.objects.active = empty
    bpy.ops.rigidbody.constraint_add(type="FIXED")
    constraint = empty.rigid_body_constraint
    constraint.object1 = below
    constraint.object2 = above
    constraint.disable_collisions = True
    return empty


def key_constraint_open(empty, scene, frame):
    """Key the joint open at `frame`, so the next pass of the solver lets it go there."""
    empty.rigid_body_constraint.enabled = True
    empty.keyframe_insert("rigid_body_constraint.enabled", frame=scene.frame_start)
    empty.rigid_body_constraint.enabled = False
    empty.keyframe_insert("rigid_body_constraint.enabled", frame=frame)
    for curve in empty.animation_data.action.fcurves:
        for point in curve.keyframe_points:
            point.interpolation = "CONSTANT"


# --- Running it --------------------------------------------------------------------------------------


def sample_poses(scene, proxies, frames):
    """Step the rigid body world and read the evaluated pose of every proxy, per frame.

    Returns one dict per frame, piece id -> (Vector, Quaternion), copied out of the depsgraph.
    """
    start = scene.frame_start
    scene.frame_set(start)
    samples = []
    for offset in range(frames):
        scene.frame_set(start + offset)
        graph = bpy.context.evaluated_depsgraph_get()
        pose = {}
        for piece, proxy in proxies.items():
            matrix = proxy.evaluated_get(graph).matrix_world
            pose[piece] = (matrix.to_translation(), matrix.to_quaternion())
        samples.append(pose)
    return samples


def replay_matches(scene, proxies, frames, samples):
    """Run the very same scene again and compare it sample for sample.

    Bullet is deterministic for a fixed setup, single threaded, without randomness - but a setting
    that quietly breaks that (a threaded solver, a sleeping body woken by timing) would only show up
    as two clients disagreeing about where the wreck lies. Replaying here turns that into a failed
    generation run instead. Returns (True, None) or (False, (frame, piece)).
    """
    again = sample_poses(scene, proxies, frames)
    if len(again) != len(samples):
        return False, (min(len(again), len(samples)), None)
    for frame, (pose, other) in enumerate(zip(samples, again)):
        for piece in pose:
            location, rotation = pose[piece]
            other_location, other_rotation = other[piece]
            if tuple(location) != tuple(other_location) or tuple(rotation) != tuple(other_rotation):
                return False, (frame, piece)
    return True, None


def trim_to_rest(samples, pieces, fps):
    """Cut the clip once everything has held still for a second, and hold the last pose.

    Returns (frames, rest_frame, rest_piece): the trimmed clip, the last frame anything moved
    in and which piece that was.
    """
    moving, last = 0, None
    for frame in range(1, len(samples)):
        for piece in pieces:
            location, rotation = samples[frame][piece]
            previous_location, previous_rotation = samples[frame - 1][piece]
            if ((location - previous_location).length > REST_TRANSLATION
                    or tilt_of(rotation.rotation_difference(previous_rotation)) > REST_ROTATION):
                moving, last = frame, piece
                break
    end = min(len(samples), moving + REST_FRAMES + 1)
    frames = samples[:end]
    frames.extend([frames[-1]] * int(round(TAIL_SECONDS * fps)))
    return frames, moving, last


def dismantle(scene, objects):
    """Take the whole simulation back out. None of it may reach the exported file."""
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.ops.object.delete()
    if scene.rigidbody_world is not None:
        bpy.ops.rigidbody.world_remove()


def rest_pose():
    """The identity pose every clip opens on."""
    return Quaternion((1.0, 0.0, 0.0, 0.0))


def piece_steps(frames, piece):
    """(total turn, largest move per frame, largest turn per frame) of one piece over a clip."""
    swept = 0.0
    step_move, step_turn = 0.0, 0.0
    for frame in range(1, len(frames)):
        location, rotation = frames[frame][piece]
        previous_location, previous_rotation = frames[frame - 1][piece]
        move = (location - previous_location).length
        turn = tilt_of(rotation.rotation_difference(previous_rotation))
        swept += turn
        step_move = max(step_move, move)
        step_turn = max(step_turn, turn)
    return swept, step_move, step_turn
