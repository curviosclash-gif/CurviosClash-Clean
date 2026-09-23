# glTF Runtime Contract

Read this before creating or validating `.glb` or `.gltf` output. Treat `.blend` as the editable authoring format and glTF as a runtime delivery format.

## Geometry

- Exported glTF geometry is mesh-based. Evaluate Blender curves, text, Geometry Nodes, and other procedural types on an export copy.
- Measure the exported result. Quads and n-gons become triangles, while UV discontinuities, material boundaries, and hard normals may duplicate vertices.
- Verify positive, finite transforms and the intended up and forward axes after roundtrip.
- Keep collision, render geometry, cameras, lights, and helpers in explicit export sets.
- Preserve stable node and action names only where the runtime actually consumes them.

When gameplay addresses individual parts, validate the exported **and engine-loaded** node hierarchy, not only the Blender object list. Material primitives may become child meshes while names, custom properties, and transforms remain on a parent node. Check that every required part has a unique stable ID, its expected metadata, and a usable transform after import; keep noninteractive geometry batched where practical.

When an animated visible mesh defines a damage or collision volume, compare the exported mesh surface or bounds through its full transform chain with the gameplay volume, including intermediate animation times. Matching rig scale alone is insufficient: a flattened or offset unit mesh can extend differently from a sphere with the same scale. Keep a regression check that fails for that mismatch; do not assume every decorative mesh should acquire a collider.

## Materials and Foliage

- Use Principled metallic-roughness inputs that the exporter recognizes; bake unsupported procedural shading when visual parity matters.
- For every visible primitive whose authored color is not white, inspect the exported document for an effective source: a non-white `baseColorFactor`, a `baseColorTexture`, or `COLOR_0`. A colored Blender viewport or `diffuse_color` is not export evidence. When using vertex colors, bind the intended attribute through an exporter-recognized material node, then confirm the target loader enables and reads it; a white material factor is valid only when the texture or vertex color supplies the intended result.
- Use `OPAQUE` for solid bark and stems.
- Prefer `MASK` for most leaf cards because it avoids order-dependent blending. Choose and test `alphaCutoff` in the target renderer.
- Use `BLEND` only when partial transparency is required and runtime sorting artifacts are acceptable.
- Set `doubleSided` deliberately. Two-sided leaves require correct back-face lighting; otherwise use oriented or doubled geometry according to the engine.
- Validate base-color alpha, roughness, normal maps, color space, and texture paths after import.
- A geometry-only test loader that removes materials cannot validate material or color parity. Inspect the original exported material assignments and values, or use the real material-capable loader; comparing substituted default materials is not evidence.

## Volumetric smoke transferred to a real-time renderer

When a Blender volume must look similar in a mesh-based runtime, first choose a
representation that retains density and soft silhouettes. More triangles alone
do not reproduce volume shading. A practical bounded alternative is an RGBA
smoke atlas baked from the source material, with overlapping cards following the
exported animation rigs. Preserve the volume authoring scene; validate the atlas
and the target shader as separate deliverables rather than claiming the GLB
contains the original volume shader.

- Check transparent padding on every atlas tile, graded alpha, colour space and
  packaged texture loading. Inspect the original view and an opposing view;
  sorting and repeated flat silhouettes can be invisible from one camera.
- Bind positions to the authoritative animation phase and imported transforms.
  Test the first render after a time seek, a round reset and a second camera;
  an extra warm-up render can conceal stale GPU data. In three.js r186,
  geometry attributes are uploaded during scene projection, before an object's
  `onBeforeRender`. Updating them there can lag one render; prepare them earlier
  or use a verified per-draw uniform/data-texture path. This is an engine-version
  detail, not a universal renderer rule.
- Keep tall column cards upright unless their authored shape requires rotation.
  Treat flat ground dust separately: camera-facing cards clipped by the ground
  can produce sharp wedges. Existing dust geometry can remain a valid solution.
- For continuous plume-to-vortex transport, rotating separate lobes is not enough.
  Join the advected paths with matching positions and tangents; test inner upflow,
  top outflow, outer downflow and underside inflow independently. Fade recycled
  parcels at open-path endpoints and verify deterministic time seeks.
