import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    APPROVAL_DIRECTIVE,
    APPROVAL_TTL_MS,
    createApprovalGrant,
    isApprovalPrompt,
    isValidApprovalGrant,
    processHook,
} from '../.claude/hooks/claude-agent-lock.mjs';

const NOW = 1_800_000_000_000;

function payload(overrides = {}) {
    return {
        session_id: 'session-a',
        cwd: '/repo',
        hook_event_name: 'PreToolUse',
        tool_name: 'Agent',
        ...overrides,
    };
}

class MemoryApprovalStore {
    grant = null;
    revokeCount = 0;

    async revoke() {
        this.revokeCount += 1;
        this.grant = null;
    }

    async issue(_payload, grant) {
        this.grant = grant;
    }

    async consume() {
        const grant = this.grant;
        this.grant = null;
        return grant;
    }
}

test('accepts only the exact approval directive on the first line', () => {
    assert.equal(isApprovalPrompt(`${APPROVAL_DIRECTIVE}\nImplementiere die Aufgabe.`), true);
    assert.equal(isApprovalPrompt(` ${APPROVAL_DIRECTIVE}`), false);
    assert.equal(isApprovalPrompt(`Bitte ${APPROVAL_DIRECTIVE}`), false);
    assert.equal(isApprovalPrompt(`Implementiere zuerst.\n${APPROVAL_DIRECTIVE}`), false);
});

test('arms one agent invocation and consumes the grant atomically', async () => {
    const store = new MemoryApprovalStore();
    const arm = payload({
        hook_event_name: 'UserPromptSubmit',
        tool_name: undefined,
        prompt: `${APPROVAL_DIRECTIVE}\nNutze genau einen Claude-Agenten.`,
    });

    assert.equal((await processHook('arm', arm, { store, now: NOW })).exitCode, 0);
    assert.equal((await processHook('check', payload(), { store, now: NOW + 1 })).exitCode, 0);
    assert.equal((await processHook('check', payload(), { store, now: NOW + 2 })).exitCode, 2);
});

test('revokes an unused grant on the next unapproved prompt', async () => {
    const store = new MemoryApprovalStore();
    const approvedPrompt = payload({
        hook_event_name: 'UserPromptSubmit',
        tool_name: undefined,
        prompt: APPROVAL_DIRECTIVE,
    });
    const ordinaryPrompt = { ...approvedPrompt, prompt: 'Arbeite ohne Agenten weiter.' };

    await processHook('arm', approvedPrompt, { store, now: NOW });
    await processHook('arm', ordinaryPrompt, { store, now: NOW + 1 });

    assert.equal(store.revokeCount, 2);
    assert.equal((await processHook('check', payload(), { store, now: NOW + 2 })).exitCode, 2);
});

test('rejects expired and differently scoped grants', () => {
    const grant = createApprovalGrant(payload(), NOW);
    assert.equal(isValidApprovalGrant(grant, payload(), NOW + APPROVAL_TTL_MS), true);
    assert.equal(isValidApprovalGrant(grant, payload(), NOW + APPROVAL_TTL_MS + 1), false);
    assert.equal(isValidApprovalGrant(grant, payload({ session_id: 'session-b' }), NOW + 1), false);
    assert.equal(isValidApprovalGrant(grant, payload({ cwd: '/other-repo' }), NOW + 1), false);
});

test('fails closed for unexpected hook events and store failures', async () => {
    const store = new MemoryApprovalStore();
    assert.equal((await processHook('check', payload({ tool_name: 'Bash' }), { store, now: NOW })).exitCode, 2);

    const failingStore = {
        async revoke() { throw new Error('unavailable'); },
    };
    await assert.rejects(
        processHook('arm', payload({ hook_event_name: 'UserPromptSubmit', prompt: APPROVAL_DIRECTIVE }), {
            store: failingStore,
            now: NOW,
        }),
        /unavailable/
    );
});

test('wires the approval and blocking hooks into shared Claude settings', () => {
    const settings = JSON.parse(readFileSync('.claude/settings.json', 'utf8'));
    const approvalHook = settings.hooks.UserPromptSubmit[0].hooks[0];
    const blockingGroup = settings.hooks.PreToolUse[0];

    assert.match(approvalHook.command, /claude-agent-lock\.mjs" arm$/);
    assert.equal(blockingGroup.matcher, 'Agent|Task');
    assert.match(blockingGroup.hooks[0].command, /claude-agent-lock\.mjs" check$/);
});
