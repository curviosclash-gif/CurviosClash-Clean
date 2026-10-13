import assert from 'node:assert/strict';
import test from 'node:test';

import {
    MAP_PROFILE_FEATURES,
    MAP_PROFILE_LARGE_FOOTPRINT_FROM,
    MAP_PROFILE_SMALL_FOOTPRINT_BELOW,
    MAP_PROFILE_SIZE_CLASSES,
    classifyMapSize,
    resolveMapProfile,
} from '../src/shared/contracts/MapProfileContract.js';
import { resolveBundledMapBalancing } from '../src/shared/maps/MapBalancingBundledData.js';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { resolveMapCategory } from '../src/ui/menu/MenuPreviewCatalog.js';
import {
    describeMapProfile,
    renderMapProfileCard,
} from '../src/ui/start-setup/MapProfileCardView.js';

const featureCodes = (profile) => profile.features.map((feature) => feature.code);
const balancing = (values) => ({ values });

test('size class follows the footprint thresholds', () => {
    assert.equal(classifyMapSize([80, 30, 80]), MAP_PROFILE_SIZE_CLASSES.SMALL);
    assert.equal(classifyMapSize([100, 40, 100]), MAP_PROFILE_SIZE_CLASSES.SMALL);
    assert.equal(classifyMapSize([120, 40, 125]), MAP_PROFILE_SIZE_CLASSES.MEDIUM);
    assert.equal(classifyMapSize([200, 40, 200]), MAP_PROFILE_SIZE_CLASSES.MEDIUM);
    assert.equal(classifyMapSize([300, 40, 300]), MAP_PROFILE_SIZE_CLASSES.LARGE);
    // The thresholds are exclusive below / inclusive from.
    const edge = Math.sqrt(MAP_PROFILE_SMALL_FOOTPRINT_BELOW);
    assert.equal(classifyMapSize([edge, 1, edge]), MAP_PROFILE_SIZE_CLASSES.MEDIUM);
    const largeEdge = Math.sqrt(MAP_PROFILE_LARGE_FOOTPRINT_FROM);
    assert.equal(classifyMapSize([largeEdge, 1, largeEdge]), MAP_PROFILE_SIZE_CLASSES.LARGE);
    // Unreadable sizes fall back to the 80 x 80 default arena.
    assert.equal(classifyMapSize(undefined), MAP_PROFILE_SIZE_CLASSES.SMALL);
    assert.equal(classifyMapSize([Number.NaN, 1, -5]), MAP_PROFILE_SIZE_CLASSES.SMALL);
});

test('the three size classes are spread over the real catalog and drive the map filter', () => {
    const counts = { small: 0, medium: 0, large: 0 };
    const entries = Object.entries(MAP_PRESET_CATALOG)
        .filter(([key, map]) => key !== 'custom' && map.hiddenFromMapPicker !== true);
    for (const [, map] of entries) counts[classifyMapSize(map.size)] += 1;
    for (const [code, count] of Object.entries(counts)) {
        assert.ok(count / entries.length >= 0.2, `${code} holds only ${count} of ${entries.length} maps`);
    }
    for (const [key, map] of entries) {
        assert.equal(resolveMapCategory(map), classifyMapSize(map.size), `${key}: filter and profile disagree`);
    }
});

test('bot limit comes from the balancing values and the pilot range stays inside it', () => {
    const map = MAP_PRESET_CATALOG.crossfire;
    const open = resolveMapProfile(map, balancing({ botCountMin: 0, botCountMax: 8 }));
    assert.deepEqual({ ...open.bots }, { min: 0, max: 8 });
    assert.equal(open.size.code, MAP_PROFILE_SIZE_CLASSES.SMALL);
    assert.ok(open.pilots.min >= 1 && open.pilots.min <= open.pilots.max);

    const capped = resolveMapProfile(MAP_PRESET_CATALOG.giant_forest, balancing({ botCountMin: 0, botCountMax: 3 }));
    assert.equal(capped.size.code, MAP_PROFILE_SIZE_CLASSES.LARGE);
    assert.ok(capped.pilots.max <= 4, 'pilots are humans plus at most three bots');

    const forced = resolveMapProfile(MAP_PRESET_CATALOG.standard, balancing({ botCountMin: 5, botCountMax: 6 }));
    assert.ok(forced.pilots.min >= 6 && forced.pilots.max <= 7);

    const noBots = resolveMapProfile(MAP_PRESET_CATALOG.standard, balancing({ botCountMin: 0, botCountMax: 0 }));
    assert.deepEqual({ ...noBots.pilots }, { min: 1, max: 1 });
});

