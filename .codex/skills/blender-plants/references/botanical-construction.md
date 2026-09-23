# Botanical Construction Reference

## Parameterize Meaningful Growth Traits

Prefer parameters a plant designer can reason about:

- plant height and spread;
- growth habit and apical dominance;
- node count and internode length curve;
- branching probability by age or height;
- branch length and elevation response;
- phyllotaxis and leaves per node;
- leaf size, aspect, curl, droop, and age;
- light, gravity, wind, and support tropisms;
- seasonal and health state.

Avoid exposing separate noise controls for every coordinate unless the art direction genuinely needs them.

## Parent Frame

At an attachment point, construct a local frame from the parent tangent `T` and a stable reference vector. Derive two perpendicular axes `N` and `B`. Express child direction as a blend of:

- inherited tangent;
- radial direction around the stem;
- upward or downward bias;
- light direction;
- bounded scatter.

Rebuild the reference vector when it becomes nearly parallel to `T` to avoid frame flips.

## Phyllotaxis

Use the actual plant habit when known. For a generic spiral arrangement, golden-angle spacing near 137.5 degrees is a useful baseline, with small deterministic jitter. Opposite and whorled plants need discrete node groups rather than spiral placement.

Vary internode distance along the stem: crowded young growth near tips and wider mature internodes often read more naturally than constant spacing.

## Leaves

Create a leaf orientation from:

1. petiole or stem tangent;
2. outward radial direction;
3. light-facing bias;
4. gravity droop based on leaf age and size;
5. random roll and flutter within limits.

Use correlated size and color: young tip leaves can be smaller and lighter; shaded interior leaves darker; old or dry leaves less saturated. Break clusters through omissions and small gaps rather than independent extreme rotations.

## Flowers and Fruit

Attach reproductive organs to plausible nodes or terminals. Give them age stages and allow some empty sites. Weight the stem response by their mass if wind or droop is visible.

## Natural Variation

Good variation operates at several scales:

- whole plant: lean, crown asymmetry, dominant direction;
- shoot cluster: shared vigor, light response, local density;
- organ: scale, roll, age, damage.

Keep each scale bounded. If every level uses high-amplitude noise, the result loses the plant's species identity.

## Runtime Reduction

- Replace distant leaf geometry with cards or clustered meshes when appropriate.
- Preserve terminal silhouettes and flower heads before interior density.
- Collapse hidden stem segments and simplify curvature.
- Keep alpha overdraw in mind; fewer large overlapping cards may perform worse than more carefully placed geometry.
- Test the actual game camera and lighting, not only Blender close-ups.

## Validation Facts

Report plant bounds, triangle count after evaluation, material and texture count, number of instances or realized organs, wind mechanism, LOD counts, and whether alpha or double-sided rendering is required.
