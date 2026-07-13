import { resolveMapPreview, resolveVehiclePreview } from '../menu/MenuPreviewCatalog.js';
import { MENU_SESSION_TYPES } from '../menu/MenuStateContracts.js';
import {
    MULTIPLAYER_TRANSPORTS,
    normalizeMultiplayerTransport,
} from '../../shared/contracts/RuntimeSessionContract.js';
import {
    humanizePreviewCategory,
    renderPreviewCard,
    renderSummaryBlocks,
} from './StartSetupUiOps.js';
import { resolveArcadeGhostDuelModeLabel } from './StartSetupSelectionSync.js';

function resolveSessionLabel(surfaceEntryCopy, sessionType) {
    return surfaceEntryCopy.sessionSummaryLabels[sessionType]
        || (sessionType === MENU_SESSION_TYPES.SPLITSCREEN
            ? 'Splitscreen'
            : (sessionType === MENU_SESSION_TYPES.MULTIPLAYER ? 'Multiplayer' : 'Single Player'));
}

function resolveModeLabel(modePath) {
    if (modePath === 'fight') return 'Fight';
    if (modePath === 'arcade') return 'Arcade';
    if (modePath === 'quick_action') return 'Schnellstart';
    return 'Normal';
}

function createSummaryBlocks({
    ui,
    settings,
    sessionType,
    modePath,
    surfaceEntryCopy,
    sessionContract,
    resolvedMultiplayerSessionState,
    hasActiveLobbySession,
    mapPreview,
    vehiclePreviewP1,
    vehiclePreviewP2,
    ghostDuelState,
}) {
    const themeLabel = String(settings?.localSettings?.themeMode || 'dunkel').toLowerCase() === 'hell' ? 'Hell' : 'Dunkel';
    const summaryBlocks = [
        { label: 'Session', value: resolveSessionLabel(surfaceEntryCopy, sessionType) },
        { label: 'Spielstil', value: resolveModeLabel(modePath) },
        { label: 'Map', value: mapPreview.name },
        { label: 'P1', value: vehiclePreviewP1.label },
        {
            label: 'Ghost',
            value: resolveArcadeGhostDuelModeLabel(ghostDuelState.effectiveMode),
            muted: !ghostDuelState.duelSelectable,
        },
        {
            label: 'Ghost-Kollision',
            value: ghostDuelState.effectiveTrailCollisionEnabled ? 'An' : 'Aus',
            muted: !ghostDuelState.trailCollisionSelectable,
        },
        { label: 'Ansicht', value: themeLabel },
    ];
    if (sessionType === MENU_SESSION_TYPES.SPLITSCREEN) {
        summaryBlocks.push({ label: 'P2', value: vehiclePreviewP2.label });
    }
    if (sessionType === MENU_SESSION_TYPES.MULTIPLAYER) {
        const hasCode = String(resolvedMultiplayerSessionState?.lobbyCode || ui.multiplayerLobbyCodeInput?.value || '').trim();
        const readySummary = hasActiveLobbySession
            ? ` | ${resolvedMultiplayerSessionState.readyCount}/${resolvedMultiplayerSessionState.memberCount} ready`
            : '';
        const roleSummary = hasActiveLobbySession
            ? (resolvedMultiplayerSessionState.isHost ? 'Host' : surfaceEntryCopy.multiplayerClientRoleLabel)
            : '';
        const connectionSummary = hasActiveLobbySession
            ? (resolvedMultiplayerSessionState.pendingMatchCommandId
                ? 'Startsignal gesendet'
                : (resolvedMultiplayerSessionState.connected ? 'verbunden' : 'Warte auf Host'))
            : '';
        summaryBlocks.push({
            label: 'Lobby',
            value: hasCode
                ? [hasCode, roleSummary, connectionSummary].filter(Boolean).join(' | ') + readySummary
                : 'nicht verbunden',
            muted: !hasCode,
        });
        summaryBlocks.push({
            label: 'Transport',
            value: sessionContract.transportAudienceLabel,
            muted: sessionContract.isLegacyTransport === true,
        });
    }
    return summaryBlocks;
}

