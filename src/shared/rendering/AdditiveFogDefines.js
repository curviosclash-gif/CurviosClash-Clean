// Opts an additive glow into fading out in fog instead of adding the fog colour
// (see ATMOSPHERIC_FOG_ADDITIVE in src/core/renderer/AtmosphericFogShaderPatch.js).
// Set after construction: MeshBasicMaterial has no `defines` property, so three.js drops a
// `defines` entry passed to its constructor without a trace.
export function applyAdditiveFogFade(material) {
    material.defines = { ...material.defines, ATMOSPHERIC_FOG_ADDITIVE: 1 };
    return material;
}
