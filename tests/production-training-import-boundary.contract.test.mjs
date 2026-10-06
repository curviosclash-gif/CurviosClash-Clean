import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));

async function lintImport(filePath, specifier) {
    const eslint = new ESLint({ cwd: repoRoot });
    const [result] = await eslint.lintText(`import '${specifier}';\n`, { filePath });
    return (result?.messages || []).filter((message) => message.ruleId === 'no-restricted-imports');
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