function renderSelectionPreviews(ui, mapPreview, vehiclePreviewP1, vehiclePreviewP2) {
    if (ui.mapPreview) {
        renderPreviewCard(ui.mapPreview, {
            title: mapPreview.name,
            badges: [
                mapPreview.renderMode,
                humanizePreviewCategory(mapPreview.category),
                mapPreview.portalLevelCount > 1 ? `${mapPreview.portalLevelCount} Ebenen` : mapPreview.sizeText,
            ],
            facts: [
                { label: 'Groesse', value: mapPreview.sizeText },
                { label: 'Hindernisse', value: String(mapPreview.obstacleCount) },
                { label: 'Tunnel', value: String(mapPreview.tunnelCount) },
                { label: 'Portale', value: String(mapPreview.portalCount) },
                { label: 'Gates', value: String(mapPreview.gateCount) },
                { label: 'Spawns', value: String(mapPreview.spawnCount) },
                { label: 'Items', value: String(mapPreview.itemAnchorCount) },
                { label: 'Deko', value: String(mapPreview.aircraftCount) },
            ],
        });
    }
    if (ui.vehiclePreviewP1) {
        renderPreviewCard(ui.vehiclePreviewP1, {
            title: vehiclePreviewP1.label,
            badges: ['Pilot 1', humanizePreviewCategory(vehiclePreviewP1.category)],
            facts: [
                { label: 'Klasse', value: humanizePreviewCategory(vehiclePreviewP1.category) },
                { label: 'Hitbox', value: vehiclePreviewP1.hitboxRadius.toFixed(2) },
            ],
        });
    }
    if (ui.vehiclePreviewP2) {
        renderPreviewCard(ui.vehiclePreviewP2, {
            title: vehiclePreviewP2.label,
            badges: ['Pilot 2', humanizePreviewCategory(vehiclePreviewP2.category)],
            facts: [
                { label: 'Klasse', value: humanizePreviewCategory(vehiclePreviewP2.category) },
                { label: 'Hitbox', value: vehiclePreviewP2.hitboxRadius.toFixed(2) },
            ],
        });
    }
}

export function renderStartSetupSummaryAndPreview({
    ui,
    settings,
    sessionType,
    modePath,
    effectiveMapKey,
    surfaceEntryCopy,
    sessionContract,
    resolvedMultiplayerSessionState,
    hasActiveLobbySession,
    ghostDuelState,
}) {
    const mapPreview = resolveMapPreview(effectiveMapKey);
    const vehiclePreviewP1 = resolveVehiclePreview(settings?.vehicles?.PLAYER_1);
    const vehiclePreviewP2 = resolveVehiclePreview(settings?.vehicles?.PLAYER_2);
    if (ui.menuSummary) {
        renderSummaryBlocks(ui.menuSummary, createSummaryBlocks({
            ui,
            settings,
            sessionType,
            modePath,
            surfaceEntryCopy,
            sessionContract,
            resolvedMultiplayerSessionState,
            hasActiveLobbySession,
            mapPreview,
            vehiclePreviewP1,
            vehiclePreviewP2,
            ghostDuelState,
        }));
    }
    renderSelectionPreviews(ui, mapPreview, vehiclePreviewP1, vehiclePreviewP2);
}

