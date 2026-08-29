export const PLAYWRIGHT_SMOKE_SPECS = Object.freeze(['tests/core.spec.js']);

export const DESKTOP_E2E_CLUSTERS = Object.freeze([
    { id: 'core-shell', specs: ['tests/core-targeted.spec.js'] },
    { id: 'core-platform', specs: ['tests/core-targeted-platform.spec.js'] },
    { id: 'core-surface', specs: ['tests/core-targeted-surface.spec.js'] },
    { id: 'core-runtime', specs: ['tests/core-targeted-runtime.spec.js'] },
    { id: 'core-regressions', specs: ['tests/core-targeted-regressions.spec.js'] },
    { id: 'network', runProfile: 'browser-compat', specs: ['tests/network-adapter.spec.js'] },
    {
        id: 'desktop-flows',
        specs: [
            'tests/arcade-hangar-workshop.desktop.spec.js',
            'tests/atmospheric-fog.desktop.spec.js',
            'tests/chrono-forge-nexus.desktop.spec.js',
            'tests/eclipse-foundry.desktop.spec.js',
            'tests/hangar-window.desktop.spec.js',
            'tests/four-player-planar.desktop.spec.js',
            'tests/kinetic-tide-branches.desktop.spec.js',
            'tests/kinetic-tide.desktop.spec.js',
            'tests/verdant-aperture.desktop.spec.js',
            'tests/aetherion-orrery.desktop.spec.js',
            'tests/notre-dame.desktop.spec.js',
            'tests/notre-dame-arena.desktop.spec.js',
            'tests/notre-dame-atmosphere.desktop.spec.js',
            'tests/notre-dame-fire.desktop.spec.js',
            'tests/eiffel-tower.desktop.spec.js',
            'tests/hud-layout.spec.js',
            'tests/killcam-pixel.desktop.spec.js',
            'tests/killcam.desktop.spec.js',
            'tests/parcours-assault.desktop.spec.js',
            'tests/player-profiles.desktop.spec.js',
            'tests/render-smoothing.desktop.spec.js',
        ],
    },
    {
        id: 'gameplay-smoke',
        specs: [
            'tests/parcours-map-pack-start.spec.js',
            'tests/parcours-start.spec.js',
            'tests/recording.spec.js',
            'tests/runtime-facade.spec.js',
        ],
    },
    {
        id: 'editor',
        specs: [
            'tests/editor-fly-mode.spec.js',
            'tests/editor-glb-preview.spec.js',
            'tests/editor-map-ui.spec.js',
            'tests/editor-vehicle.spec.js',
        ],
    },
]);

export const HEAVY_DIAGNOSTIC_CLUSTERS = Object.freeze([
    { id: 'physics-core', specs: ['tests/physics-core.spec.js'] },
    { id: 'physics-hunt', specs: ['tests/physics-hunt.spec.js'] },
    { id: 'physics-policy', specs: ['tests/physics-policy.spec.js'] },
    { id: 'gpu-stress', specs: ['tests/gpu.spec.js', 'tests/stress.spec.js', 'tests/v28-regression.spec.js'] },
    {
        id: 'ghost-selfduel',
        specs: [
            'tests/ghost-selfduel-allmaps.desktop.spec.js',
            'tests/ghost-selfduel-roundtrip.desktop.spec.js',
        ],
    },
]);
