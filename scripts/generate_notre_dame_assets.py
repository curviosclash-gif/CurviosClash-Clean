#!/usr/bin/env python3
"""Generate the Notre-Dame cathedral map assets.

Run with Blender 4.2 LTS:

    blender --background --python scripts/generate_notre_dame_assets.py

Unlike the three machine maps this one reproduces a real building, so the geometry is driven by
measurements rather than by a movement rule. Everything is modelled in metres at the documented
proportions of Notre-Dame de Paris -- 127.5 m long, 48 m across the transept, towers at 69 m,
nave vault at 33 m, spire tip at 96 m -- and the map preset scales the whole set uniformly. That
is why every part is built in one shared cathedral coordinate system instead of around its own
origin: X runs west (negative) to east (positive), Y runs north/south, Z is height above the
floor. The exporter prints each part's bounding box so the preset can place them back together.

The building itself is public domain; every mesh here is authored from primitives, nothing is
downloaded or scanned.

Two budgets apply. The static architecture below may spend up to 18000 triangles per part,
because tracery, the gallery of kings and the buttress work are what make the building
recognisable. The animated reconstruction-site pieces (added in the second stage) stay at the
6000 the other maps use, since those are the meshes the collision system has to track per frame.

Collision follows the same rule as the other GLB maps: with the map running in glbColliderMode
'dynamic' only meshes an animation moves get a collider, so the cathedral shell carries its
collision through the preset's authored boxes and hollow tunnel corridors. Decorative meshes
still carry the _nocol suffix so they stay excluded even if that mode ever changes.
"""

from math import asin, atan2, cos, hypot, pi, radians, sin
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "assets" / "maps" / "notre_dame" / "blender"
GLB_DIR = ROOT / "assets" / "maps" / "notre_dame" / "glb"
FPS = 30

# Measurements in metres, all taken along the cathedral axis: X west to east, Y north/south,
# Z upward from the floor. Zero sits in the middle of the building, not at the west front.
LENGTH = 127.5
WEST_FRONT_X = -LENGTH / 2          # -63.75, outer face of the west facade
FACADE_DEPTH = 9.0
NAVE_START_X = WEST_FRONT_X + FACADE_DEPTH
NAVE_BAYS = 10
BAY_LENGTH = 6.0
NAVE_END_X = NAVE_START_X + NAVE_BAYS * BAY_LENGTH   # +5.25
CROSSING_LENGTH = 14.0
CROSSING_CENTER_X = NAVE_END_X + CROSSING_LENGTH / 2  # +12.25
CHOIR_START_X = NAVE_END_X + CROSSING_LENGTH          # +19.25
CHOIR_BAYS = 5
CHOIR_END_X = CHOIR_START_X + CHOIR_BAYS * BAY_LENGTH  # +49.25
APSE_RADIUS = LENGTH / 2 - CHOIR_END_X                 # 14.5

NAVE_HALF_WIDTH = 6.25              # central vessel, 12.5 m clear
AISLE_INNER = 12.0                  # first aisle wall
AISLE_OUTER = 20.0                  # outer wall of the double aisles, 40 m overall
TRANSEPT_HALF = 24.0                # 48 m across the transept
CLERESTORY_HALF = 8.5               # outer face of the central vessel wall

AISLE_VAULT_Z = 10.0
ARCADE_TOP_Z = 15.0
TRIFORIUM_TOP_Z = 20.0
CLERESTORY_TOP_Z = 30.0
NAVE_VAULT_Z = 33.0
ROOF_RIDGE_Z = 45.0
TOWER_TOP_Z = 69.0
SPIRE_TIP_Z = 96.0

# The west block is 9 m deep overall, but the wall *plane* inside it is only about two metres
# thick. Modelling the whole block as solid buried the rose, the kings and the tower lights
# inside the masonry, so the wall panels start here and the carved detail sits in front of them.
FACADE_WALL_FRONT = 2.0             # wall face, measured back from the outer building line
FACADE_WALL_THICKNESS = 2.2
FACADE_DETAIL_X = 0.9               # carved detail sits this far back from the building line
CHAPEL_DEPTH = 3.0                  # radiating chapels project this far past the ambulatory
BUTTRESS_OFFSET = 3.0               # pier standing this far outside the aisle wall
WEST_ROSE_RADIUS = 4.8              # 9.6 m across
TRANSEPT_ROSE_RADIUS = 6.55         # 13.1 m across
TOWER_HALF_WIDTH = 7.0
TOWER_CENTER_Y = 14.5

# Lutetian limestone, lead roofing, oak framing, stained glass. Nothing here is chrome; the
# building reads through its silhouette and through the coloured light of the three roses.
LIMESTONE = (0.74, 0.70, 0.60, 1.0)
LIMESTONE_SHADED = (0.52, 0.48, 0.41, 1.0)
LIMESTONE_DARK = (0.36, 0.33, 0.29, 1.0)
LEAD = (0.35, 0.37, 0.39, 1.0)
OAK = (0.27, 0.17, 0.09, 1.0)
COPPER_AGED = (0.24, 0.47, 0.42, 1.0)
GOLD = (0.86, 0.68, 0.26, 1.0)
GLASS_BLUE = (0.11, 0.19, 0.62, 1.0)
GLASS_RED = (0.64, 0.13, 0.15, 1.0)
GLASS_WARM = (0.92, 0.72, 0.38, 1.0)
SLATE = (0.20, 0.21, 0.24, 1.0)
FOLIAGE = (0.17, 0.31, 0.13, 1.0)
WATER = (0.15, 0.26, 0.31, 1.0)


def reset_scene(name):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = name
    scene.render.fps = FPS
    scene.frame_start = 1
    scene.frame_end = 1
    scene["setpiece"] = name
    bpy.context.preferences.edit.keyframe_new_interpolation_type = "LINEAR"
    bpy.context.preferences.filepaths.save_version = 0
    return scene


def material(name, color, emission_strength=0.0, metallic=0.0, roughness=0.68):
    value = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    value.diffuse_color = color
    value.use_nodes = True
    shader = value.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = color
    metallic_input = shader.inputs.get("Metallic IOR Level") or shader.inputs.get("Metallic")
    if metallic_input:
        metallic_input.default_value = metallic
    shader.inputs["Roughness"].default_value = roughness
    if emission_strength > 0:
        shader.inputs["Emission Color"].default_value = color
        shader.inputs["Emission Strength"].default_value = emission_strength
    return value


def build_materials():
    return {
        "stone": material("NDStone", LIMESTONE, roughness=0.82),
        "stone_shaded": material("NDStoneShaded", LIMESTONE_SHADED, roughness=0.86),
        "stone_dark": material("NDStoneDark", LIMESTONE_DARK, roughness=0.9),
        "lead": material("NDLead", LEAD, metallic=0.35, roughness=0.55),
        "oak": material("NDOak", OAK, roughness=0.88),
        "copper": material("NDCopper", COPPER_AGED, metallic=0.4, roughness=0.6),
        "gold": material("NDGold", GOLD, 1.2, 0.85, 0.28),
        "glass_blue": material("NDGlassBlue", GLASS_BLUE, 2.6, 0.0, 0.14),
        "glass_red": material("NDGlassRed", GLASS_RED, 2.4, 0.0, 0.14),
        "glass_warm": material("NDGlassWarm", GLASS_WARM, 2.0, 0.0, 0.16),
        "slate": material("NDSlate", SLATE, roughness=0.78),
        "foliage": material("NDFoliage", FOLIAGE, roughness=0.92),
        "water": material("NDWater", WATER, metallic=0.2, roughness=0.22),
    }


def finish_mesh(obj, name, mat):
    obj.name = name
    obj.data.name = f"{name}_mesh"
    obj.data.materials.append(mat)
    return obj


def cube(name, location, scale, mat, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = finish_mesh(bpy.context.object, name, mat)
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return obj


def cylinder(name, location, radius, depth, mat, vertices=10, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation
    )
    return finish_mesh(bpy.context.object, name, mat)


def cone(name, location, radius1, radius2, depth, mat, vertices=8, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices,
        radius1=radius1,
        radius2=radius2,
        depth=depth,
        location=location,
        rotation=rotation,
    )
    return finish_mesh(bpy.context.object, name, mat)


def sphere(name, location, scale, mat, segments=8, rings=4):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=location)
    obj = finish_mesh(bpy.context.object, name, mat)
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return obj


