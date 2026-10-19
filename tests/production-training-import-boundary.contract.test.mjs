import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));

const TRAINING_RULES = new Set(['no-restricted-imports', 'curvios/no-dev-training-load']);

async function lintSource(filePath, source) {
    const eslint = new ESLint({ cwd: repoRoot });
    const [result] = await eslint.lintText(source, { filePath });
    return (result?.messages || []).filter((message) => TRAINING_RULES.has(message.ruleId));
}

function lintImport(filePath, specifier) {
    return lintSource(filePath, `import '${specifier}';\n`);
}

// The post-build scan only knows a handful of training class names; the import itself must fail.
for (const [filePath, specifier] of [
    ['src/entities/ai/FakePolicy.js', '../../../dev/training/src/entities/ai/training/WebSocketTrainerBridge.js'],
    ['electron/fake-main.mjs', '../dev/training/scripts/anything.mjs'],
    ['server/fake-server.js', '../dev/training/src/index.js'],
]) {
    test(`product code in ${filePath.split('/')[0]} may not import dev/training`, async () => {
        const violations = await lintImport(filePath, specifier);
        assert.equal(violations.length, 1, `${filePath} importing ${specifier} must be a lint error`);
        assert.equal(violations[0].severity, 2);
    });
}

test('ordinary product imports stay allowed', async () => {
    const violations = await lintImport('src/entities/ai/FakePolicy.js', './BotPolicyTypes.js');
    assert.deepEqual(violations, []);
});

// no-restricted-imports only sees static declarations; import() and require() reach the bundle too.
for (const [filePath, source] of [
    ['src/entities/ai/FakePolicy.js', "export const load = () => import('../../../dev/training/x.js');\n"],
    ['src/entities/ai/FakePolicy.js', "export const load = () => import(`../../../dev/training/x.js`);\n"],
    ['electron/fake.cjs', "module.exports = require('../dev/training/x.cjs');\n"],
    ['server/fake-server.cjs', "module.exports = require('../dev/training');\n"],
    ['src/entities/ai/FakePolicy.js', "export const all = import.meta.glob('../../../dev/training/*.js');\n"],
    ['src/entities/ai/FakePolicy.js', "export const all = import.meta.glob(['./a.js', '../../../dev/training/*.js']);\n"],
    ['src/entities/ai/FakePolicy.js', "export const load = () => import('../../../dev/' + 'training/x.js');\n"],
    ['src/entities/ai/FakePolicy.js', "export const url = new URL('../../../dev/training/worker.js', import.meta.url);\n"],
    ['electron/fake.cjs', "module.exports = require.resolve('../dev/training/x.cjs');\n"],
]) {
    test(`dynamic load of dev/training in ${filePath} is a lint error: ${source.trim()}`, async () => {
        const violations = await lintSource(filePath, source);
        assert.equal(violations.length, 1, `${filePath} loading dev/training must be a lint error`);
        assert.equal(violations[0].severity, 2);
    });
}

test('ordinary dynamic loads stay allowed', async () => {
    assert.deepEqual(await lintSource('src/entities/ai/FakePolicy.js', "export const load = () => import('./BotPolicyTypes.js');\n"), []);
    assert.deepEqual(await lintSource('electron/fake.cjs', "module.exports = require('./dev-training-notes.cjs');\n"), []);
    assert.deepEqual(await lintSource('src/entities/ai/FakePolicy.js', "export const all = import.meta.glob('../../data/*.json');\n"), []);
    assert.deepEqual(await lintSource('src/entities/ai/FakePolicy.js', "export const note = 'see dev/training/README';\n"), []);
});