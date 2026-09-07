import assert from 'node:assert/strict';
import test from 'node:test';

import { VEHICLE_PRESETS } from '../prototypes/vehicle-lab/src/VehiclePresets.js';
import {
    VEHICLE_LAB_HITBOX_MIN_RADIUS,
    estimateVehicleLabHitboxRadius,
    normalizeVehicleLabConfig,
} from '../src/shared/contracts/VehicleLabConfigContract.js';
import {
    VEHICLE_LAB_HANGAR_MAX_PARTS,
    createVehicleLabHangarPublication,
    describeVehicleLabHangarPublicationLimits,
} from '../src/shared/contracts/VehicleLabHangarPublishContract.js';

const COMPLEX_SHIP_IDS = Object.freeze([
    'lab_helix_interceptor',
    'lab_eclipse_phantom',
    'lab_valkyrie_gunship',
    'lab_atlas_salvager',
    'lab_aegis_carrier',
    'lab_leviathan_dreadnought',
]);

const REQUIRED_ROLES = Object.freeze([
    'core',
    'nose',
    'wing_left',
    'wing_right',
    'engine_left',
    'engine_right',
    'utility',
]);

function flattenParts(parts, result = []) {
    for (const part of Array.isArray(parts) ? parts : []) {
        result.push(part);
        flattenParts(part.children, result);
    }
    return result;
}

function getComplexShips() {
    return COMPLEX_SHIP_IDS.map((id) => {
        const preset = VEHICLE_PRESETS.find((candidate) => candidate.id === id);
        assert.ok(preset, `Komplexe Vehicle-Lab-Vorlage fehlt: ${id}`);
        return preset;
    });
}

test('Vehicle Lab ships the complete complex fleet with stable unique ids', () => {
    const ships = getComplexShips();
    assert.equal(new Set(ships.map((ship) => ship.id)).size, COMPLEX_SHIP_IDS.length);
    assert.deepEqual(ships.map((ship) => ship.id), [...COMPLEX_SHIP_IDS]);
});

test('complex fleet presets contain nested, animated, role-complete assemblies', () => {
    for (const ship of getComplexShips()) {
        const parts = flattenParts(ship.parts);
        const roles = new Set(parts.map((part) => part.role).filter(Boolean));

        assert.ok(parts.length >= 24, `${ship.id}: nur ${parts.length} Bauteile`);
        assert.ok(parts.length <= VEHICLE_LAB_HANGAR_MAX_PARTS, `${ship.id}: ${parts.length} Bauteile`);
        assert.ok(parts.length > ship.parts.length, `${ship.id}: keine verschachtelte Baugruppe`);
        assert.ok(parts.some((part) => part.anim), `${ship.id}: keine Animation`);
        assert.ok(parts.some((part) => part.material === 'glow'), `${ship.id}: kein Leuchtelement`);
        for (const role of REQUIRED_ROLES) {
            assert.ok(roles.has(role), `${ship.id}: Rolle ${role} fehlt`);
        }
    }
});

test('complex fleet normalizes and publishes without dropping or resizing parts', () => {
    for (const ship of getComplexShips()) {
        const normalized = normalizeVehicleLabConfig(ship);
        const parts = flattenParts(ship.parts);
        const limits = describeVehicleLabHangarPublicationLimits(ship);
        const publication = createVehicleLabHangarPublication(ship, { publishedAtMs: 1 });

        assert.equal(normalized.ok, true, `${ship.id}: ${normalized.errors.join('; ')}`);
        assert.deepEqual(limits, { droppedParts: 0, clampedSizes: 0, totalParts: parts.length }, ship.id);
        assert.equal(publication.parts.length, parts.length, ship.id);
        assert.equal(new Set(publication.parts.map((part) => part.id)).size, parts.length, ship.id);
    }
});

test('complex fleet stays inside the established gameplay hitbox range', () => {
    for (const ship of getComplexShips()) {
        const radius = estimateVehicleLabHitboxRadius(ship);
        assert.ok(radius >= VEHICLE_LAB_HITBOX_MIN_RADIUS, `${ship.id}: Hitbox ${radius}`);
        assert.ok(radius <= 1.8, `${ship.id}: Hitbox ${radius}`);
    }
});
