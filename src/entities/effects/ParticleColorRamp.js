// Particles used to keep their spawn colour until they shrank away, which read as
// coloured confetti instead of fire. The ramp reshapes that colour along the
// particle's own lifetime without touching its identity: a short white-hot flash
// right after the spawn, the source colour (player, rocket tier) through the
// middle so a hit stays attributable, then a burnout toward black.

const FLASH_WINDOW = 0.22;
const FLASH_MIX = 0.8;
const BURNOUT_WINDOW = 0.55;
const BURNOUT_FLOOR = 0.06;

// Mutates the passed colour in place so the hot path stays allocation-free.
// `lifeRatio` is 1 at spawn and 0 at death; non-finite input collapses to 0.
export function applyParticleColorRamp(color, lifeRatio) {
    if (!color) return color;
    let ratio = 0;
    if (lifeRatio > 1) ratio = 1;
    else if (lifeRatio > 0) ratio = lifeRatio;

    if (ratio > 1 - FLASH_WINDOW) {
        const flash = ((ratio - (1 - FLASH_WINDOW)) / FLASH_WINDOW) * FLASH_MIX;
        color.r += (1 - color.r) * flash;
        color.g += (1 - color.g) * flash;
        color.b += (1 - color.b) * flash;
        return color;
    }

    if (ratio < BURNOUT_WINDOW) {
        const burn = BURNOUT_FLOOR + (1 - BURNOUT_FLOOR) * (ratio / BURNOUT_WINDOW);
        color.r *= burn;
        color.g *= burn;
        color.b *= burn;
    }
    return color;
}