test('without balancing values the bot limit is unknown instead of invented', () => {
    for (const missing of [null, undefined, {}, balancing({}), balancing({ botCountMax: 'x' })]) {
        const profile = resolveMapProfile(MAP_PRESET_CATALOG.standard, missing);
        assert.equal(profile.bots, null);
        assert.ok(profile.pilots.min <= profile.pilots.max);
    }
});

test('the shipped balancing resolves a bot range for free play and classic', () => {
    for (const modePath of ['fight', 'normal']) {
        const resolved = resolveBundledMapBalancing({ modePath, mapKey: 'standard' });
        assert.equal(typeof resolved.values.botCountMax, 'number');
        const profile = resolveMapProfile(MAP_PRESET_CATALOG.standard, resolved);
        assert.equal(profile.bots.max, resolved.values.botCountMax);
    }
});

test('features only come from what the map definition holds', () => {
    const plain = resolveMapProfile({ name: 'x', size: [80, 30, 80], portals: [], portalCount: 0 }, null);
    assert.deepEqual(featureCodes(plain), []);

    const carnival = resolveMapProfile(MAP_PRESET_CATALOG.neon_carnival, null);
    const codes = featureCodes(carnival);
    assert.ok(codes.includes(MAP_PROFILE_FEATURES.PORTALS));
    assert.ok(codes.includes(MAP_PROFILE_FEATURES.PARCOURS));
    assert.ok(codes.includes(MAP_PROFILE_FEATURES.LEVELS));
    const levels = carnival.features.find((feature) => feature.code === MAP_PROFILE_FEATURES.LEVELS);
    assert.equal(levels.count, MAP_PRESET_CATALOG.neon_carnival.portalLevels.length);
    const parcours = carnival.features.find((feature) => feature.code === MAP_PROFILE_FEATURES.PARCOURS);
    assert.equal(parcours.count, MAP_PRESET_CATALOG.neon_carnival.parcours.checkpoints.length);

    assert.ok(featureCodes(resolveMapProfile(MAP_PRESET_CATALOG.pyramid, null)).includes(MAP_PROFILE_FEATURES.SANDSTORM));
    assert.ok(featureCodes(resolveMapProfile(MAP_PRESET_CATALOG.giant_forest, null)).includes(MAP_PROFILE_FEATURES.FOG));
    assert.ok(!featureCodes(resolveMapProfile(MAP_PRESET_CATALOG.standard, null)).includes(MAP_PROFILE_FEATURES.FOG));
});

test('portals follow the pair count of the map and the balancing switch', () => {
    const standard = resolveMapProfile(MAP_PRESET_CATALOG.standard, null);
    const portals = standard.features.find((feature) => feature.code === MAP_PROFILE_FEATURES.PORTALS);
    assert.equal(portals.count, MAP_PRESET_CATALOG.standard.portals.length);
    const off = resolveMapProfile(MAP_PRESET_CATALOG.standard, balancing({ portalsEnabled: false }));
    assert.ok(!featureCodes(off).includes(MAP_PROFILE_FEATURES.PORTALS));
});

test('destructible parts count only in the game modes the map allows', () => {
    const bridge = MAP_PRESET_CATALOG.storm_bridge_siege;
    const hunt = resolveMapProfile(bridge, null, { gameMode: 'HUNT' });
    const destructible = hunt.features.find((feature) => feature.code === MAP_PROFILE_FEATURES.DESTRUCTIBLE);
    assert.equal(destructible.count, bridge.destructibles.segments.length);
    assert.ok(!featureCodes(resolveMapProfile(bridge, null, { gameMode: 'CLASSIC' })).includes(MAP_PROFILE_FEATURES.DESTRUCTIBLE));
    // Maps without a mode list are destructible in every mode.
    assert.ok(featureCodes(resolveMapProfile(MAP_PRESET_CATALOG.notre_dame_arena, null, { gameMode: 'CLASSIC' }))
        .includes(MAP_PROFILE_FEATURES.DESTRUCTIBLE));
});

