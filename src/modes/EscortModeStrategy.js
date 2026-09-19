import { HuntModeStrategy } from './HuntModeStrategy.js';

export class EscortModeStrategy extends HuntModeStrategy {
    get modeType() { return 'ESCORT'; }
    getPickupModeType() { return 'HUNT'; }
    hasCombatHud() { return true; }
    isRespawnEnabled() { return true; }
}
