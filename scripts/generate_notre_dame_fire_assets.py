#!/usr/bin/env python3
"""Generate the burnt Notre-Dame map assets, as the building stood after 15 April 2019.

Run with Blender 4.2 LTS, after generate_notre_dame_assets.py:

    blender --background --python scripts/generate_notre_dame_fire_assets.py

Only the parts the fire changed are rebuilt here. The west front, the choir and apse, the
buttresses and the island are unharmed and the fire map keeps loading them straight out of
assets/maps/notre_dame -- the fire took the roof and three vaults, not the whole church, and
re-exporting stone that did not move would only let the two buildings drift apart.

Every part is built by calling the intact builder from generate_notre_dame_assets and then taking
away what burned. That is deliberate: it means the measurements can never disagree between the two
maps, because there is only one set of them. What this file adds is the damage -- broken vault
rims, charred rafter stumps, fallen timbers and the debris cone the spire left on the crossing
floor.

What is destroyed follows the record rather than taste. The oak roof frame burned in full and the
spire came down through the crossing vault at 19:50; the vault failed in three places -- the
crossing, the north transept arm, and one bay of the nave's north aisle. The towers, the west
front and all three roses survived, so nothing here touches them.

Collision note: the intact map runs in glbColliderMode 'scene', where every mesh without a _nocol
suffix becomes collision and everything with it does not. The vault ribs were always _nocol, so
the vault was never solid -- the breaches are what finally makes that readable rather than a
surface a ship silently passes through. The lead roof slopes, by contrast, are solid, and burning
them away is what actually opens the attic to the sky. Broken rims stay _nocol so nobody catches
on an edge they cannot see; the debris cone is deliberately solid, because it is an obstacle.
"""

import sys
from math import cos, pi, sin
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))

import generate_notre_dame_assets as nd  # noqa: E402  (needs the path above)


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "assets" / "maps" / "notre_dame_fire" / "blender"
GLB_DIR = ROOT / "assets" / "maps" / "notre_dame_fire" / "glb"

# Charred oak, soot-blackened limestone, and the lead that ran off the roof and set solid again.
CHARRED = (0.085, 0.065, 0.055, 1.0)
SOOT_STONE = (0.30, 0.27, 0.25, 1.0)
SPENT_LEAD = (0.26, 0.26, 0.25, 1.0)


def with_fire_materials(mats):
    """The intact palette plus the three the fire produced."""
    extended = dict(mats)
    extended["charred"] = nd.material("NDFCharred", CHARRED, roughness=0.96)
    extended["soot"] = nd.material("NDFSoot", SOOT_STONE, roughness=0.93)
    extended["spent_lead"] = nd.material("NDFSpentLead", SPENT_LEAD, metallic=0.3, roughness=0.7)
    return extended


def remove_meshes(*prefixes):
    """Take away every mesh whose name starts with one of the prefixes.

    This is how damage is expressed: the intact builder runs first and puts the whole bay or roof
    run in place, then what burned is removed by name. Removing rather than not-building keeps the
    measurements in one file.
    """
    removed = 0
    for obj in list(bpy.context.scene.objects):
        if obj.type != "MESH":
            continue
        if any(obj.name.startswith(prefix) for prefix in prefixes):
            bpy.data.objects.remove(obj, do_unlink=True)
            removed += 1
    return removed


def breach_rim(name, mat, *, center, span_x, span_y, crown_z, teeth=7):
    """The broken edge of a collapsed vault: stubs of rib and web left standing on the wall head.

    A hole with a clean rectangular edge reads as a missing object, not as a collapse. The teeth
    below vary in length and lean by index rather than by chance, so the export stays byte-stable.
    """
    for index in range(teeth):
        along = -0.5 + (index + 0.5) / teeth
        # Two long sides of the opening.
        for side in (-1, 1):
            drop = 0.45 + 0.55 * abs(sin(index * 2.1 + side))
            nd.cube(
                f"{name}_tooth_x{index}_{'p' if side > 0 else 'm'}_nocol",
                (center[0] + along * span_x, center[1] + side * span_y / 2, crown_z - drop / 2),
                (span_x / (teeth * 2.4), 0.3, drop / 2),
                mat,
                rotation=(0.12 * side * cos(index * 1.7), 0, 0),
            )
        # Two short ends.
        for side in (-1, 1):
            drop = 0.4 + 0.5 * abs(cos(index * 1.9 + side))
            nd.cube(
                f"{name}_tooth_y{index}_{'p' if side > 0 else 'm'}_nocol",
                (center[0] + side * span_x / 2, center[1] + along * span_y, crown_z - drop / 2),
                (0.3, span_y / (teeth * 2.4), drop / 2),
                mat,
                rotation=(0, 0.12 * side * sin(index * 1.6), 0),
            )


