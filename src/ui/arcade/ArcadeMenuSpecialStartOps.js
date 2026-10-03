import { resolvePortalChain } from '../../shared/contracts/PortalChainContract.js';
import { createDemolitionMapPlan } from '../../shared/contracts/DemolitionContract.js';

export function bindArcadeSpecialStartButtons(refs, bind, startRunWithOwnMap, seed, demolitionProfiles, runtimeAccess) {
    bind(refs.startEndlessButton, 'click', () => startRunWithOwnMap('endless_parcours', { mapKey: 'standard', numBots: 0 }));
    bind(refs.startFiveFrontsButton, 'click', () => startRunWithOwnMap('arena_waves', { mapKey: 'notre_dame_arena', numBots: 12 }));
    bind(refs.startFivePortalsButton, 'click', () => startRunWithOwnMap('five_portals', { mapKey: 'micro_maw', numBots: 0 }, 'five_portals'));
    bind(refs.startSkyLadderButton, 'click', () => startRunWithOwnMap('five_portals', { mapKey: resolvePortalChain('sky_ladder').maps[0], numBots: 0 }, 'sky_ladder'));
    bind(refs.startWeaponRaceButton, 'click', () => startRunWithOwnMap('weapon_race', { mapKey: 'parcours_assault', numBots: 4 }));
    bind(refs.startDemolitionButton, 'click', () => {
        if (demolitionProfiles.hasUnsupportedPlayerCount()) {
            runtimeAccess?.showStatusToast?.('Abrisskommando unterstützt höchstens drei lokale Spieler.', 1800, 'warning');
            return;
        }
        const profileIds = demolitionProfiles.save();
        if (demolitionProfiles.hasMissingActiveProfile(profileIds)) {
            runtimeAccess?.showStatusToast?.('Bitte ordne jedem Abrisskommando-Spieler ein vorhandenes Profil zu.', 1800, 'warning');
            return;
        }
        const firstMap = createDemolitionMapPlan(seed).maps[0];
        startRunWithOwnMap('demolition', { mapKey: firstMap.mapKey, numBots: firstMap.botCount });
    });
}
