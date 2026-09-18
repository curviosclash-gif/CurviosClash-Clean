import { resolveMapPreview, resolveVehiclePreview } from '../menu/MenuPreviewCatalog.js';
import { syncLobbyScreen } from './LobbyScreenUi.js';
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
            ? 'Geteilter Bildschirm'
            : (sessionType === MENU_SESSION_TYPES.MULTIPLAYER ? 'Mehrspieler' : 'Einzelspieler'));
}

function resolveModeLabel(modePath) {
    if (modePath === 'fight') return 'Kampf';
    if (modePath === 'arcade') return 'Arcade';
    if (modePath === 'quick_action') return 'Schnellstart';
    return 'Klassisch';
}

export function formatMenuRulesSummary(settings, modePath) {
    if (modePath === 'arcade') {
        const sectors = settings?.arcade?.sectorCount;
        return sectors ? `${sectors} Sektoren bis zum Sieg · Punkte sammeln` : 'Sektoren meistern · Punkte sammeln';
    }
    const count = Math.max(0, Number(settings?.numBots) || 0);
    const difficulty = { EASY: 'Leicht', NORMAL: 'Normal', HARD: 'Schwer' }[settings?.botDifficulty] || 'Normal';
    const bots = count ? `${count} Bots · ${difficulty}` : 'Ohne Bots';
    const winsNeeded = Math.max(1, Number(settings?.winsNeeded) || 1);
    const winsLabel = `${winsNeeded} ${winsNeeded === 1 ? 'Sieg' : 'Siege'}`;
    const objective = settings?.gameMode === 'HUNT' && settings?.hunt?.respawnEnabled
        ? `${settings.hunt.deathmatchKillLimit || 10} Abschüsse${winsNeeded > 1 ? ` · ${winsLabel}` : ''}`
        : winsLabel;
    return `${bots} · ${objective}`;
}

function clearElementChildren(element) {
    if (!element) return;
    while (element.firstChild) {
        element.removeChild(element.firstChild);
    }
}

