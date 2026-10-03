import { resolvePortalChain } from '../../shared/contracts/PortalChainContract.js';
import { createDemolitionMapPlan } from '../../shared/contracts/DemolitionContract.js';
import { validateArcadePlayerProfileSelection } from './ArcadeDemolitionProfileSelection.js';

export function bindArcadeSpecialStartButtons(refs, bind, startRunWithOwnMap, seed, demolitionProfiles, runtimeAccess) {
    bind(refs.startEndlessButton, 'click', () => startRunWithOwnMap('endless_parcours', { mapKey: 'standard', numBots: 0 }));
    bind(refs.startFiveFrontsButton, 'click', () => startRunWithOwnMap('arena_waves', { mapKey: 'notre_dame_arena', numBots: 12 }));
    bind(refs.startFivePortalsButton, 'click', () => startRunWithOwnMap('five_portals', { mapKey: 'micro_maw', numBots: 0 }, 'five_portals'));
    bind(refs.startSkyLadderButton, 'click', () => startRunWithOwnMap('five_portals', { mapKey: resolvePortalChain('sky_ladder').maps[0], numBots: 0 }, 'sky_ladder'));
    bind(refs.startWeaponRaceButton, 'click', () => startRunWithOwnMap('weapon_race', { mapKey: 'parcours_assault', numBots: 4 }));
    bind(refs.startDemolitionButton, 'click', () => {
        const validation = validateArcadePlayerProfileSelection(demolitionProfiles);
        if (!validation.ok) {
            const message = validation.reason === 'unsupported_player_count'
                ? 'Abrisskommando unterstützt höchstens drei lokale Spieler.'
                : validation.reason === 'duplicate_profile'
                    ? 'Jeder Abrisskommando-Spieler benötigt ein eigenes Profil.'
                    : 'Bitte ordne jedem Abrisskommando-Spieler ein vorhandenes Profil zu.';
            runtimeAccess?.showStatusToast?.(message, 1800, 'warning');
            return;
        }
        const firstMap = createDemolitionMapPlan(seed).maps[0];
        startRunWithOwnMap('demolition', { mapKey: firstMap.mapKey, numBots: firstMap.botCount });
    });
}