def build_nave_burnt(mats):
    """The nave, with the north aisle vault down in the bay next to the crossing.

    Everything else in the nave stood: the arcade, the clerestory and the high vault over the
    central vessel are intact, and only the stone above is blackened.
    """
    mats = with_fire_materials(mats)
    nd.build_nave(mats)

    # North is +Y, and the bay that failed is the last one before the crossing.
    breach_bay = nd.NAVE_BAYS - 1
    removed = remove_meshes(f"nave_aisle_vault_{breach_bay}_1")
    assert removed > 0, "the north aisle bay to remove must exist"

    bay_x = nd.NAVE_START_X + nd.BAY_LENGTH * (breach_bay + 0.5)
    aisle_center_y = (nd.NAVE_HALF_WIDTH + nd.AISLE_OUTER) / 2
    breach_rim(
        "nave_aisle_breach", mats["soot"],
        center=(bay_x, aisle_center_y),
        span_x=nd.BAY_LENGTH, span_y=nd.AISLE_OUTER - nd.NAVE_HALF_WIDTH,
        crown_z=nd.AISLE_VAULT_Z,
    )
    # What fell through it, lying on the aisle floor below.
    for index in range(9):
        angle = index * 2.4
        nd.cube(
            f"nave_aisle_rubble_{index}",
            (bay_x + 2.1 * cos(angle), aisle_center_y + 3.4 * sin(angle), 0.5 + 0.2 * (index % 3)),
            (0.7 + 0.25 * (index % 4), 0.6 + 0.2 * (index % 3), 0.45),
            mats["soot"],
            rotation=(0.2 * sin(angle), 0.18 * cos(angle), angle),
        )


def build_transept_burnt(mats):
    """The transept, with the crossing vault gone and the north arm vault with it.

    The crossing is the hole the spire made. Its four piers carried the spire and are still
    standing, which is why they are untouched here.
    """
    mats = with_fire_materials(mats)
    nd.build_transept(mats)

    assert remove_meshes("transept_crossing_vault") > 0, "the crossing vault must exist"
    assert remove_meshes("transept_arm_vault_1") > 0, "the north arm vault must exist"

    breach_rim(
        "transept_crossing_breach", mats["soot"],
        center=(nd.CROSSING_CENTER_X, 0),
        span_x=nd.CROSSING_LENGTH, span_y=nd.NAVE_HALF_WIDTH * 2,
        crown_z=nd.NAVE_VAULT_Z, teeth=9,
    )
    breach_rim(
        "transept_arm_breach", mats["soot"],
        center=(nd.CROSSING_CENTER_X, (nd.NAVE_HALF_WIDTH + nd.TRANSEPT_HALF) / 2),
        span_x=nd.CROSSING_LENGTH, span_y=nd.TRANSEPT_HALF - nd.NAVE_HALF_WIDTH,
        crown_z=nd.NAVE_VAULT_Z - 1.5, teeth=9,
    )


