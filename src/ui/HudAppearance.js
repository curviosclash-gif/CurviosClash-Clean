// ============================================
// HudAppearance.js - applies HUD appearance settings to CSS variables
// ============================================

import {
    DEFAULT_HUD_APPEARANCE,
    HUD_COLOR_PRESET,
    normalizeHudAppearance,
    resolveEffectiveHudScale,
} from '../shared/contracts/HudAppearanceContract.js';

const HUD_COLOR_PRESET_VARS = Object.freeze({
    [HUD_COLOR_PRESET.GREEN]: Object.freeze({
        color: '#8dff9f',
        text: '#c8ffd0',
        line: 'rgba(141, 255, 159, 0.85)',
        lineSoft: 'rgba(141, 255, 159, 0.55)',
        lineStrong: 'rgba(141, 255, 159, 0.95)',
        glow: 'rgba(20, 255, 120, 0.5)',
        bg: 'rgba(8, 22, 14, 0.35)',
        accent: '#3dff7a',
        accentSoft: '#0f9c46',
    }),
    [HUD_COLOR_PRESET.AMBER]: Object.freeze({
        color: '#ffd28d',
        text: '#ffe9c8',
        line: 'rgba(255, 210, 141, 0.85)',
        lineSoft: 'rgba(255, 210, 141, 0.55)',
        lineStrong: 'rgba(255, 210, 141, 0.95)',
        glow: 'rgba(255, 180, 60, 0.5)',
        bg: 'rgba(26, 18, 6, 0.35)',
        accent: '#ffb43c',
        accentSoft: '#a35d09',
    }),
    [HUD_COLOR_PRESET.CYAN]: Object.freeze({
        color: '#8ddcff',
        text: '#c8efff',
        line: 'rgba(141, 220, 255, 0.85)',
        lineSoft: 'rgba(141, 220, 255, 0.55)',
        lineStrong: 'rgba(141, 220, 255, 0.95)',
        glow: 'rgba(60, 200, 255, 0.5)',
        bg: 'rgba(6, 20, 26, 0.35)',
        accent: '#3cc8ff',
        accentSoft: '#0b6fa8',
    }),
    [HUD_COLOR_PRESET.WHITE]: Object.freeze({
        color: '#e8e8e8',
        text: '#f5f5f5',
        line: 'rgba(232, 232, 232, 0.85)',
        lineSoft: 'rgba(232, 232, 232, 0.55)',
        lineStrong: 'rgba(232, 232, 232, 0.95)',
        glow: 'rgba(255, 255, 255, 0.45)',
        bg: 'rgba(16, 16, 16, 0.35)',
        accent: '#ffffff',
        accentSoft: '#8a8a8a',
    }),
});

const HUD_COLOR_PRESET_LABELS = Object.freeze({
    [HUD_COLOR_PRESET.GREEN]: 'Grün',
    [HUD_COLOR_PRESET.AMBER]: 'Amber',
    [HUD_COLOR_PRESET.CYAN]: 'Cyan',
    [HUD_COLOR_PRESET.WHITE]: 'Weiß',
});

export function resolveHudColorPresetLabel(colorPreset) {
    return HUD_COLOR_PRESET_LABELS[colorPreset] || HUD_COLOR_PRESET_LABELS[DEFAULT_HUD_APPEARANCE.colorPreset];
}

/**
 * Summary line under the HUD controls. Says so when the window is too small for the chosen size.
 * @param {object} appearance
 * @param {{ innerWidth?: number, innerHeight?: number } | null} [view]
 */
export function formatHudAppearanceHint(appearance, view = null) {
    const normalized = normalizeHudAppearance(appearance);
    const scalePercent = Math.round(normalized.scale * 100);
    const opacityPercent = Math.round(normalized.opacity * 100);
    const base = `HUD: ${scalePercent}% – ${opacityPercent}% – ${resolveHudColorPresetLabel(normalized.colorPreset)}`;
    const fittedPercent = Math.round(resolveEffectiveHudScale(
        normalized.scale,
        view ? { width: view.innerWidth, height: view.innerHeight } : null
    ) * 100);
    return fittedPercent < scalePercent
        ? `${base} · Für dieses Fenster zu groß, angezeigt ${fittedPercent}%`
        : base;
}

