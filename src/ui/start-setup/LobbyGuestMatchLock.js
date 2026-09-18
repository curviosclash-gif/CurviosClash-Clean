// ============================================
// LobbyGuestMatchLock.js - guests see the match rules but cannot change them
// ============================================
//
// In a lobby the host's match settings win at start. A guest could still move the rule
// sliders in the options window; the change stayed local and was dropped silently. Those
// tabs are now inert for guests. Local tabs (controls, audio, graphics, HUD, recording)
// stay free.

export const GUEST_LOCKED_LEVEL4_SECTIONS = Object.freeze(['gameplay', 'advanced_map', 'presets']);
export const LOBBY_GUEST_LOCK_HINT = 'Der Host legt die Match-Einstellungen fest.';

export function isLobbyGuestMatchLocked(state, isMultiplayerSession) {
    return isMultiplayerSession === true && state?.joined === true && state?.isHost !== true;
}

export function applyLobbyGuestMatchLock(doc, locked) {
    const sections = doc?.querySelectorAll?.('[data-level4-section]') || [];
    for (const section of sections) {
        const lockSection = locked === true && GUEST_LOCKED_LEVEL4_SECTIONS.includes(section.dataset?.level4Section);
        for (const body of section.querySelectorAll('.menu-section')) {
            body.inert = lockSection;
        }
        const hint = section.querySelector('.lobby-guest-lock-hint');
        if (lockSection && !hint) {
            const node = doc.createElement('p');
            node.className = 'menu-hint lobby-guest-lock-hint';
            node.textContent = LOBBY_GUEST_LOCK_HINT;
            section.prepend(node);
        } else if (!lockSection && hint) {
            hint.remove();
        }
    }
}