- For requested local width changes, record the current reference revision, pose,
  cross-section heights and diameter definition before editing. Different base
  and upper multipliers need a smooth height-dependent profile, not one object
  scale. Apply the same profile to supporting geometry and advected smoke paths,
  normalized against the same physical height: a stem top and a vortex centre
  are different extents. Check the profile at matching world-space heights;
  verify source/export sections and the visible runtime silhouette separately.
  Keep the user's ratios in the asset brief, not as defaults for other clouds.
- When tuning visible heat, inspect the complete emission calculation: a slow
  parcel cooling curve multiplied by a fast global fade still loses its glow
  early. Evaluate the combined result at ignition, rise and cooled poses before
    claiming longer-lived local embers. Distinguish emission from smoke colour.
  Check texture thresholds in the shader's decoded colour space: sRGB texels
  become darker linear samples. Compare otherwise identical engine renders with
  emission enabled and disabled; nonzero heat uniforms alone do not prove glow
  reaches the image.
- When soft smoke must respect a height bound, fit lobe extents before drawing;
  a hard global cut can visibly flatten the cloud. Keep decorative alpha bounds
  separate from fireball damage and collision contracts.
- Batch cards, bound overdraw and release atlas/data textures with the scene.
  Compare the same pose, resolution and camera with the effect enabled/disabled;
  confirm the effect is actually inside the camera frustum and reset cumulative
  render counters per sample. Concurrent game instances invalidate hardware
  performance claims. A draw-call reduction alone does not establish faster GPU
  rendering of transparent smoke.
- If distance LOD compacts a fixed-capacity instance buffer, test sorting only over
  the active draw range. Check unused rows separately for stale data, and verify
  that receding reduces the actual instance count and approaching restores it.
  Capacity is not the number of rendered instances.

## Animation

Core glTF animation supports node translation, rotation, scale, skinned bones, and morph-target weights. It does not define arbitrary material, physics, modifier, or Geometry Nodes animation.

- Bake unsupported procedural motion into node, bone, or morph animation.
- Give each runtime clip a stable name and explicit range.
- Confirm the exported file contains animations and that their channel paths target valid nodes.
- For baked collapses, validate independently moving parts by changing relative transforms, not just channel counts or how many descendants move. Sweep the actual engine-loaded geometry across the exported clip, including release, impact, and retimed intermediate poses, against the intended contact surfaces. A passing proxy simulation or stationary final frame does not prove that visible pieces avoid penetration.
- Confirm every morph-enabled primitive has the expected target count.
- Define looping, autoplay, speed, and clip selection in the runtime; glTF stores keyframes but does not define playback policy.
- Inspect payload size: morph targets duplicate per-vertex displacement data and can dominate vegetation files.

## Extensions and Compression

- Record `extensionsUsed` and `extensionsRequired` for every export.
- Enable Draco, mesh quantization, GPU instancing, or compressed textures only after confirming the target importer supports the exact extension.
- Compare compressed and uncompressed roundtrips; compression is not valid if bounds, normals, UVs, materials, or animation degrade beyond the stated tolerance.

## Roundtrip Gate

1. Export from an explicit selection or collection.
2. Validate the container with `scripts/validate_glb.py`.
3. Import it into an empty Blender scene.
4. Recount exported vertices, triangles, meshes, materials, actions, bones, and morph targets.
5. Compare bounds, pivot, orientation, alpha behavior, rest pose, peak pose, and clip range.
6. Run the target engine's loader or smallest relevant project build.

For repository assets, confirm that the build also copies or bundles the runtime file at the path the loader requests. A successful standalone GLB roundtrip does not prove the packaged application can load it.

Example structural check:

```text
python validate_glb.py tree.glb --require-animation --require-morphs --max-triangles 120000
```

Numeric budgets are project inputs, not universal defaults.

## Primary References

- [Khronos glTF 2.0 specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html)
- [Blender glTF 2.0 importer and exporter manual](https://docs.blender.org/manual/en/latest/addons/import_export/scene_gltf2.html)
