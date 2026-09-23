// ============================================
// MatchStartValidationService.js - validates menu state before match start
// ============================================
// @ts-nocheck
import { createSurfacePolicyPort } from '../../shared/runtime/SurfacePolicyPort.js';
import { resolveDesktopConnectivityProfile } from '../../shared/contracts/DesktopMultiplayerRoleContract.js';
import { isMapEligibleForModePath } from '../../shared/contracts/MapModeContract.js';
import { resolveRuntimeSessionContract } from '../../shared/contracts/RuntimeSessionContract.js';
import { normalizeTeamHuntSettings, validateTeamRoster } from '../../shared/contracts/TeamHuntContract.js';

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
            message: 'Start nicht möglich: Bitte eine gültige Karte wählen.',
            fieldKey: 'map',
            fieldMessage: 'Die Kartenwahl fehlt oder ist ungültig.',
        };
    }

    const vehicleP1 = String(settings?.vehicles?.PLAYER_1 || '').trim();
    if (!vehicleP1) {
        return {
            message: 'Start nicht möglich: Flugzeug für Spieler 1 fehlt.',
            fieldKey: 'vehicleP1',
            fieldMessage: 'Flugzeug für Spieler 1 wählen.',
        };
    }

    if (sessionType === 'splitscreen') {
        const vehicleP2 = String(settings?.vehicles?.PLAYER_2 || '').trim();
        if (!vehicleP2) {
            return {
                message: 'Start nicht möglich: Der geteilte Bildschirm braucht ein Flugzeug für Spieler 2.',
                fieldKey: 'vehicleP2',
                fieldMessage: 'Flugzeug für Spieler 2 wählen.',
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
                    message: `Start nicht möglich: "${sessionContract.transportAudienceLabel}" ist kein nutzbarer Mehrspieler-Weg.`,
                    fieldKey: 'multiplayer',
                    fieldMessage: 'LAN oder Online wählen und danach eine Lobby verbinden.',
                };
            }
            const transportLabel = sessionContract.transportAudienceLabel;
            return {
                message: `Start nicht möglich: ${transportLabel}-Lobby erstellen oder ihr beitreten.`,
                fieldKey: 'multiplayer',
                fieldMessage: `${transportLabel}: Lobby erstellen oder ihr beitreten. ${transportOfflineHint}`,
            };
        }
        if (sessionState?.isHost !== true) {
            if (!hostGate.allowed) {
                return {
                    message: 'Start nicht möglich: Diese Demo kann nur beitreten; das Match startet der Host am Desktop.',
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
                message: 'Start nicht möglich: Mehrspieler braucht mindestens zwei Teilnehmer.',
                fieldKey: 'multiplayer',
                fieldMessage: 'Einen zweiten Spieler beitreten lassen.',
            };
        }
        if (sessionState?.allReady !== true) {
            return {
                message: 'Start nicht möglich: Alle Teilnehmer der Lobby müssen bereit sein.',
                fieldKey: 'multiplayer',
                fieldMessage: 'Alle verbundenen Mitspieler müssen sich bereit melden.',
            };
        }
        const teamSettings = normalizeTeamHuntSettings(settings?.hunt);
        if (settings?.gameMode === huntModeType && teamSettings.enabled) {
            const rosterValidation = validateTeamRoster({
                humanCount: Math.max(sessionState?.memberCount || 0, sessionState?.playerCount || 0),
                teamSize: teamSettings.teamSize,
                humanTeamIds: (Array.isArray(sessionState?.members) ? sessionState.members : [])
                    .map((member) => member?.teamId),
            });
            if (!rosterValidation.valid) {
                const message = `Die gewählte Teamgröße erlaubt höchstens ${rosterValidation.capacity} Spieler.`;
                return {
                    message: `Start nicht möglich: ${message}`,
                    fieldKey: 'match',
                    fieldMessage: `${message} Teamgröße erhöhen oder Lobby verkleinern.`,
                };
            }
        }
    }

    const modePath = String(settings?.localSettings?.modePath || 'normal').toLowerCase();
    if (mapExists && mapKey !== 'custom' && !isMapEligibleForModePath(maps?.[mapKey], modePath)) {
        return {
            message: 'Start nicht möglich: Die gewählte Karte ist in dieser Version nicht startbar.',
            fieldKey: 'map',
            fieldMessage: 'Andere Karte wählen oder die Kartendaten prüfen.',
        };
    }

    const gameMode = String(settings?.gameMode || 'CLASSIC').toUpperCase();
    if (modePath === 'fight' && gameMode !== huntModeType) {
        return {
            message: 'Start nicht möglich: interner Fehler, Kampf braucht den Spielmodus HUNT.',
            fieldKey: 'match',
            fieldMessage: 'Fight-Konflikt: Modus auf HUNT synchronisieren.',
        };
    }
    if (modePath === 'arcade' && gameMode !== arcadeModeType) {
        return {
            message: 'Start nicht möglich: interner Fehler, Arcade braucht den Spielmodus ARCADE.',
            fieldKey: 'match',
            fieldMessage: 'Arcade-Konflikt: Modus auf ARCADE synchronisieren.',
        };
    }
    if (modePath === 'normal' && gameMode !== classicModeType) {
        return {
            message: 'Start nicht möglich: interner Fehler, Klassisch braucht den Spielmodus CLASSIC.',
            fieldKey: 'match',
            fieldMessage: 'Modus-Konflikt: Normal auf CLASSIC synchronisieren.',
        };
    }

    return null;
}
