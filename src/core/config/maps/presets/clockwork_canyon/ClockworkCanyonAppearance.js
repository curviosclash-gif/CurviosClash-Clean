// ============================================================
// Clockwork Canyon – Look-Werte (nur Aussehen, keine Geometrie)
// Wuestencanyon zur goldenen Stunde: Sandstein, Messing, Amber-Daemmerung
// Wird per Spread in das eigentliche Preset-Objekt eingemischt
// (siehe VULKAN_ODYSSEY_MAP / FROZEN_HELIX_MAP fuer das Muster).
// `lighting` ist der einzige top-level Look-Key, der fuer prozedurale
// Presets tatsaechlich konsumiert wird (SceneLightingRig, ArenaBuilder,
// GlobalFogEffectSystem) und via normalizeMapLighting normalisiert wird.
// ============================================================

import { normalizeMapLighting } from '../../../../../shared/contracts/MapLightingContract.js';

export const CLOCKWORK_CANYON_APPEARANCE = {
    // Tiefstehende Sonne: warmes Messinglicht, kuehler Schattenwurf als Kontrast
    lighting: normalizeMapLighting({
        key: { direction: [-18, 22, 30], color: 0xffb46b, intensity: 1.55 },
        fill: { direction: [26, 18, -20], color: 0x8a9bd6, intensity: 0.5 },
        rim: { direction: [0, 14, -40], color: 0xffd9a0, intensity: 0.55 },
        hemisphere: { skyColor: 0xf3c98a, groundColor: 0x7a5a3a },
        // Sandiger Daemmerungsdunst, der den Canyon in Amberton taucht
        fog: { color: 0xd9a06a, near: 90, far: 200, height: 6, heightFalloff: 0.07, turbulence: 0.1 },
        skyDome: { zenithColor: 0x3a3a6b, horizonColor: 0xe08a4a, nadirColor: 0x4a3320 },
        starsVisible: false,
    }),
};
