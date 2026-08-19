import {
    deriveEndlessSeed,
    resolveEndlessDifficultyTier,
    sampleEndlessSeed,
} from '../../shared/contracts/EndlessParcoursContract.js';

const ROLE_TABLES = Object.freeze({
    1: Object.freeze(['pursuer', 'pursuer', 'pursuer', 'guard']),
    2: Object.freeze(['pursuer', 'flanker', 'guard', 'pursuer']),
    3: Object.freeze(['pursuer', 'flanker', 'guard', 'interceptor']),
    4: Object.freeze(['interceptor', 'interceptor', 'pursuer', 'flanker', 'guard']),
});

export function findSafeEndlessSpawnAnchor(runtime, slotState) {
    const human = runtime.entityManager?.humanPlayers?.[0] || null;
    let hasSelection = false;
    let selectedRank = 0xffffffff;
    const domain = `bot-slot:${slotState.slot}:life:${slotState.life + 1}`;
    for (const instance of runtime.activeModules.values()) {
        const module = instance.module;
        for (let index = 0; index < module.botAnchors.length; index += 1) {
            const local = module.botAnchors[index];
            runtime._tmpSpawnPosition.set(local.x, local.y, module.originZ + local.z);
            const candidate = runtime._candidateSpawnAnchor;
            candidate.id = local.id;
            candidate.x = runtime._tmpSpawnPosition.x;
            candidate.y = runtime._tmpSpawnPosition.y;
            candidate.z = runtime._tmpSpawnPosition.z;
            if (!runtime._isSpawnAnchorSafe(candidate, human)) continue;
            const rank = deriveEndlessSeed(runtime.baseSeed, `${domain}:${candidate.id}`);
            if (rank >= selectedRank) continue;
            selectedRank = rank;
            hasSelection = true;
            runtime._selectedSpawnAnchor.id = candidate.id;
            runtime._selectedSpawnAnchor.x = candidate.x;
            runtime._selectedSpawnAnchor.y = candidate.y;
            runtime._selectedSpawnAnchor.z = candidate.z;
        }
    }
    return hasSelection ? runtime._selectedSpawnAnchor : null;
}

export function resolveEndlessBotRole(runtime, slotState) {
    const tier = resolveEndlessDifficultyTier(runtime.elapsedCombatSeconds);
    const roles = ROLE_TABLES[tier] || ROLE_TABLES[1];
    const interval = Math.floor(runtime.elapsedCombatSeconds / 45);
    const directorSeed = deriveEndlessSeed(runtime.baseSeed, `bot-director:${interval}`);
    const slotSeed = deriveEndlessSeed(directorSeed, `bot-slot:${slotState.slot}:${slotState.life + 1}`);
    return roles[Math.floor(sampleEndlessSeed(slotSeed) * roles.length) % roles.length];
}