export function syncStartSetupMultiplayerUi({
    ui,
    sessionType,
    surfaceEntryCopy,
    sessionContract,
    multiplayerTransportUiState,
    resolvedMultiplayerSessionState,
    hasActiveLobbySession,
}) {
    const isMultiplayerSession = sessionType === MENU_SESSION_TYPES.MULTIPLAYER;
    if (ui.multiplayerInlineState) {
        ui.multiplayerInlineState.classList.toggle('hidden', !isMultiplayerSession);
        if (typeof HTMLDetailsElement !== 'undefined' && ui.multiplayerInlineState instanceof HTMLDetailsElement) {
            ui.multiplayerInlineState.open = isMultiplayerSession;
        }
    }
    if (Array.isArray(ui.multiplayerTransportButtons)) {
        ui.multiplayerTransportButtons.forEach((button) => {
            const transport = normalizeMultiplayerTransport(button?.dataset?.multiplayerTransport, '');
            const allowed = multiplayerTransportUiState.allowedTransports.includes(transport);
            const active = transport === multiplayerTransportUiState.selectedTransport;
            button.classList.toggle('hidden', !allowed);
            button.classList.toggle('active', active);
            button.setAttribute('aria-hidden', String(!allowed));
            button.setAttribute('aria-pressed', String(active));
            button.disabled = !allowed || (
                transport === MULTIPLAYER_TRANSPORTS.ONLINE
                && !multiplayerTransportUiState.onlineConfigured
            );
            if (transport === MULTIPLAYER_TRANSPORTS.ONLINE && allowed) {
                button.title = multiplayerTransportUiState.isOnlineUnconfigured
                    ? 'Online ist nicht konfiguriert. Bitte VITE_SIGNALING_URL setzen oder LAN verwenden.'
                    : 'Online-Lobby als Internet-Pfad nutzen.';
            } else if (allowed) {
                button.title = 'LAN als produktiven Host-/Join-Pfad nutzen.';
            } else {
                button.title = '';
            }
        });
    }
    if (ui.multiplayerTransportHint) {
        ui.multiplayerTransportHint.textContent = multiplayerTransportUiState.isOnlineUnconfigured
            ? 'Auswahl: Online | nicht konfiguriert, bitte LAN verwenden'
            : `Produktiver Transport: ${multiplayerTransportUiState.selectedTransportLabel}`;
    }
    if (ui.multiplayerLobbyCodeInput) {
        if (hasActiveLobbySession) {
            ui.multiplayerLobbyCodeInput.value = String(resolvedMultiplayerSessionState.lobbyCode || '');
        }
        ui.multiplayerLobbyCodeInput.readOnly = hasActiveLobbySession;
        ui.multiplayerLobbyCodeInput.title = hasActiveLobbySession
            ? 'Lobby-Code wird aus der aktiven Session gelesen.'
            : '';
    }
    if (ui.multiplayerHostAddressInput) {
        const isLanTransportSelected = multiplayerTransportUiState.selectedTransport === MULTIPLAYER_TRANSPORTS.LAN;
        ui.multiplayerHostAddressInput.disabled = !isMultiplayerSession || !isLanTransportSelected;
        ui.multiplayerHostAddressInput.readOnly = hasActiveLobbySession;
        ui.multiplayerHostAddressInput.title = hasActiveLobbySession
            ? 'Host-Adresse ist fuer die aktive Session festgelegt.'
            : (isLanTransportSelected ? '' : 'Host-Adresse wird nur fuer LAN-Join verwendet.');
    }
    if (ui.multiplayerHostButton) {
        ui.multiplayerHostButton.disabled = !isMultiplayerSession
            || hasActiveLobbySession
            || multiplayerTransportUiState.isOnlineUnconfigured
            || surfaceEntryCopy?.hostActionAvailable === false;
    }
    if (ui.multiplayerJoinButton) {
        ui.multiplayerJoinButton.disabled = !isMultiplayerSession
            || hasActiveLobbySession
            || multiplayerTransportUiState.isOnlineUnconfigured;
    }
    if (ui.multiplayerLeaveLobbyButton) {
        ui.multiplayerLeaveLobbyButton.disabled = !hasActiveLobbySession;
    }
    if (ui.multiplayerReadyToggle) {
        ui.multiplayerReadyToggle.disabled = !hasActiveLobbySession;
        ui.multiplayerReadyToggle.checked = isMultiplayerSession
            ? resolvedMultiplayerSessionState?.localReady === true
            : false;
    }
    if (ui.multiplayerLobbyState) {
        const lobbyCode = String(resolvedMultiplayerSessionState?.lobbyCode || ui.multiplayerLobbyCodeInput?.value || '').trim();
        if (!isMultiplayerSession) {
            ui.multiplayerLobbyState.textContent = 'Lobbystatus: inaktiv';
        } else if (hasActiveLobbySession) {
            const roleLabel = resolvedMultiplayerSessionState.isHost
                ? 'Host'
                : surfaceEntryCopy.multiplayerClientRoleLabel;
            const connectionLabel = resolvedMultiplayerSessionState.pendingMatchCommandId
                ? 'Startsignal gesendet'
                : (resolvedMultiplayerSessionState.connected
                    ? 'verbunden'
                    : (resolvedMultiplayerSessionState.isHost ? 'Host aktiv' : 'Warte auf Host'));
            const transportSuffix = sessionContract.isLegacyTransport === true
                ? ` | ${sessionContract.transportAudienceLabel}`
                : '';
            ui.multiplayerLobbyState.textContent = `Lobbystatus: ${lobbyCode} | ${roleLabel} | ${connectionLabel} | ${resolvedMultiplayerSessionState.memberCount} Spieler | ${resolvedMultiplayerSessionState.readyCount}/${resolvedMultiplayerSessionState.memberCount} ready${transportSuffix}`;
        } else if (sessionContract.isLegacyTransport === true) {
            ui.multiplayerLobbyState.textContent = lobbyCode
                ? `Lobbystatus: ${lobbyCode} | ${sessionContract.transportAudienceLabel}`
                : 'Lobbystatus: Legacy-Fallback aktiv | lokaler Menu-Bridge-Pfad, kein produktives LAN/Online';
        } else if (multiplayerTransportUiState.isOnlineUnconfigured) {
            ui.multiplayerLobbyState.textContent = 'Lobbystatus: Online ausgewaehlt | nicht konfiguriert, bitte LAN verwenden';
        } else if (lobbyCode) {
            ui.multiplayerLobbyState.textContent = `Lobbystatus: ${lobbyCode} | ${surfaceEntryCopy.joinButtonLabel} noch nicht verbunden`;
        } else {
            ui.multiplayerLobbyState.textContent = `Lobbystatus: ${surfaceEntryCopy.joinButtonLabel} noch nicht verbunden | Transport: ${sessionContract.transportAudienceLabel}`;
        }
    }

    const disableTransportUnavailableActions = isMultiplayerSession
        && multiplayerTransportUiState.isOnlineUnconfigured;
    if (ui.multiplayerHostButton) {
        const surfaceDisabled = ui.multiplayerHostButton.disabled === true;
        ui.multiplayerHostButton.disabled = surfaceDisabled || disableTransportUnavailableActions;
        if (disableTransportUnavailableActions) {
            ui.multiplayerHostButton.title = 'Online ist nicht konfiguriert. Bitte VITE_SIGNALING_URL setzen oder LAN verwenden.';
        }
    }
    if (ui.multiplayerJoinButton) {
        const surfaceDisabled = ui.multiplayerJoinButton.disabled === true;
        ui.multiplayerJoinButton.disabled = surfaceDisabled || disableTransportUnavailableActions;
        if (disableTransportUnavailableActions) {
            ui.multiplayerJoinButton.title = 'Online ist nicht konfiguriert. Bitte VITE_SIGNALING_URL setzen oder LAN verwenden.';
        } else {
            ui.multiplayerJoinButton.title = '';
        }
    }
}
