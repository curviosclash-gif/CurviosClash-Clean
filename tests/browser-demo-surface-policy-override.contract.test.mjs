import assert from 'node:assert/strict';
import test from 'node:test';

import {
    BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_CONTRACT_VERSION,
    BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_MIGRATION_CODES,
    BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_VALIDATION_CODES,
    classifyBrowserDemoSurfacePolicyOverrideMigration,
    createBrowserDemoSurfacePolicyOverrideDraft,
    mergeBrowserDemoSurfacePolicyWithOverride,
    validateBrowserDemoSurfacePolicyOverrideDraft,
} from '../src/shared/contracts/BrowserDemoSurfacePolicyOverrideContract.js';
import {
    PLATFORM_CAPABILITY_REGISTRY,
    PLATFORM_PRODUCT_SURFACE_IDS,
} from '../src/shared/contracts/PlatformCapabilityData.js';

function getBrowserDemoBase() {
    return PLATFORM_CAPABILITY_REGISTRY.products[PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO];
}

test('createBrowserDemoSurfacePolicyOverrideDraft returns v1 draft with empty policy sections', () => {
    const draft = createBrowserDemoSurfacePolicyOverrideDraft();
    assert.equal(draft.contractVersion, BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_CONTRACT_VERSION);
    assert.deepEqual(draft.policy, {});
    assert.deepEqual(draft.capabilityFlags, {});
    assert.equal(Object.isFrozen(draft), true);
});

test('classifyBrowserDemoSurfacePolicyOverrideMigration returns current/upgrade/fallback/reject', () => {
    const current = classifyBrowserDemoSurfacePolicyOverrideMigration({
        contractVersion: BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_CONTRACT_VERSION,
    });
    assert.equal(current.status, 'current');
    assert.equal(current.code, BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_MIGRATION_CODES.CURRENT);

    const upgrade = classifyBrowserDemoSurfacePolicyOverrideMigration({ policy: {} });
    assert.equal(upgrade.status, 'upgrade');
    assert.equal(upgrade.code, BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_MIGRATION_CODES.UPGRADE);

    const fallback = classifyBrowserDemoSurfacePolicyOverrideMigration({
        contractVersion: 'browser-demo-surface-policy.v9',
    });
    assert.equal(fallback.status, 'fallback');
    assert.equal(fallback.code, BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_MIGRATION_CODES.FALLBACK);

    const reject = classifyBrowserDemoSurfacePolicyOverrideMigration({
        contractVersion: 'invalid-version-token',
    });
    assert.equal(reject.status, 'reject');
    assert.equal(reject.code, BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_MIGRATION_CODES.REJECT);
});

test('validateBrowserDemoSurfacePolicyOverrideDraft accepts minimal v1 payload', () => {
    const result = validateBrowserDemoSurfacePolicyOverrideDraft({
        contractVersion: BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_CONTRACT_VERSION,
    });
    assert.equal(result.valid, true, JSON.stringify(result.errors));
    assert.equal(result.errors.length, 0);
    assert.deepEqual(result.normalizedDraft.policy, {});
    assert.deepEqual(result.normalizedDraft.capabilityFlags, {});
});

test('validateBrowserDemoSurfacePolicyOverrideDraft reports unknown fields and invalid capability entries', () => {
    const result = validateBrowserDemoSurfacePolicyOverrideDraft({
        contractVersion: BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_CONTRACT_VERSION,
        unknownRootField: true,
        policy: {
            unknownPolicyField: [],
            allowedModePaths: ['fight', ''],
        },
        capabilityFlags: {
            host: { enabled: false, reason: 'not-allowed-here' },
            nope: true,
        },
    });

    assert.equal(result.valid, false);
    const errorCodes = result.errors.map((entry) => entry.code);
    assert.ok(errorCodes.includes(BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_VALIDATION_CODES.TOP_LEVEL_FIELD_UNKNOWN));
    assert.ok(errorCodes.includes(BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_VALIDATION_CODES.POLICY_FIELD_UNKNOWN));
    assert.ok(errorCodes.includes(BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_VALIDATION_CODES.FIELD_VALUE_INVALID));
    assert.ok(errorCodes.includes(BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_VALIDATION_CODES.CAPABILITY_FLAG_FIELD_UNKNOWN));
    assert.ok(errorCodes.includes(BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_VALIDATION_CODES.CAPABILITY_FLAG_UNKNOWN));
});

test('mergeBrowserDemoSurfacePolicyWithOverride applies monotone clamp and never broadens capabilities', () => {
    const browserDemoBase = getBrowserDemoBase();
    const merged = mergeBrowserDemoSurfacePolicyWithOverride(
        browserDemoBase.surfacePolicy,
        browserDemoBase.capabilities,
        {
            contractVersion: BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_CONTRACT_VERSION,
            policy: {
                allowedSessionTypes: ['single', 'splitscreen'],
                allowedModePaths: ['fight', 'quick_action'],
                allowedPresetIds: ['fight-standard', 'future-preset'],
                allowedMultiplayerTransports: ['online'],
                hostMultiplayerTransports: ['online'],
                joinMultiplayerTransports: ['online'],
                curatedMapKeysByModePath: {
                    arcade: ['parcours_rift'],
                    fight: ['maze', 'future_map'],
                },
            },
            capabilityFlags: {
                host: true,
                save: false,
            },
        }
    );

    assert.equal(merged.diagnostics.status, 'applied');
    assert.deepEqual(merged.policy.allowedSessionTypes, ['single']);
    assert.deepEqual(merged.policy.allowedModePaths, ['fight']);
    assert.deepEqual(merged.policy.allowedPresetIds, ['fight-standard']);
    assert.deepEqual(merged.policy.allowedMultiplayerTransports, []);
    assert.deepEqual(merged.policy.hostMultiplayerTransports, []);
    assert.deepEqual(merged.policy.joinMultiplayerTransports, []);
    assert.deepEqual(merged.policy.curatedMapKeysByModePath.fight, ['maze']);
    assert.equal(Object.prototype.hasOwnProperty.call(merged.policy.curatedMapKeysByModePath, 'arcade'), false);
    assert.equal(merged.capabilityFlags.host, false, 'host must stay disabled because base browser policy disables it');
    assert.equal(merged.capabilityFlags.save, false, 'explicit capability false must narrow from base true to false');
});

test('mergeBrowserDemoSurfacePolicyWithOverride falls back for unknown future version', () => {
    const browserDemoBase = getBrowserDemoBase();
    const merged = mergeBrowserDemoSurfacePolicyWithOverride(
        browserDemoBase.surfacePolicy,
        browserDemoBase.capabilities,
        {
            contractVersion: 'browser-demo-surface-policy.v8',
            policy: {
                allowedModePaths: ['fight'],
            },
        }
    );

    assert.equal(merged.diagnostics.status, 'fallback');
    assert.deepEqual(merged.policy.allowedModePaths, ['arcade', 'fight', 'normal']);
    assert.equal(merged.capabilityFlags.discovery, true);
    assert.equal(merged.capabilityFlags.host, false);
});

test('mergeBrowserDemoSurfacePolicyWithOverride rejects non-object drafts and keeps base policy', () => {
    const browserDemoBase = getBrowserDemoBase();
    const merged = mergeBrowserDemoSurfacePolicyWithOverride(
        browserDemoBase.surfacePolicy,
        browserDemoBase.capabilities,
        null
    );

    assert.equal(merged.diagnostics.status, 'reject');
    assert.deepEqual(merged.policy.allowedSessionTypes, ['single', 'multiplayer']);
    assert.equal(merged.capabilityFlags.save, true);
});
