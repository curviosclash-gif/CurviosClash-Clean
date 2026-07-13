import { SETTINGS_CHANGE_KEYS } from '../../composition/core-ui/CoreSettingsPorts.js';
import { normalizeBotPolicyStrategy } from '../RuntimeConfig.js';
import {
    createSettingsMutationFailure,
    withMutationChangedKeys,
} from './SettingsMutationResult.js';

export function createSettingsBotPolicyFacade() {
    function setBotPolicyStrategy(settings, strategy) {
        if (!settings || typeof settings !== 'object') {
            return createSettingsMutationFailure('invalid_settings');
        }

        const previousStrategy = normalizeBotPolicyStrategy(settings.botPolicyStrategy, 'auto');
        const nextStrategy = normalizeBotPolicyStrategy(strategy, previousStrategy);
        settings.botPolicyStrategy = nextStrategy;

        return withMutationChangedKeys(
            {
                success: true,
                reason: previousStrategy === nextStrategy ? 'unchanged' : 'updated',
            },
            previousStrategy === nextStrategy ? [] : [SETTINGS_CHANGE_KEYS.BOTS_POLICY_STRATEGY],
            { botPolicyStrategy: nextStrategy }
        );
    }

    return {
        setBotPolicyStrategy,
    };
}
