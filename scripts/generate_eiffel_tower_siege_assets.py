#!/usr/bin/env python3
"""Generate the break scenes of the destructible Eiffel Tower, as one-shot collapse clips.

Run with Blender 4.2 LTS, after generate_eiffel_tower_assets.py:

    blender --background --python scripts/generate_eiffel_tower_siege_assets.py

The intact tower is not touched. Every piece of geometry in this pack is built by calling the
intact builders out of generate_eiffel_tower_assets, so the measurements can never disagree
between the standing tower and the one that comes down -- there is only one set of them. What this
file adds is motion: four scenes, one per destroyed segment, each a single one-shot clip in which
the part of the tower above the hit topples, shears apart at its galleries and lands. The one
static part here is the Champ-de-Mars again, widened, because the wreck lands past the edge of the
intact lawn.

Scene layout
------------
Each scene holds one rig empty per falling piece, named `piece_<id>`, with that piece's meshes
parented under it. The runtime derives a dynamic collider from every mesh an animation moves, so a
mesh the clip left standing still would keep a stale collider hanging in the air; that is why
*every* mesh in these files sits under a keyframed rig, including pieces that only ride along at
the start.

Frame 1 is the standing tower with no tilt at all. The map preset places a scene by the bounding
box of that rest pose and then turns the whole slot about its own footprint centre, which is how
one authored fall direction serves all four legs -- so a rest pose that already leaned would put
the tower back together crooked.

The fall is simulated, not hand-animated
----------------------------------------
Hand-keying a 330 m structure produces motion that reads as a prop falling over, and a hand-written
integrator produces motion that reads as whatever its author forgot -- the pass before this one
teleported pieces forty metres in a frame, clamped them exactly upright and stood a 159 m stub on
its foot 133 m from the axis, because its contact model was a height field rather than a solver.

So the collapse is run in Blender's own rigid body world (Bullet) and baked to one keyframe per
frame:

  * one active body per falling piece, a convex hull of the piece's own drawn silhouette, with the
    mass the taper model gives it,
  * the ground and -- for a scene that breaks off part way up -- the tower still standing below the
    break as passive bodies, so a piece lands *on* the tower instead of inside it,
  * `FIXED` constraints at the first gallery, the second gallery and the top platform, disabled at
    the frame the bending moment there passes the joint's capacity,
  * twelve substeps and twenty-four solver iterations per frame, single threaded, no randomness.

Bullet is deterministic here: two runs of the same scene produce bit-identical samples, which is
checked in `simulate` itself by replaying the last pass.

Where the collapse starts, and why nothing is pushed
----------------------------------------------------
Nothing is given an initial velocity, and nothing is given an impulse. Every scene starts from the
standing tower at rest and the only force is gravity; what makes it move is that the hit has taken
a bite out of what the tower stands on. Three cuts, all the same cut, all on the struck side:

  * the foot of the lowest falling piece. In 20_topple_lower that is the north-east pier and the
    first sixteen metres of that leg, pulverised, so the hull has no support in that corner and the
    three feet that are left carry the centre of mass outside their own triangle. The tower sags
    north-east, and the sag stops dead when the crushed corner has ground in as far as it can.
  * the seat under every joint. A rocket that takes out the north-east mid leg takes the corner of
    the gallery it is bolted to with it, so what is left under the upper tower is the south-west
    half of that seat. The same cut is made at the top of every piece and at the top of the tower
    left standing, which is why a stack that shears at a gallery does not then stand neatly on the
    stump below it -- and why the foot of a landed piece is a torn face rather than a flat foot.
  * the flank of the tower left standing, for `FLANK_CUT` metres below the break. A tapering tower
    is wider than the piece standing on it, so a piece tipping off a gallery meets iron two metres
    into the turn and wedges there; what a collapsing stack actually does to the iron its own base
    swings through is demolish it.

Each cut is made `SEAT_CUT` metres past the tower axis rather than exactly on it. On the axis the
centre of mass would sit precisely over the edge of what is left -- neutral, and then the direction
of the fall would be decided by rounding rather than by the model. Six metres is about half a leg
width, and it is the one authored number in the collapse.

Sideways travel is held in the plane of the fall. The map turns the whole slot about the tower's
own axis, so the heading is authored rather than simulated, and the preset states it -- but a
convex hull's triangulation is not mirror symmetric and a tumbling piece drifts a few degrees off
every bounce. Turning stays free in all three axes; only the drift is taken out.

Because the tower is modelled at true scale the result is slow: tens of seconds from the first
movement to the last piece coming to rest. That is what a structure this size actually does, and it
is the reason the collapse has to be a one-shot clip rather than a beat-aligned loop.
"""

import sys
from math import degrees, hypot, pi, radians, sin, sqrt
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Quaternion, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))

import generate_eiffel_tower_assets as et  # noqa: E402  (needs the path above)


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "assets" / "maps" / "eiffel_tower_siege" / "blender"
GLB_DIR = ROOT / "assets" / "maps" / "eiffel_tower_siege" / "glb"

