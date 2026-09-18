// ============================================
// MatchStartValidationService.js - validates menu state before match start
// ============================================
// @ts-nocheck
import { createSurfacePolicyPort } from '../../shared/runtime/SurfacePolicyPort.js';
import { resolveDesktopConnectivityProfile } from '../../shared/contracts/DesktopMultiplayerRoleContract.js';
import { isMapEligibleForModePath } from '../../shared/contracts/MapModeContract.js';
import { resolveRuntimeSessionContract } from '../../shared/contracts/RuntimeSessionContract.js';

/**
 * @param {{ settings?: any, ui?: any, multiplayerSessionState?: any, surfaceState?: any, currentFallbackModePath?: string }}
 */
export function resolveMatchStartValidationIssue({
    settings = {},
    ui = null,
    multiplayerSessionState = null,
    maps = {},
    huntModeType = 'HUNT',
    classicModeType = 'CLASSIC',
    arcadeModeType = 'ARCADE',
    productSurfaceId = '',
} = {}) {
    const sessionContract = resolveRuntimeSessionContract(settings?.localSettings);
    const sessionType = sessionContract.sessionType;
    const mapKey = String(settings?.mapKey || '').trim();
    const mapExists = mapKey === 'custom' || !!maps?.[mapKey];
    if (!mapExists) {
        return {
            message: 'Start nicht möglich: Bitte eine gültige Map wählen.',
            fieldKey: 'map',
            fieldMessage: 'Map-Auswahl fehlt oder ist ungültig.',
        };
    }

    const vehicleP1 = String(settings?.vehicles?.PLAYER_1 || '').trim();
    if (!vehicleP1) {
        return {
            message: 'Start nicht möglich: Flugzeug P1 fehlt.',
            fieldKey: 'vehicleP1',
            fieldMessage: 'Flugzeug P1 auswählen.',
        };
    }

    if (sessionType === 'splitscreen') {
        const vehicleP2 = String(settings?.vehicles?.PLAYER_2 || '').trim();
        if (!vehicleP2) {
            return {
                message: 'Start nicht möglich: Splitscreen benötigt Flugzeug P2.',
                fieldKey: 'vehicleP2',
                fieldMessage: 'Flugzeug P2 auswählen.',
            };
        }
    }

    if (sessionContract.sessionType === 'multiplayer') {
        const sessionState = multiplayerSessionState && typeof multiplayerSessionState === 'object'
            ? multiplayerSessionState
            : null;
        const connectivityProfile = resolveDesktopConnectivityProfile();
        const surfacePolicyPort = createSurfacePolicyPort({ getProductSurfaceId: () => productSurfaceId });
        const hostGate = surfacePolicyPort.resolveMultiplayerGateAccess('host');
        const legacyTransportActive = sessionContract.isLegacyTransport === true;
        const requestedTransport = String(
            sessionState?.transport || sessionContract.multiplayerTransport || 'lan'
        ).trim().toLowerCase();
        const onlineTransport = requestedTransport === 'online';
        const transportOfflineHint = onlineTransport
            ? connectivityProfile.onlineUnavailableHint
            : connectivityProfile.lanOfflineHint;
        const lobbyCode = String(sessionState?.lobbyCode || ui?.multiplayerLobbyCodeInput?.value || '').trim();
        if (sessionState?.joined === true && sessionState?.connected !== true) {
            return {
                message: `Start nicht möglich: ${transportOfflineHint}`,
                fieldKey: 'multiplayer',
                fieldMessage: transportOfflineHint,
            };
        }
        if (!lobbyCode || sessionState?.joined !== true) {
            if (!hostGate.allowed) {
                return {
                    message: 'Start nicht möglich: Diese Demo kann nur einer Desktop-Lobby beitreten.',
                    fieldKey: 'multiplayer',
                    fieldMessage: 'Lobby-Code eines Desktop-Hosts eingeben und beitreten.',
                };
            }
            if (legacyTransportActive) {
                return {
                    message: `Start nicht möglich: "${sessionContract.transportAudienceLabel}" ist kein produktiver Multiplayer-Transport.`,
                    fieldKey: 'multiplayer',
                    fieldMessage: 'Produktiven Transport (LAN oder Online) wählen und danach Lobby verbinden.',
                };
            }
            const transportLabel = sessionContract.transportAudienceLabel;
            return {
                message: `Start nicht möglich: ${transportLabel}-Lobby verbinden (Host oder Join).`,
                fieldKey: 'multiplayer',
                fieldMessage: `${transportLabel}: Host oder Join ausführen. ${transportOfflineHint}`,
            };
        }
        if (sessionState?.isHost !== true) {
            if (!hostGate.allowed) {
                return {
                    message: 'Start nicht möglich: Diese Demo joint nur; Matchstart erfolgt über den Desktop-Host.',
                    fieldKey: 'multiplayer',
                    fieldMessage: 'Auf den Desktop-Host warten; die Demo besitzt keinen Matchstart.',
                };
            }
            return {
                message: 'Start nicht möglich: Nur der Host darf das Match starten.',
                fieldKey: 'multiplayer',
                fieldMessage: 'Auf den Host warten oder selbst hosten.',
            };
        }
        if ((sessionState?.memberCount || 0) < 2) {
            return {
                message: 'Start nicht möglich: Multiplayer benötigt mindestens zwei Teilnehmer.',
                fieldKey: 'multiplayer',
                fieldMessage: 'Einen zweiten Spieler joinen lassen.',
            };
        }
        if (sessionState?.allReady !== true) {
            return {
                message: 'Start nicht möglich: Alle Lobby-Teilnehmer müssen Ready sein.',
                fieldKey: 'multiplayer',
                fieldMessage: 'Ready auf allen verbundenen Clients setzen.',
            };
        }
    }

    const modePath = String(settings?.localSettings?.modePath || 'normal').toLowerCase();
    if (mapExists && mapKey !== 'custom' && !isMapEligibleForModePath(maps?.[mapKey], modePath)) {
        return {
            message: 'Start nicht möglich: Die gewählte Map ist in diesem Build nicht startbar.',
            fieldKey: 'map',
            fieldMessage: 'Andere Map wählen oder Map-Daten prüfen.',
        };
    }

    const gameMode = String(settings?.gameMode || 'CLASSIC').toUpperCase();
    if (modePath === 'fight' && gameMode !== huntModeType) {
        return {
            message: 'Start nicht möglich: Fight muss intern auf HUNT laufen.',
            fieldKey: 'match',
            fieldMessage: 'Fight-Konflikt: Modus auf HUNT synchronisieren.',
        };
    }
    if (modePath === 'arcade' && gameMode !== arcadeModeType) {
        return {
            message: 'Start nicht möglich: Arcade muss intern auf ARCADE laufen.',
            fieldKey: 'match',
            fieldMessage: 'Arcade-Konflikt: Modus auf ARCADE synchronisieren.',
        };
    }
    if (modePath === 'normal' && gameMode !== classicModeType) {
        return {
            message: 'Start nicht möglich: Normal muss intern auf CLASSIC laufen.',
            fieldKey: 'match',
            fieldMessage: 'Modus-Konflikt: Normal auf CLASSIC synchronisieren.',
        };
    }

    const themeMode = String(settings?.localSettings?.themeMode || 'dunkel').toLowerCase();
    if (themeMode !== 'hell' && themeMode !== 'dunkel') {
        return {
            message: 'Start nicht möglich: Theme-Modus ungültig.',
            fieldKey: 'theme',
            fieldMessage: 'Theme auf Hell oder Dunkel setzen.',
        };
    }

    return null;
}