def build_roof_burnt(mats):
    """What the fire left of the roof: no lead, no spire, no forest -- rafter stubs on the wall
    heads and a few timbers that fell inward and lodged on the vault.

    This is the part that changes how the map is flown. The lead slopes were solid, so the attic
    could only be entered through the narrow slot along the ridge; with them gone the whole length
    of the building is open from above. The aisle lean-to roofs survive, blackened, so the attic
    still has sides.
    """
    mats = with_fire_materials(mats)
    nd.build_roof_fleche(mats)

    # Keep the aisle lean-tos; everything else above the vault burned or came down.
    for obj in list(bpy.context.scene.objects):
        if obj.type == "MESH" and not obj.name.startswith("roof_aisle_"):
            bpy.data.objects.remove(obj, do_unlink=True)
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            obj.data.materials.clear()
            obj.data.materials.append(mats["spent_lead"])

    charred = mats["charred"]

    def rafter_stubs(name, start_x, end_x, half_width):
        """The bottom two metres of each truss, still standing on the wall head."""
        length = end_x - start_x
        count = max(4, int(length / 3.0))
        for index in range(count):
            truss_x = start_x + length * (index + 0.5) / count
            for side in (-1, 1):
                stub = 1.6 + 0.9 * abs(sin(index * 1.3 + side))
                nd._strut(
                    f"{name}_stub_{index}_{'p' if side > 0 else 'm'}_nocol", charred,
                    start=(truss_x, side * half_width / 2, nd.CLERESTORY_TOP_Z),
                    end=(truss_x - 0.3 * cos(index * 1.1), side * (half_width / 2 - stub * 0.55),
                         nd.CLERESTORY_TOP_Z + stub),
                    thickness=0.24,
                )

    rafter_stubs("roof_nave", nd.NAVE_START_X, nd.NAVE_END_X, nd.CLERESTORY_HALF * 2)
    rafter_stubs("roof_choir", nd.CHOIR_START_X, nd.CHOIR_END_X + nd.APSE_RADIUS,
                 nd.CLERESTORY_HALF * 2)

    # Timbers that fell inward and came to rest on the extrados of the vault. These are solid on
    # purpose: they are the obstacle the attic branch of the route now has to be flown around.
    # They lie low, on the vault back at 33 m, well under the line the route runs at.
    fallen = (
        (-46.0, -3.2, -30.0, 4.4), (-38.0, 5.0, -22.0, -2.0), (-27.0, -5.4, -13.0, 3.0),
        (-9.0, 4.2, 1.0, -4.6), (24.0, -4.0, 33.0, 3.6), (36.0, 3.8, 45.0, -3.2),
    )
    for index, (x0, y0, x1, y1) in enumerate(fallen):
        nd._strut(
            f"roof_fallen_timber_{index}", charred,
            start=(x0, y0, nd.NAVE_VAULT_Z + 0.5),
            end=(x1, y1, nd.NAVE_VAULT_Z + 2.3),
            thickness=0.55,
        )


def build_fleche_debris(mats):
    """The spire on the crossing floor: burnt oak, spent lead and the stonework it took with it.

    Placed as its own part rather than inside the transept so the preset can position it against
    its own bounding box, and so it can be tuned without re-exporting the building.
    """
    mats = with_fire_materials(mats)
    charred = mats["charred"]
    lead = mats["spent_lead"]
    stone = mats["soot"]

    # The cone itself, widest at the floor.
    for index in range(14):
        angle = index * (2 * pi / 7) + index * 0.31
        radius = 5.6 * (1.0 - index / 18.0)
        height = 0.6 + index * 0.42
        nd.cube(
            f"debris_block_{index}",
            (nd.CROSSING_CENTER_X + radius * cos(angle) * 0.8, radius * sin(angle) * 0.8,
             height / 2),
            (1.5 - index * 0.06, 1.3 - index * 0.05, height / 2),
            stone if index % 3 else lead,
            rotation=(0.14 * sin(angle), 0.12 * cos(angle), angle),
        )
    # Roof timbers driven into the pile at every angle.
    for index in range(10):
        angle = index * (2 * pi / 10) + 0.4
        nd._strut(
            f"debris_timber_{index}", charred,
            start=(nd.CROSSING_CENTER_X + 6.4 * cos(angle), 6.4 * sin(angle), 0.4),
            end=(nd.CROSSING_CENTER_X + 1.5 * cos(angle + 0.6), 1.5 * sin(angle + 0.6),
                 4.2 + 2.0 * abs(sin(index * 1.7))),
            thickness=0.42,
        )
    # The upper shaft, folded over where it hit the floor, and the cockerel that was found in it.
    nd.cone("debris_shaft", (nd.CROSSING_CENTER_X - 1.2, 2.4, 5.2), 2.4, 0.4, 7.4, lead,
            vertices=8, rotation=(0.72, 0.0, 0.4))
    nd.cube("debris_cross_nocol", (nd.CROSSING_CENTER_X - 2.6, 4.6, 8.4), (0.16, 1.3, 0.16),
            mats["gold"], rotation=(0.9, 0.2, 0.3))
    nd.sphere("debris_cockerel_nocol", (nd.CROSSING_CENTER_X + 3.4, -4.2, 0.9),
              (0.6, 0.4, 0.65), mats["gold"], 8, 5)


# --- The fire ---------------------------------------------------------------------------------
# Flame, ember and the light they throw. None of it is an obstacle: every mesh below carries both
# _nocol and _noshadow, so nothing here can stop a ship and nothing here casts a shadow. The fire
# is what the map looks like, not what it does.
#
# Two things shape how these are built. Flames are grouped under a handful of rigs rather than
# animated one by one, because merge_animated_meshes joins decorative children per rig and per
# material -- six rigs of eight flames is six nodes, sixty separate flames would be sixty. And
# every loop is a whole multiple of the six second beat the whole map runs on, so the fire
# breathes with the site rather than against it.


