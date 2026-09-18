import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { toArenaMapDefinition } from '../src/entities/mapSchema/MapSchemaRuntimeOps.js';

// Moved from tests/core-targeted-regressions.spec.js (P3): this only reads the authored
// preset catalog and normalizes it, so no renderer and no window are involved. The spec
// reached both modules via `import('/src/...')`, which fails against the built dist-app.

test('V87.4 authored map presets keep portal, gate and parcours contracts aligned', () => {
    const presetKeys = ['abyssal_descent', 'neon_circuit', 'sky_islands'];
    const result = presetKeys.map((presetKey) => {
        const runtime = toArenaMapDefinition(MAP_PRESET_CATALOG[presetKey], { name: presetKey });
        const checkpoints = runtime.map.parcours?.checkpoints || [];
        const baseCheckpoints = checkpoints.filter((entry) => !entry?.aliasOf);
        const checkpointIdSequence = baseCheckpoints.map((entry) => entry?.id || '');
        const hasSequentialCheckpointIds = checkpointIdSequence.every((id, index) => id === `CP${String(index + 1).padStart(2, '0')}`);
        const invalidAliasCount = checkpoints.filter((entry) => entry?.aliasOf && !checkpointIdSequence.includes(entry.aliasOf)).length;
        const invalidPortalCount = (runtime.map.portals || []).filter((portal) => {
            const posA = Array.isArray(portal?.a) ? portal.a : [];
            const posB = Array.isArray(portal?.b) ? portal.b : [];
            const allFinite = [...posA, ...posB].every((value) => Number.isFinite(value));
            const distinctEndpoints = posA.length === 3
                && posB.length === 3
                && posA.some((value, index) => value !== posB[index]);
            return !allFinite || !distinctEndpoints;
        }).length;
        const invalidGateCount = (runtime.map.gates || []).filter((gate) => {
            const forward = Array.isArray(gate?.forward) ? gate.forward : [];
            const pos = Array.isArray(gate?.pos) ? gate.pos : [];
            const params = gate?.params && typeof gate.params === 'object' ? Object.values(gate.params) : [];
            return !gate?.id
                || pos.length !== 3
                || !pos.every((value) => Number.isFinite(value))
                || forward.length !== 3
                || !forward.every((value) => Number.isFinite(value))
                || params.length === 0
                || !params.every((value) => typeof value !== 'number' || Number.isFinite(value));
        }).length;

        return {
            presetKey,
            warningCount: runtime.warnings.length,
            portalCount: runtime.map.portals.length,
            gateCount: runtime.map.gates.length,
            hasSequentialCheckpointIds,
            invalidAliasCount,
            invalidPortalCount,
            invalidGateCount,
            finishId: runtime.map.parcours?.finish?.id || '',
        };
    });

    for (const preset of result) {
        assert.strictEqual(preset.warningCount, 0);
        assert.ok(preset.portalCount > 0);
        assert.ok(preset.gateCount > 0);
        assert.strictEqual(preset.hasSequentialCheckpointIds, true);
        assert.strictEqual(preset.invalidAliasCount, 0);
        assert.strictEqual(preset.invalidPortalCount, 0);
        assert.strictEqual(preset.invalidGateCount, 0);
        assert.strictEqual(preset.finishId, 'FINISH');
    }
});