def torus(name, location, major_radius, minor_radius, mat, rotation=(0, 0, 0), major_segments=16):
    """Tori cost major * minor * 2 triangles, so every call here keeps both counts low."""
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=major_segments,
        minor_segments=4,
        location=location,
        rotation=rotation,
    )
    return finish_mesh(bpy.context.object, name, mat)


# --- Gothic building blocks -------------------------------------------------------------------
# The shapes below are what make the silhouette read as a cathedral rather than as a box with
# holes. Each one is a chain of straight segments, so the triangle cost stays predictable: an
# arch of n steps costs n * 12 triangles and nothing more.


def _segment(name, mat, *, start, end, width, thickness, plane):
    """One straight member between two points, oriented along the line that joins them.

    Every arch here is a chain of these. `plane` says which plane the chain is drawn in — "xz"
    for arches seen from the side (nave arcades, flying buttresses), "yz" for arches seen head
    on (portals in a west or gable wall). Getting this orientation right is the whole job: a
    voussoir that stays axis-aligned turns a gothic arch back into a staircase of blocks.
    """
    across = end[0] - start[0] if plane == "xz" else end[1] - start[1]
    up = end[2] - start[2]
    length = hypot(across, up)
    if length < 1e-4:
        return None
    center = (
        (start[0] + end[0]) / 2,
        (start[1] + end[1]) / 2,
        (start[2] + end[2]) / 2,
    )
    if plane == "xz":
        # The cube is long along its local X. A rotation of theta about Y maps local X to
        # (cos theta, 0, -sin theta), so theta = -atan2(up, across) points it along the segment.
        return cube(name, center, (length / 2, width / 2, thickness / 2), mat,
                    rotation=(0, -atan2(up, across), 0))
    # Long along local Y instead; a rotation of phi about X maps local Y to (0, cos phi, sin phi).
    return cube(name, center, (thickness / 2, length / 2, width / 2), mat,
                rotation=(atan2(up, across), 0, 0))


def _arch_points(span, rise, steps):
    """Sample points of one half of a two-centred gothic arch, from springing to apex.

    The horizontal travel falls off as the square of the climb, which is what produces the
    pointed outline instead of a semicircle.
    """
    half = span / 2
    return [
        (half * (1 - (step / steps) ** 2), rise * (step / steps))
        for step in range(steps + 1)
    ]


def pointed_arch(name, mat, *, center, span, rise, depth, steps=6, thickness=0.55, axis="y"):
    """A two-centred gothic arch. `center` is the springing point in the middle of the opening,
    `span` the clear width, `rise` the height from springing to apex. `axis` names the normal of
    the plane the arch stands in, so the same helper serves nave arcades and west portals.
    """
    plane = "xz" if axis == "y" else "yz"
    points = _arch_points(span, rise, steps)
    pieces = []
    for side in (-1, 1):
        for step in range(steps):
            (across0, up0), (across1, up1) = points[step], points[step + 1]
            if plane == "xz":
                start = (center[0] + side * across0, center[1], center[2] + up0)
                end = (center[0] + side * across1, center[1], center[2] + up1)
            else:
                start = (center[0], center[1] + side * across0, center[2] + up0)
                end = (center[0], center[1] + side * across1, center[2] + up1)
            piece = _segment(f"{name}_v{'p' if side > 0 else 'm'}{step}", mat,
                             start=start, end=end, width=depth, thickness=thickness, plane=plane)
            if piece:
                pieces.append(piece)
    return pieces


def flying_arch(name, mat, *, springing, landing, steps=6, thickness=0.6, width=0.9, lift=0.35):
    """A flying buttress: an arc that leaps from the pier head up to the clerestory wall.

    Straight beams were what the first draft used, and they read as scaffolding rather than as
    masonry. The real thing rises on a circular curve, so the chain below bulges upward by
    `lift` times its span at the crown and lands tangentially against the wall.
    """
    across_total = landing[1] - springing[1]
    up_total = landing[2] - springing[2]
    points = []
    for step in range(steps + 1):
        t = step / steps
        # Straight line plus a sine bulge: zero at both ends, maximum in the middle.
        points.append((
            springing[0],
            springing[1] + across_total * t,
            springing[2] + up_total * t + sin(t * pi) * abs(across_total) * lift,
        ))
    pieces = []
    for step in range(steps):
        piece = _segment(f"{name}_{step}", mat, start=points[step], end=points[step + 1],
                         width=width, thickness=thickness, plane="yz")
        if piece:
            pieces.append(piece)
    return pieces


