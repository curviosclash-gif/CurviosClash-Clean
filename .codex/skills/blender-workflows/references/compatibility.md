# Blender and Runtime Compatibility

Do not assume that the Blender version used to author a skill matches the installed version or the target importer.

## Version Detection

- Discover the Blender executable rather than hard-coding a path.
- Inspect `bpy.app.version` and `bpy.app.version_string` at runtime.
- Record the version in generated manifests and QA reports.
- Use feature checks or small version branches for renamed render engines, Geometry Nodes sockets, action slots, and exporter properties.
- Fail with an actionable message when a required feature is unavailable; do not silently omit output.

## Blender 4.2 and Later

- Blender 4.2 uses Eevee Next under the `BLENDER_EEVEE_NEXT` engine identifier.
- Blender 4.4 introduced slotted actions and changed parts of action and NLA export behavior. Do not assume that grouping tracks by name behaves identically across 4.2, 4.4, and later versions.
- Geometry Nodes features such as repeat or simulation zones require version checks when a skill promises compatibility with older Blender releases.
- Exporter operator arguments can change. Query the installed operator or test a minimal export instead of copying an argument list from another version.

## Target Runtime Profile

Capture these facts before choosing materials or animation:

- engine and loader version;
- supported glTF or FBX features and extensions;
- coordinate and unit conventions;
- material alpha and two-sided behavior;
- maximum bone influences and morph targets;
- animation clip naming and looping convention;
- LOD discovery and switching convention;
- collision naming and file layout;
- texture formats, compression, and memory limits.

If no runtime is named, deliver conservative core glTF 2.0 and report assumptions. Do not enable required extensions merely because Blender can export them.

## Reproducibility

Record generator seed, Blender version, script version or hash when available, output paths, and validation facts. A newer Blender run may legitimately change triangulation, shading, animation organization, or binary output, so compare semantic facts rather than binary equality alone.

## Primary References

- [Blender command-line arguments](https://docs.blender.org/manual/en/latest/advanced/command_line/arguments.html)
- [Blender glTF 2.0 importer and exporter manual](https://docs.blender.org/manual/en/latest/addons/import_export/scene_gltf2.html)
