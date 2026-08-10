import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { collectNodeTestFileNames, selectNodeTestFiles } from '../scripts/run-contract-tests.mjs';
import {
    DESKTOP_E2E_CLUSTERS,
    HEAVY_DIAGNOSTIC_CLUSTERS,
    PLAYWRIGHT_SMOKE_SPECS,
} from '../scripts/playwright-test-clusters.mjs';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

test('push and pull requests run the complete quality command set', () => {
    const workflow = readRepoFile('.github/workflows/quality.yml');
    assert.match(workflow, /push:/);
    assert.match(workflow, /pull_request:/);
    for (const command of [
        'npm ci',
        'npm --prefix electron ci',
        'npm run quality',
    ]) {
        assert.match(workflow, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    for (const duplicatedCommand of [
        'npm run lint',
        'npm run typecheck:architecture',
        'npm run check:architecture',
        'npm run test:contract',
    ]) {
        assert.doesNotMatch(workflow, new RegExp(duplicatedCommand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
});

test('desktop smoke covers product, dependency, branding, and launcher changes', () => {
    const workflow = readRepoFile('.github/workflows/desktop.yml');
    for (const pathFilter of [
        'src/**',
        'electron/**',
        'server/**',
        'editor/**',
        'prototypes/vehicle-lab/**',
        'assets/**',
        'START_CURVIOSCLASH.cmd',
        'package-lock.json',
        'electron/package-lock.json',
    ]) {
        assert.match(workflow, new RegExp(pathFilter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.match(workflow, /npm run test:desktop:smoke/);
    assert.match(workflow, /schedule:/);
    assert.match(workflow, /heavy-e2e:/);
    assert.match(workflow, /browser-compat:/);
    assert.match(workflow, /needs: smoke/);
    assert.match(workflow, /npm run test:browser:compat/);
    for (const cluster of [...DESKTOP_E2E_CLUSTERS, ...HEAVY_DIAGNOSTIC_CLUSTERS]) {
        assert.match(workflow, new RegExp(`- ${cluster.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\r?\\n|$)`));
    }
});

test('contract runner discovers every root Node test exactly once', () => {
    const allNodeTests = readdirSync(new URL('../tests/', import.meta.url))
        .filter((fileName) => fileName.endsWith('.test.mjs'))
        .sort();
    const selected = [
        ...selectNodeTestFiles(allNodeTests, 'fast'),
        ...selectNodeTestFiles(allNodeTests, 'dist'),
    ].sort();

    assert.deepEqual(selected, allNodeTests);
});

function fakeTestTree(tree) {
    return (directory, options) => {
        void options;
        const entries = tree[directory.split(/[\\/]/).join('/')];
        if (!entries) throw new Error(`unexpected directory: ${directory}`);
        return entries.map(([name, isDirectory]) => ({
            name,
            isDirectory: () => isDirectory,
        }));
    };
}

test('a Node test in a subfolder is collected instead of silently skipped', () => {
    const collected = collectNodeTestFileNames('tests', fakeTestTree({
        tests: [['root.contract.test.mjs', false], ['nested', true]],
        'tests/nested': [['deep.contract.test.mjs', false], ['helper.mjs', false]],
    }));

    assert.deepEqual(collected, ['nested/deep.contract.test.mjs', 'root.contract.test.mjs']);
});

test('fixture folders keep their deliberately broken tests out of the suite', () => {
    const collected = collectNodeTestFileNames('tests', fakeTestTree({
        tests: [['root.contract.test.mjs', false], ['council-test-loop', true]],
    }));

    assert.deepEqual(collected, ['root.contract.test.mjs']);
});

test('the dist-dependent test is routed by name even from a subfolder', () => {
    const nested = ['nested/electron-renderer-dist-drift.contract.test.mjs'];

    assert.deepEqual(selectNodeTestFiles(nested, 'dist'), nested);
    assert.deepEqual(selectNodeTestFiles(nested, 'fast'), []);
});

test('the real tests folder exposes its fixture loop but never runs it', () => {
    const collected = collectNodeTestFileNames(fileURLToPath(new URL('../tests/', import.meta.url)));

    assert.ok(collected.includes('ci-automation.contract.test.mjs'), 'root tests are collected');
    assert.equal(
        collected.some((fileName) => fileName.startsWith('council-test-loop/')),
        false,
        'council fixtures stay out of the product suite'
    );
});

test('CI cluster catalog assigns every Playwright spec exactly once', () => {
    const allSpecs = readdirSync(new URL('../tests/', import.meta.url))
        .filter((fileName) => fileName.endsWith('.spec.js'))
        .map((fileName) => `tests/${fileName}`)
        .sort();
    const assignedSpecs = [
        ...PLAYWRIGHT_SMOKE_SPECS,
        ...DESKTOP_E2E_CLUSTERS.flatMap((cluster) => cluster.specs),
        ...HEAVY_DIAGNOSTIC_CLUSTERS.flatMap((cluster) => cluster.specs),
    ].sort();

    assert.deepEqual(assignedSpecs, allSpecs);
});

test('Playwright design keeps skips, fixed sleeps, randomness, and white-box growth out', () => {
    const specSources = readdirSync(new URL('../tests/', import.meta.url))
        .filter((fileName) => fileName.endsWith('.spec.js'))
        .map((fileName) => ({
            fileName,
            source: readRepoFile(`tests/${fileName}`),
        }));
    const combinedSource = specSources.map(({ source }) => source).join('\n');

    assert.doesNotMatch(combinedSource, /\btest\.skip\s*\(/);
    assert.doesNotMatch(combinedSource, /\.waitForTimeout\s*\(/);
    assert.doesNotMatch(combinedSource, /\bMath\.random\s*\(/);

    const fixturelessTests = specSources.flatMap(({ fileName, source }) => (
        [...source.matchAll(/\btest\([^\n]+,\s*(?:async\s*)?\(\)\s*=>/g)]
            .map(() => fileName)
    ));
    assert.ok(
        fixturelessTests.length <= 29,
        `Move browserless Playwright tests to node:test before adding more: ${fixturelessTests.join(', ')}`
    );

    const privateAccesses = combinedSource.match(
        /\b(?:game|runtime|manager|system|service|recorder|player|adapter|bridge)\._[A-Za-z]/g
    ) || [];
    assert.ok(
        privateAccesses.length <= 133,
        `Use runtime/debug contracts before adding E2E private access (${privateAccesses.length}/133)`
    );
});

test('package changes build and exercise both packaged Electron entries', () => {
    const workflow = readRepoFile('.github/workflows/package-check.yml');
    assert.match(workflow, /assets\/branding\/\*\*/);
    assert.match(workflow, /START_CURVIOSCLASH\.cmd/);
    assert.match(workflow, /npm run app:package/);
    assert.match(workflow, /\\entry\.cjs/);
    assert.match(workflow, /\\settings-studio\\main\.cjs/);
    assert.match(workflow, /npm run app:package:verify/);
    assert.doesNotMatch(workflow, /resources\\src\\core\\main\.js/);
    assert.match(workflow, /ExtractAssociatedIcon/);
});

test('weekly audits cover every dependency tree without automatic major updates', () => {
    const auditWorkflow = readRepoFile('.github/workflows/security-audit.yml');
    assert.match(auditWorkflow, /schedule:/);
    assert.match(auditWorkflow, /npm audit --audit-level=high/);
    assert.match(auditWorkflow, /npm --prefix electron audit --audit-level=high/);
    assert.match(auditWorkflow, /npm --prefix server audit --audit-level=high/);

    const dependabot = readRepoFile('.github/dependabot.yml');
    for (const directory of ['/', '/electron', '/server']) {
        assert.match(dependabot, new RegExp(`directory: ${directory.replace('/', '\\/')}(?:\\r?\\n|$)`));
    }
    assert.equal((dependabot.match(/version-update:semver-major/g) || []).length, 3);
});
