export const GPU_TIERS = Object.freeze({
    DISCRETE: 'discrete',
    INTEGRATED: 'integrated',
    SOFTWARE: 'software',
    UNKNOWN: 'unknown',
});

const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|microsoft basic render|software/i;
// Integrated graphics share memory bandwidth with the CPU. ULTRA roughly doubles the shadow and
// pixel cost, which such a chip only carries on the lightest maps. Intel Arc is a discrete card and
// never says HD or Iris; AMD's APUs call themselves "Radeon Graphics", "Vega N" or "780M".
const INTEGRATED_RENDERER = /intel.*\b(?:u?hd|iris)\b|radeon(?:\(tm\))?\s+(?:graphics|vega\s*\d+|\d{3}m\b)|\bmali\b|\badreno\b|powervr/i;
// Browsers that mask the unmasked name report a vendor placeholder instead.
const MASKED_RENDERER = /^(?:webkit webgl|mozilla|generic renderer|angle)$/i;

/**
 * @param {unknown} renderer the UNMASKED_RENDERER_WEBGL string
 * @param {{timerQuery?: boolean}} [options]
 * @returns {{gpuKey: string, tier: string, timerQuery: boolean}}
 */
export function classifyGpuRenderer(renderer, { timerQuery = false } = {}) {
    const gpuKey = String(renderer ?? '').trim().slice(0, 200);
    let tier = GPU_TIERS.DISCRETE;
    if (!gpuKey || MASKED_RENDERER.test(gpuKey)) tier = GPU_TIERS.UNKNOWN;
    else if (SOFTWARE_RENDERER.test(gpuKey)) tier = GPU_TIERS.SOFTWARE;
    else if (INTEGRATED_RENDERER.test(gpuKey)) tier = GPU_TIERS.INTEGRATED;
    return Object.freeze({ gpuKey, tier, timerQuery: timerQuery === true });
}

/**
 * Reads the GPU name once from a live context. Never throws: a context that refuses answers is
 * treated as unknown hardware and simply never gets the automatic ULTRA step.
 * @param {any} gl
 * @param {boolean} timerQuery whether a GPU timer query is available
 */
export function readGpuCapabilities(gl, timerQuery = false) {
    let renderer = '';
    try {
        const info = gl?.getExtension?.('WEBGL_debug_renderer_info');
        renderer = (info && gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) || gl?.getParameter?.(gl.RENDERER) || '';
    } catch {
        renderer = '';
    }
    return classifyGpuRenderer(renderer, { timerQuery });
}