# The generator this pack is derived from. scripts/generate_map_assets.py redirects the base
# module's ROOT/SOURCE_DIR/GLB_DIR through this attribute when it is given an --output-dir.
BASE = et

# The intact tower ships without vertex colours -- its grain comes out neutral after the occlusion
# bake and is pruned on the way to the file. These scenes stand in for those exact parts at the
# moment a segment is destroyed, so they have to match: iron that suddenly turned mottled as the
# scene appeared would read as a bug rather than as damage. It also takes about half a megabyte of
# COLOR_0 off the pack.
et.GRAIN = False

FPS = et.FPS

# --- The falling pieces ---------------------------------------------------------------------------
# The tower is cut where the real one changes section: at the first gallery, at the second gallery
# and at the top platform. Those three heights are the joints, and they are also the feet of the
# four pieces.
FIRST_JOINT = et.FIRST_DECK + 2.4     # 60.03 m, where the mid legs stand on the first gallery
SECOND_JOINT = et.SECOND_DECK + 2.2   # 117.93 m, where the upper shaft stands on the second one
TOP_JOINT = et.TOP_DECK               # 276.10 m, where the summit stands on the shaft

JOINT_NAMES = {FIRST_JOINT: "first_gallery", SECOND_JOINT: "second_gallery",
               TOP_JOINT: "top_platform"}

# (id, foot height, top of its mass range, builders out of the intact generator). The foot is both
# the piece's own origin -- its rig empty stands there -- and the joint that carries it.
PIECES = (
    ("lower", 0.0, FIRST_JOINT, (et.build_legs_lower, et.build_arches, et.build_first_floor)),
    ("mid", FIRST_JOINT, SECOND_JOINT, (et.build_legs_mid, et.build_second_floor)),
    ("shaft", SECOND_JOINT, TOP_JOINT, (et.build_shaft,)),
    ("summit", TOP_JOINT, et.TIP, (et.build_summit,)),
)
PIECE_ORDER = tuple(entry[0] for entry in PIECES)
PIECE_FOOT = {entry[0]: entry[1] for entry in PIECES}
PIECE_HEAD = {entry[0]: entry[2] for entry in PIECES}
PIECE_BUILDERS = {entry[0]: entry[3] for entry in PIECES}

# --- Physics constants ----------------------------------------------------------------------------
GRAVITY = 9.81                 # m/s^2, and the rigid body world's own gravity
SUBSTEPS = 12                  # Bullet substeps per frame: 360 integration steps a second
SOLVER_ITERATIONS = 24
FRICTION = 0.6                 # wrought iron on stone, and iron on iron
RESTITUTION = 0.05             # wreckage is about as bouncy as a sack of bricks
LINEAR_DAMPING = 0.05
ANGULAR_DAMPING = 0.1
# A guard, so a mistake in the setup cannot key ten minutes of debris shuffling.
SIM_MAX_SECONDS = 57.0
# What counts as standing still, per frame, and how long it has to hold before the clip is cut.
REST_TRANSLATION = 0.05        # m
REST_ROTATION = radians(0.5)
REST_FRAMES = 30
TAIL_SECONDS = 1.0             # still frames after the clip is cut, so it does not end on a jump

# How much of the struck legs is pulverised and stops carrying load, measured up from the ground.
# Only the pier and the cast shoes: everything above that still counts as iron under the tower.
CRUSH_BAND = 16.0
# How deep the shear face at a destroyed joint reaches: a gallery, its deck beams and the shoes of
# the legs bolted to it. It is both the seat a piece offers the one above and the foot the piece
# above is left standing on, so it is one number.
#
# It is also the one number that decides how far the torn end of a landed piece hangs below the
# ground it is lying on. The proxy that is simulated is a convex hull, and the cut takes the
# struck corner out of it while the drawn iron stays where the intact builders put it -- so a piece
# resting on its shear face has that corner under the lawn, by about the depth of the band. Four
# metres buries less (five to nine, against nine to thirteen) but it also flattens the face a piece
# comes to rest on, and at four the mid section of 20_topple_lower settles eight degrees off
# upright, which is the pose this whole rework exists to get rid of.
SEAT_BAND = 8.0
# How far below the break the struck quarter of the tower that is left standing is gone. The
# collapsing stack demolishes the iron its own base swings through, and this is how far down that
# reaches: a piece pivoting on the north-east edge of its seat has its base corner forty-odd metres
# lower by the time it has turned far enough to be past saving. Below that the tower still stands,
# which is what stops debris dropping down the side of it and coming to rest between the legs.
FLANK_CUT = 45.0
# How far past the tower axis the destroyed seat and the crushed corner are cut back, along the
# fall. See the module docstring: on the axis the fall direction would be decided by rounding.
SEAT_CUT = 6.0
# Height band the proxy silhouette is sampled with. Fine enough to follow the taper, coarse enough
# that a hull stays a few dozen vertices.
PROXY_BAND = 4.0

