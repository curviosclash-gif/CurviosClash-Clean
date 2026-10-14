// ============================================
// KillcamLetterboxView.js - cinema bars and HUD marker while a killcam plays
// ============================================
//
// The killcam (src/hunt) only decides when its presentation is on; drawing the bars is UI work.
// The HUD binds this view to every new entity manager, and the killcam calls it synchronously on
// start and clear, so the bars appear and vanish in the same frame as before, also when a round
// ends or the match is torn down while the killcam runs.

const KILLCAM_LETTERBOX_DOM_ID = 'killcam-letterbox';
const KILLCAM_HUD_ACTIVE_CLASS = 'killcam-active';

function createLetterboxElement(doc) {
    const el = doc.createElement('div');
    el.id = KILLCAM_LETTERBOX_DOM_ID;
    el.className = 'killcam-letterbox hidden';
    el.setAttribute('aria-hidden', 'true');
    const top = doc.createElement('div');
    top.className = 'killcam-letterbox-bar killcam-letterbox-top';
    const bottom = doc.createElement('div');
    bottom.className = 'killcam-letterbox-bar killcam-letterbox-bottom';
    const label = doc.createElement('div');
    label.className = 'killcam-letterbox-label';
    label.setAttribute('data-menu-text-id', 'game.killcam.label');
    label.textContent = 'KILLCAM';
    el.appendChild(top);
    el.appendChild(bottom);
    el.appendChild(label);
    (doc.getElementById('game-container') || doc.body).appendChild(el);
    return el;
}

export function createKillcamLetterboxView(documentRef = typeof document !== 'undefined' ? document : null) {
    let letterboxEl = null;
    let ownsLetterboxEl = false;
    let boundManager = null;

    function resolveLetterboxEl() {
        if (letterboxEl) return letterboxEl;
        if (!documentRef?.body) return null;
        letterboxEl = documentRef.getElementById(KILLCAM_LETTERBOX_DOM_ID);
        if (!letterboxEl) {
            letterboxEl = createLetterboxElement(documentRef);
            ownsLetterboxEl = true;
        }
        return letterboxEl;
    }

    function setVisible(show, { reduceMotion = false } = {}) {
        documentRef?.getElementById?.('hud')?.classList?.toggle?.(KILLCAM_HUD_ACTIVE_CLASS, show);
        const el = show ? resolveLetterboxEl() : letterboxEl;
        if (!el) return;
        try {
            el.classList.toggle('hidden', !show);
            el.classList.toggle('reduced-motion', show && reduceMotion);
            el.setAttribute('aria-hidden', String(!show));
        } catch {
            // best-effort toggle
        }
    }

    function bind(entityManager) {
        if (!entityManager || entityManager === boundManager) return;
        if (boundManager) {
            boundManager.setKillcamPresentationListener?.(null);
            setVisible(false);
        }
        boundManager = entityManager;
        entityManager.setKillcamPresentationListener?.(setVisible);
    }

    function dispose() {
        setVisible(false);
        boundManager?.setKillcamPresentationListener?.(null);
        boundManager = null;
        if (ownsLetterboxEl) letterboxEl?.remove?.();
        letterboxEl = null;
        ownsLetterboxEl = false;
    }

    return { setVisible, bind, dispose };
}

/** Binds the HUD's letterbox view to the current entity manager, creating the view on first use. */
export function bindKillcamLetterbox(view, entityManager) {
    const letterbox = view || createKillcamLetterboxView();
    letterbox.bind(entityManager);
    return letterbox;
}