function renderMultiplayerMembers(ui, sessionState, hasActiveLobbySession) {
    const memberList = ui?.multiplayerMemberList;
    const memberCount = ui?.multiplayerMemberCount;
    if (!memberList && !memberCount) return;

    const members = hasActiveLobbySession && Array.isArray(sessionState?.members)
        ? sessionState.members
        : [];
    if (memberCount) {
        const resolvedMemberCount = hasActiveLobbySession
            ? Math.max(members.length, Math.floor(Number(sessionState?.memberCount) || 0))
            : 0;
        const maxPlayers = Math.max(resolvedMemberCount, Math.floor(Number(sessionState?.maxPlayers) || 10));
        memberCount.textContent = `${resolvedMemberCount} / ${maxPlayers}`;
    }
    if (!memberList) return;

    clearElementChildren(memberList);
    const doc = memberList.ownerDocument
        || (typeof document !== 'undefined' ? document : null);
    if (!doc?.createElement) return;

    for (const member of members) {
        const row = doc.createElement('div');
        row.className = [
            'mp-player-card',
            member?.isHost === true ? 'is-host' : '',
            member?.isLocal === true ? 'is-local' : '',
            member?.ready === true ? 'is-ready' : '',
        ].filter(Boolean).join(' ');

        const name = doc.createElement('span');
        name.className = 'mp-player-name';
        const displayName = String(member?.name || member?.actorId || member?.peerId || 'Spieler').trim() || 'Spieler';
        name.textContent = `${displayName}${member?.isHost === true ? ' · Host' : ''}${member?.isLocal === true ? ' · Du' : ''}`;

        const ready = doc.createElement('span');
        ready.className = `mp-ready-indicator${member?.ready === true ? ' is-ready' : ''}`;
        ready.textContent = member?.ready === true ? 'Bereit' : 'Nicht bereit';

        row.appendChild(name);
        row.appendChild(ready);
        memberList.appendChild(row);
    }

    if (members.length === 0) {
        const waiting = doc.createElement('p');
        waiting.className = 'mp-waiting-message';
        waiting.textContent = 'Warte auf Teilnehmer …';
        memberList.appendChild(waiting);
    }
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
    const summaryBlocks = [
        { label: 'Session', value: resolveSessionLabel(surfaceEntryCopy, sessionType), secondary: true },
        { label: 'Spielstil', value: resolveModeLabel(modePath) },
        { label: 'Karte', value: mapPreview.name },
        { label: 'Flugzeug', value: vehiclePreviewP1.label },
        { label: 'Regeln', value: formatMenuRulesSummary(settings, modePath) },
        {
            label: 'Ghost',
            value: resolveArcadeGhostDuelModeLabel(ghostDuelState.effectiveMode),
            muted: !ghostDuelState.duelSelectable,
            secondary: true,
        },
        {
            label: 'Ghost-Kollision',
            value: ghostDuelState.effectiveTrailCollisionEnabled ? 'An' : 'Aus',
            muted: !ghostDuelState.trailCollisionSelectable,
            secondary: true,
        },
    ];
    if (sessionType === MENU_SESSION_TYPES.SPLITSCREEN
        || sessionType === MENU_SESSION_TYPES.MULTIPLAYER) {
        summaryBlocks.push({ label: 'Flugzeug P2', value: vehiclePreviewP2.label });
    }
    if (sessionType === MENU_SESSION_TYPES.MULTIPLAYER) {
        const hasCode = String(resolvedMultiplayerSessionState?.lobbyCode || ui.multiplayerLobbyCodeInput?.value || '').trim();
        const readySummary = hasActiveLobbySession
            ? ` | ${resolvedMultiplayerSessionState.readyCount}/${resolvedMultiplayerSessionState.memberCount} bereit`
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
            secondary: true,
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
                mapPreview.hasParcours ? 'Parcours' : null,
                humanizePreviewCategory(mapPreview.category),
                mapPreview.portalLevelCount > 1 ? `${mapPreview.portalLevelCount} Ebenen` : mapPreview.sizeText,
            ].filter(Boolean),
            facts: [
                { label: 'Größe', value: mapPreview.sizeText },
                { label: 'Hindernisse', value: String(mapPreview.obstacleCount) },
                { label: 'Portal-Paare', value: String(mapPreview.portalCount) },
                mapPreview.gateCount > 0 ? { label: 'Tore', value: String(mapPreview.gateCount) } : null,
                mapPreview.tunnelCount > 0 ? { label: 'Tunnel', value: String(mapPreview.tunnelCount) } : null,
                mapPreview.spawnCount > 0 ? { label: 'Startpunkte', value: String(mapPreview.spawnCount) } : null,
                mapPreview.itemAnchorCount > 0 ? { label: 'Items', value: String(mapPreview.itemAnchorCount) } : null,
                mapPreview.aircraftCount > 0 ? { label: 'Deko-Flieger', value: String(mapPreview.aircraftCount) } : null,
            ].filter(Boolean),
        });
    }
    if (ui.vehiclePreviewP1 && !ui.vehiclePreview3dMount) {
        renderPreviewCard(ui.vehiclePreviewP1, {
            title: vehiclePreviewP1.label,
            badges: ['Pilot 1', humanizePreviewCategory(vehiclePreviewP1.category)],
            facts: [
                { label: 'Klasse', value: humanizePreviewCategory(vehiclePreviewP1.category) },
                { label: 'Hitbox', value: vehiclePreviewP1.hitboxRadius.toFixed(2) },
            ],
        });
    }
    if (ui.vehiclePreviewP2 && !ui.vehiclePreview3dMount) {
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
    if (ui.quickStartLastSummary) {
        ui.quickStartLastSummary.textContent = [
            resolveSessionLabel(surfaceEntryCopy, sessionType),
            resolveModeLabel(modePath),
            mapPreview.name,
            vehiclePreviewP1.label,
            formatMenuRulesSummary(settings, modePath),
        ].join(' · ');
    }
    const quickLabel = ui.quickStartLastButton?.querySelector?.('.menu-primary-start-label');
    if (quickLabel) quickLabel.textContent = sessionType === MENU_SESSION_TYPES.MULTIPLAYER
        ? (hasActiveLobbySession ? 'Zur Lobby' : 'Mehrspieler öffnen') : 'Sofort spielen';
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
    const isHost = hasActiveLobbySession && resolvedMultiplayerSessionState?.isHost === true;
    syncLobbyScreen(ui, resolvedMultiplayerSessionState, isMultiplayerSession);
    if (ui.multiplayerInlineState) {
        ui.multiplayerInlineState.classList.toggle('hidden', !isMultiplayerSession);
        if (typeof HTMLDetailsElement !== 'undefined' && ui.multiplayerInlineState instanceof HTMLDetailsElement) {
            ui.multiplayerInlineState.open = isMultiplayerSession;
        }
    }
    if (ui.startButton) {
        ui.startButton.classList.toggle('hidden', isMultiplayerSession);
        ui.startButton.setAttribute('aria-hidden', String(isMultiplayerSession));
    }
    if (ui.multiplayerConnectionControls) {
        ui.multiplayerConnectionControls.classList.toggle('hidden', hasActiveLobbySession);
    }
    if (ui.multiplayerSessionControls) {
        ui.multiplayerSessionControls.classList.toggle('hidden', !hasActiveLobbySession);
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
                    ? 'Online ist derzeit nicht eingerichtet. Bitte LAN verwenden.'
                    : 'Online-Lobby als Internet-Pfad nutzen.';
            } else if (allowed) {
                button.title = 'Mit anderen Spielern im lokalen Netzwerk spielen.';
            } else {
                button.title = '';
            }
        });
    }
    if (ui.multiplayerTransportHint) {
        ui.multiplayerTransportHint.textContent = multiplayerTransportUiState.isOnlineUnconfigured
            ? 'Auswahl: Online | nicht konfiguriert, bitte LAN verwenden'
            : `Verbindung: ${multiplayerTransportUiState.selectedTransportLabel}`;
    }
    const showOpenLobbies = isMultiplayerSession && sessionContract.isLegacyTransport !== true;
    const canBrowseOpenLobbies = showOpenLobbies
        && !hasActiveLobbySession
        && !(multiplayerTransportUiState.selectedTransport === MULTIPLAYER_TRANSPORTS.ONLINE
            && multiplayerTransportUiState.isOnlineUnconfigured);
    if (ui.multiplayerOpenLobbiesControls) {
        ui.multiplayerOpenLobbiesControls.classList.toggle('hidden', !showOpenLobbies);
        // The automatic lobby search only runs while browsing is possible.
        ui.multiplayerOpenLobbiesControls.dataset.canBrowse = String(canBrowseOpenLobbies);
    }
    if (ui.multiplayerOpenLobbiesLabel) {
        ui.multiplayerOpenLobbiesLabel.textContent = multiplayerTransportUiState.selectedTransport === MULTIPLAYER_TRANSPORTS.ONLINE
            ? 'Offene Online-Lobbys'
            : 'Lobbys im LAN';
    }
    if (ui.multiplayerLobbySearchInput) ui.multiplayerLobbySearchInput.disabled = !canBrowseOpenLobbies;
    if (ui.multiplayerOpenLobbiesRefreshButton) {
        ui.multiplayerOpenLobbiesRefreshButton.disabled = !canBrowseOpenLobbies;
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
            ? 'Die Host-Adresse ist für die aktive Sitzung festgelegt.'
            : (isLanTransportSelected ? '' : 'Die Host-Adresse wird nur für den Beitritt im LAN verwendet.');
    }
    if (ui.multiplayerManualAddress) {
        const showManualAddress = isMultiplayerSession
            && !hasActiveLobbySession
            && multiplayerTransportUiState.selectedTransport === MULTIPLAYER_TRANSPORTS.LAN;
        ui.multiplayerManualAddress.classList.toggle('hidden', !showManualAddress);
        if (!showManualAddress) ui.multiplayerManualAddress.open = false;
    }
    if (ui.multiplayerHostButton) {
        const hostActionAvailable = surfaceEntryCopy?.hostActionAvailable !== false;
        ui.multiplayerHostButton.classList.toggle('hidden', !hostActionAvailable);
        ui.multiplayerHostButton.setAttribute('aria-hidden', String(!hostActionAvailable));
        ui.multiplayerHostButton.disabled = !isMultiplayerSession
            || hasActiveLobbySession
            || multiplayerTransportUiState.isOnlineUnconfigured
            || !hostActionAvailable;
    }
    if (ui.multiplayerJoinButton) {
        ui.multiplayerJoinButton.disabled = !isMultiplayerSession
            || hasActiveLobbySession
            || multiplayerTransportUiState.isOnlineUnconfigured;
    }
    if (ui.multiplayerLeaveLobbyButton) {
        ui.multiplayerLeaveLobbyButton.disabled = !hasActiveLobbySession;
    }
    const lobbyCode = String(resolvedMultiplayerSessionState?.lobbyCode || '').trim();
    const shareAddress = String(resolvedMultiplayerSessionState?.shareAddress || '').trim();
    if (ui.multiplayerShareCode) ui.multiplayerShareCode.textContent = lobbyCode || '—';
    if (ui.multiplayerCopyCodeButton) ui.multiplayerCopyCodeButton.disabled = !lobbyCode;
    if (ui.multiplayerShareAddress) ui.multiplayerShareAddress.textContent = shareAddress || '—';
    if (ui.multiplayerShareAddressRow) {
        ui.multiplayerShareAddressRow.classList.toggle('hidden', !shareAddress);
    }
    if (ui.multiplayerCopyAddressButton) ui.multiplayerCopyAddressButton.disabled = !shareAddress;
    if (ui.multiplayerReadyToggle) {
        ui.multiplayerReadyToggle.disabled = !hasActiveLobbySession
            || isHost
            || resolvedMultiplayerSessionState?.connectionPhase === 'reconnecting'
            || resolvedMultiplayerSessionState?.matchStartPending === true
            || !!resolvedMultiplayerSessionState?.pendingMatchCommandId
            || resolvedMultiplayerSessionState?.readyMutationPending === true;
        ui.multiplayerReadyToggle.checked = isMultiplayerSession
            ? resolvedMultiplayerSessionState?.localReady === true
            : false;
    }
    if (ui.multiplayerReadyControl) {
        ui.multiplayerReadyControl.classList.toggle('hidden', !hasActiveLobbySession || isHost);
    }
    if (ui.multiplayerStartMatchButton) {
        const pendingMatchStart = !!resolvedMultiplayerSessionState?.pendingMatchCommandId
            || resolvedMultiplayerSessionState?.matchStartPending === true;
        const canStart = isHost && resolvedMultiplayerSessionState?.canStart === true && !pendingMatchStart;
        ui.multiplayerStartMatchButton.classList.toggle('hidden', !hasActiveLobbySession);
        ui.multiplayerStartMatchButton.disabled = !canStart;
        ui.multiplayerStartMatchButton.textContent = pendingMatchStart
            ? 'Match wird gestartet …'
            : (isHost
                ? 'Match starten'
                : 'Warte auf Host');
        ui.multiplayerStartMatchButton.title = pendingMatchStart
            ? 'Das Startsignal wurde an die Lobby gesendet.'
            : (isHost
                ? (resolvedMultiplayerSessionState?.memberCount < 2
                    ? 'Mindestens ein weiterer Teilnehmer wird benötigt.'
                    : 'Alle Mitspieler müssen bereit sein.')
                : 'Der Host startet das Match.');
    }
    renderMultiplayerMembers(ui, resolvedMultiplayerSessionState, hasActiveLobbySession);
    if (ui.multiplayerLobbyState) {
        const lobbyCode = String(resolvedMultiplayerSessionState?.lobbyCode || ui.multiplayerLobbyCodeInput?.value || '').trim();
        if (!isMultiplayerSession) {
            ui.multiplayerLobbyState.textContent = 'Lobbystatus: inaktiv';
        } else if (hasActiveLobbySession) {
            const roleLabel = resolvedMultiplayerSessionState.isHost
                ? 'Host'
                : surfaceEntryCopy.multiplayerClientRoleLabel;
            const connectionLabel = resolvedMultiplayerSessionState.connectionPhase === 'reconnecting'
                ? `Verbindung wird wiederhergestellt (${resolvedMultiplayerSessionState.reconnectAttempt}/${resolvedMultiplayerSessionState.reconnectMaxAttempts})`
                : (resolvedMultiplayerSessionState.pendingMatchCommandId
                ? 'Startsignal gesendet'
                : (resolvedMultiplayerSessionState.connected
                    ? 'verbunden'
                    : (resolvedMultiplayerSessionState.isHost ? 'Host aktiv' : 'Warte auf Host')));
            const transportSuffix = sessionContract.isLegacyTransport === true
                ? ` | ${sessionContract.transportAudienceLabel}`
                : '';
            ui.multiplayerLobbyState.textContent = `${lobbyCode} | ${roleLabel} | ${connectionLabel} | ${resolvedMultiplayerSessionState.memberCount} Teilnehmer | ${resolvedMultiplayerSessionState.readyCount}/${resolvedMultiplayerSessionState.memberCount} bereit${transportSuffix}`;
        } else if (sessionContract.isLegacyTransport === true) {
            ui.multiplayerLobbyState.textContent = lobbyCode
                ? `Lobbystatus: ${lobbyCode} | ${sessionContract.transportAudienceLabel}`
                : 'Lobbystatus: Legacy-Fallback aktiv | lokaler Menu-Bridge-Pfad, kein produktives LAN/Online';
        } else if (multiplayerTransportUiState.isOnlineUnconfigured) {
            ui.multiplayerLobbyState.textContent = 'Lobbystatus: Online gewählt, aber nicht eingerichtet. Bitte LAN verwenden.';
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
            ui.multiplayerHostButton.title = 'Online ist derzeit nicht eingerichtet. Bitte LAN verwenden.';
        }
    }
    if (ui.multiplayerJoinButton) {
        const surfaceDisabled = ui.multiplayerJoinButton.disabled === true;
        ui.multiplayerJoinButton.disabled = surfaceDisabled || disableTransportUnavailableActions;
        if (disableTransportUnavailableActions) {
            ui.multiplayerJoinButton.title = 'Online ist derzeit nicht eingerichtet. Bitte LAN verwenden.';
        } else {
            ui.multiplayerJoinButton.title = '';
        }
    }
}