# Mass of the wrought iron alone, in tonnes; the historical figure for the structure.
LATTICE_TONNES = 7300.0
# Floors, galleries and the summit buildings are not lattice and do not follow its taper, so they
# are carried as lumps at their own height: (height in m, tonnes).
DECK_LUMPS = (
    (et.FIRST_DECK + 1.0, 900.0),    # the first gallery ring and its four pavilions
    (et.SECOND_DECK + 1.0, 400.0),   # the second gallery and the restaurant
    (et.TOP_DECK + 9.0, 220.0),      # top platform, glazed level, cupola, mast and antenna
)
MASS_SLICE = 0.5  # m, the step the lattice mass is integrated with

# Bending capacity of a joint, in kN*m per cubic metre of `spread^2 * post_thickness`. This is the
# one tuned number in the file and it is not a material property: the joints in these scenes are
# already wrecked by the hit that started the collapse, and intact wrought iron would not shear
# under a topple this slow.
JOINT_STRENGTH = 1100.0
# A joint is never called broken inside the first second, nor before the stack below it has really
# started to turn. The solver spends the opening frames settling eight thousand tonnes into its
# contacts, and the accelerations that takes are a numerical transient rather than a bending moment
# -- read as one they shear every joint in the tower before anything has moved, and the upper tower
# then drops straight down and lands on its feet.
JOINT_SETTLE_FRAMES = 30
JOINT_MIN_TILT = radians(1.0)
# The measured turn is differentiated twice to get the acceleration the moment formula needs, so it
# is smoothed over this many frames first. Raw second differences of a contact solver are noise.
MOMENT_SMOOTHING = 5

# --- The fall frame -------------------------------------------------------------------------------
# `u` runs along the fall direction, the tower's north-east diagonal. A cut that has to be square to
# the fall is expressed in it.
ROOT2 = sqrt(2.0)


def fall_reach(x, y):
    """How far a point stands along the fall, in metres from the tower axis."""
    return (x + y) / ROOT2


def tilt_of(rotation):
    """A quaternion's turn, folded into 0..180 degrees."""
    angle = rotation.angle % (2.0 * pi)
    return angle if angle <= pi else 2.0 * pi - angle


# --- Mass model -----------------------------------------------------------------------------------
# The lattice is four legs of four uprights, braced in every bay. How much iron that is per metre of
# height follows the two taper tables the geometry is drawn from: the members get shorter as the legs
# draw in (spread) and thinner as the load above them falls away (post_thickness). So the iron
# carried at one height is taken as spread * post_thickness, in m^2, and the density below is
# whatever turns the integral of that over the whole tower into 7300 t.


def lattice_section(height):
    """Iron cross-section carried at one height, in m^2."""
    return et.spread(height) * et.post_thickness(height)


def lattice_density():
    """Tonnes per m^3 of `spread * post_thickness`, fixed by the tower's known mass."""
    steps = int(et.TIP / MASS_SLICE)
    volume = sum(lattice_section((index + 0.5) * MASS_SLICE) * MASS_SLICE for index in range(steps))
    return LATTICE_TONNES / volume


LATTICE_DENSITY = lattice_density()


def mass_slices(low, high):
    """The tower between two heights as (height, tonnes) samples, plus any deck lumps in range."""
    steps = max(1, int(round((high - low) / MASS_SLICE)))
    step = (high - low) / steps
    slices = [
        (low + step * (index + 0.5), lattice_section(low + step * (index + 0.5)) * step
         * LATTICE_DENSITY)
        for index in range(steps)
    ]
    slices.extend((height, tonnes) for height, tonnes in DECK_LUMPS if low <= height < high)
    return slices


_SLICE_CACHE = {}


def piece_slices(piece_id):
    if piece_id not in _SLICE_CACHE:
        _SLICE_CACHE[piece_id] = mass_slices(PIECE_FOOT[piece_id], PIECE_HEAD[piece_id])
    return _SLICE_CACHE[piece_id]


def total_mass(slices):
    return sum(tonnes for _height, tonnes in slices)


def centre_of_mass(slices):
    """Height of the centre of mass. The tower is symmetric, so it sits on the axis."""
    mass = total_mass(slices)
    return sum(height * tonnes for height, tonnes in slices) / mass if mass else 0.0


def joint_capacity(height):
    """Bending moment one joint carries before it shears, in kN*m.

    A lattice section resists bending through its corner chords, so its strength grows with the
    square of how far apart they stand and with how much metal is in them: spread^2 times
    post_thickness. At the second gallery that is 180 m^3 of section, at the top platform 13.
    """
    return JOINT_STRENGTH * et.spread(height) ** 2 * et.post_thickness(height)


# --- Geometry --------------------------------------------------------------------------------------


class PieceCanvas(et.Canvas):
    """An intact-tower canvas whose vertices come out relative to the piece's own foot.

    The rig empty stands at the foot and the meshes hang under it, so the mesh data has to be in the
    rig's frame or the piece would be drawn one foot height too high.
    """

    def __init__(self, origin_height):
        super().__init__()
        self.shift = Matrix.Translation(Vector((0.0, 0.0, -origin_height)))

    def _add(self, material, decorative, verts, faces, matrix):
        super()._add(material, decorative, verts, faces, self.shift @ matrix)


