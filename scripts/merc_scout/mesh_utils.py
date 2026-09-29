"""Mesh helpers for the character generator: ring lofts with analytic UVs.

Everything the generator builds is a ring loft (a sequence of cross sections
bridged into quads). That single technique gives three things at once:

* quad topology through the joints, which is what a deforming character needs;
* analytic UVs (u around the section, v along the length), so the texture
  painter knows where the face, the chest or a boot seam ends up;
* deterministic output: no randomness, no interactive operators.

Randomness, if a caller needs it, must come from ``random.Random(seed)``.
"""

from __future__ import annotations

import math

import bpy
from mathutils import Matrix, Vector

Vec3 = tuple[float, float, float]


# --------------------------------------------------------------------------- #
# cross sections
# --------------------------------------------------------------------------- #


def ring2d(segments: int, rx: float, ry: float, exponent: float = 2.0,
           front_scale: float = 1.0, back_scale: float = 1.0,
           flat_bottom: float = 0.0) -> list[tuple[float, float]]:
    """One closed cross section in local (x, y); index 0 faces -Y (front).

    ``exponent`` 2 is an ellipse, higher values square the section off (torso).
    ``front_scale``/``back_scale`` stretch the front and back halves
    independently, which is how a chest stays deeper than a back.
    ``flat_bottom`` clamps the lower half towards a flat sole.
    """
    points: list[tuple[float, float]] = []
    power = 2.0 / exponent
    for index in range(segments + 1):  # closing point duplicates index 0 for the UV seam
        angle = 2.0 * math.pi * index / segments
        sin_t, cos_t = math.sin(angle), math.cos(angle)
        x = rx * math.copysign(abs(sin_t) ** power, sin_t)
        y = -ry * math.copysign(abs(cos_t) ** power, cos_t)
        y *= front_scale if y < 0.0 else back_scale
        if flat_bottom and y > 0.0:
            y *= 1.0 - flat_bottom
        points.append((x, y))
    return points


def path_frames(path: list[Vec3]) -> list[tuple[Vector, Vector, Vector]]:
    """Frames along a polyline, transported without twisting.

    Rebuilding the frame from a fixed reference vector flips it by 180 degrees
    whenever the path turns past that reference, which shows up in the mesh as a
    sawtooth spiral. The frame is therefore carried along by the minimal rotation
    that takes one tangent to the next (parallel transport).
    """
    points = [Vector(point) for point in path]
    tangents: list[Vector] = []
    for index, point in enumerate(points):
        if index == 0:
            tangent = points[1] - point
        elif index == len(points) - 1:
            tangent = point - points[index - 1]
        else:
            tangent = points[index + 1] - points[index - 1]
        if tangent.length < 1e-9:
            tangent = Vector((0.0, 0.0, 1.0))
        tangents.append(tangent.normalized())

    reference = Vector((1.0, 0.0, 0.0)) if abs(tangents[0].x) < 0.9 else Vector((0.0, 1.0, 0.0))
    side = reference.cross(tangents[0])
    if side.length < 1e-6:
        side = Vector((0.0, 1.0, 0.0)).cross(tangents[0])
    side.normalize()
    up = tangents[0].cross(side).normalized()
    frames: list[tuple[Vector, Vector, Vector]] = [(tangents[0], side, up)]

    for index in range(1, len(points)):
        rotation = tangents[index - 1].rotation_difference(tangents[index])
        side = rotation @ side
        side = side - tangents[index] * side.dot(tangents[index])
        if side.length < 1e-6:
            side = Vector((1.0, 0.0, 0.0)).cross(tangents[index])
        side.normalize()
        up = tangents[index].cross(side).normalized()
        frames.append((tangents[index], side, up))
    return frames


# --------------------------------------------------------------------------- #
# building blocks
# --------------------------------------------------------------------------- #


def loft(sections: list[dict], *, segments: int = 16, cap_start: bool = True,
         cap_end: bool = True, v_scale: float = 1.0) -> tuple[list[Vec3], list[tuple[int, ...]], list[tuple[float, float]]]:
    """Bridge cross sections into quads.

    Each section is a dict with ``center`` (Vec3), optional ``side``/``up`` axis
    vectors (defaults to a Z-aligned frame), ``rx``, ``ry``, ``exponent``,
    ``front_scale``, ``back_scale``, ``flat_bottom`` and an optional ``warp``
    callable ``(x, y, t) -> (x, y)`` applied inside the local plane.
    Returns ``(verts, faces, uvs)`` with one UV per vertex.
    """
    verts: list[Vec3] = []
    uvs: list[tuple[float, float]] = []
    rings: list[list[int]] = []
    cumulative = 0.0
    previous_center: Vector | None = None

    for section in sections:
        center = Vector(section["center"])
        side = Vector(section.get("side", (1.0, 0.0, 0.0)))
        up = Vector(section.get("up", (0.0, 1.0, 0.0)))
        profile = ring2d(segments, section["rx"], section["ry"],
                         section.get("exponent", 2.0),
                         section.get("front_scale", 1.0),
                         section.get("back_scale", 1.0),
                         section.get("flat_bottom", 0.0))
        warp = section.get("warp")
        if warp is not None:
            profile = [warp(x, y, index / segments) for index, (x, y) in enumerate(profile)]
        if previous_center is not None:
            cumulative += (center - previous_center).length * v_scale
        previous_center = center
        offset = Vector(section.get("offset", (0.0, 0.0, 0.0)))
        shift = section.get("shift")
        ring: list[int] = []
        for index, (x, y) in enumerate(profile):
            point = center + side * x + up * y + offset
            if shift is not None:
                point = point + Vector(shift(index / segments))
            ring.append(len(verts))
            verts.append((point.x, point.y, point.z))
            uvs.append((index / segments, cumulative))
        rings.append(ring)

    faces: list[tuple[int, ...]] = []
    for lower, upper in zip(rings, rings[1:]):
        for index in range(segments):
            faces.append((lower[index], lower[index + 1], upper[index + 1], upper[index]))
    if cap_start:
        faces.extend(_cap(rings[0], verts, uvs, sections[0], segments, closing=False))
    if cap_end:
        faces.extend(_cap(rings[-1], verts, uvs, sections[-1], segments, closing=True))
    return verts, faces, uvs