def glowing(name, emission_color, strength):
    """A material that only emits: near-black base colour, coloured emission on top.

    The shared material() helper puts the same colour into base and emission, which is right for
    stained glass but wrong for fire. A flame with a bright base colour also *receives* light, so
    the eight fire lights in the preset wash it out, and the scene's tone mapping then finishes the
    job -- measured, that is exactly what turned the first pass of these flames into pale cones
    that read as stalagmites. Emission strength is kept low for the same reason: anything much
    above two saturates to white through the tone map and the fire loses its colour entirely.
    """
    value = nd.material(name, (0.06, 0.025, 0.012, 1.0), 0.0, 0.0, 0.5)
    shader = value.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Emission Color"].default_value = emission_color
    shader.inputs["Emission Strength"].default_value = strength
    value.diffuse_color = emission_color
    return value


def flame_materials(mats):
    """Fire colours. Emission is what carries them: the map is dark, and a flame that is merely
    orange reads as painted cardboard next to lit stone.

    The material names end in _noshadow on purpose, and it is not decoration. merge_animated_meshes
    rebuilds every merged mesh's name from its rig and its material, which drops the suffixes the
    individual meshes were given -- so a flame authored as `..._nocol_noshadow` comes out of the
    merge as `..._nocol` and would be eligible to cast a shadow. Carrying the marker in the
    material name is what survives that rename. Fire must not throw shadows: it is light.
    """
    extended = with_fire_materials(mats)
    # Saturation over brightness. At strength 2.6 the core colour tone-mapped to something
    # indistinguishable from white, which put pale slabs in the attic; the values below keep the
    # orange through the tone map, and the fire reads brighter for being coloured, not lighter.
    extended["flame_core"] = glowing("NDFFlameCore_noshadow", (1.0, 0.50, 0.12, 1.0), 1.8)
    extended["flame_body"] = glowing("NDFFlameBody_noshadow", (1.0, 0.30, 0.05, 1.0), 1.5)
    extended["flame_tip"] = glowing("NDFFlameTip_noshadow", (0.82, 0.12, 0.02, 1.0), 1.1)
    extended["ember"] = glowing("NDFEmber_noshadow", (1.0, 0.40, 0.08, 1.0), 1.9)
    return extended


def flame_tongue(name, mat, *, base, height, radius, lean=0.0, spin=0.0):
    """One tongue of flame: a cone drawn to a point.

    The taper is the whole shape budget. Measured on the first pass, a cone with a blunt tip and a
    uniform height reads as a traffic bollard however it is coloured -- what makes a row of these
    read as fire is that no two are the same height and none of them stand straight up.
    """
    return nd.cone(
        f"{name}_nocol_noshadow", (base[0], base[1], base[2] + height / 2),
        radius, radius * 0.02, height, mat, vertices=8, rotation=(lean, 0, spin),
    )


def flame_cluster(scene, name, mats, *, center, spread, height, count, beats, phase):
    """A group of tongues on one rig, breathing together on its own phase.

    The rig scales rather than moves: fire grows and falls back in place. Scaling the whole group
    at once is also why the count can be raised without paying another animated node.

    Colour follows height rather than index. A fire is yellow where it is fed and dark red where it
    is running out, so the short tongues get the bright core material and the tall ones the dull
    tip -- which also means the group has a gradient instead of three colours shuffled together.
    """
    rig = nd.empty(f"{name}Rig", (center[0], center[1], center[2]))
    for index in range(count):
        angle = index * (2 * pi / count) + phase * 2.1
        reach = spread * (0.3 + 0.7 * abs(sin(index * 1.7 + phase)))
        # A wide spread of heights: this is what breaks up the row of identical cones.
        tall = abs(sin(index * 2.9 + phase * 3.1))
        tongue_height = height * (0.3 + 0.7 * tall)
        material = (mats["flame_core"] if tall < 0.34
                    else mats["flame_body"] if tall < 0.7
                    else mats["flame_tip"])
        tongue = flame_tongue(
            f"{name}_tongue_{index}", material,
            base=(center[0] + reach * cos(angle), center[1] + reach * 0.7 * sin(angle), center[2]),
            height=tongue_height, radius=0.34 + 0.42 * abs(sin(index * 2.3)),
            lean=0.34 * cos(angle * 1.7 + index), spin=angle,
        )
        nd.parent_keep_world(tongue, rig)

    # Eight samples per loop, back to the starting scale so the loop closes seamlessly.
    steps = 8
    for step in range(steps + 1):
        at = step / steps
        pulse = 0.72 + 0.28 * (0.5 + 0.5 * sin((at + phase) * 2 * pi))
        nd.keyframe(rig, nd.beat_frame(scene, at * beats), scale=(1.0, 1.0, pulse))