_CANVAS_CACHE = {}


def piece_canvas(piece_id):
    """The piece's geometry, built once and reused by every scene that contains it."""
    if piece_id not in _CANVAS_CACHE:
        canvas = PieceCanvas(PIECE_FOOT[piece_id])
        for builder in PIECE_BUILDERS[piece_id]:
            builder(canvas)
        _CANVAS_CACHE[piece_id] = canvas
    return _CANVAS_CACHE[piece_id]


def canvas_vertices(canvas):
    for verts, _faces, _colors in canvas.buckets.values():
        yield from verts


def outline_profile(vertices, low, high):
    """(height, half width) rings of the square that contains the geometry between two heights.

    Measured off the drawn geometry rather than off the taper tables, so the proxy that is
    simulated is the shape the player sees: the summit's platform is wider than the shaft under it
    and the galleries stick out past the legs, neither of which a hand-written profile would have
    got right on its own.

    The clamp matters as much as the measurement. The tower's parts interleave -- the first
    gallery's pavilions stand 4 m up beside the mid legs, the restaurant on the second gallery
    stands beside the shaft -- so a proxy built from a piece's whole vertex list would start the
    scene already inside the piece above it, and a solver asked to separate two bodies that begin
    four metres inside each other throws them apart. Each proxy therefore owns exactly the height
    band between its own joints, and the iron that leans past that is drawn but not simulated.
    """
    bands = {}
    for x, y, z in vertices:
        if z < low - 1e-6 or z > high + 1e-6:
            continue
        index = int((z - low) // PROXY_BAND)
        half = max(abs(x), abs(y))
        if half > bands.get(index, 0.0):
            bands[index] = half
    rings = []
    for index in sorted(bands):
        bottom = min(high, low + index * PROXY_BAND)
        top = min(high, low + (index + 1) * PROXY_BAND)
        rings.append((bottom, bands[index]))
        if top > bottom:
            rings.append((top, bands[index]))
    return rings


def clipped_ring(half, offset):
    """The square of half-width `half`, cut off square to the fall `offset` metres past the axis.

    The corners of the square are not enough on their own: cutting a point cloud at u = -offset
    throws away the two side corners as well as the near one, because both of those sit at u = 0,
    and what is left is a sliver of one corner rather than half a gallery. The square is therefore
    clipped as a polygon, with the two points where the cut crosses its edges put back.
    """
    corners = [(-half, -half), (half, -half), (half, half), (-half, half)]
    kept = []
    for index, corner in enumerate(corners):
        following = corners[(index + 1) % 4]
        here, there = fall_reach(*corner), fall_reach(*following)
        if here <= -offset:
            kept.append(corner)
        if (here <= -offset) != (there <= -offset):
            ratio = (-offset - here) / (there - here)
            kept.append((corner[0] + (following[0] - corner[0]) * ratio,
                         corner[1] + (following[1] - corner[1]) * ratio))
    return kept


def profile_points(rings, cuts=()):
    """The silhouette as a point cloud, minus whatever the hit took out.

    `cuts` are (low, high, offset) triples in the same frame as the rings: between those two
    heights the ring is cut back to the far side of a line drawn `offset` metres past the tower
    axis, square to the fall, so the convex hull of what is left has no support there at all.
    """
    points = []
    for height, half in rings:
        offsets = [offset for low, high, offset in cuts if low <= height <= high]
        corners = (clipped_ring(half, max(offsets)) if offsets
                   else [(-half, -half), (half, -half), (half, half), (-half, half)])
        points.extend((x, y, height) for x, y in corners)
    return points


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
    points = [(sign_x * half_span, sign_y * half_span, height)
              for height in (low, high) for sign_x in (-1.0, 1.0) for sign_y in (-1.0, 1.0)]
    return hull_object(name, points)


def piece_profile(piece_id):
    """The falling piece's own silhouette, in the piece's frame.

    Cut off at the piece's own two joints, bottom included. The iron is drawn a little below the
    foot -- the ends of the splayed uprights overhang their own shoes by two thirds of a metre --
    and a proxy that kept it would start the scene that far inside the esplanade, which a solver
    answers by throwing eight thousand tonnes back out of the ground.
    """
    return outline_profile(canvas_vertices(piece_canvas(piece_id)), 0.0,
                           PIECE_HEAD[piece_id] - PIECE_FOOT[piece_id])


def standing_profile(piece_id, ceiling):
    """The same silhouette in world heights, capped at the break, for what is left standing."""
    foot = PIECE_FOOT[piece_id]
    vertices = [(x, y, z + foot) for x, y, z in canvas_vertices(piece_canvas(piece_id))]
    return outline_profile(vertices, foot, min(PIECE_HEAD[piece_id], ceiling))


# --- Rigid bodies -----------------------------------------------------------------------------------


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


def add_plane_lock(name, proxy, anchor):
    """Hold one proxy's travel in the fall plane. Its turning stays free.

    The map turns the whole slot about the tower's own axis, so the direction a scene falls in is
    authored rather than simulated. Left free, a piece does not keep to it: a convex hull's
    triangulation is not mirror symmetric, so a tumbling piece picks up a few degrees of drift off
    every bounce and the summit of 23_topple_summit came to rest thirty-two degrees off the
    diagonal it was authored on. The preset states one baked heading per scene and the contract
    test measures it off the file, so that drift is not cosmetic -- it is the map placing a
    collapse that lands somewhere else.

    Only the sideways *travel* is held. Locking the two out-of-plane rotations as well was tried
    first and Bullet threw the summit into orbit: a generic six-degree-of-freedom constraint
    resolves its angular limits through an Euler decomposition, which stops meaning anything once a
    body has turned past a right angle, and these bodies turn several times.
    """
    empty = bpy.data.objects.new(name, None)
    empty.empty_display_type = "PLAIN_AXES"
    empty.location = proxy.location
    # Local X along the fall, local Y along the hinge, local Z up.
    empty.rotation_euler = (0.0, 0.0, pi / 4.0)
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


def add_constraint(name, height, below, above):
    empty = bpy.data.objects.new(name, None)
    empty.empty_display_type = "PLAIN_AXES"
    empty.location = (0.0, 0.0, height)
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


# --- The collapse -------------------------------------------------------------------------------------


class Collapse:
    """One scene: the proxies, what they land on, and the frames that come out of it."""

    def __init__(self, scene, pieces):
        self.scene = scene
        self.pieces = tuple(pieces)
        self.hinge_height = PIECE_FOOT[self.pieces[0]]
        self.on_own_base = self.hinge_height <= 0.0
        self.standing = tuple(piece for piece in PIECE_ORDER if PIECE_FOOT[piece]
                              < self.hinge_height - 0.01)
        self.max_frames = int(SIM_MAX_SECONDS * FPS)
        self.simulation = []      # sim objects, deleted before anything is exported
        self.proxies = {}
        self.constraints = {}     # joint height -> constraint empty
        self.breaks = {}          # joint height -> frame it was disabled at
        self.passes = 0
        self.frames = []          # [{piece: (Vector, Quaternion)}]
        self.samples = []         # the last pass, untrimmed
        self.loads = []
        self.rest_frame = 0
        self.rest_piece = None
        self._build()

    # -- setting the scene up ------------------------------------------------------------------

    def _build(self):
        rigid_world(self.scene, self.max_frames)

        # A hull rather than a BOX: Blender's box shape is the object's bounding box centred on the
        # object's *origin*, so a slab drawn from -30 to 0 would collide from -15 to +15 and the
        # whole pack would come to rest fifteen metres in the air. Every shape here is therefore
        # built from the vertices themselves.
        ground = box_object("sim_ground", 420.0, -30.0, 0.0)
        add_body(ground, "PASSIVE", "CONVEX_HULL")
        self.simulation.append(ground)

        # The struck quarter of the tower that is left standing is not there, from the seat down as
        # far as the falling stack's own base swings. Cutting only the seat and leaving the flank
        # intact was tried first, and what it produced was a tower that leaned seven degrees onto
        # its own undamaged side and stopped there -- the flank of a tapering tower is wider than
        # the piece standing on it, so a piece tipping off a gallery meets iron two metres later and
        # wedges. Cutting the flank all the way down was tried next, and then the summit dropped
        # two hundred and seventy metres down the resulting shaft and landed between the legs.
        cuts = ((self.hinge_height - FLANK_CUT, self.hinge_height + 1.0, SEAT_CUT),)
        for piece in self.standing:
            body = hull_object(f"sim_standing_{piece}",
                               profile_points(standing_profile(piece, self.hinge_height), cuts))
            add_body(body, "PASSIVE", "CONVEX_HULL")
            self.simulation.append(body)

        for index, piece in enumerate(self.pieces):
            top = PIECE_HEAD[piece] - PIECE_FOOT[piece]
            # The foot of a falling piece is a shear face, not a foot. The joint under it has been
            # destroyed -- by the hit for the lowest piece of a scene, by the gallery tearing
            # through for the ones above -- and what is left of it is the south-west side, the same
            # cut the seat below gets. Leaving the base square is what let a 58 m stack come down
            # sixty metres and stand there: a flat foot under a centre of mass on the axis is a
            # stable pose, and a rigid body that finds one stays in it.
            cuts = [(0.0, CRUSH_BAND if self.on_own_base and index == 0 else SEAT_BAND, SEAT_CUT)]
            if index < len(self.pieces) - 1:
                # ...and the same cut at the top, so the piece above is never handed a level seat.
                cuts.append((top - SEAT_BAND, top + PROXY_BAND, SEAT_CUT))
            proxy = hull_object(f"sim_piece_{piece}", profile_points(piece_profile(piece), cuts),
                                location=(0.0, 0.0, PIECE_FOOT[piece]))
            add_body(proxy, "ACTIVE", "CONVEX_HULL", mass=total_mass(piece_slices(piece)))
            self.proxies[piece] = proxy
            self.simulation.append(proxy)
            self.simulation.append(add_plane_lock(f"sim_plane_{piece}", proxy, ground))

        for index in range(1, len(self.pieces)):
            height = PIECE_FOOT[self.pieces[index]]
            empty = add_constraint(f"sim_joint_{JOINT_NAMES[height]}", height,
                                   self.proxies[self.pieces[index - 1]],
                                   self.proxies[self.pieces[index]])
            self.constraints[height] = empty
            self.simulation.append(empty)

    # -- the joints ---------------------------------------------------------------------------

    def joint_load(self, index):
        """Everything the joint under piece `index` has to carry, as rest-frame constants."""
        joint = PIECE_FOOT[self.pieces[index]]
        above = [sample for piece in self.pieces[index:] for sample in piece_slices(piece)]
        mass = total_mass(above)
        com = centre_of_mass(above)
        own = sum(tonnes * ((height - com) ** 2 + et.spread(height) ** 2) for height, tonnes in above)
        return (joint, mass, com - joint, com - self.hinge_height, own)

    def bending_moment(self, load, turns, frame):
        """The moment the joint carries at one frame, in kN*m.

        Take the part above a joint on its own. It has to be swung round with the rest, and the only
        thing that can swing it is the joint, so the joint carries whatever gravity does not:

            M = m * d * (alpha * R - g * sin(theta)) + I_com * alpha

        with d the distance from the joint up to that part's centre of mass, R the distance from the
        hinge to the same point, and I_com its own moment of inertia. The bracket is the whole story
        of why a falling tower comes apart at all: there is one radius at which gravity provides
        exactly the acceleration the motion needs, above it the structure lags and has to be pulled
        forward, below it the structure runs ahead and has to be held back, and both bend the joints
        in between.

        `turns` is the measured tilt of the piece below the joint, one sample per frame; alpha is
        its second difference, smoothed, because the raw second difference of a contact solver is
        noise rather than an acceleration.
        """
        _joint, mass, lever, radius, own = load
        half = MOMENT_SMOOTHING // 2
        if frame - 2 * half < 0 or frame + 2 * half >= len(turns):
            return 0.0

        def tilt(at):
            window = turns[max(0, at - half):at + half + 1]
            return sum(window) / len(window)

        step = half + 1
        acceleration = ((tilt(frame + step) - 2.0 * tilt(frame) + tilt(frame - step))
                        * FPS * FPS / (step * step))
        return (mass * lever * (acceleration * radius - GRAVITY * sin(tilt(frame)))
                + own * acceleration)

    def disable_at(self, height, frame):
        """Key the joint open at `frame`, so the next pass of the solver lets it go there."""
        empty = self.constraints[height]
        empty.rigid_body_constraint.enabled = True
        empty.keyframe_insert("rigid_body_constraint.enabled", frame=self.scene.frame_start)
        empty.rigid_body_constraint.enabled = False
        empty.keyframe_insert("rigid_body_constraint.enabled", frame=frame)
        for curve in empty.animation_data.action.fcurves:
            for point in curve.keyframe_points:
                point.interpolation = "CONSTANT"
        self.breaks[height] = frame

    # -- running it ---------------------------------------------------------------------------

    def simulate(self, frames):
        """Step the rigid body world and read the evaluated pose of every proxy, per frame."""
        self.passes += 1
        start = self.scene.frame_start
        self.scene.frame_set(start)
        samples = []
        for offset in range(frames):
            self.scene.frame_set(start + offset)
            graph = bpy.context.evaluated_depsgraph_get()
            pose = {}
            for piece, proxy in self.proxies.items():
                matrix = proxy.evaluated_get(graph).matrix_world
                pose[piece] = (matrix.to_translation(), matrix.to_quaternion())
            samples.append(pose)
        return samples

    def run(self):
        """Find the joint failures, then bake the pass that has all of them in it."""
        loads = [self.joint_load(index) for index in range(1, len(self.pieces))]
        samples = self.simulate(self.max_frames)
        for _attempt in range(len(loads)):
            found = self.first_failure(loads, samples)
            if found is None:
                break
            self.disable_at(*found)
            samples = self.simulate(self.max_frames)
        self.loads = loads
        self.samples = samples
        self.frames = self.trim(samples)
        return self.frames

    def joint_diagnostics(self):
        """One line per joint: what it carried, against what it could carry."""
        lines = []
        for index, load in enumerate(self.loads):
            joint = load[0]
            turns = [tilt_of(pose[self.pieces[index]][1]) for pose in self.samples]
            capacity = joint_capacity(joint)
            broken = self.breaks.get(joint)
            window = range(JOINT_SETTLE_FRAMES, broken + 1 if broken else len(self.samples))
            worst, at = 0.0, 0
            for frame in window:
                ratio = abs(self.bending_moment(load, turns, frame)) / capacity
                if ratio > worst:
                    worst, at = ratio, frame
            lines.append(
                f"joint {JOINT_NAMES[joint]} capacity={capacity / 1000.0:.0f}MN*m "
                f"peak={worst:.2f}x@frame{at} "
                + (f"sheared@frame{broken}/{degrees(turns[broken]):.1f}deg"
                   if broken else "held")
            )
        return lines

    def first_failure(self, loads, samples):
        """The earliest still-intact joint whose moment passes its capacity, and the frame."""
        earliest = None
        for index, load in enumerate(loads):
            joint = load[0]
            if joint in self.breaks:
                continue
            below = self.pieces[index]
            turns = [tilt_of(pose[below][1]) for pose in samples]
            capacity = joint_capacity(joint)
            for frame in range(JOINT_SETTLE_FRAMES, len(samples)):
                if turns[frame] < JOINT_MIN_TILT:
                    continue
                if abs(self.bending_moment(load, turns, frame)) > capacity:
                    if earliest is None or frame < earliest[1]:
                        earliest = (joint, frame)
                    break
        return earliest

    def trim(self, samples):
        """Cut the clip once everything has held still for a second, and hold the last pose."""
        moving, last = 0, None
        for frame in range(1, len(samples)):
            for piece in self.pieces:
                location, rotation = samples[frame][piece]
                previous_location, previous_rotation = samples[frame - 1][piece]
                if ((location - previous_location).length > REST_TRANSLATION
                        or tilt_of(rotation.rotation_difference(previous_rotation))
                        > REST_ROTATION):
                    moving, last = frame, piece
                    break
        self.rest_frame = moving
        self.rest_piece = last
        end = min(len(samples), moving + REST_FRAMES + 1)
        frames = samples[:end]
        frames.extend([frames[-1]] * int(round(TAIL_SECONDS * FPS)))
        return frames

    def dismantle(self):
        """Take the whole simulation back out. None of it may reach the exported file."""
        bpy.ops.object.select_all(action="DESELECT")
        for obj in self.simulation:
            obj.select_set(True)
        bpy.ops.object.delete()
        if self.scene.rigidbody_world is not None:
            bpy.ops.rigidbody.world_remove()
        self.proxies, self.constraints, self.simulation = {}, {}, []

    # -- measurements ------------------------------------------------------------------------------

    def pose_matrix(self, piece, frame):
        location, rotation = self.frames[frame][piece]
        return Matrix.Translation(location) @ rotation.to_matrix().to_4x4()

    def rest_vertices(self, piece):
        matrix = self.pose_matrix(piece, len(self.frames) - 1)
        for vertex in canvas_vertices(piece_canvas(piece)):
            yield matrix @ Vector(vertex)

    def reach(self):
        """How far the wreck ends up from the tower axis, in metres.

        Scenes 20 and 21 are only ever turned onto one of the four legs, so the map sees their
        footprint square on and the number it needs is the largest |x| or |y|. Scenes 22 and 23 are
        yawed freely by the shot that felled them, so theirs is the radius.
        """
        square = self.pieces[0] in ("lower", "mid")
        far = 0.0
        for piece in self.pieces:
            for point in self.rest_vertices(piece):
                far = max(far, max(abs(point.x), abs(point.y)) if square
                          else hypot(point.x, point.y))
        return far

    def report(self, stem, clip_name):
        last = len(self.frames) - 1
        shears = " ".join(
            f"{JOINT_NAMES[height]}@frame{frame}/"
            f"{degrees(tilt_of(self.frames[min(frame, last)][self.pieces[0]][1])):.1f}deg"
            for height, frame in sorted(self.breaks.items(), key=lambda entry: entry[1])
        ) or "none"
        print(
            f"collapse {stem} clip={clip_name} pieces={','.join(self.pieces)} "
            f"passes={self.passes} shears={shears} "
            f"rest_frame={self.rest_frame}/{self.rest_piece} frames={len(self.frames)} "
            f"duration={last / FPS:.2f}s reach={self.reach():.1f}m "
            f"overran={self.rest_frame >= self.max_frames - REST_FRAMES - 1}"
        )
        for piece in self.pieces:
            swept = 0.0
            step_move, step_turn = 0.0, 0.0
            for frame in range(1, len(self.frames)):
                location, rotation = self.frames[frame][piece]
                previous_location, previous_rotation = self.frames[frame - 1][piece]
                move = (location - previous_location).length
                turn = tilt_of(rotation.rotation_difference(previous_rotation))
                swept += turn
                step_move = max(step_move, move)
                step_turn = max(step_turn, turn)
            location, rotation = self.frames[-1][piece]
            lowest = min(point.z for point in self.rest_vertices(piece))
            print(
                f"  piece {stem} {piece} turned={degrees(swept):.0f}deg "
                f"tilt={degrees(tilt_of(rotation)):.1f}deg "
                f"max_step={step_move:.2f}m/{degrees(step_turn):.2f}deg "
                f"rest=(x={location.x:.1f} y={location.y:.1f} z={location.z:.1f}) "
                f"lowest={lowest:.2f}m"
            )
        for line in self.joint_diagnostics():
            print(f"  {stem} {line}")


# --- The ground the wreck lands on ------------------------------------------------------------------
# A toppling tower throws iron a long way from its axis and the intact lawn stops at 150 m, so on
# this map the last stretch of every collapse would settle over bare arena floor. The one static part
# in this pack is the same Champ-de-Mars with its lawn and its two long walks run out to 240 m, which
# covers the furthest piece with room to spare. Nothing else about it moves: the gravel square, the
# four piers and their lamps are placed off the tower above them, so the widened ground still lines
# up with the legs exactly as the intact one does.
#
# It replaces 01_champ_de_mars on the siege map rather than joining it -- two lawns at the same
# height would fight over every pixel of the ground.
WIDE_ESPLANADE_HALF = 240.0


def build_wide_esplanade(canvas):
    return et.build_esplanade(canvas, half_span=WIDE_ESPLANADE_HALF)


ARCHITECTURE = (
    ("01_champ_de_mars_wide", build_wide_esplanade),
)


# --- Scene definitions ----------------------------------------------------------------------------
# (file stem, clip name, pieces bottom to top). Which tower is left standing under a scene follows
# from the foot of its lowest piece, so it is not stated twice.
SCENES = (
    # A lower leg is destroyed and the tower goes over its own base. Nothing is left standing.
    ("20_topple_lower", "ToppleLowerOnce", ("lower", "mid", "shaft", "summit")),
    # A mid leg goes, and everything above the first gallery topples off it.
    ("21_topple_mid", "ToppleMidOnce", ("mid", "shaft", "summit")),
    # The shaft goes, and takes the summit with it off the second gallery.
    ("22_topple_shaft", "ToppleShaftOnce", ("shaft", "summit")),
    # Only the summit comes down, off the top platform.
    ("23_topple_summit", "ToppleSummitOnce", ("summit",)),
)


def build_scene(stem, clip_name):
    """The builder handed to the shared exporter: simulate, bake, then draw the pieces."""

    def builder(scene, _mats):
        _stem, _clip, pieces = next(entry for entry in SCENES if entry[0] == stem)
        # The exporter is handed a placeholder range; the collapse decides how long it takes, and
        # that is not known until it has been run.
        scene.frame_end = scene.frame_start + int(SIM_MAX_SECONDS * FPS) - 1
        collapse = Collapse(scene, pieces)
        frames = collapse.run()
        collapse.dismantle()
        scene.frame_end = scene.frame_start + len(frames) - 1
        scene["loop_duration_seconds"] = (len(frames) - 1) / FPS

        # A note on what comes out of the exporter here. Each scene carries a few extra animation
        # channels it does not need: a constant translation on each mesh under `piece_summit`. They
        # are not a mistake in the rig -- those meshes sit at the origin of their rig and never move
        # relative to it. The exporter samples every object's local transform, and that local is
        # recovered by inverting the rig's own matrix; at the summit's 276.1 m the round trip leaves
        # about 6e-5 m of float residue, which is enough that the pass which drops constant channels
        # does not recognise them as constant. The values are zero to within a tenth of a
        # millimetre, so they change nothing at runtime.
        rigs = {}
        for piece in pieces:
            rig = et.rig(f"piece_{piece}", (0.0, 0.0, PIECE_FOOT[piece]))
            rig.rotation_mode = "QUATERNION"
            piece_canvas(piece).emit(f"piece_{piece}", parent=rig)
            rigs[piece] = rig

        for index, frame in enumerate(frames):
            at = scene.frame_start + index
            for piece, (location, rotation) in frame.items():
                rig = rigs[piece]
                # Frame 1 is the standing tower, exactly: the solver leaves the rest pose alone to
                # well inside a millimetre, but the preset places the scene off this pose and the
                # contract test measures it, so it is written rather than sampled.
                if index == 0:
                    location = Vector((0.0, 0.0, PIECE_FOOT[piece]))
                    rotation = Quaternion((1.0, 0.0, 0.0, 0.0))
                rig.location = location
                rig.keyframe_insert("location", frame=at)
                rig.rotation_quaternion = rotation
                rig.keyframe_insert("rotation_quaternion", frame=at)

        collapse.report(stem, clip_name)

    return builder


# The duration is a placeholder: the builder above sets the real frame range once it has simulated
# the collapse. Keeping it here would mean simulating every scene just to import the module.
SETPIECES = tuple(
    (stem, clip, 0, build_scene(stem, clip))
    for stem, clip, _pieces in SCENES
)


def main():
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    GLB_DIR.mkdir(parents=True, exist_ok=True)
    # Point the shared exporter at this pack's directories, so the glTF flags -- Y-up, applied
    # modifiers, one scene-named clip -- stay identical to the intact set.
    et.SOURCE_DIR = SOURCE_DIR
    et.GLB_DIR = GLB_DIR
    for part in ARCHITECTURE:
        et.export_part(*part)
    for setpiece in SETPIECES:
        et.export_setpiece(*setpiece)


if __name__ == "__main__":
    main()
