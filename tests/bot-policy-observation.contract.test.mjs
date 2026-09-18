import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as ItemSlotEncoder from '../src/entities/ai/observation/ItemSlotEncoder.js';
import * as ModeFeatureEncoder from '../src/entities/ai/observation/ModeFeatureEncoder.js';
import * as ObservationSchemaV1 from '../src/entities/ai/observation/ObservationSchemaV1.js';
import * as ObservationSemantics from '../src/entities/ai/observation/ObservationSemantics.js';

// Moved from tests/physics-policy.spec.js (P3): encoder and schema checks are
// pure table lookups and never needed a running renderer.

test('T67: Item-Slot-Encoding erzeugt stabiles 20-Slot-One-Hot-Array', () => {
    const mod = ItemSlotEncoder;
    const encoded = new Array(mod.ITEM_SLOT_COUNT).fill(-1);
    mod.encodeItemSlots(['SPEED_UP', 'ROCKET_MEDIUM', 'UNKNOWN_ITEM', 'ROCKET_MEDIUM'], encoded);
    const result = {
        encoded,
        slotCount: mod.ITEM_SLOT_COUNT,
        speedUpSlot: mod.ITEM_SLOT_BY_TYPE.SPEED_UP,
        rocketMediumSlot: mod.ITEM_SLOT_BY_TYPE.ROCKET_MEDIUM,
        unknownSlot: mod.ITEM_SLOT_UNKNOWN_INDEX,
    };

    assert.strictEqual(result.encoded.length, result.slotCount);
    assert.strictEqual(result.encoded[result.speedUpSlot], 1);
    assert.strictEqual(result.encoded[result.rocketMediumSlot], 1);
    assert.strictEqual(result.encoded[result.unknownSlot], 1);
    assert.ok(result.encoded.every((value) => value === 0 || value === 1));
});

test('T68: Mode-Feature-Encoding mappt classic/hunt deterministisch', () => {
    const mod = ModeFeatureEncoder;
    const classic = mod.writeModeFeatures('classic', [0, 0, 0]);
    const hunt = mod.writeModeFeatures('HUNT', [0, 0, 0]);
    const fallback = mod.writeModeFeatures('unknown-mode', [0, 0, 0]);
    const result = { classic, hunt, fallback };

    assert.deepStrictEqual(result.classic, [0, 1, 0]);
    assert.deepStrictEqual(result.hunt, [1, 0, 1]);
    assert.deepStrictEqual(result.fallback, [0, 1, 0]);
});

test('T69: Observation-Schema V1 hat feste Laenge und eindeutige Indizes', () => {
    const schema = ObservationSchemaV1;
    const semantics = ObservationSemantics;
    const indexValues = Object.values(schema.OBSERVATION_INDEX)
        .filter((value) => Number.isInteger(value))
        .sort((a, b) => a - b);
    const uniqueIndices = new Set(indexValues);
    const semanticsIndices = semantics.OBSERVATION_SEMANTICS_V1.map((entry) => entry.index);
    const uniqueSemanticIndices = new Set(semanticsIndices);

    const result = {
        version: schema.OBSERVATION_SCHEMA_VERSION,
        length: schema.OBSERVATION_LENGTH_V1,
        indexCount: indexValues.length,
        uniqueIndexCount: uniqueIndices.size,
        minIndex: indexValues[0],
        maxIndex: indexValues[indexValues.length - 1],
        itemSlot00: schema.ITEM_SLOT_00,
        itemSlot19: schema.ITEM_SLOT_19,
        semanticsLength: semantics.OBSERVATION_SEMANTICS_V1.length,
        uniqueSemanticsIndexCount: uniqueSemanticIndices.size,
        hasUniqueSemanticsIndices: semantics.hasUniqueObservationSemanticIndices(),
        hasExpectedSemanticsLength: semantics.hasExpectedObservationSemanticLength(schema.OBSERVATION_LENGTH_V1),
    };

    assert.strictEqual(result.version, 'v1');
    assert.strictEqual(result.length, 40);
    assert.strictEqual(result.indexCount, 40);
    assert.strictEqual(result.uniqueIndexCount, 40);
    assert.strictEqual(result.minIndex, 0);
    assert.strictEqual(result.maxIndex, 39);
    assert.strictEqual(result.itemSlot00, 20);
    assert.strictEqual(result.itemSlot19, 39);
    assert.strictEqual(result.semanticsLength, 40);
    assert.strictEqual(result.uniqueSemanticsIndexCount, 40);
    assert.ok(result.hasUniqueSemanticsIndices);
    assert.ok(result.hasExpectedSemanticsLength);
});
