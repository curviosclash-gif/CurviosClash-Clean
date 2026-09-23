# Blender Production Checklist

Use only the sections relevant to the requested deliverable.

## Scene Contract

- Confirm Blender version compatibility when the destination constrains it.
- Record units, up axis, forward axis, origin, pivot, and real-world dimensions.
- Keep source, preview, runtime, and collision outputs in distinct paths.
- Use stable names for exported objects and actions.
- Keep helpers, lights, cameras, and collision out of render exports unless explicitly required.

## Reproducible Automation

- Use a fixed random seed.
- Make output paths explicit and create only the required directories.
- Start from a known scene state without overwriting unrelated user content.
- Fail fast on missing inputs, invalid geometry, or export errors.
- Print compact validation facts: object roles, bounds, faces or triangles, materials, actions, and output paths.
- Save the `.blend` after geometry, materials, animation, and validation state are complete.

A typical command shape is:

```text
blender --background --factory-startup --python-exit-code 1 --python generator.py
```

Use the discovered executable and project-specific arguments rather than copying this literally.

## Geometry Checks

- No unintended zero-area faces, flipped normals, isolated fragments, or non-finite coordinates.
- Applied scale where exporters or physics require it.
- Shading mode and split normals survive export.
- Major joins look continuous in rendered views.
- Bounds and pivot match the intended placement.
- Triangle count is measured after modifiers and export evaluation.

## Material Checks

- Material count is intentional.
- Metallic and roughness values match the substance.
- Alpha mode and double-sided behavior are explicit for cards.
- Procedural materials either export correctly or are baked when the target requires textures.
- Neutral-light renders expose over-glossy, crushed, or self-illuminated surfaces.

## Animation Checks

- Frame range, frame rate, action names, and loop boundary are intentional.
- Rest pose is stable.
- Peak pose does not produce severe intersections or broken normals.
- When baking parented bone matrices, rotated children under non-uniform parent scale can introduce shear that location/rotation/scale keys cannot preserve. Use a scale/inheritance policy that avoids shear (uniform segment scale when acceptable), preserve the rest-frame orientation, and measure evaluated endpoints and attachment tangents across the full animation; assigning the intended matrix alone is not proof.
- Morph targets, bones, and actions exist in the exported container, not only in Blender.

## Preview Checks

- Use a consistent camera distance and lighting across comparison views.
- For alternate views of an animated scene, use a static QA camera or temporarily clear its animation; frame evaluation can restore keyed camera transforms. Confirm that the rendered viewpoints actually differ.
- Inspect front, side, rear, and three-quarter silhouettes.
- Verify transparent background by sampling image corners or inspecting alpha.
- Keep the asset fully in frame with enough margin for extremities and animation.

## Video Output Checks

- Set the FFmpeg codec before the container format and verify both in the saved `.blend`; changing codec can reset the container in Blender 4.2.
- Probe the final video for container, codec, dimensions, frame rate, frame count, and duration, then decode it end to end. Do not infer the container from the output filename.

## Export Roundtrip

For each runtime file:

1. open an empty Blender scene;
2. import the file;
3. count meshes, triangles, materials, actions, and morph-enabled primitives;
4. compare bounds and orientation with the source;
5. inspect representative materials and one animation cycle;
6. fail the task if required data disappeared.

## Delivery Report

State what was created, the runtime variants, triangle counts, animation mechanism, tests or builds run, and any deliberate limitations. Link the editable source and primary runtime asset. If cleanup or integration is blocked, name the exact remaining item.