/**
 * Writes the HUD appearance as CSS custom properties onto the given root
 * element (usually #hud). Falls back to the canonical defaults for invalid
 * input so the HUD never becomes invisible.
 *
 * @param {HTMLElement|null} rootElement - Element receiving the CSS variables.
 * @param {object|null} appearance - Raw appearance settings value.
 */
function setHudStyleVar(style, name, value) {
    // Guard against redundant style recalcs on the settings sync path.
    if (typeof style.getPropertyValue === 'function' && style.getPropertyValue(name) === value) return;
    style.setProperty(name, value);
}

export function applyHudAppearance(rootElement, appearance) {
    if (!rootElement || !rootElement.style) return;
    const normalized = normalizeHudAppearance(appearance);
    const presetVars = HUD_COLOR_PRESET_VARS[normalized.colorPreset]
        || HUD_COLOR_PRESET_VARS[DEFAULT_HUD_APPEARANCE.colorPreset];
    const style = rootElement.style;
    setHudStyleVar(style, '--hud-scale', String(normalized.scale));
    setHudStyleVar(style, '--hud-opacity', String(normalized.opacity));
    setHudStyleVar(style, '--hud-color', presetVars.color);
    setHudStyleVar(style, '--hud-text', presetVars.text);
    setHudStyleVar(style, '--hud-line', presetVars.line);
    setHudStyleVar(style, '--hud-line-soft', presetVars.lineSoft);
    setHudStyleVar(style, '--hud-line-strong', presetVars.lineStrong);
    setHudStyleVar(style, '--hud-glow', presetVars.glow);
    setHudStyleVar(style, '--hud-bg', presetVars.bg);
    // Chrome accents (frames, meter fills, active item slots) follow the preset
    // so a non-default color scheme reaches the whole HUD, not just the tapes.
    setHudStyleVar(style, '--hud-accent', presetVars.accent);
    setHudStyleVar(style, '--hud-accent-soft', presetVars.accentSoft);
}

/**
 * Applies appearance to the main HUD and the document root. Arcade overlays
 * are mounted under document.body, so they cannot inherit variables from
 * #hud alone.
 */
export function applyRuntimeHudAppearance(hudElement, appearance) {
    const ownerDocument = hudElement?.ownerDocument || globalThis.document || null;
    const view = ownerDocument?.defaultView || null;
    const normalized = normalizeHudAppearance(appearance);
    // Draw the HUD only as large as the window leaves room for; the chosen scale stays stored.
    const fitted = {
        ...normalized,
        scale: resolveEffectiveHudScale(normalized.scale, view ? { width: view.innerWidth, height: view.innerHeight } : null),
    };
    applyHudAppearance(hudElement, fitted);
    const documentElement = ownerDocument?.documentElement || null;
    if (documentElement && documentElement !== hudElement) {
        applyHudAppearance(documentElement, fitted);
    }
    watchViewportForHudFit(view, hudElement, normalized);
}

// A resized window changes how large the HUD may be drawn, so the last appearance is re-applied.
let hudFitWatch = null;
function watchViewportForHudFit(view, hudElement, appearance) {
    if (!view || typeof view.addEventListener !== 'function') return;
    if (!hudFitWatch || hudFitWatch.view !== view) {
        hudFitWatch = { view, hudElement, appearance };
        view.addEventListener('resize', () => {
            applyRuntimeHudAppearance(hudFitWatch.hudElement, hudFitWatch.appearance);
        });
        return;
    }
    hudFitWatch.hudElement = hudElement;
    hudFitWatch.appearance = appearance;
}
