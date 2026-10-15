"""Small deterministic mesh helpers shared by the Cloud Harbor static builders."""

from math import cos, pi, sin

from mathutils import Matrix

import cloud_harbor_layout as L


def _orientation(a, b, c):
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def _triangulate_polygon(points):
    """Deterministic ear clipping for the simple concave harbor-gorge footprint."""
    order = list(range(len(points)))
    area = sum(points[index][0] * points[(index + 1) % len(points)][1]
               - points[(index + 1) % len(points)][0] * points[index][1]
               for index in range(len(points)))
    if area < 0.0:
        order.reverse()
    triangles = []
    while len(order) > 3:
        ear = None
        for cursor, current in enumerate(order):
            previous = order[cursor - 1]
            following = order[(cursor + 1) % len(order)]
            a, b, c = points[previous], points[current], points[following]
            if _orientation(a, b, c) <= 1e-8:
                continue
            contains = False
            for candidate in order:
                if candidate in (previous, current, following):
                    continue
                p = points[candidate]
                if (_orientation(a, b, p) >= -1e-8
                        and _orientation(b, c, p) >= -1e-8
                        and _orientation(c, a, p) >= -1e-8):
                    contains = True
                    break
            if not contains:
                ear = cursor
                triangles.append((previous, current, following))
                break
        if ear is None:
            raise ValueError("island notch footprint is not a simple polygon")
        del order[ear]
    triangles.append(tuple(order))
    return triangles


def _add_notched_rock_island(canvas, center, radius_x, radius_z, bottom_y, top_y,
                             material, segments, notch):
    """Extrude a simple concave footprint; the inner gorge wall closes the collision shell."""
    notch_angle, notch_half, inner_radius = notch
    start, end = notch_angle - notch_half, notch_angle + notch_half
    outer_angles = [end]
    outer_angles.extend(angle for index in range(segments)
                        if end < (angle := 360.0 * index / segments) < start + 360.0)
    outer_angles.append(start + 360.0)
    inner_angles = [start]
    inner_angles.extend(angle for index in range(segments)
                        if start < (angle := 360.0 * index / segments) < end)
    inner_angles.append(end)

    outline = []
    for degrees in outer_angles:
        angle = degrees * pi / 180.0
        index = len(outline)
        wobble = 1.0 + 0.035 * sin(index * 2.17 + radius_x)
        outline.append((center[0] + cos(angle) * radius_x * wobble,
                        center[1] + sin(angle) * radius_z * wobble))
    for degrees in inner_angles:
        angle = degrees * pi / 180.0
        outline.append((center[0] + cos(angle) * inner_radius,
                        center[1] + sin(angle) * inner_radius))

    triangles = _triangulate_polygon(outline)
    levels = ((bottom_y, 0.82), (bottom_y + 8.0, 0.94),
              (top_y - 10.0, 1.0), (top_y, 0.88))
    verts = []
    for height, scale in levels:
        for x, z in outline:
            verts.append(L.bl(center[0] + (x - center[0]) * scale,
                              height,
                              center[1] + (z - center[1]) * scale))
    count = len(outline)
    faces = []
    # The authored boundary includes the outer shoreline, two gorge cheeks and a solid inner
    # arc. Matching cap edges and side edges gives every undirected edge exactly two faces.
    for level in range(len(levels) - 1):
        lower, upper = level * count, (level + 1) * count
        for index in range(count):
            following = (index + 1) % count
            faces.append((lower + index, upper + index,
                          upper + following, lower + following))
    top = (len(levels) - 1) * count
    for a, b, c in triangles:
        faces.append((top + a, top + c, top + b))
        faces.append((b, c, a))
    canvas._add(material, False, verts, faces, Matrix.Identity(4))


