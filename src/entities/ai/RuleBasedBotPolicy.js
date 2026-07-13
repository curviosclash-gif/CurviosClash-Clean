// ============================================
// RuleBasedBotPolicy.js - adapter for legacy BotAI
// ============================================

import { BotAI } from '../Bot.js';
import { BOT_POLICY_TYPES } from './BotPolicyTypes.js';

export class RuleBasedBotPolicy {
    constructor(options = {}) {
        this.type = BOT_POLICY_TYPES.RULE_BASED;
        this.sensePhase = 0;
        this._botAI = new BotAI(options);
    }

    update(dt, player, arena, allPlayers, projectiles) {
        return this._botAI.update(dt, player, arena, allPlayers, projectiles);
    }

    setDifficulty(profileName) {
        if (typeof this._botAI.setDifficulty === 'function') {
            this._botAI.setDifficulty(profileName);
        }
    }

    onBounce(type, normal = null) {
        if (typeof this._botAI.onBounce === 'function') {
            this._botAI.onBounce(type, normal);
        }
    }

    setSensePhase(phase) {
        const normalizedPhase = Number.isFinite(Number(phase)) ? Math.max(0, Math.trunc(Number(phase))) : 0;
        this.sensePhase = normalizedPhase;
        if (typeof this._botAI.setSensePhase === 'function') {
            this._botAI.setSensePhase(normalizedPhase);
        }
    }

    getSensorSnapshot() {
        if (typeof this._botAI.getSensorSnapshot === 'function') {
            return this._botAI.getSensorSnapshot();
        }
        return null;
    }

    getSensorArray() {
        if (typeof this._botAI.getSensorArray === 'function') {
            return this._botAI.getSensorArray();
        }
        return null;
    }
}