def _cap(ring: list[int], verts: list[Vec3], uvs: list[tuple[float, float]],
         section: dict, segments: int, *, closing: bool) -> list[tuple[int, ...]]:
    """Fan cap with its own centre vertex so the UVs stay planar."""
    centre = Vector(section["center"]) + Vector(section.get("offset", (0.0, 0.0, 0.0)))
    index = len(verts)
    verts.append((centre.x, centre.y, centre.z))
    average_v = sum(uvs[position][1] for position in ring) / max(1, len(ring))
    uvs.append((0.5, average_v))
    faces = []
    for position in range(segments):
        first, second = ring[position], ring[position + 1]
        faces.append((first, second, index) if closing else (second, first, index))
    return faces


def tube(path: list[Vec3], radii: list[tuple[float, float]], *, exponent: float = 2.0,
         front_scale: float = 1.0, back_scale: float = 1.0, **kwargs) -> tuple[list[Vec3], list[tuple[int, ...]], list[tuple[float, float]]]:
    """Loft along a polyline with per-point (rx, ry) radii in the frame's plane.

    For a vertical path the frame's side axis is the world Y axis and its up axis
    is the world X axis, so ``rx`` measures depth and ``ry`` measures width.
    """
    frames = path_frames(path)
    sections = []
    for (tangent, side, up), point, (rx, ry) in zip(frames, path, radii):
        sections.append({"center": point, "side": side, "up": up, "rx": rx, "ry": ry,
                         "exponent": exponent, "front_scale": front_scale,
                         "back_scale": back_scale})
    return loft(sections, **kwargs)


def make_object(name: str, verts: list[Vec3], faces: list[tuple[int, ...]],
                uvs: list[tuple[float, float]] | None = None, *, smooth: bool = True) -> bpy.types.Object:
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(vertex) for vertex in verts], [], [list(face) for face in faces])
    mesh.validate(verbose=False)
    mesh.update()
    if uvs is not None:
        layer = mesh.uv_layers.new(name="UVMap")
        for polygon in mesh.polygons:
            for loop_index in polygon.loop_indices:
                vertex_index = mesh.loops[loop_index].vertex_index
                layer.data[loop_index].uv = uvs[vertex_index]
    for polygon in mesh.polygons:
        polygon.use_smooth = smooth
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


# --------------------------------------------------------------------------- #
# object level helpers
# --------------------------------------------------------------------------- #


def select_only(objects: list[bpy.types.Object], active: bpy.types.Object | None = None) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = active or objects[0]


def join(objects: list[bpy.types.Object], name: str) -> bpy.types.Object:
    """Join meshes into one object, keeping material slots and UVs."""
    if len(objects) == 1:
        objects[0].name = name
        objects[0].data.name = name
        return objects[0]
    select_only(objects, objects[0])
    bpy.ops.object.join()
    joined = bpy.context.view_layer.objects.active
    joined.name = name
    joined.data.name = name
    return joined


def apply_modifier(obj: bpy.types.Object, modifier: bpy.types.Modifier) -> None:
    select_only([obj], obj)
    bpy.ops.object.modifier_apply(modifier=modifier.name)


def triangles(objects: list[bpy.types.Object]) -> int:
    total = 0
    for obj in objects:
        obj.data.calc_loop_triangles()
        total += len(obj.data.loop_triangles)
    return total


def bounds(objects: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    low = Vector((1e9, 1e9, 1e9))
    high = Vector((-1e9, -1e9, -1e9))
    for obj in objects:
        for vertex in obj.data.vertices:
            point = obj.matrix_world @ vertex.co
            for axis in range(3):
                low[axis] = min(low[axis], point[axis])
                high[axis] = max(high[axis], point[axis])
    return low, high


def fit_uv_region(obj: bpy.types.Object, region: tuple[float, float, float, float]) -> None:
    """Scale the object's existing UVs into an atlas rectangle."""
    layer = obj.data.uv_layers.active
    if layer is None:
        return
    us = [item.uv[0] for item in layer.data]
    vs = [item.uv[1] for item in layer.data]
    if not us or not vs:
        return
    u0, v0, u1, v1 = region
    min_u, max_u = min(us), max(us)
    min_v, max_v = min(vs), max(vs)
    span_u = max(max_u - min_u, 1e-6)
    span_v = max(max_v - min_v, 1e-6)
    for item in layer.data:
        item.uv[0] = u0 + (item.uv[0] - min_u) / span_u * (u1 - u0)
        item.uv[1] = v0 + (item.uv[1] - min_v) / span_v * (v1 - v0)


def smart_unwrap(obj: bpy.types.Object, angle_degrees: float = 66.0) -> None:
    select_only([obj], obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle_degrees), island_margin=0.02)
    bpy.ops.uv.pack_islands(margin=0.02)
    bpy.ops.object.mode_set(mode="OBJECT")


def set_active_object(obj: bpy.types.Object) -> None:
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)


def delete_all() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials,
                       bpy.data.images, bpy.data.actions, bpy.data.objects):
        for item in list(collection):
            if item.users == 0:
                collection.remove(item)
