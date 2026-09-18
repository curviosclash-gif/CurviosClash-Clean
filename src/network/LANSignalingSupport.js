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
        message = 'Alle Teilnehmer müssen Ready sein.';
    } else if (signalingCode === 'settings_revision_mismatch') {
        message = 'Match-Einstellungen wurden geändert. Bitte erneut bereit werden.';
    } else if (signalingCode === 'not_enough_members') {
        message = 'Mindestens zwei Teilnehmer werden benötigt.';
    } else if (signalingCode === 'mobile_protocol_incompatible') {
        message = 'Die Lobby verwendet eine nicht unterstützte Multiplayer-Version.';
    } else if (signalingCode === 'mobile_mode_incompatible') {
        message = 'Android-Crossplay unterstützt derzeit nur Normal / Classic über LAN.';
    } else if (signalingCode === 'mobile_map_incompatible') {
        message = 'Die Host-Karte ist in der Android-App nicht für Crossplay freigegeben.';
    } else if (signalingCode === 'mobile_settings_mismatch') {
        message = 'Die Host-Einstellungen haben sich nach dem Ready-Status geändert.';
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
