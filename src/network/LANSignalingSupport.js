import { SIGNALING_HTTP_ROUTES } from '../shared/contracts/SignalingSessionContract.js';

/**
 * @param {{
 *   response?: { status?: number } | null,
 *   payload?: { message?: unknown } | null,
 *   fallbackMessage?: string,
 *   fallbackCode?: string,
 * }} options
 */
export function buildLanRequestError({
    response = null,
    payload = null,
    fallbackMessage = 'LAN request failed.',
    fallbackCode = 'lan_request_failed',
} = {}) {
    const responseCode = Number(response?.status || 0);
    const signalingCode = String(payload?.message || '').trim() || fallbackCode;
    let message = fallbackMessage;
    if (signalingCode === 'lobby_full') {
        message = 'Lobby ist voll.';
    } else if (signalingCode === 'lobby_not_found') {
        message = 'Lobby nicht gefunden.';
    } else if (signalingCode === 'host_required') {
        message = 'Nur der Host darf diese Aktion ausführen.';
    } else if (signalingCode === 'host_auth_failed') {
        message = 'Host-Autorisierung fehlgeschlagen.';
    } else if (signalingCode === 'player_auth_failed') {
        message = 'Spieler-Autorisierung fehlgeschlagen.';
    } else if (signalingCode === 'members_not_ready') {
        message = 'Alle Teilnehmer müssen bereit sein.';
    } else if (signalingCode === 'settings_revision_mismatch') {
        message = 'Match-Einstellungen wurden geändert. Bitte erneut bereit werden.';
    } else if (signalingCode === 'not_enough_members') {
        message = 'Mindestens zwei Teilnehmer werden benötigt.';
    } else if (signalingCode === 'mobile_protocol_incompatible') {
        message = 'Die Lobby verwendet eine nicht unterstützte Mehrspieler-Version.';
    } else if (signalingCode === 'mobile_mode_incompatible') {
        message = 'Mit der Android-App geht gemeinsames Spielen derzeit nur im klassischen Modus über LAN.';
    } else if (signalingCode === 'mobile_map_incompatible') {
        message = 'Die Karte des Hosts ist in der Android-App nicht für gemeinsames Spielen freigegeben.';
    } else if (signalingCode === 'mobile_settings_mismatch') {
        message = 'Der Host hat die Einstellungen geändert, nachdem du bereit warst.';
    } else if (responseCode > 0) {
        message = `${fallbackMessage} (${responseCode})`;
    }
    return Object.assign(new Error(message), {
        code: signalingCode,
        status: responseCode,
    });
}

/**
 * @param {{
 *   signalingUrl?: string,
 *   hostPeerId?: string,
 *   hostToken?: string,
 *   metadata?: object | null,
 * }} options
 */
// Renames one seat; the token must belong to that seat (a player renames only itself).
export async function publishLanLobbyName({
    signalingUrl,
    playerId,
    isHost,
    token,
    lobbyName,
} = {}) {
    const res = await fetch(`${signalingUrl}${SIGNALING_HTTP_ROUTES.LOBBY_NAME}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            playerId,
            lobbyName: String(lobbyName ?? ''),
            hostToken: isHost ? token : undefined,
            playerToken: isHost ? undefined : token,
        }),
    });
    if (res?.ok === false) {
        const payload = await res.json().catch(() => ({}));
        throw buildLanRequestError({
            response: res,
            payload,
            fallbackMessage: 'Name konnte nicht geändert werden.',
            fallbackCode: 'lobby_name_failed',
        });
    }
    return res.json();
}

export async function publishLanLobbyMetadata({
    signalingUrl,
    hostPeerId,
    hostToken,
    metadata,
} = {}) {
    const res = await fetch(`${signalingUrl}${SIGNALING_HTTP_ROUTES.LOBBY_METADATA}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostPeerId, hostToken, metadata }),
    });
    if (res?.ok === false) {
        const payload = await res.json().catch(() => ({}));
        throw buildLanRequestError({
            response: res,
            payload,
            fallbackMessage: 'Lobby-Metadaten aktualisieren fehlgeschlagen.',
            fallbackCode: 'metadata_update_failed',
        });
    }
    return res.json();
}