def ember_bed(name, mats, *, start_x, end_x, half_width, height_z, count):
    """The burning floor under the flames: scattered coals lying on the vault back.

    Without this the roof fire is a row of cones standing on nothing. What is actually alight up
    there is the wreckage of the frame lying on the extrados.

    They are small on purpose. The first pass used panels a few metres across, and at that size a
    glowing surface stops reading as embers and becomes a lit slab -- from above the attic looked
    like it had been paved. Coals have to be smaller than the flames they feed.

    And they are deliberately not rotated. These are root meshes, so merge_animated_meshes joins
    them into the frame of whichever one it makes active; a tilted frame then swings the other
    hundred metres of the run through it, and the part's bounding box -- the number the preset
    places by -- grows to a width the geometry never has. Measured: a 0.7 radian tilt turned a
    10 m wide bed into a 105 m one. Shape variety comes from the sizes instead.
    """
    span = end_x - start_x
    for index in range(count):
        at = (index + 0.5) / count
        across = half_width * 0.75 * sin(index * 2.7)
        size = 0.5 + 0.55 * abs(cos(index * 1.9))
        nd.cube(
            f"{name}_coal_{index}_nocol_noshadow",
            (start_x + span * at + 1.4 * cos(index * 3.1), across, height_z),
            (size, size * (0.5 + 0.5 * abs(sin(index * 2.2))), 0.16),
            mats["flame_tip"] if index % 3 else mats["flame_body"],
        )


def build_fire_breaches(scene, mats):
    """One beat. Flame standing in the three holes the fire opened: the crossing, the north
    transept arm, and the nave's north aisle bay.

    They are placed at the rim of each breach rather than in the middle of it, because that is
    where the draught is and because a flyable hole must stay flyable -- the light has to say
    'this is where it burns' without the flame filling the way through.
    """
    mats = flame_materials(mats)
    aisle_bay_x = nd.NAVE_START_X + nd.BAY_LENGTH * (nd.NAVE_BAYS - 0.5)
    arm_y = (nd.NAVE_HALF_WIDTH + nd.TRANSEPT_HALF) / 2

    # The crossing: the biggest hole and the one the spire came through, so the tallest flame.
    for index, offset in enumerate((-4.6, 4.6)):
        flame_cluster(
            scene, f"FireCrossing{index}", mats,
            center=(nd.CROSSING_CENTER_X + offset, 0, nd.NAVE_VAULT_Z - 1.0),
            spread=2.6, height=7.5, count=8, beats=1, phase=index / 2,
        )
    # The north transept arm.
    flame_cluster(
        scene, "FireTransept", mats,
        center=(nd.CROSSING_CENTER_X, arm_y, nd.NAVE_VAULT_Z - 2.5),
        spread=3.2, height=5.5, count=8, beats=1, phase=1 / 3,
    )
    # The aisle bay, low and much smaller: this one is seen from inside, at eye level.
    flame_cluster(
        scene, "FireAisle", mats,
        center=(aisle_bay_x, (nd.NAVE_HALF_WIDTH + nd.AISLE_OUTER) / 2, nd.AISLE_VAULT_Z - 1.0),
        spread=2.2, height=3.4, count=6, beats=1, phase=2 / 3,
    )