test('the profile is frozen, carries codes only and survives garbage input', () => {
    const profile = resolveMapProfile(MAP_PRESET_CATALOG.eiffel_tower_siege, balancing({ botCountMax: 8 }));
    assert.ok(Object.isFrozen(profile));
    assert.ok(Object.isFrozen(profile.size));
    assert.ok(Object.isFrozen(profile.pilots));
    assert.ok(Object.isFrozen(profile.features));
    assert.ok(profile.features.every((feature) => Object.isFrozen(feature)));
    assert.doesNotMatch(JSON.stringify(profile), /[äöüÄÖÜß]/);
    for (const garbage of [null, undefined, 5, 'x', [], {}]) {
        const result = resolveMapProfile(garbage, garbage);
        assert.equal(result.size.code, MAP_PROFILE_SIZE_CLASSES.SMALL);
        assert.deepEqual(featureCodes(result).filter((code) => code !== MAP_PROFILE_FEATURES.PORTALS), []);
    }
});

test('every catalog map yields a complete profile', () => {
    for (const [key, map] of Object.entries(MAP_PRESET_CATALOG)) {
        const profile = resolveMapProfile(map, resolveBundledMapBalancing({ modePath: 'fight', mapKey: key }));
        assert.ok(Object.values(MAP_PROFILE_SIZE_CLASSES).includes(profile.size.code), key);
        assert.ok(profile.pilots.min >= 1 && profile.pilots.min <= profile.pilots.max, key);
    }
});

test('the card text names every fact in words, never only by symbol', () => {
    const profile = resolveMapProfile(MAP_PRESET_CATALOG.neon_carnival, balancing({ botCountMin: 0, botCountMax: 8 }));
    const items = describeMapProfile(profile);
    const labels = items.map((item) => item.text);
    assert.ok(labels.some((text) => /^Größe: /.test(text)));
    assert.ok(labels.some((text) => /Bots: höchstens 8/.test(text)));
    assert.ok(labels.some((text) => /^Empfohlen: .*Piloten/.test(text)));
    assert.ok(labels.some((text) => /Portal/.test(text)));
    assert.ok(labels.some((text) => /Parcours/.test(text)));
    assert.ok(items.every((item) => item.text.trim() !== '' && item.symbol.trim() !== ''));

    const plain = describeMapProfile(resolveMapProfile({ size: [80, 30, 80], portals: [], portalCount: 0 }, null));
    assert.ok(plain.some((item) => /Keine Besonderheiten/.test(item.text)));
    assert.ok(!plain.some((item) => /^Bots:/.test(item.text)), 'unknown bot limit is not shown');
});

function createFakeDocument() {
    const create = (tagName) => {
        const node = {
            tagName,
            children: [],
            attributes: {},
            textContent: '',
            className: '',
            hidden: false,
            appendChild(child) { node.children.push(child); return child; },
            replaceChildren(...children) { node.children = children; },
            setAttribute(name, value) { node.attributes[name] = String(value); },
            classList: {
                set: new Set(),
                toggle(name, force) { if (force) this.set.add(name); else this.set.delete(name); },
                contains(name) { return this.set.has(name); },
            },
        };
        return node;
    };
    return { createElement: create };
}

test('the card renders a labelled list and hides itself outside free play', () => {
    const previous = globalThis.document;
    globalThis.document = createFakeDocument();
    try {
        const host = globalThis.document.createElement('section');
        const profile = resolveMapProfile(MAP_PRESET_CATALOG.standard, balancing({ botCountMin: 0, botCountMax: 8 }));
        renderMapProfileCard(host, { profile, mapName: 'Standard Arena' });
        assert.equal(host.classList.contains('hidden'), false);
        assert.equal(host.attributes['aria-hidden'], 'false');
        const [heading, list] = host.children;
        assert.match(heading.textContent, /Steckbrief/);
        assert.match(heading.textContent, /Standard Arena/);
        assert.equal(list.tagName, 'ul');
        assert.ok(list.children.length >= 3);
        const first = list.children[0];
        assert.equal(first.tagName, 'li');
        assert.equal(first.children[0].attributes['aria-hidden'], 'true', 'the symbol is decoration');
        assert.ok(first.children[1].textContent.length > 0, 'the text carries the meaning');

        renderMapProfileCard(host, null);
        assert.equal(host.classList.contains('hidden'), true);
        assert.equal(host.attributes['aria-hidden'], 'true');
        assert.equal(host.children.length, 0);
    } finally {
        if (previous === undefined) delete globalThis.document;
        else globalThis.document = previous;
    }
});
