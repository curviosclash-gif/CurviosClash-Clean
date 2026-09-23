# Geometry Nodes for Plants

Use Geometry Nodes when the user benefits from interactive variation, reusable controls, or many related specimens. Use deterministic `bpy` instead when the primary requirement is unattended file generation.

## Recommended Data Flow

1. Represent stems and branch skeletons as curves.
2. Store growth order, age, vigor, radius, phase, organ type, and stable ID as attributes.
3. Resample curves only where downstream spacing requires it.
4. Set curve radius from branch order and taper, then use `Curve to Mesh` with a low-resolution profile appropriate to the LOD.
5. Generate organ sites from nodes or sampled curve positions.
6. Instance leaves, petals, fruit, and thorns on points.
7. Rotate instances from a stable local frame, phyllotaxis, light bias, gravity, and bounded scatter.
8. Keep instances unrealized through look development and viewport work.
9. Realize only the export copy or only where unique deformation and attribute processing require it.

## Stable Variation

- Derive random values from stable IDs so changing density does not completely reshuffle existing organs.
- Separate whole-plant, shoot-cluster, and organ-level variation.
- Expose morphology controls, not raw noise coordinates.
- Keep a visible seed input.
- Use omissions and dormant sites to create gaps without destroying the plant's arrangement.

## Node Group Interface

Useful top-level inputs include:

- seed;
- height and spread;
- node or internode density;
- branching probability and order limit;
- apical dominance;
- leaf scale, age curve, droop, and light bias;
- season and health;
- wind stiffness by branch order;
- preview or export quality.

Group related sockets into panels. Hide internal tuning inputs from the modifier interface. Give node groups stable domain prefixes such as `Plant_`, `Leaf_`, `Stem_`, and `Wind_`.

## Version and Export Boundaries

- Repeat and simulation zones require a compatible Blender version.
- Simulation results do not become arbitrary glTF animation. Bake supported output into transforms, bones, or morph targets.
- Evaluate curves and realize required instances on a duplicate export object or collection.
- Preserve the procedural source in the `.blend`.
- Measure geometry and attributes after realization; source instance count is not an exported vertex budget.

## QA

Test at least three seeds and the minimum and maximum useful parameter values. Reject configurations that invert leaves, disconnect organs, create non-finite geometry, exceed runtime budgets, or collapse into one viewing plane.

## Primary References

- [Blender Geometry Nodes instances](https://docs.blender.org/manual/en/latest/modeling/geometry_nodes/instances.html)
- [Blender Curve to Mesh node](https://docs.blender.org/manual/en/latest/modeling/geometry_nodes/curve/operations/curve_to_mesh.html)
- [Blender node groups](https://docs.blender.org/manual/en/latest/interface/controls/nodes/groups.html)
