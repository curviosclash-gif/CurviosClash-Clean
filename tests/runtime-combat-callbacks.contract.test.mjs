import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createEntityRuntimeSupport } from '../src/entities/runtime/EntityRuntimeSupportAssembly.js';

// The entity runtime has two things called "combat": runtimePorts.combat lists the combat systems
// (tests and diagnostics read it), runtimeContext.combat holds the actions the game calls. Product
// code that asks the action object for a system name gets undefined and silently does nothing:
// d69fb6f1 found the G key refusing every bomber strike because HuntCombatSystem asked
// runtime.combat.mapUnitSystem. This guard reads every `.combat.<name>` call in src/ and requires
// the name to be one of the real actions. Destructured access (`const { combat } = runtime`) is
// not seen here.

const SRC_ROOT = fileURLToPath(new URL('../src/', import.meta.url));
const COMBAT_MEMBER = /\.combat\??\.([A-Za-z_$][\w$]*)/g;

function listSourceFiles(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return listSourceFiles(full);
        return entry.isFile() && entry.name.endsWith('.js') ? [full] : [];
    });
}

function findCombatMemberCalls(source, file = '<source>') {
    const calls = [];
    source.split('\n').forEach((line, index) => {
        for (const match of line.matchAll(COMBAT_MEMBER)) {
            calls.push({ file, line: index + 1, name: match[1] });
        }
    });
    return calls;
}

function readCombatActionNames() {
    const support = createEntityRuntimeSupport({ players: [], arena: null });
    return new Set(Object.keys(support.runtimeContext.combat));
}

function findUnknownCombatCalls(calls, actions) {
    return calls
        .filter((call) => !actions.has(call.name))
        .map((call) => `${call.file}:${call.line} combat.${call.name}`);
}

test('every combat call in src names an action the runtime context really has', () => {
    const actions = readCombatActionNames();
    assert.ok(actions.has('applyPlayerHit'), 'the action list was read from the real runtime support');
    const calls = listSourceFiles(SRC_ROOT).flatMap((file) => findCombatMemberCalls(
        readFileSync(file, 'utf8'),
        path.relative(SRC_ROOT, file).replaceAll('\\', '/'),
    ));
    assert.ok(calls.length > 5, `the scan found the combat calls in src (${calls.length})`);
    assert.deepEqual(findUnknownCombatCalls(calls, actions), []);
});

test('the guard reports a system name asked from the action object (the bomber strike bug)', () => {
    const actions = readCombatActionNames();
    const calls = findCombatMemberCalls([
        'if (this.runtime?.combat?.mapUnitSystem?.callBomberStrike?.(player) !== true) {',
        'const ok = this.runtime?.combat?.callBomberStrike?.(player) === true;',
    ].join('\n'), 'HuntCombatSystem.js');
    assert.deepEqual(findUnknownCombatCalls(calls, actions), ['HuntCombatSystem.js:1 combat.mapUnitSystem']);
});
