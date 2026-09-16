import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createPlayerProfileMigrationRecord,
    PLAYER_PROFILE_MIGRATION_SCHEMA_VERSION,
} from '../src/shared/contracts/PlayerProfileMigrationContract.js';

test('migration records normalize an optional recovery target profile id', () => {
    const record = createPlayerProfileMigrationRecord('source-profile', {
        recoveryTargetProfileId: '  target-profile  ',
    });
    assert.equal(record.recoveryTargetProfileId, 'target-profile');
});

test('migration records remain compatible with persisted records without a recovery target', () => {
    const record = createPlayerProfileMigrationRecord('source-profile', {
        schemaVersion: PLAYER_PROFILE_MIGRATION_SCHEMA_VERSION,
        profileId: 'source-profile',
        status: 'failed',
        records: { arcadeRunProfile: { status: 'copied' } },
    });
    assert.equal(record.recoveryTargetProfileId, '');
    assert.equal(record.profileId, 'source-profile');
    assert.deepEqual(record.records, { arcadeRunProfile: { status: 'copied' } });
});