def build_fire_attic(scene, mats):
    """One beat. The roof fire itself, running the length of the open attic.

    This is the piece that is seen from the river, so it is built along the whole vessel rather
    than as one bonfire: a burning roof is a line of fire, and the silhouette of the building has
    to be read against it. The clusters are phased across the length so the line ripples instead
    of pulsing as one block.
    """
    mats = flame_materials(mats)
    # Four clusters over the nave and three over the choir, not one per bay: every cluster costs
    # one node per material it uses, and nine tongues in four places read as a burning roof just
    # as well as seven in ten places while drawing less.
    runs = (
        (nd.NAVE_START_X, nd.NAVE_END_X, 4),
        (nd.CHOIR_START_X, nd.CHOIR_END_X + nd.APSE_RADIUS * 0.6, 3),
    )
    group = 0
    for start_x, end_x, count in runs:
        span = end_x - start_x
        # The bed of glow the tongues stand in, laid the length of the run.
        ember_bed(
            f"attic_glow_{group}", mats,
            start_x=start_x, end_x=end_x, half_width=nd.CLERESTORY_HALF * 0.9,
            height_z=nd.NAVE_VAULT_Z + 0.45, count=count * 3,
        )
        for index in range(count):
            at = (index + 0.5) / count
            flame_cluster(
                scene, f"FireAttic{group}", mats,
                center=(start_x + span * at, 0, nd.NAVE_VAULT_Z + 1.2),
                spread=5.2, height=6.0 + 2.0 * abs(sin(group * 1.9)), count=9,
                beats=1, phase=(group % 5) / 5,
            )
            group += 1


def build_ember_column(scene, mats):
    """Two beats. What rises off the crossing: a standing column of embers, drifting upward.

    Each ember holds its own height on the column and climbs a share of the spacing over the loop,
    growing as it goes and shrinking again at the top, where the next one has already taken its
    place. That is what makes the column continuous: no ember has to wrap around the end of the
    loop, which would interpolate backwards and rain the sparks back down.

    The ends of that pulse are deliberately small rather than zero. A rig scaled to nothing at the
    start frame collapses the part's bounding box to a point, and the loader places every model by
    that box -- the whole column would be positioned off a single coordinate. At this height the
    difference between a spark at 15% and one that is gone is not visible anyway.
    """
    mats = flame_materials(mats)
    total_beats = 2
    count = 12
    column_height = 26.0
    spacing = column_height / count
    for index in range(count):
        angle = index * (2 * pi / count) * 3.0
        drift = 2.2 + 3.4 * (index % 4) / 3
        base_height = spacing * index
        origin = (nd.CROSSING_CENTER_X, 0.0, nd.NAVE_VAULT_Z)
        rig = nd.empty(f"Ember{index}Rig", origin)
        spark = nd.cube(
            f"ember_{index}_nocol_noshadow", origin, (0.22, 0.22, 0.32), mats["ember"],
        )
        nd.parent_keep_world(spark, rig)

        def key(at_loop, climb, scale):
            # The rig carries the absolute position: a keyframed location replaces the one the
            # empty was created with rather than adding to it.
            reach = climb / column_height
            nd.keyframe(
                rig, nd.beat_frame(scene, at_loop * total_beats),
                location=(origin[0] + drift * cos(angle) * reach,
                          origin[1] + drift * sin(angle) * reach,
                          origin[2] + climb),
                scale=(scale, scale, scale),
            )

        # Higher embers are smaller: the column tapers, which is what reads as distance.
        peak = 1.0 - 0.45 * (index / count)
        for step in range(5):
            at = step / 4
            pulse = 0.15 + (peak - 0.15) * (0.5 - 0.5 * cos(at * 2 * pi))
            key(at, base_height + spacing * at, pulse)


# Each entry is (file stem, builder). The numbering continues the intact set so a directory
# listing still reads west to east, with the debris as a new part of its own.
ARCHITECTURE = (
    ("02_nave_burnt", build_nave_burnt),
    ("03_transept_burnt", build_transept_burnt),
    ("06_roof_burnt", build_roof_burnt),
    ("20_fleche_debris", build_fleche_debris),
)

# (file stem, clip name, loop seconds, builder). The clip name is what the runtime clock addresses.
SETPIECES = (
    ("30_fire_breaches", "FireBreachesLoop", 6, build_fire_breaches),
    ("31_fire_attic", "FireAtticLoop", 6, build_fire_attic),
    ("32_ember_column", "EmberColumnLoop", 12, build_ember_column),
)


def main():
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    GLB_DIR.mkdir(parents=True, exist_ok=True)
    # Point the shared exporter at this map's directories. Reusing it rather than copying forty
    # lines keeps the glTF flags -- Y-up, applied modifiers, no cameras or lights -- identical to
    # the intact set, which is what lets both maps load the parts the same way.
    nd.SOURCE_DIR = SOURCE_DIR
    nd.GLB_DIR = GLB_DIR
    for part in ARCHITECTURE:
        nd.export_part(*part)
    for setpiece in SETPIECES:
        nd.export_setpiece(*setpiece)


if __name__ == "__main__":
    main()