def rose_window(name, mat_frame, mat_glass, *, center, radius, spokes=12, axis="x"):
    """A rose window: two concentric rings, radial mullions in two tiers, and a glazed disc.

    The tracery is the whole character of a rose -- a plain ring with spokes reads as a wheel, so
    the outer tier is doubled and the ring of foils between the spokes is what the eye picks up
    from a distance. The glass is emissive so the window carries colour inward the way the real
    ones do, and every piece is _nocol because a rose must never block a flight path.
    """
    plane_rotation = (0, pi / 2, 0) if axis == "x" else (pi / 2, 0, 0)
    torus(f"{name}_ring_nocol", center, radius, radius * 0.07, mat_frame, plane_rotation, 20)
    torus(f"{name}_mid_ring_nocol", center, radius * 0.62, radius * 0.045, mat_frame,
          plane_rotation, 16)
    torus(f"{name}_hub_ring_nocol", center, radius * 0.26, radius * 0.05, mat_frame,
          plane_rotation, 12)

    def place(offset_a, offset_b):
        if axis == "x":
            return (center[0], center[1] + offset_a, center[2] + offset_b)
        return (center[0] + offset_a, center[1], center[2] + offset_b)

    # Inner tier of mullions runs from hub to middle ring, the outer tier doubles up beyond it.
    for tier, (inner, outer, count) in enumerate(
        ((0.26, 0.62, spokes // 2), (0.62, 1.0, spokes))
    ):
        for index in range(count):
            angle = index * (2 * pi / count) + (0 if tier else pi / count)
            span = radius * (outer - inner) / 2
            mid = radius * (inner + outer) / 2
            location = place(cos(angle) * mid, sin(angle) * mid)
            scale = ((0.14, span, 0.1) if axis == "x" else (span, 0.14, 0.1))
            rotation = ((angle, 0, 0) if axis == "x" else (0, -angle, 0))
            cube(f"{name}_mullion_{tier}_{index}_nocol", location, scale, mat_frame,
                 rotation=rotation)

    # Foils: the small circles set between the outer spokes.
    for index in range(spokes):
        angle = (index + 0.5) * (2 * pi / spokes)
        cylinder(
            f"{name}_foil_{index}_nocol",
            place(cos(angle) * radius * 0.79, sin(angle) * radius * 0.79),
            radius * 0.1, 0.09, mat_frame, 6, plane_rotation,
        )

    cylinder(f"{name}_glass_nocol", center, radius * 0.94, 0.12, mat_glass, 20, plane_rotation)


def lancet_window(name, mat_glass, *, center, width, height, depth=0.22, axis="x"):
    """A tall pointed window: a rectangle with a small arch of glass on top."""
    if axis == "x":
        cube(f"{name}_pane_nocol", center, (depth / 2, width / 2, height / 2), mat_glass)
        cone(
            f"{name}_head_nocol",
            (center[0], center[1], center[2] + height / 2 + width * 0.35),
            width / 2,
            0.0,
            width * 0.7,
            mat_glass,
            vertices=6,
        )
    else:
        cube(f"{name}_pane_nocol", center, (width / 2, depth / 2, height / 2), mat_glass)
        cone(
            f"{name}_head_nocol",
            (center[0], center[1], center[2] + height / 2 + width * 0.35),
            width / 2,
            0.0,
            width * 0.7,
            mat_glass,
            vertices=6,
        )


def pinnacle(name, mat, *, base, height, width):
    """A finial: tapered shaft with a crocketed cap. Used on buttress piers and tower corners."""
    cube(f"{name}_shaft_nocol", (base[0], base[1], base[2] + height * 0.3),
         (width / 2, width / 2, height * 0.3), mat)
    cone(f"{name}_cap_nocol", (base[0], base[1], base[2] + height * 0.78),
         width * 0.62, 0.0, height * 0.55, mat, vertices=6)


def statue(name, mat, *, base, height, facing=0.0):
    """A standing figure reduced to three primitives. Twenty-eight of these form the gallery of
    kings, so the cost per figure decides whether the facade fits its budget: 4 + 12 + 48 tris."""
    cylinder(f"{name}_body_nocol", (base[0], base[1], base[2] + height * 0.42),
             height * 0.13, height * 0.84, mat, vertices=6, rotation=(0, 0, facing))
    sphere(f"{name}_head_nocol", (base[0], base[1], base[2] + height * 0.92),
           (height * 0.1, height * 0.1, height * 0.12), mat, 6, 4)
    cube(f"{name}_plinth_nocol", (base[0], base[1], base[2] - height * 0.05),
         (height * 0.16, height * 0.16, height * 0.06), mat)


def _strut(name, mat, *, start, end, thickness, mat_scale=1.0):
    """A bar between two arbitrary points in space. Blender applies XYZ euler as Rz*Ry*Rx, so a
    bar long along its local X points along (cos a cos b, sin a cos b, -sin b) -- solving that
    for the direction gives the two angles below."""
    dx, dy, dz = end[0] - start[0], end[1] - start[1], end[2] - start[2]
    length = hypot(hypot(dx, dy), dz)
    if length < 1e-4:
        return None
    return cube(
        name,
        ((start[0] + end[0]) / 2, (start[1] + end[1]) / 2, (start[2] + end[2]) / 2),
        (length / 2, thickness / 2 * mat_scale, thickness / 2 * mat_scale),
        mat,
        rotation=(0, -asin(max(-1.0, min(1.0, dz / length))), atan2(dy, dx)),
    )


def rib_vault_bay(name, mat, *, center, span, length, crown_z, springing_z):
    """One bay of a quadripartite rib vault: four diagonal ribs meeting at a boss, plus the
    transverse and wall arches that frame it.

    The vault is what the interior reads by, but it must never become a collision surface -- the
    preset's hollow tunnel corridor defines where the nave is flyable, so every rib is _nocol.
    """
    crown = (center[0], center[1], crown_z)
    for sx in (-1, 1):
        for sy in (-1, 1):
            _strut(
                f"{name}_rib_{'p' if sx > 0 else 'm'}{'p' if sy > 0 else 'm'}_nocol", mat,
                start=(center[0] + sx * length / 2, center[1] + sy * span / 2, springing_z),
                end=crown, thickness=0.34,
            )
    for sx in (-1, 1):
        pointed_arch(
            f"{name}_transverse_{'p' if sx > 0 else 'm'}_nocol", mat,
            center=(center[0] + sx * length / 2, center[1], springing_z),
            span=span, rise=crown_z - springing_z, depth=0.34, steps=4, thickness=0.3, axis="x",
        )
    sphere(f"{name}_boss_nocol", crown, (0.42, 0.42, 0.3), mat, 6, 4)
    cube(f"{name}_web_nocol", (center[0], center[1], crown_z - 0.25),
         (length / 2, span / 2, 0.16), mat)


def tracery(name, mat, *, center, width, height, lights=2, axis="x"):
    """Window tracery: the stone mullions and the small foiled arches in the window head.

    This is the detail that separates a gothic window from a rectangular hole, and it is cheap:
    a mullion is one box, a foil one flattened cylinder.
    """
    for index in range(lights + 1):
        offset = -width / 2 + width * index / lights
        location = ((center[0], center[1] + offset, center[2]) if axis == "x"
                    else (center[0] + offset, center[1], center[2]))
        scale = ((0.12, 0.11, height / 2) if axis == "x" else (0.11, 0.12, height / 2))
        cube(f"{name}_mullion_{index}_nocol", location, scale, mat)
    cube(f"{name}_transom_nocol", center,
         (0.12, width / 2, 0.12) if axis == "x" else (width / 2, 0.12, 0.12), mat)
    foil_rotation = (0, pi / 2, 0) if axis == "x" else (pi / 2, 0, 0)
    for index in range(lights):
        offset = -width / 2 + width * (index + 0.5) / lights
        location = ((center[0], center[1] + offset, center[2] + height / 2 + width * 0.18)
                    if axis == "x"
                    else (center[0] + offset, center[1], center[2] + height / 2 + width * 0.18))
        cylinder(f"{name}_foil_{index}_nocol", location, width / (lights * 2.6), 0.1, mat,
                 vertices=6, rotation=foil_rotation)


# --- Static architecture ----------------------------------------------------------------------

def build_west_facade(mats):
    """The west front: three portals, the gallery of kings, the west rose, the chimera gallery
    and the two towers. Placed at X -63.75 .. -54.75, towers rising to 69 m.

    This is the face everybody recognises, so it gets the largest share of the triangle budget --
    28 kings, tracery in the rose, and real depth in the portal recesses.
    """
    stone = mats["stone"]
    shaded = mats["stone_shaded"]
    facade_x = WEST_FRONT_X + FACADE_DEPTH / 2
    # Centre and half-depth of the thin wall panels that the carving is applied to.
    wall_x = WEST_FRONT_X + FACADE_WALL_FRONT + FACADE_WALL_THICKNESS / 2
    wall_half = FACADE_WALL_THICKNESS / 2

    # Ground storey: a solid wall broken by three recessed portals.
    portal_centers = (-13.5, 0.0, 13.5)
    portal_widths = (7.2, 9.6, 7.2)
    cube("facade_base", (facade_x, 0, 1.2), (FACADE_DEPTH / 2, 21.75, 1.2), shaded)
    for index, (offset, width) in enumerate(zip(portal_centers, portal_widths)):
        # Wall panels left and right of each portal rather than one wall with holes: the loader
        # would collide against a box either way, and this keeps the mesh count honest.
        pier_front = WEST_FRONT_X + FACADE_DETAIL_X + 0.3
        pier_center = (pier_front + WEST_FRONT_X + FACADE_DEPTH) / 2
        pier_half = (WEST_FRONT_X + FACADE_DEPTH - pier_front) / 2
        cube(f"facade_pier_{index}", (pier_center, offset - width / 2 - 1.6, 9.0),
             (pier_half, 1.6, 7.8), stone)
        cube(f"facade_pier_{index}_far", (pier_center, offset + width / 2 + 1.6, 9.0),
             (pier_half, 1.6, 7.8), stone)
        pointed_arch(
            f"facade_portal_{index}", shaded,
            center=(WEST_FRONT_X + 1.0, offset, 9.5),
            span=width, rise=6.2, depth=2.0, steps=6, thickness=0.7, axis="x",
        )
        # Archivolts: five receding rings of voussoirs give the portal its funnel of depth. This
        # is the single most recognisable thing about a French gothic west front up close.
        for ring in range(5):
            pointed_arch(
                f"facade_archivolt_{index}_{ring}_nocol", stone,
                center=(WEST_FRONT_X + 1.5 + ring * 0.62, offset, 9.5 + ring * 0.3),
                span=width + ring * 0.9, rise=6.2 + ring * 0.42, depth=0.6, steps=5,
                thickness=0.34, axis="x",
            )
        cube(f"facade_tympanum_{index}_nocol", (WEST_FRONT_X + 1.4, offset, 12.4),
             (0.35, width / 2 * 0.9, 1.6), shaded)
        cube(f"facade_lintel_{index}_nocol", (WEST_FRONT_X + 1.2, offset, 9.6),
             (0.5, width / 2 * 0.95, 0.45), stone)
        # Jamb figures stand in the splay of the doorway, stepping back as it funnels inward,
        # and the trumeau splits the opening. They must stay in front of the pier faces above,
        # otherwise the masonry swallows them.
        for jamb in range(4):
            for jamb_side in (-1, 1):
                statue(
                    f"facade_jamb_{index}_{jamb}_{'p' if jamb_side > 0 else 'm'}", stone,
                    base=(WEST_FRONT_X + 0.4 + jamb * 0.25,
                          offset + jamb_side * (width / 2 + 0.5 + jamb * 0.55), 3.2),
                    height=3.0,
                )
        statue(f"facade_trumeau_{index}", stone,
               base=(WEST_FRONT_X + 0.6, offset, 3.4), height=3.6)
        # The wimperg over each portal, and the pinnacles that flank it.
        for step in range(5):
            for gable_side in (-1, 1):
                _strut(
                    f"facade_wimperg_{index}_{step}_{'p' if gable_side > 0 else 'm'}_nocol",
                    shaded,
                    start=(WEST_FRONT_X + 0.8,
                           offset + gable_side * (width / 2 + 1.4) * (1 - step / 5),
                           15.8 + step * 1.1),
                    end=(WEST_FRONT_X + 0.8,
                         offset + gable_side * (width / 2 + 1.4) * (1 - (step + 1) / 5),
                         15.8 + (step + 1) * 1.1),
                    thickness=0.36,
                )

    cube("facade_wall_mid", (wall_x, 0, 17.0), (wall_half, 21.75, 1.4), stone)

    # Gallery of kings: 28 figures in a continuous arcaded band at 18 m.
    cube("facade_kings_ledge_nocol", (WEST_FRONT_X + 0.9, 0, 18.1),
         (0.9, 21.0, 0.35), shaded)
    for index in range(28):
        offset_y = -20.25 + index * 1.5
        statue(f"facade_king_{index}", stone, base=(WEST_FRONT_X + 1.1, offset_y, 18.5), height=3.4)
        cube(f"facade_king_niche_{index}_nocol", (WEST_FRONT_X + 2.2, offset_y, 20.1),
             (0.4, 0.62, 1.9), shaded)
    cube("facade_kings_cornice_nocol", (WEST_FRONT_X + 1.0, 0, 22.4), (1.0, 21.0, 0.45), shaded)

    # Rose storey. The rose sits on the axis at 26.5 m with the twin lancets flanking it. The
    # wall is split around the rose so the window is an opening rather than a disc stuck on
    # solid stone -- that is what lets its light read from inside the nave.
    for panel_side in (-1, 1):
        cube(f"facade_wall_rose_{'n' if panel_side > 0 else 's'}",
             (wall_x, panel_side * (WEST_ROSE_RADIUS + 1.2 + 7.9), 27.5),
             (wall_half, 7.9, 5.0), stone)
    cube("facade_wall_rose_head", (wall_x, 0, 31.4),
         (wall_half, WEST_ROSE_RADIUS + 1.2, 1.1), stone)
    cube("facade_wall_rose_sill", (wall_x, 0, 22.0),
         (wall_half, WEST_ROSE_RADIUS + 1.2, 1.1), stone)
    rose_window(
        "facade_west_rose", shaded, mats["glass_blue"],
        center=(WEST_FRONT_X + FACADE_DETAIL_X, 0, 26.5),
        radius=WEST_ROSE_RADIUS, spokes=16, axis="x",
    )
    for side in (-1, 1):
        for twin in (-1, 1):
            lancet_window(
                f"facade_lancet_{'n' if side > 0 else 's'}{'a' if twin > 0 else 'b'}",
                mats["glass_warm"],
                center=(WEST_FRONT_X + FACADE_DETAIL_X, side * 14.5 + twin * 3.0, 26.0),
                width=2.4, height=8.0, axis="x",
            )

    # Chimera gallery: the open colonnade that ties the two towers together at 43 m, and the
    # gargoyles leaning over its balustrade that every photograph of this building has in it.
    cube("facade_gallery_floor", (facade_x, 0, 33.4), (FACADE_DEPTH / 2, 21.75, 1.1), shaded)
    for index in range(24):
        offset_y = -20.0 + index * 1.74
        cylinder(f"facade_gallery_column_{index}_nocol", (WEST_FRONT_X + 1.2, offset_y, 38.0),
                 0.34, 8.4, stone, vertices=6)
        # Trefoil heads over every second opening.
        if index % 2 == 0:
            cylinder(f"facade_gallery_foil_{index}_nocol",
                     (WEST_FRONT_X + 1.2, offset_y + 0.87, 42.2), 0.62, 0.16, shaded, 6,
                     (0, pi / 2, 0))
    for index in range(9):
        chimera_y = -18.0 + index * 4.5
        statue(f"facade_chimera_{index}", mats["stone_dark"],
               base=(WEST_FRONT_X + 0.5, chimera_y, 43.6), height=1.9)
    cube("facade_gallery_head", (facade_x, 0, 43.0), (FACADE_DEPTH / 2, 21.75, 1.3), shaded)

    # The towers: square shafts, tall paired openings with tracery, corner turrets and the open
    # balustrade at 69 m. Deliberately flat-topped -- the spires were never built.
    for side in (-1, 1):
        tag = "north" if side > 0 else "south"
        center_y = side * TOWER_CENTER_Y
        # The tower shaft is set back behind the plane the openings sit in, so the paired
        # lights read as openings in a wall instead of panes buried in solid stone. The plinth
        # and the cornices below still carry the building line out to the full 9 m depth.
        tower_front = WEST_FRONT_X + FACADE_DETAIL_X + 0.3
        cube(f"facade_tower_{tag}",
             ((tower_front + WEST_FRONT_X + FACADE_DEPTH) / 2, center_y,
              (43.0 + TOWER_TOP_Z) / 2),
             ((WEST_FRONT_X + FACADE_DEPTH - tower_front) / 2, TOWER_HALF_WIDTH,
              (TOWER_TOP_Z - 43.0) / 2), stone)
        for twin in (-1, 1):
            lancet_window(
                f"facade_tower_{tag}_light_{'a' if twin > 0 else 'b'}", mats["glass_warm"],
                center=(WEST_FRONT_X + FACADE_DETAIL_X, center_y + twin * 3.2, 54.0),
                width=2.8, height=15.0, axis="x",
            )
            tracery(
                f"facade_tower_{tag}_tracery_{'a' if twin > 0 else 'b'}", shaded,
                center=(WEST_FRONT_X + FACADE_DETAIL_X - 0.15, center_y + twin * 3.2, 54.0),
                width=2.8, height=15.0, lights=2, axis="x",
            )
        # Vertical buttress strips break up the tower faces the way the real ones do.
        for strip in (-1, 1):
            cube(f"facade_tower_{tag}_strip_{'p' if strip > 0 else 'm'}_nocol",
                 (WEST_FRONT_X + FACADE_DETAIL_X - 0.2,
                  center_y + strip * (TOWER_HALF_WIDTH - 0.7), 56.0),
                 (0.5, 0.8, 13.0), shaded)
        cube(f"facade_tower_{tag}_cornice_nocol", (facade_x, center_y, TOWER_TOP_Z + 0.7),
             (FACADE_DEPTH / 2, TOWER_HALF_WIDTH + 0.5, 0.7), shaded)
        # Open balustrade on the platform: the walk between the towers.
        for baluster in range(10):
            baluster_y = center_y - TOWER_HALF_WIDTH + 0.8 + baluster * 1.38
            for face_x in (WEST_FRONT_X + 0.5, WEST_FRONT_X + FACADE_DEPTH - 0.5):
                cylinder(
                    f"facade_tower_{tag}_baluster_{baluster}_"
                    f"{'w' if face_x < facade_x else 'e'}_nocol",
                    (face_x, baluster_y, TOWER_TOP_Z + 2.2), 0.14, 2.2, shaded, vertices=6,
                )
        for corner_x in (-1, 1):
            for corner_y in (-1, 1):
                pinnacle(
                    f"facade_tower_{tag}_pinnacle_{corner_x}_{corner_y}", stone,
                    base=(facade_x + corner_x * (FACADE_DEPTH / 2 - 0.4),
                          center_y + corner_y * (TOWER_HALF_WIDTH - 0.4), TOWER_TOP_Z + 1.2),
                    height=5.0, width=1.1,
                )


def build_nave(mats):
    """The nave: ten bays from X -54.75 to +5.25, double aisles either side, arcade at 15 m,
    triforium to 20 m, clerestory to 30 m and the vault crown at 33 m.

    The interior is the reason the map has an inside at all, so the arcades stay open and the
    vault is drawn as ribs rather than as a closed shell.
    """
    stone = mats["stone"]
    shaded = mats["stone_shaded"]

    for side in (-1, 1):
        # Outer aisle wall, buttressed in the next part.
        cube(f"nave_outer_wall_{side}", ((NAVE_START_X + NAVE_END_X) / 2, side * AISLE_OUTER,
                                         ARCADE_TOP_Z / 2),
             (NAVE_BAYS * BAY_LENGTH / 2, 0.9, ARCADE_TOP_Z / 2), stone)
        # Clerestory wall of the central vessel.
        cube(f"nave_clerestory_wall_{side}", ((NAVE_START_X + NAVE_END_X) / 2,
                                              side * CLERESTORY_HALF,
                                              (TRIFORIUM_TOP_Z + CLERESTORY_TOP_Z) / 2),
             (NAVE_BAYS * BAY_LENGTH / 2, 0.8, (CLERESTORY_TOP_Z - TRIFORIUM_TOP_Z) / 2), stone)
        cube(f"nave_triforium_band_{side}_nocol", ((NAVE_START_X + NAVE_END_X) / 2,
                                                   side * CLERESTORY_HALF,
                                                   (ARCADE_TOP_Z + TRIFORIUM_TOP_Z) / 2),
             (NAVE_BAYS * BAY_LENGTH / 2, 0.5, (TRIFORIUM_TOP_Z - ARCADE_TOP_Z) / 2), shaded)

    for bay in range(NAVE_BAYS):
        bay_x = NAVE_START_X + BAY_LENGTH * (bay + 0.5)
        for side in (-1, 1):
            # Arcade pier between nave and inner aisle, and the aisle pier beyond it.
            cylinder(f"nave_pier_{bay}_{side}", (bay_x, side * NAVE_HALF_WIDTH, ARCADE_TOP_Z / 2),
                     1.05, ARCADE_TOP_Z, stone, vertices=8)
            cylinder(f"nave_aisle_pier_{bay}_{side}", (bay_x, side * AISLE_INNER,
                                                       AISLE_VAULT_Z / 2),
                     0.8, AISLE_VAULT_Z, stone, vertices=8)
            cube(f"nave_capital_{bay}_{side}_nocol", (bay_x, side * NAVE_HALF_WIDTH,
                                                      ARCADE_TOP_Z - 0.5),
                 (1.35, 1.35, 0.5), shaded)
            # Arcade arch spanning to the next pier. The last bay has no next pier -- that arch
            # belongs to the crossing -- so springing one there would push the nave three metres
            # into the transept and stack two sets of stone in the same space.
            if bay < NAVE_BAYS - 1:
                pointed_arch(
                    f"nave_arcade_{bay}_{side}", shaded,
                    center=(bay_x + BAY_LENGTH / 2, side * NAVE_HALF_WIDTH, ARCADE_TOP_Z),
                    span=BAY_LENGTH, rise=3.4, depth=1.0, steps=5, thickness=0.5, axis="y",
                )
            # Clerestory window: the light source of the central vessel.
            lancet_window(
                f"nave_clerestory_{bay}_{side}", mats["glass_warm"],
                center=(bay_x, side * CLERESTORY_HALF, 25.0), width=3.2, height=7.6, axis="y",
            )
            lancet_window(
                f"nave_aisle_window_{bay}_{side}", mats["glass_blue"],
                center=(bay_x, side * AISLE_OUTER, 6.4), width=2.6, height=5.6, axis="y",
            )
            # Aisle vault, low and dark, the flyable side route under the tribune.
            rib_vault_bay(
                f"nave_aisle_vault_{bay}_{side}", shaded,
                center=(bay_x, side * (NAVE_HALF_WIDTH + AISLE_OUTER) / 2),
                span=AISLE_OUTER - NAVE_HALF_WIDTH, length=BAY_LENGTH,
                crown_z=AISLE_VAULT_Z, springing_z=ARCADE_TOP_Z * 0.55,
            )

        rib_vault_bay(
            f"nave_vault_{bay}", shaded,
            center=(bay_x, 0), span=NAVE_HALF_WIDTH * 2, length=BAY_LENGTH,
            crown_z=NAVE_VAULT_Z, springing_z=CLERESTORY_TOP_Z - 4.0,
        )

    cube("nave_floor", ((NAVE_START_X + NAVE_END_X) / 2, 0, -0.4),
         (NAVE_BAYS * BAY_LENGTH / 2, AISLE_OUTER, 0.4), mats["stone_dark"])


def build_transept(mats):
    """The transept: 48 m across, its two gable ends carrying the north and south roses at 13.1 m
    diameter. Centred on X +12.25, this is the widest point of the building and the junction the
    route branches at.
    """
    stone = mats["stone"]
    shaded = mats["stone_shaded"]

    for side in (-1, 1):
        tag = "north" if side > 0 else "south"
        gable_y = side * TRANSEPT_HALF
        cube(f"transept_{tag}_wall", (CROSSING_CENTER_X, gable_y, CLERESTORY_TOP_Z / 2),
             (CROSSING_LENGTH / 2, 0.9, CLERESTORY_TOP_Z / 2), stone)
        # The gable above the rose, stepped back and topped by its own small arcade.
        cube(f"transept_{tag}_gable_nocol", (CROSSING_CENTER_X, gable_y, ROOF_RIDGE_Z * 0.78),
             (CROSSING_LENGTH / 2 * 0.7, 0.7, 6.0), stone)
        for index in range(7):
            cylinder(f"transept_{tag}_gable_column_{index}_nocol",
                     (CROSSING_CENTER_X - 4.5 + index * 1.5, gable_y - side * 0.5, 32.6),
                     0.2, 4.4, shaded, vertices=6)

        rose_window(
            f"transept_{tag}_rose", shaded,
            mats["glass_red"] if side > 0 else mats["glass_blue"],
            center=(CROSSING_CENTER_X, gable_y - side * 0.7, 25.0),
            radius=TRANSEPT_ROSE_RADIUS, spokes=16, axis="y",
        )
        # The band of tall lancets that carries the rose, glazed in the opposite colour.
        for index in range(7):
            lancet_window(
                f"transept_{tag}_lancet_{index}",
                mats["glass_blue"] if side > 0 else mats["glass_red"],
                center=(CROSSING_CENTER_X - 6.0 + index * 2.0, gable_y - side * 0.7, 15.6),
                width=1.5, height=5.6, axis="y",
            )
        tracery(f"transept_{tag}_lancet_tracery", shaded,
                center=(CROSSING_CENTER_X, gable_y - side * 0.8, 15.6),
                width=13.0, height=5.6, lights=7, axis="y")

        pointed_arch(
            f"transept_{tag}_portal", shaded,
            center=(CROSSING_CENTER_X, gable_y - side * 0.6, 9.0),
            span=8.0, rise=5.4, depth=1.8, steps=6, thickness=0.7, axis="y",
        )
        for ring in range(3):
            pointed_arch(
                f"transept_{tag}_archivolt_{ring}_nocol", stone,
                center=(CROSSING_CENTER_X, gable_y - side * (1.3 + ring * 0.7), 9.0),
                span=8.0 + ring * 1.0, rise=5.4 + ring * 0.45, depth=0.65, steps=5,
                thickness=0.38, axis="y",
            )
        # Jamb figures flanking the portal, and the trumeau splitting the doorway.
        for jamb in range(4):
            for jamb_side in (-1, 1):
                statue(
                    f"transept_{tag}_jamb_{jamb}_{'p' if jamb_side > 0 else 'm'}", stone,
                    base=(CROSSING_CENTER_X + jamb_side * (4.8 + jamb * 0.9),
                          gable_y - side * 1.4, 3.0),
                    height=2.9,
                )
        statue(f"transept_{tag}_trumeau", stone,
               base=(CROSSING_CENTER_X, gable_y - side * 1.5, 3.2), height=3.4)
        # A wimperg: the steep gable that crowns a gothic portal.
        for step in range(5):
            for wimperg_side in (-1, 1):
                _strut(
                    f"transept_{tag}_wimperg_{step}_{'p' if wimperg_side > 0 else 'm'}_nocol",
                    shaded,
                    start=(CROSSING_CENTER_X + wimperg_side * (5.4 - step * 1.08),
                           gable_y - side * 1.1, 14.6 + step * 1.5),
                    end=(CROSSING_CENTER_X + wimperg_side * (5.4 - (step + 1) * 1.08),
                         gable_y - side * 1.1, 14.6 + (step + 1) * 1.5),
                    thickness=0.4,
                )

        # Corner turrets where the gable wall meets the flanks.
        for corner in (-1, 1):
            pinnacle(f"transept_{tag}_turret_{'e' if corner > 0 else 'w'}", stone,
                     base=(CROSSING_CENTER_X + corner * (CROSSING_LENGTH / 2 - 0.6),
                           gable_y, CLERESTORY_TOP_Z),
                     height=8.5, width=2.0)

        # Side walls of the transept arm: only the strip that projects past the aisles.
        for arm_x in (NAVE_END_X, CHOIR_START_X):
            cube(f"transept_{tag}_flank_{'w' if arm_x < CROSSING_CENTER_X else 'e'}",
                 (arm_x, side * (TRANSEPT_HALF + AISLE_OUTER) / 2, ARCADE_TOP_Z / 2),
                 (0.9, (TRANSEPT_HALF - AISLE_OUTER) / 2, ARCADE_TOP_Z / 2),
                 stone)
            lancet_window(
                f"transept_{tag}_flank_window_{'w' if arm_x < CROSSING_CENTER_X else 'e'}",
                mats["glass_warm"],
                center=(arm_x, side * (TRANSEPT_HALF + AISLE_OUTER) / 2, 8.0),
                width=2.4, height=6.4, axis="x",
            )

    # The four crossing piers carry the spire above; they are the heaviest supports in the church.
    for sx in (-1, 1):
        for sy in (-1, 1):
            cube(f"transept_crossing_pier_{sx}_{sy}",
                 (CROSSING_CENTER_X + sx * CROSSING_LENGTH / 2, sy * NAVE_HALF_WIDTH,
                  CLERESTORY_TOP_Z / 2),
                 (1.5, 1.5, CLERESTORY_TOP_Z / 2), stone)

    rib_vault_bay(
        "transept_crossing_vault", shaded,
        center=(CROSSING_CENTER_X, 0), span=NAVE_HALF_WIDTH * 2, length=CROSSING_LENGTH,
        crown_z=NAVE_VAULT_Z, springing_z=CLERESTORY_TOP_Z - 4.0,
    )
    for side in (-1, 1):
        rib_vault_bay(
            f"transept_arm_vault_{side}", shaded,
            center=(CROSSING_CENTER_X, side * (NAVE_HALF_WIDTH + TRANSEPT_HALF) / 2),
            span=TRANSEPT_HALF - NAVE_HALF_WIDTH, length=CROSSING_LENGTH,
            crown_z=NAVE_VAULT_Z - 1.5, springing_z=CLERESTORY_TOP_Z - 5.0,
        )
    cube("transept_floor", (CROSSING_CENTER_X, 0, -0.4),
         (CROSSING_LENGTH / 2, TRANSEPT_HALF, 0.4), mats["stone_dark"])


def build_choir_apse(mats):
    """Choir and apse: five straight bays from X +19.25, then the semicircular east end with its
    ring of radiating chapels. The ambulatory around the choir is the low branch of the route.
    """
    stone = mats["stone"]
    shaded = mats["stone_shaded"]

    for bay in range(CHOIR_BAYS):
        bay_x = CHOIR_START_X + BAY_LENGTH * (bay + 0.5)
        for side in (-1, 1):
            cylinder(f"choir_pier_{bay}_{side}", (bay_x, side * NAVE_HALF_WIDTH, ARCADE_TOP_Z / 2),
                     1.0, ARCADE_TOP_Z, stone, vertices=8)
            cylinder(f"choir_ambulatory_pier_{bay}_{side}",
                     (bay_x, side * AISLE_INNER, AISLE_VAULT_Z / 2), 0.75, AISLE_VAULT_Z,
                     stone, vertices=8)
            cube(f"choir_outer_wall_{bay}_{side}", (bay_x, side * AISLE_OUTER, ARCADE_TOP_Z / 2),
                 (BAY_LENGTH / 2, 0.85, ARCADE_TOP_Z / 2), stone)
            cube(f"choir_clerestory_wall_{bay}_{side}",
                 (bay_x, side * CLERESTORY_HALF, (TRIFORIUM_TOP_Z + CLERESTORY_TOP_Z) / 2),
                 (BAY_LENGTH / 2, 0.8, (CLERESTORY_TOP_Z - TRIFORIUM_TOP_Z) / 2), stone)
            lancet_window(
                f"choir_clerestory_{bay}_{side}", mats["glass_red"],
                center=(bay_x, side * CLERESTORY_HALF, 25.0), width=3.0, height=7.2, axis="y",
            )
            if bay < CHOIR_BAYS - 1:
                pointed_arch(
                    f"choir_arcade_{bay}_{side}", shaded,
                    center=(bay_x + BAY_LENGTH / 2, side * NAVE_HALF_WIDTH, ARCADE_TOP_Z),
                    span=BAY_LENGTH, rise=3.2, depth=1.0, steps=5, thickness=0.5, axis="y",
                )
        rib_vault_bay(
            f"choir_vault_{bay}", shaded,
            center=(bay_x, 0), span=NAVE_HALF_WIDTH * 2, length=BAY_LENGTH,
            crown_z=NAVE_VAULT_Z, springing_z=CLERESTORY_TOP_Z - 4.0,
        )

    # The apse: hemicycle piers, an outer wall of chapels, and the vault fanning over both.
    for index in range(9):
        angle = radians(-80 + index * 20)
        inner_x = CHOIR_END_X + NAVE_HALF_WIDTH * 1.1 * cos(angle)
        inner_y = NAVE_HALF_WIDTH * 1.15 * sin(angle) * 1.6
        cylinder(f"apse_pier_{index}", (inner_x, inner_y, ARCADE_TOP_Z / 2), 0.9, ARCADE_TOP_Z,
                 stone, vertices=8)

        # The chapels have to end at the apse radius, not start there: their outer face is the
        # east end of the building, and 127.5 m is measured to it.
        chapel_reach = APSE_RADIUS - CHAPEL_DEPTH
        outer_x = CHOIR_END_X + chapel_reach * cos(angle)
        outer_y = (AISLE_OUTER - CHAPEL_DEPTH) * sin(angle)
        cube(f"apse_chapel_{index}", (outer_x, outer_y, AISLE_VAULT_Z / 2),
             (2.4, 2.4, AISLE_VAULT_Z / 2), stone, rotation=(0, 0, angle))
        lancet_window(
            f"apse_chapel_window_{index}", mats["glass_blue"],
            center=(outer_x + 1.6 * cos(angle), outer_y + 1.6 * sin(angle), 6.0),
            width=2.2, height=5.4, axis="y",
        )
        cone(f"apse_chapel_roof_{index}_nocol", (outer_x, outer_y, AISLE_VAULT_Z + 1.6),
             CHAPEL_DEPTH, 0.0, 3.2, mats["lead"], vertices=6)

    cube("apse_hemicycle_wall", (CHOIR_END_X + APSE_RADIUS * 0.55, 0,
                                 (TRIFORIUM_TOP_Z + CLERESTORY_TOP_Z) / 2),
         (APSE_RADIUS * 0.5, CLERESTORY_HALF, (CLERESTORY_TOP_Z - TRIFORIUM_TOP_Z) / 2), stone)
    rib_vault_bay(
        "apse_vault", shaded,
        center=(CHOIR_END_X + APSE_RADIUS * 0.4, 0), span=NAVE_HALF_WIDTH * 2,
        length=APSE_RADIUS, crown_z=NAVE_VAULT_Z, springing_z=CLERESTORY_TOP_Z - 4.0,
    )
    cube("choir_floor", ((CHOIR_START_X + CHOIR_END_X + APSE_RADIUS) / 2, 0, -0.4),
         ((CHOIR_END_X + APSE_RADIUS - CHOIR_START_X) / 2, AISLE_OUTER, 0.4), mats["stone_dark"])


def build_buttresses(mats):
    """The flying buttresses: the outside skeleton that carries the vault thrust down to the
    ground. At the choir they span roughly 15 m in a single leap, which is what makes the east
    end look like a cage. The gaps between them are flyable, which is the point for the map.
    """
    stone = mats["stone"]
    shaded = mats["stone_shaded"]

    def buttress(name, x, side, *, pier_offset=BUTTRESS_OFFSET, double=True):
        pier_y = side * (AISLE_OUTER + pier_offset)
        cube(f"{name}_pier", (x, pier_y, 9.0), (1.5, 1.9, 9.0), stone)
        # The pier steps back as it rises, the way real masonry sheds load and water.
        cube(f"{name}_pier_step_nocol", (x, pier_y - side * 0.35, 14.5), (1.25, 1.55, 4.5), stone)
        cube(f"{name}_pier_head_nocol", (x, pier_y, 18.6), (1.7, 2.1, 0.7), shaded)
        pinnacle(f"{name}_pinnacle", stone, base=(x, pier_y, 19.3), height=6.5, width=1.5)

        # The lower flyer takes the vault thrust, the upper one braces the roof against wind.
        flying_arch(
            f"{name}_flyer_lower", stone,
            springing=(x, pier_y, 18.4),
            landing=(x, side * (CLERESTORY_HALF + 0.6), 23.5),
            steps=6, thickness=0.62, width=0.95, lift=0.16,
        )
        if double:
            flying_arch(
                f"{name}_flyer_upper_nocol", shaded,
                springing=(x, pier_y, 24.4),
                landing=(x, side * (CLERESTORY_HALF + 0.6), 29.0),
                steps=5, thickness=0.42, width=0.65, lift=0.13,
            )
        # The open spandrel between the two flyers is carried on slender colonnettes.
        for index in range(3):
            colonnette_y = side * (CLERESTORY_HALF + 2.4 + index * 3.2)
            cylinder(f"{name}_colonnette_{index}_nocol", (x, colonnette_y, 25.6), 0.16, 4.2,
                     shaded, vertices=6)
        cube(f"{name}_gutter_nocol", (x, side * (CLERESTORY_HALF + 0.9), 30.2),
             (0.5, 1.0, 0.45), shaded)
        # A gargoyle at the outer end throws water clear of the wall. It is the only thing
        # allowed to overhang the building line, and even that stays short.
        cylinder(f"{name}_gargoyle_nocol", (x, pier_y + side * 1.2, 18.2), 0.26, 1.6,
                 mats["stone_dark"], vertices=6, rotation=(pi / 2, 0, 0))
        sphere(f"{name}_gargoyle_head_nocol", (x, pier_y + side * 1.9, 18.2),
               (0.34, 0.42, 0.34), mats["stone_dark"], 6, 4)

    for bay in range(NAVE_BAYS):
        x = NAVE_START_X + BAY_LENGTH * (bay + 0.5)
        for side in (-1, 1):
            buttress(f"buttress_nave_{bay}_{'n' if side > 0 else 's'}", x, side)

    for bay in range(CHOIR_BAYS):
        x = CHOIR_START_X + BAY_LENGTH * (bay + 0.5)
        for side in (-1, 1):
            # The choir flyers are the famous ones: the longest single leap on the building.
            buttress(f"buttress_choir_{bay}_{'n' if side > 0 else 's'}", x, side,
                     pier_offset=BUTTRESS_OFFSET + 1.0)

    # Apse buttresses radiate from the hemicycle instead of standing in a row. They stand between
    # the chapels, so they follow a slightly wider curve than the chapel ring does.
    for index in range(7):
        angle = radians(-60 + index * 20)
        pier_x = CHOIR_END_X + (APSE_RADIUS - CHAPEL_DEPTH + 1.4) * cos(angle)
        pier_y = (AISLE_OUTER - CHAPEL_DEPTH + 1.4) * sin(angle)
        cube(f"buttress_apse_{index}_pier", (pier_x, pier_y, 9.0), (1.4, 1.8, 9.0), stone,
             rotation=(0, 0, angle))
        cube(f"buttress_apse_{index}_head_nocol", (pier_x, pier_y, 18.5), (1.6, 2.0, 0.6), shaded,
             rotation=(0, 0, angle))
        pinnacle(f"buttress_apse_{index}_pinnacle", stone, base=(pier_x, pier_y, 19.1),
                 height=6.0, width=1.4)
        # Aimed at the hemicycle wall rather than straight inward, so the ring of arcs converges.
        landing_x = CHOIR_END_X + APSE_RADIUS * 0.35 * cos(angle)
        landing_y = CLERESTORY_HALF * sin(angle) * 1.1
        steps = 6
        for step in range(steps):
            t0, t1 = step / steps, (step + 1) / steps
            start = (pier_x + (landing_x - pier_x) * t0, pier_y + (landing_y - pier_y) * t0,
                     18.4 + 5.2 * t0 + sin(t0 * pi) * 2.4)
            end = (pier_x + (landing_x - pier_x) * t1, pier_y + (landing_y - pier_y) * t1,
                   18.4 + 5.2 * t1 + sin(t1 * pi) * 2.4)
            _strut(f"buttress_apse_{index}_flyer_{step}", stone, start=start, end=end,
                   thickness=0.75)


def build_roof_fleche(mats):
    """Lead roof and the spire over the crossing. The ridge sits at 45 m, the spire tip at 96 m.

    The spire is the highest point of the map and the visual anchor from anywhere on it, so it
    keeps its ring of apostle figures at the base and the cockerel at the very top.
    """
    lead = mats["lead"]
    oak = mats["oak"]

    def roof_run(name, start_x, end_x, half_width):
        length = end_x - start_x
        center_x = (start_x + end_x) / 2
        for side in (-1, 1):
            cube(f"{name}_slope_{side}", (center_x, side * half_width / 2,
                                          (CLERESTORY_TOP_Z + ROOF_RIDGE_Z) / 2),
                 (length / 2, half_width / 2 * 1.12, 0.4), lead,
                 rotation=(side * -0.98, 0, 0))
        cube(f"{name}_ridge_nocol", (center_x, 0, ROOF_RIDGE_Z), (length / 2, 0.5, 0.5), lead)
        # The oak frame that gave the attic its nickname, the forest: a truss every 1.5 m, each
        # one a pair of rafters with a collar beam and a strut. Dense on purpose -- this is the
        # part of the building the reconstruction is actually about.
        truss_count = max(4, int(length / 1.5))
        for truss in range(truss_count):
            truss_x = start_x + length * (truss + 0.5) / truss_count
            for side in (-1, 1):
                _strut(f"{name}_rafter_{truss}_{'p' if side > 0 else 'm'}_nocol", oak,
                       start=(truss_x, side * half_width / 2, CLERESTORY_TOP_Z),
                       end=(truss_x, 0, ROOF_RIDGE_Z), thickness=0.26)
            if truss % 2 == 0:
                cube(f"{name}_collar_{truss}_nocol",
                     (truss_x, 0, CLERESTORY_TOP_Z + (ROOF_RIDGE_Z - CLERESTORY_TOP_Z) * 0.45),
                     (0.2, half_width / 4, 0.2), oak)
                for side in (-1, 1):
                    _strut(f"{name}_brace_{truss}_{'p' if side > 0 else 'm'}_nocol", oak,
                           start=(truss_x, side * half_width / 4, CLERESTORY_TOP_Z + 0.6),
                           end=(truss_x, side * half_width / 5, ROOF_RIDGE_Z - 3.0),
                           thickness=0.18)
        # Purlins running the length of the roof tie the trusses together.
        for side in (-1, 1):
            for purlin in range(3):
                height = CLERESTORY_TOP_Z + (ROOF_RIDGE_Z - CLERESTORY_TOP_Z) * (purlin + 1) / 4
                inset = half_width / 2 * (1 - (purlin + 1) / 4)
                cube(f"{name}_purlin_{purlin}_{'p' if side > 0 else 'm'}_nocol",
                     (center_x, side * inset, height), (length / 2, 0.18, 0.18), oak)

    roof_run("roof_nave", NAVE_START_X, NAVE_END_X, CLERESTORY_HALF * 2)
    roof_run("roof_choir", CHOIR_START_X, CHOIR_END_X + APSE_RADIUS, CLERESTORY_HALF * 2)
    for side in (-1, 1):
        cube(f"roof_transept_slope_{side}",
             (CROSSING_CENTER_X + side * CROSSING_LENGTH / 4, 0,
              (CLERESTORY_TOP_Z + ROOF_RIDGE_Z) / 2),
             (CROSSING_LENGTH / 4 * 1.12, TRANSEPT_HALF, 0.4), lead,
             rotation=(0, side * 0.98, 0))
    # Aisle lean-to roofs, lower and shallower.
    for side in (-1, 1):
        cube(f"roof_aisle_{side}", ((NAVE_START_X + CHOIR_END_X) / 2,
                                    side * (CLERESTORY_HALF + AISLE_OUTER) / 2, 16.5),
             ((CHOIR_END_X - NAVE_START_X) / 2, (AISLE_OUTER - CLERESTORY_HALF) / 2 * 1.1, 0.35),
             lead, rotation=(side * -0.34, 0, 0))

    # The spire. Base at the ridge, an octagonal tapering shaft, then the cross and cockerel.
    spire_base_z = ROOF_RIDGE_Z
    cube("fleche_base", (CROSSING_CENTER_X, 0, spire_base_z + 3.0), (5.0, 5.0, 3.0), oak)
    cone("fleche_shaft", (CROSSING_CENTER_X, 0, (spire_base_z + 6.0 + SPIRE_TIP_Z - 6.0) / 2),
         4.6, 0.5, SPIRE_TIP_Z - 6.0 - spire_base_z - 6.0, lead, vertices=8)
    for index in range(8):
        angle = index * (2 * pi / 8)
        cube(f"fleche_rib_{index}_nocol",
             (CROSSING_CENTER_X + 2.6 * cos(angle), 2.6 * sin(angle), spire_base_z + 18.0),
             (0.18, 0.18, 16.0), lead, rotation=(0, 0.09, angle))
    # Twelve apostles and four evangelists climbing the roof toward the spire.
    for index in range(16):
        angle = index * (2 * pi / 16)
        statue(
            f"fleche_apostle_{index}", mats["copper"],
            base=(CROSSING_CENTER_X + 6.4 * cos(angle), 6.4 * sin(angle), spire_base_z + 1.4),
            height=3.0, facing=angle,
        )
    cylinder("fleche_finial_nocol", (CROSSING_CENTER_X, 0, SPIRE_TIP_Z - 4.0), 0.35, 6.0,
             mats["gold"], vertices=6)
    cube("fleche_cross_nocol", (CROSSING_CENTER_X, 0, SPIRE_TIP_Z - 2.2), (0.14, 1.5, 0.14),
         mats["gold"])
    sphere("fleche_cockerel_nocol", (CROSSING_CENTER_X, 0, SPIRE_TIP_Z - 0.6),
           (0.7, 0.4, 0.75), mats["gold"], 8, 5)


def build_parvis_island(mats):
    """The setting: the square in front of the west front, the edge of the island and the two
    arms of the Seine. This is what the approach leg of the route flies over, and it gives the
    cathedral a ground plane to stand on instead of floating.
    """
    stone = mats["stone_dark"]
    cube("parvis_pavement", (WEST_FRONT_X - 32.0, 0, -0.5), (32.0, 34.0, 0.5), stone)
    cube("parvis_kilometre_zero_nocol", (WEST_FRONT_X - 22.0, 0, 0.15), (1.2, 1.2, 0.15),
         mats["stone"])

    # Island quays north and south, then the water beyond them.
    for side in (-1, 1):
        cube(f"parvis_quay_wall_{side}", (WEST_FRONT_X - 10.0, side * 46.0, 2.0),
             (66.0, 1.6, 2.0), mats["stone_shaded"])
        cube(f"parvis_bank_{side}", (WEST_FRONT_X - 10.0, side * 40.0, -0.6),
             (66.0, 6.0, 0.6), stone)
        cube(f"parvis_water_{side}_nocol", (WEST_FRONT_X - 10.0, side * 66.0, -1.4),
             (78.0, 20.0, 0.4), mats["water"])
        for index in range(12):
            tree_x = WEST_FRONT_X - 68.0 + index * 11.0
            cylinder(f"parvis_tree_trunk_{side}_{index}_nocol", (tree_x, side * 42.0, 2.4),
                     0.4, 4.8, mats["oak"], vertices=6)
            sphere(f"parvis_tree_crown_{side}_{index}_nocol", (tree_x, side * 42.0, 7.2),
                   (2.6, 2.6, 3.0), mats["foliage"], 8, 5)

    # East garden behind the apse, closing the island.
    cube("parvis_east_garden", (CHOIR_END_X + APSE_RADIUS + 22.0, 0, -0.5), (22.0, 30.0, 0.5),
         stone)
    for index in range(8):
        angle = index * (2 * pi / 8)
        cylinder(f"parvis_garden_tree_{index}_nocol",
                 (CHOIR_END_X + APSE_RADIUS + 22.0 + 15.0 * cos(angle), 20.0 * sin(angle), 2.4),
                 0.4, 4.8, mats["oak"], vertices=6)
        sphere(f"parvis_garden_crown_{index}_nocol",
               (CHOIR_END_X + APSE_RADIUS + 22.0 + 15.0 * cos(angle), 20.0 * sin(angle), 7.0),
               (2.8, 2.8, 3.2), mats["foliage"], 8, 5)


ARCHITECTURE = (
    ("01_west_facade", build_west_facade),
    ("02_nave", build_nave),
    ("03_transept", build_transept),
    ("04_choir_apse", build_choir_apse),
    ("05_buttresses", build_buttresses),
    ("06_roof_fleche", build_roof_fleche),
    ("07_parvis_island", build_parvis_island),
)


def merge_static_meshes(part_name):
    """Join every static mesh that shares a material into one object per (material, collision)
    pair, and drop the UV layers.

    Both steps are about file size rather than looks. A gothic front assembled from primitives is
    six hundred separate objects, and glTF pays for each one with its own node, mesh, primitive
    and four accessors -- that overhead was three quarters of the exported bytes. Joining changes
    no triangle. The UV layers go because these materials are flat colours with no texture, so
    the coordinates were pure ballast.

    Only the static architecture may be merged. Animated rigs must keep one object per moving
    part, otherwise the loader cannot resolve which mesh a clip drives.
    """
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]

    # Bake every rotation into the vertices first. Joining adopts the active object's local
    # frame, so a rotated member would drag the whole merged object into a tilted frame and the
    # bounding box read back below -- the number the preset places by -- would be wrong.
    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.select_set(True)
    if meshes:
        bpy.context.view_layer.objects.active = meshes[0]
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.select_all(action="DESELECT")

    groups = {}
    for obj in meshes:
        for layer in list(obj.data.uv_layers):
            obj.data.uv_layers.remove(layer)
        material_name = obj.data.materials[0].name if obj.data.materials else "plain"
        decorative = "_nocol" in obj.name.lower()
        groups.setdefault((material_name, decorative), []).append(obj)

    merged = []
    for (material_name, decorative), members in sorted(groups.items()):
        bpy.ops.object.select_all(action="DESELECT")
        for member in members:
            member.select_set(True)
        bpy.context.view_layer.objects.active = members[0]
        if len(members) > 1:
            bpy.ops.object.join()
        target = bpy.context.view_layer.objects.active
        # Material names are prefixed ND by build_materials; strip that for readable node names.
        suffix = material_name[2:].lower() if material_name.startswith("ND") else material_name
        target.name = f"{part_name}_{suffix}{'_nocol' if decorative else ''}"
        target.data.name = f"{target.name}_mesh"
        merged.append(target.name)
    bpy.ops.object.select_all(action="DESELECT")
    return merged


def scene_bounds():
    """Bounding box of everything in the scene, in cathedral metres.

    Printed for every part because the map preset has to place the exported GLBs back into the
    same relative positions: the loader recentres each file on its own bounding box, so the
    preset position is this centre in X/Y and this minimum in Z.
    """
    lows = [float("inf")] * 3
    highs = [float("-inf")] * 3
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        for corner in obj.bound_box:
            world = obj.matrix_world @ type(obj.location)(corner)
            for axis in range(3):
                lows[axis] = min(lows[axis], world[axis])
                highs[axis] = max(highs[axis], world[axis])
    return lows, highs


def triangle_count():
    total = 0
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        mesh = obj.data
        for polygon in mesh.polygons:
            total += max(1, len(polygon.vertices) - 2)
    return total


def export_part(file_stem, builder):
    scene = reset_scene(file_stem)
    builder(build_materials())
    # Part name without the numeric prefix: 01_west_facade -> west_facade.
    merged = merge_static_meshes(file_stem.split("_", 1)[1])
    scene.frame_set(scene.frame_start)

    lows, highs = scene_bounds()
    triangles = triangle_count()
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
    # Blender is Z-up, the export is Y-up: the preset reads X from Blender X, height from
    # Blender Z and the map's Z axis from Blender -Y.
    print(
        f"generated {glb_path.relative_to(ROOT)} "
        f"tris={triangles} nodes={len(merged)} "
        f"center_x={(lows[0] + highs[0]) / 2:.2f} "
        f"center_z={-(lows[1] + highs[1]) / 2:.2f} "
        f"base_y={lows[2]:.2f} "
        f"size=({highs[0] - lows[0]:.1f}, {highs[2] - lows[2]:.1f}, {highs[1] - lows[1]:.1f})"
    )


def main():
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    GLB_DIR.mkdir(parents=True, exist_ok=True)
    for part in ARCHITECTURE:
        export_part(*part)


if __name__ == "__main__":
    main()
