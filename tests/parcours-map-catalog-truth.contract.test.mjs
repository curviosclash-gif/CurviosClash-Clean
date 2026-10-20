import assert from 'node:assert/strict';
import test from 'node:test';

import { MAP_PRESETS } from '../src/core/config/MapPresets.js';
import { MAP_PICKER_META } from '../src/shared/maps/MapPickerMeta.js';
import {
    resolveMapPortalEntryCount,
    resolvePortalMode,
} from '../src/shared/contracts/PortalAuthoringContract.js';

// Parcours maps that still get default portals when portals are switched on (ArcadeDaily always
// switches them on). A ratchet: it may only shrink; a fixed map leaves the list in the same change.
// Same rule as PortalLayoutBuilder: outside planar flight only 'dynamic' and 'hybrid' build them.
const KNOWN_DEFAULT_PORTAL_PARCOURS = Object.freeze([
    'parcours_assault',
    'tutorial_classic',
]);

const NUMBER_WORDS = Object.freeze({
    ein: 1, eine: 1, einem: 1, einen: 1, einer: 1,
    zwei: 2, drei: 3, vier: 4, fünf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwölf: 12,
});
const COUNTED_PHRASE = /(\d+|[a-zäöüß]+)\s+(Checkpoints?|Kontrollpunkte?n?|Portalpaar(?:e|en)?|Portal(?:e|en)?)\b/giu;

function parseCount(word) {
    if (/^\d+$/.test(word)) return Number(word);
    return NUMBER_WORDS[word.toLowerCase()] ?? null;
}

function listParcoursMapsWithDefaultPortals() {
    return Object.entries(MAP_PRESETS)
        .filter(([, map]) => map?.parcours?.enabled === true)
        .filter(([, map]) => resolvePortalMode(map) !== 'authored')
        .filter(([, map]) => resolveMapPortalEntryCount(map) > 0)
        .map(([mapKey]) => mapKey)
        .sort();
}

test('parcours maps without authored portals do not grow default portals onto the course', () => {
    const offenders = listParcoursMapsWithDefaultPortals();
    const unexpected = offenders.filter((mapKey) => !KNOWN_DEFAULT_PORTAL_PARCOURS.includes(mapKey));
    assert.deepEqual(unexpected, [], 'set portalCount: 0 on these parcours maps (like skyscraper_site)');
    const fixed = KNOWN_DEFAULT_PORTAL_PARCOURS.filter((mapKey) => !offenders.includes(mapKey));
    assert.deepEqual(fixed, [], 'remove fixed maps from KNOWN_DEFAULT_PORTAL_PARCOURS');
});

test('cloud_harbor resolves no dynamic portal entries', () => {
    assert.equal(resolveMapPortalEntryCount(MAP_PRESETS.cloud_harbor), 0);
});

test('map picker descriptions count checkpoints and portals like the presets', () => {
    const mismatches = [];
    let checked = 0;
    for (const [mapKey, meta] of Object.entries(MAP_PICKER_META)) {
        const map = MAP_PRESETS[mapKey];
        for (const match of String(meta?.description || '').matchAll(COUNTED_PHRASE)) {
            const count = parseCount(match[1]);
            if (count === null) continue;
            const isCheckpoint = /^(checkpoint|kontrollpunkt)/i.test(match[2]);
            const actual = isCheckpoint
                ? (map?.parcours?.checkpoints?.length ?? 0)
                : (Array.isArray(map?.portals) ? map.portals.length : 0);
            checked += 1;
            if (count !== actual) mismatches.push(`${mapKey}: "${match[0]}" but preset has ${actual}`);
        }
    }
    assert.ok(checked > 40, `expected to check the catalog descriptions, checked ${checked}`);
    assert.deepEqual(mismatches, []);
});
