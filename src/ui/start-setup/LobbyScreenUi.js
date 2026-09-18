import { resolveMapPreview } from '../menu/MenuPreviewCatalog.js';
import { applyLobbyGuestMatchLock, isLobbyGuestMatchLocked } from './LobbyGuestMatchLock.js';

export function resolveLobbyStatus(state) {
    if (state?.connectionPhase === 'reconnecting') return `Verbindung wird wiederhergestellt (${state.reconnectAttempt}/${state.reconnectMaxAttempts}) …`;
    if (state?.connectionPhase === 'disconnected') return 'Verbindung unterbrochen. Bitte erneut verbinden.';
    if (!state?.joined) return 'Erstelle eine Lobby oder tritt einer bei.';
    if (!state.connected || state.connectionPhase === 'disconnected') return 'Verbindung unterbrochen.';
    if (state.settingsSyncPending) return 'Einstellungen werden übertragen …';
    if (state.settingsSyncError) return 'Übertragung fehlgeschlagen. Bitte erneut versuchen.';
    if (state.matchStartPending || state.pendingMatchCommandId) return 'Match wird gestartet …';
    if (state.readyMutationPending) return 'Bereitschaft wird aktualisiert …';
    if (state.memberCount < 2) return 'Weiterer Teilnehmer fehlt';
    const waiting = (state.members || []).filter((member) => !member.isHost && !member.ready);
    if (waiting.length > 1) return `Warte auf ${waiting.length} Teilnehmer`;
    if (waiting.length) return `Warte auf ${waiting[0].name || waiting[0].actorId || 'Spieler'}`;
    return state.isHost ? 'Alle sind bereit. Du kannst starten.' : 'Alle sind bereit. Warte auf den Host.';
}

export function resolveLobbyMatchFacts(metadata) {
    const summary = metadata?.matchSummary;
    const unavailable = 'Nicht verfügbar';
    const mode = { normal: 'Klassisch', fight: 'Kampf', arcade: 'Arcade', quick_action: 'Schnellstart' }[metadata?.modePath];
    const difficulty = { EASY: 'Leicht', NORMAL: 'Normal', HARD: 'Schwer' }[summary?.botDifficulty];
    const targets = { wins: 'Siege', kills: 'Abschüsse', sectors: 'Sektoren' };
    return [
        ['Spielstil', mode || unavailable],
        ['Karte', metadata?.mapKey ? resolveMapPreview(metadata.mapKey).name : unavailable],
        ['Bots', summary?.numBots != null ? `${summary.numBots} · ${difficulty || unavailable}` : unavailable],
        ['Spielziel', summary?.targetKind && summary.targetValue != null
            ? `${summary.targetValue} ${targets[summary.targetKind]}`
            : (summary?.targetKind === 'sectors' ? 'Sektoren meistern' : unavailable)],
    ];
}

export function syncLobbyScreen(ui, state, isMultiplayerSession) {
    const joined = isMultiplayerSession && state?.joined === true;
    const host = joined && state.isHost === true;
    const panel = ui.multiplayerPanel;
    if (panel?.dataset) {
        panel.dataset.lobbyJoined = String(joined);
        panel.dataset.lobbyHost = String(host);
    }
    const toggle = (element, visible) => element?.classList?.toggle('hidden', !visible);
    toggle(ui.multiplayerLeaveLobbyButton, joined);
    toggle(ui.lobbyEditMatchButton, host);
    toggle(ui.lobbyHostSettingsHint, joined && !host);
    applyLobbyGuestMatchLock(panel?.ownerDocument || ui.level4Drawer?.ownerDocument, isLobbyGuestMatchLocked(state, isMultiplayerSession));
    toggle(ui.lobbyRetrySettingsButton, host && !!state.settingsSyncError);
    if (ui.lobbyRetrySettingsButton) ui.lobbyRetrySettingsButton.disabled = state?.settingsSyncPending === true;
    toggle(ui.setupLobbyButton, joined);
    toggle(ui.setupModeButton, host);
    const setupBack = ui.setupPanel?.querySelector?.('.submenu-header [data-back]');
    if (setupBack) {
        setupBack.dataset.backTarget = joined ? 'submenu-multiplayer' : 'submenu-custom';
        setupBack.textContent = joined ? '← Zur Lobby' : '← Zurück';
        setupBack.setAttribute('aria-label', joined ? 'Zur Lobby' : 'Zur Moduswahl');
    }
    const modeBack = ui.modePanel?.querySelector?.('.submenu-header [data-back]');
    if (modeBack) {
        if (joined) modeBack.dataset.backTarget = 'submenu-game';
        else delete modeBack.dataset.backTarget;
    }
    if (ui.lobbyConnectionBadge) {
        ui.lobbyConnectionBadge.textContent = `${state?.transport === 'online' ? 'Online' : 'LAN'} · ${joined && state.connected ? 'Verbunden' : 'Nicht verbunden'}`;
        ui.lobbyConnectionBadge.dataset.connected = String(joined && state.connected && state.connectionPhase !== 'reconnecting');
    }
    const summaryElement = ui.lobbyMatchSummary;
    if (!summaryElement) return;
    const facts = resolveLobbyMatchFacts(joined ? state.metadata : null);
    const signature = JSON.stringify(facts);
    if (summaryElement.dataset.facts === signature) return;
    summaryElement.dataset.facts = signature;
    const doc = summaryElement.ownerDocument;
    summaryElement.replaceChildren(...facts.map(([label, value]) => {
        const group = doc.createElement('div');
        const term = doc.createElement('dt');
        const description = doc.createElement('dd');
        term.textContent = label;
        description.textContent = value;
        group.append(term, description);
        return group;
    }));
}
