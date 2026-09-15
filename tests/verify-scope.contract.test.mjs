import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
    PLAYWRIGHT_LOCK_TIMEOUT_EXIT_CODE,
    VERIFICATION_STAGES,
    selectFor,
    toStage2Command,
} from '../.claude/skills/verify-scope/scripts/select-verification.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function commandsOf(stageList) {
    return stageList.map((entry) => entry.command);
}

// The three stages exist because of one shared resource: the machine-wide Playwright lock.
// Stage 1 never takes it, stage 2 takes it briefly, stage 3 holds it for half an hour or
// more. An agent that runs stage 3 stops being an agent and becomes a waiting room.

test('verify-scope: the three stages are named and separated', () => {
    assert.equal(Object.keys(VERIFICATION_STAGES).length, 3);
    assert.match(VERIFICATION_STAGES[1], /Stufe 1/);
    assert.match(VERIFICATION_STAGES[2], /Stufe 2/);
    assert.match(VERIFICATION_STAGES[3], /Stufe 3/);
});

test('verify-scope: stage 1 always carries lint, the fast contracts and the own test', () => {
    const { byStage } = selectFor(['README.md']);
    const stage1 = commandsOf(byStage[1]);
    assert.ok(stage1.includes('npm run lint'));
    assert.ok(stage1.includes('npm run test:contract:fast'));
    assert.ok(stage1.some((command) => command.startsWith('node --test tests/')), 'the own contract test comes first');
    assert.deepEqual(byStage[2], [], 'an unmatched path needs no targeted Playwright run');
    assert.deepEqual(byStage[3], [], 'and no cluster at all');
});

test('verify-scope: no stage-1 command starts Playwright', () => {
    const { byStage } = selectFor(['src/ui/HUD.js', 'src/entities/Player.js', 'editor/main.js']);
    for (const entry of byStage[1]) {
        assert.doesNotMatch(entry.command, /playwright|desktop:smoke|desktop:e2e/i, `${entry.command} belongs to a later stage`);
    }
});

test('verify-scope: a UI change gets targeted surface ids instead of a cluster', () => {
    const { byStage } = selectFor(['src/ui/menu/MenuSurface.js']);
    const stage2 = commandsOf(byStage[2]);
    assert.equal(stage2.length, 1);
    assert.match(stage2[0], /run-playwright-targeted\.mjs tests\/core-targeted-surface\.spec\.js/);
    assert.match(stage2[0], /--grep "T20kb:\|/, 'ids are passed as a --grep alternation');

    const stage3 = commandsOf(byStage[3]);
    assert.equal(stage3.length, 1);
    assert.match(stage3[0], /core-surface/);
    assert.match(stage3[0], /desktop-flows/);
    assert.match(stage3[0], /--skip-known/, 'a cluster run hides the known old failures');
});

test('verify-scope: physics paths get one targeted call per physics spec', () => {
    const { byStage } = selectFor(['src/entities/CollisionResponseSystem.js']);
    const stage2 = commandsOf(byStage[2]);
    assert.equal(stage2.length, 3);
    assert.ok(stage2.some((command) => command.includes('tests/physics-core.spec.js')));
    assert.ok(stage2.some((command) => command.includes('tests/physics-hunt.spec.js')));
    assert.ok(stage2.some((command) => command.includes('tests/physics-policy.spec.js')));
});

test('verify-scope: a spec without test ids is named as a whole spec', () => {
    const entry = toStage2Command({ spec: 'tests/network-adapter.spec.js', ids: [], note: 'Profil browser-compat' });
    assert.equal(entry.command, 'node scripts/run-playwright-targeted.mjs tests/network-adapter.spec.js');
    assert.match(entry.reason, /keine Test-IDs/);
    assert.equal(entry.note, 'Profil browser-compat');
    assert.equal(entry.stage, 2);
});

test('verify-scope: every stage-2 id really exists in its spec', () => {
    const seen = new Set();
    for (const rulePaths of [
        'src/ui/HUD.js',
        'src/modes/ArcadeModeStrategy.js',
        'src/entities/Player.js',
        'editor/main.js',
        'electron/main.cjs',
        'src/network/LANSessionAdapter.js',
        'assets/maps/standard.glb',
        'src/mobile-classic/Boot.js',
    ]) {
        for (const entry of selectFor([rulePaths]).byStage[2]) {
            const spec = /targeted\.mjs (\S+)/.exec(entry.command)?.[1];
            if (!spec) continue; // npm scripts such as test:desktop:smoke carry no spec path

            const specPath = path.join(REPO_ROOT, spec);
            assert.ok(fs.existsSync(specPath), `${spec} does not exist`);
            const source = fs.readFileSync(specPath, 'utf8');
            for (const id of /--grep "([^"]+)"/.exec(entry.command)?.[1].split('|') || []) {
                assert.ok(source.includes(`'${id}`) || source.includes(`"${id}`), `${id} is not a title in ${spec}`);
                seen.add(id);
            }
        }
    }
    assert.ok(seen.size > 10, `expected a real id table, saw ${seen.size}`);
});

test('verify-scope: the lock timeout exit code is documented as 75', () => {
    assert.equal(PLAYWRIGHT_LOCK_TIMEOUT_EXIT_CODE, 75);
    const skill = fs.readFileSync(path.join(REPO_ROOT, '.claude/skills/verify-scope/SKILL.md'), 'utf8');
    assert.match(skill, /Stufe 1/);
    assert.match(skill, /Stufe 2/);
    assert.match(skill, /Stufe 3/);
    assert.match(skill, /\b75\b/, 'the skill names the lock timeout exit code');
    assert.match(skill, /--skip-known/);

    const claudeMd = fs.readFileSync(path.join(REPO_ROOT, 'CLAUDE.md'), 'utf8');
    assert.match(claudeMd, /Stufe 1/);
    assert.match(claudeMd, /Stufe 3/);
    assert.match(claudeMd, /playwright:summary/);
    assert.match(claudeMd, /\b75\b/);

    const baseline = fs.readFileSync(path.join(REPO_ROOT, '.claude/skills/failure-baseline/SKILL.md'), 'utf8');
    assert.match(baseline, /playwright-known-failures\.json/, 'the baseline skill starts at the checked-in list');
});
