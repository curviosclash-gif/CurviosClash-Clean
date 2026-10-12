import assert from 'node:assert/strict';
import test from 'node:test';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { resolveArcadeParcoursRespawnFallback } from '../src/modes/ArcadeRunRulesOps.js';
import { buildRouteFromParcours } from '../src/entities/systems/ParcoursProgressUtils.js';

// ParcoursProgressSystem checks resetOnDeath before resetToLastValid when a player dies, so a map
// that asks for the fall-back to the last checkpoint but leaves resetOnDeath on (its default) still
// wipes all progress on death, while running out the segment time only rewinds. The maps below ask
// for the fall-back; a death has to behave like the timeout.
const FALL_BACK_MAPS = ['storm_switchyard', 'chrono_spillway',
    'sky_ladder_abyss', 'sky_ladder_foundry', 'sky_ladder_storm', 'sky_ladder_star'];
// Not part of this rule: the classic tutorial keeps its full reset on death.
const KNOWN_FULL_RESET_WITH_FALL_BACK = ['tutorial_classic'];

test('parcours maps that fall back to the last checkpoint do it on death as well', () => {
    for (const mapKey of FALL_BACK_MAPS) {
        const parcours = MAP_PRESET_CATALOG[mapKey]?.parcours;
        assert.ok(parcours?.enabled, `${mapKey} has a parcours`);
        const rules = buildRouteFromParcours(parcours).rules;
        assert.equal(rules.resetToLastValid, true, `${mapKey} resetToLastValid`);
        assert.equal(rules.resetOnDeath, false, `${mapKey} resetOnDeath`);
    }
});

test('no other parcours map pairs resetToLastValid with a full reset on death', () => {
    for (const [mapKey, map] of Object.entries(MAP_PRESET_CATALOG)) {
        if (!map.parcours?.enabled || KNOWN_FULL_RESET_WITH_FALL_BACK.includes(mapKey)) continue;
        const rules = buildRouteFromParcours(map.parcours).rules;
        assert.equal(rules.resetToLastValid && rules.resetOnDeath, false, `${mapKey} pairs the two rules`);
    }
});

test('arcade respawn overrides do not touch resetOnDeath or resetToLastValid', () => {
    for (const runType of [undefined, 'weapon_race', 'five_portals']) {
        for (const sector of [true, false]) {
            const rules = resolveArcadeParcoursRespawnFallback(runType, sector);
            if (!rules) continue;
            assert.equal('resetOnDeath' in rules, false, `${runType}/${sector}`);
            assert.equal('resetToLastValid' in rules, false, `${runType}/${sector}`);
        }
    }
});
