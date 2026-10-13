// ============================================
// entity-network-replica.contract.test.mjs - every replica-capable system is switched
// ============================================
//
// A client mirrors map systems from the host only if EntityManager.setNetworkReplica reaches
// them. That fan-out used to be a hand-written line; a system left out of it simulates on its
// own in LAN play and drifts from the host. Every class in src/ with a setNetworkReplica method
// has to appear in NETWORK_REPLICA_TARGETS under the field the EntityManager keeps it in.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    NETWORK_REPLICA_TARGETS,
    applyEntityNetworkSnapshot,
    setEntityNetworkReplica,
} from '../src/entities/runtime/EntityNetworkReplicaOps.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(ROOT, 'src');
const NOT_A_SYSTEM = new Set(['src/entities/EntityManager.js']);

function listSourceFiles(dir) {
    const files = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) files.push(...listSourceFiles(fullPath));
        else if (entry.name.endsWith('.js')) files.push(fullPath);
    }
    return files;
}

function listReplicaCapableClasses() {
    const classes = [];
    for (const file of listSourceFiles(SRC_DIR)) {
        const relative = path.relative(ROOT, file).replaceAll('\\', '/');
        if (NOT_A_SYSTEM.has(relative)) continue;
        const source = readFileSync(file, 'utf8');
        if (!/^\s+setNetworkReplica\s*\(/m.test(source)) continue;
        const className = source.match(/^export class (\w+)/m)?.[1];
        classes.push({ file: relative, className });
    }
    return classes;
}

function expectedFields(className) {
    const camel = className.charAt(0).toLowerCase() + className.slice(1);
    return [`_${camel}`, camel];
}

export function findUnswitchedClasses(classes, targets) {
    const fields = new Set(targets.map(([field]) => field));
    return classes
        .filter(({ className }) => !className || !expectedFields(className).some((field) => fields.has(field)))
        .map(({ file, className }) => `${file} (${className || 'no exported class'})`);
}

test('the check reports a replica-capable class missing from the targets', () => {
    const classes = [{ file: 'src/x/MapUnitSystem.js', className: 'MapUnitSystem' }];
    assert.deepEqual(findUnswitchedClasses(classes, []), ['src/x/MapUnitSystem.js (MapUnitSystem)']);
    assert.deepEqual(findUnswitchedClasses(classes, [['_mapUnitSystem', 'setNetworkReplica']]), []);
});

test('every class with setNetworkReplica is switched by the entity manager', () => {
    const classes = listReplicaCapableClasses();
    assert.ok(classes.length >= 15, `expected the known replica systems, found ${classes.length}`);
    assert.deepEqual(findUnswitchedClasses(classes, NETWORK_REPLICA_TARGETS), []);
});

test('replica mode reaches every target in order and skips absent systems', () => {
    const calls = [];
    const manager = {};
    for (const [field, method] of NETWORK_REPLICA_TARGETS) {
        manager[field] = { [method]: (enabled) => calls.push([field, enabled]) };
    }
    manager._secretRoomSystem = null;
    setEntityNetworkReplica(manager, true);
    assert.deepEqual(
        calls,
        NETWORK_REPLICA_TARGETS.filter(([field]) => field !== '_secretRoomSystem').map(([field]) => [field, true])
    );
});

test('a snapshot without optional parts leaves the arena alone', () => {
    const calls = [];
    const arena = new Proxy({}, { get: (_target, name) => (...args) => calls.push([name, ...args]) });
    applyEntityNetworkSnapshot({ arena, players: [] }, { mapElapsedSeconds: 'later' });
    assert.deepEqual(calls, []);
    applyEntityNetworkSnapshot({ arena, players: [] }, { mapElapsedSeconds: 12, cherryLeaves: [1] });
    assert.deepEqual(calls, [['setGlbAnimationElapsedSeconds', 12], ['applyCherryLeafState', [1]]]);
});