def add_rock_island(canvas, center, radius_x, radius_z, bottom_y, top_y, *,
                    material=None, segments=20, notch=None):
    """Build a closed faceted island with an optional radial gorge cut into its rim.

    ``notch`` is (map-angle-degrees, half-angle-degrees, inner-radius). The omitted wedge starts
    at ``inner-radius`` and reaches the island edge, which lets a course skim an island without
    moving either the authored route or its clearance contract.
    """
    material = material or L.ROCK
    if notch is not None:
        _add_notched_rock_island(canvas, center, radius_x, radius_z, bottom_y, top_y,
                                  material, segments, notch)
        return
    # Bottom lip, broad underside, shoulder, then a smaller flat collidable landing.
    levels = ((bottom_y, 0.48), (bottom_y + 9.0, 0.84), (top_y - 10.0, 1.0),
              (top_y, 0.88))
    vertices = []
    for height, scale in levels:
        for index in range(segments):
            angle = 2.0 * pi * index / segments
            wobble = 1.0 + 0.035 * sin(index * 2.17 + radius_x)
            vertices.append(L.bl(center[0] + cos(angle) * radius_x * scale * wobble,
                                 height,
                                 center[1] + sin(angle) * radius_z * scale * wobble))

    faces = []
    for level in range(len(levels) - 1):
        for index in range(segments):
            a = level * segments + index
            b = level * segments + (index + 1) % segments
            c = (level + 1) * segments + (index + 1) % segments
            d = (level + 1) * segments + index
            faces.append((a, b, c, d))

    # Close underside and top. The same wedge rule leaves a deliberate, capped inner wall.
    bottom_center = len(vertices)
    vertices.append(L.bl(center[0], bottom_y, center[1]))
    top_center = len(vertices)
    vertices.append(L.bl(center[0], top_y, center[1]))
    for index in range(segments):
        angle = 360.0 * (index + 0.5) / segments
        faces.append((bottom_center, (index + 1) % segments, index))
        offset = (len(levels) - 1) * segments
        faces.append((top_center, offset + (index + 1) % segments, offset + index))
    canvas._add(material, False, vertices, faces, Matrix.Identity(4))


def add_annular_shell(canvas, material, x_start, x_end, center_y, center_z,
                      inner_radius, outer_radius, *, stations=18, sides=24,
                      decorative=False):
    """Closed thick-walled tube along map +x, open through the centre and capped at both ends."""
    verts = []
    outer_profile = []
    # A polygon's chords sit inside the vertex radius. Move the inner vertices out just enough
    # that the actual polygonal bore still clears the requested radius between its sides.
    bore_vertex_radius = inner_radius / cos(pi / sides)
    for index in range(stations + 1):
        t = index / stations
        # Rounded bow and stern shoulders, full body through the two cargo portals.
        shoulder = min(1.0, 0.88 + 0.12 * min(t * 4.0, (1.0 - t) * 4.0))
        outer_profile.append(outer_radius * shoulder)
        x = x_start + (x_end - x_start) * t
        for side in range(sides):
            for radius in (bore_vertex_radius, outer_profile[-1]):
                angle = 2.0 * pi * side / sides
                verts.append((x, -center_z + radius * cos(angle),
                              center_y + radius * sin(angle)))

    stride = sides * 2
    faces = []
    for station in range(stations):
        base, following = station * stride, (station + 1) * stride
        for side in range(sides):
            nxt = (side + 1) % sides
            # Inner wall, outer skin, and the two end annuli are all closed shells.
            faces.extend(((base + side * 2, following + side * 2,
                           following + nxt * 2, base + nxt * 2),
                          (base + side * 2 + 1, base + nxt * 2 + 1,
                           following + nxt * 2 + 1, following + side * 2 + 1)))
    for side in range(sides):
        nxt = (side + 1) % sides
        first, last = side * 2, stations * stride + side * 2
        first_next, last_next = nxt * 2, stations * stride + nxt * 2
        faces.extend(((first, first_next, first_next + 1, first + 1),
                      (last, last + 1, last_next + 1, last_next)))
    canvas._add(material, decorative, verts, faces, Matrix.Identity(4))


def add_arch_ring(canvas, material, center, normal, radius, tube_radius, *,
                  major_segments=36, minor_segments=8, decorative=False):
    """Circular vertical arch in a plane normal to the supplied map x/z direction."""
    nx, nz = normal
    lateral = (-nz, nx)
    verts = []
    for major in range(major_segments):
        theta = 2.0 * pi * major / major_segments
        radial_x, radial_z = lateral[0] * cos(theta), lateral[1] * cos(theta)
        up = sin(theta)
        for minor in range(minor_segments):
            phi = 2.0 * pi * minor / minor_segments
            normal_offset = tube_radius * sin(phi)
            radial_offset = tube_radius * cos(phi)
            x = center[0] + radius * radial_x + radial_offset * radial_x + normal_offset * nx
            z = center[2] + radius * radial_z + radial_offset * radial_z + normal_offset * nz
            y = center[1] + (radius + radial_offset) * up
            verts.append(L.bl(x, y, z))
    faces = []
    for major in range(major_segments):
        next_major = (major + 1) % major_segments
        for minor in range(minor_segments):
            next_minor = (minor + 1) % minor_segments
            a = major * minor_segments + minor
            b = next_major * minor_segments + minor
            faces.append((a, b, next_major * minor_segments + next_minor,
                          major * minor_segments + next_minor))
    canvas._add(material, decorative, verts, faces, Matrix.Identity(4))
