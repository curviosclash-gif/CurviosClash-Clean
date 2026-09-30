import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

// Stained glass on the intact cathedral: a near-black pane lit by one hue, dimmer from outside,
// and roses glazed in sectors rather than as one lamp-like disc. Emission is read the way
// three.js reads it: emissiveFactor times KHR_materials_emissive_strength.
const GLB_DIR = path.resolve('assets/maps/notre_dame/glb');
const PARTS = Object.freeze([
    '01_west_facade',
    '02_nave',
    '03_transept',
    '04_choir_apse',
    '05_buttresses',
    '06_roof_fleche',
    '07_parvis_island',
]);
const ROSE_PARTS = Object.freeze(['01_west_facade', '03_transept']);
const GLAZED_PARTS = Object.freeze(['01_west_facade', '02_nave', '03_transept', '04_choir_apse']);

function readGlbJson(fileStem) {
    const bytes = readFileSync(path.join(GLB_DIR, `${fileStem}.glb`));
    assert.equal(bytes.toString('ascii', 0, 4), 'glTF', `${fileStem} has a GLB header`);
    const jsonLength = bytes.readUInt32LE(12);
    return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trimEnd());
}

function emission(material) {
    const factor = material.emissiveFactor || [0, 0, 0];
    const strength = Number(material.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1);
    return factor.map((value) => value * strength);
}

function dominantChannel(color) {
    return color.indexOf(Math.max(...color));
}

function glassMaterials(document) {
    return (document.materials || []).filter((material) => /^NDGlass/.test(String(material.name || '')));
}

/** Names of the glass materials that some primitive actually draws with. */
function usedGlassNames(document) {
    const names = new Set();
    for (const mesh of document.meshes || []) {
        for (const primitive of mesh.primitives || []) {
            const name = String(document.materials?.[primitive.material]?.name || '');
            if (/^NDGlass/.test(name)) names.add(name);
        }
    }
    return names;
}

test('stained glass is a near-black pane lit by one dominant hue', () => {
    for (const part of PARTS) {
        for (const material of glassMaterials(readGlbJson(part))) {
            const base = material.pbrMetallicRoughness?.baseColorFactor || [1, 1, 1, 1];
            assert.ok(
                Math.max(...base.slice(0, 3)) <= 0.05,
                `${part} ${material.name} keeps a near-black base, got ${base.slice(0, 3).join(', ')}`,
            );

            const color = emission(material);
            const sorted = [...color].sort((a, b) => b - a);
            assert.ok(
                sorted[0] >= sorted[1] * 2,
                `${part} ${material.name} has one dominant emission channel, got ${color.join(', ')}`,
            );
            if (material.name.endsWith('Outside')) continue;
            assert.ok(
                sorted[0] >= 0.8 && sorted[0] <= 1.3,
                `${part} ${material.name} glows at 0.8-1.3, got ${sorted[0].toFixed(3)}`,
            );
        }
    }
});

test('glass seen from outside is darker than the same glass seen from inside', () => {
    for (const part of GLAZED_PARTS) {
        const document = readGlbJson(part);
        const byName = new Map(glassMaterials(document).map((material) => [material.name, material]));
        const used = usedGlassNames(document);
        const inside = [...used].filter((name) => !name.endsWith('Outside'));
        assert.ok(inside.length > 0, `${part} is glazed`);

        for (const name of inside) {
            assert.ok(used.has(`${name}Outside`), `${part} shows ${name} darker from outside`);
            const lit = emission(byName.get(name));
            const dim = emission(byName.get(`${name}Outside`));
            assert.equal(dominantChannel(dim), dominantChannel(lit), `${name} keeps its hue outside`);
            assert.ok(
                Math.max(...dim) <= Math.max(...lit) * 0.5,
                `${part} ${name} outside glows at most half as bright, got ${Math.max(...dim).toFixed(3)}`,
            );
        }
    }
});

test('rose windows are glazed in three to four colour sectors', () => {
    const allHues = new Set();
    for (const part of PARTS) {
        for (const name of usedGlassNames(readGlbJson(part))) {
            if (!name.endsWith('Outside')) allHues.add(name);
        }
    }
    assert.ok(allHues.size >= 3 && allHues.size <= 4, `the cathedral uses 3-4 glass hues, got ${[...allHues]}`);

    for (const part of ROSE_PARTS) {
        const hues = [...usedGlassNames(readGlbJson(part))].filter((name) => !name.endsWith('Outside'));
        assert.ok(
            hues.length >= 3 && hues.length <= 4,
            `${part} glazes its rose in 3-4 colour sectors, got ${hues.join(', ')}`,
        );
    }
    // The west front has no red lancet; red there can only come from the rose's sectors.
    assert.ok(usedGlassNames(readGlbJson('01_west_facade')).has('NDGlassRed'),
        'the west rose carries a red sector');
});
