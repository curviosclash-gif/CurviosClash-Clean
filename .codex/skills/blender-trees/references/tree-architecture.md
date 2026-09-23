# Tree Architecture Reference

Use these ranges as starting points for a mature broad deciduous tree. Change them for conifers, palms, pollards, columnar trees, stylized assets, storm-damaged trees, or a specific species.

## Hierarchy and Ratios

Typical starting ranges:

| Order | Length relative to parent | End radius relative to start | Direction change |
| --- | ---: | ---: | ---: |
| Primary | 0.45–0.80 of tree height | 0.35–0.58 | 20–55 degrees from trunk axis |
| Secondary | 0.35–0.70 | 0.38–0.62 | 18–52 degrees from parent |
| Tertiary | 0.28–0.58 | 0.36–0.60 | 20–60 degrees from parent |
| Fine | 0.18–0.45 | 0.28–0.55 | 18–68 degrees from parent |

Scale these ranges by vigor, light access, and crown position. Upper shoots often have more upward bias; low or old limbs may sag.

Use the pipe-model idea as a plausibility check and calculate radii from tips toward the base:

```text
r_parent^n = sum(r_child^n)
```

An exponent `n` between roughly 2 and 3 is a useful biological starting range. It need not be mathematically exact in a stylized asset, but child branches should not look structurally impossible. Apply species, age, damage, and art-direction adjustments after the structural pass.

## Recursive Direction

At each child site, blend:

- parent tangent inheritance;
- radial divergence around the parent;
- upward phototropism;
- gravity or age sag;
- outward crown-space attraction;
- repulsion from nearby major branches;
- deterministic jitter.

Golden-angle spacing near 137.5 degrees is useful for distributing many attachments, but add bounded divergence and skip selected sites. Never force all descendants into a single parent plane.

Stop recursion by minimum radius, minimum length, maximum order, crown-envelope boundary, or polygon budget. Use fewer, more intentional paths before increasing recursion depth.

Orient cross-sections, leaf frames, and directional bark with a minimum-twist or parallel-transport frame. Reusing a fixed world-up vector near vertical or reversing branches can cause sudden roll flips.

## Crown Coverage

Represent the intended crown as an ellipsoid or species-specific envelope. Track terminal sites in azimuth and height bands. If one sector is empty, first redirect or lengthen branches that can plausibly occupy it; do not hide the problem with a disconnected foliage cloud.

For a deliberately round broad crown, compare silhouette widths across evenly spaced azimuth views. A minimum-to-maximum width ratio above roughly 0.8 is a useful warning threshold, not a universal acceptance rule. Columnar, windswept, and flat-topped species need their own target.

Maintain a mix of:

- outer terminal clusters defining the contour;
- middle-depth foliage connecting branch groups;
- sparse inner foliage and fine twigs preventing a hollow shell;
- negative spaces revealing major architecture.

## Branch Bases

Increase radius locally where a branch joins the trunk or parent. Use tapered collars, blended curves, or clean boolean/remesh workflows depending on the target. If collars are separate curve geometry, avoid capped ends that create dark disks or obvious seams.

Inspect bases under grazing light and from the opposite side. A join that works frontally may expose a wedge or floating intersection at 90 degrees.

## Roots

Create buttress and surface roots as part of the trunk's structural rhythm. Vary root prominence deliberately rather than using evenly spaced copies. Dominant roots can be longer and thicker; subordinate roots shorter, partially buried, or forked less often.

Follow terrain where available. On flat preview ground, lower root tips slightly below the surface so they do not appear to float. Keep detailed root collision only when gameplay needs it.

## Bark and Age

Combine scales:

- large trunk taper and lobing;
- longitudinal ridges and grooves following each branch;
- medium cracks, plates, and scars;
- restrained micro-roughness.

For aged dry bark, roughness around 0.85–0.98 is a useful starting range. Species and moisture override this. Dark grooves should read as recesses rather than painted black lines.

Age details should have causes and preferred locations: deadwood in shaded or damaged areas, fungi on old or damp trunk zones, scars near lost limbs, and dry leaves in stressed clusters.

## Wind

Keep the trunk nearly rigid. Scale displacement inversely with branch thickness and increase it toward tips. Fine branches should lead leaf movement without separating from the trunk. Neighboring leaf clusters share phase with subtle offsets.

For morph animation, verify the basis and gust targets on the exported fine-branch and foliage primitives. For skeletal animation, verify bone weights and action names. LOD exports can remain static unless the engine's LOD system preserves the chosen animation mechanism.

## Game Exports

Useful starting targets depend on the platform, camera distance, and foliage method. Measure rather than guess. Preserve materials and silhouette while reducing:

1. hidden fine twigs and interior leaves;
2. curve radial segments and leaf subdivisions;
3. medium branch curvature;
4. only then outer contour detail.

Build collision from a trunk volume plus a small number of primary-branch volumes. Export collision separately or with the engine's required naming convention.

## Multi-View Acceptance

Use at least eight evenly spaced azimuth previews when crown roundness is a stated requirement. Keep camera height, projection, scale, and lighting constant. Record width measurements, the minimum-to-maximum ratio, overall bounds, branch counts by order, evaluated triangle counts, file sizes, and animation presence.

Roundtrip-import the hero, every LOD, and collision export. Confirm that the hero retains required animation and morph targets, LODs retain materials and bounds, and the collision file contains only the intended simple volumes.
