import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
        'assets/branding/**',
        'START_CURVIOSCLASH.cmd',
        'package-lock.json',
        'electron/package-lock.json',
    ]) {
        assert.match(workflow, new RegExp(pathFilter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.match(workflow, /npm run test:desktop:smoke/);
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
