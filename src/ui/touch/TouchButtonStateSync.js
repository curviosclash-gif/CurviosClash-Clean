// ============================================
// TouchButtonStateSync.js - change-detecting touch button writes
// ============================================

import { applyTouchButtonVisualState } from './TouchControlLayoutOps.js';

const NO_ITEM_LABEL = 'Kein Item';

function toCooldownTenths(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric * 10)) : 0;
}

/**
 * Caches the last written visual state per touch button so a poll() only reaches
 * the DOM when something actually changed. Title strings are rebuilt only when
 * the rounded tenth of a second behind them moves, which keeps the per-frame
 * cost at a handful of primitive comparisons.
 *
 * Holds no game or runtime reference on purpose: it receives the resolved
 * action state and the button elements from the caller.
 */
export class TouchButtonStateSync {
    constructor({ applyVisualState } = {}) {
        this._applyVisualState = typeof applyVisualState === 'function'
            ? applyVisualState
            : applyTouchButtonVisualState;
        this._states = new Map();
        this._writeCount = 0;
        this._itemLabel = { rawType: undefined, text: NO_ITEM_LABEL };
        this._fireTitle = { canShoot: null, ready: null, type: null, tenths: null, text: '' };
        this._useTitle = { canUse: null, ready: null, label: null, tenths: null, text: '' };
    }

    get writeCount() {
        return this._writeCount;
    }

    /** Forget every cached button state so the next sync writes again. */
    reset() {
        this._states.clear();
    }

    resolveItemLabel(rawType) {
        const cache = this._itemLabel;
        if (cache.rawType !== rawType) {
            cache.rawType = rawType;
            cache.text = rawType ? String(rawType).replace(/_/g, ' ') : NO_ITEM_LABEL;
        }
        return cache.text;
    }

    resolveFireTitle(actionState) {
        const canShoot = !!actionState?.canShootRocket;
        const ready = !!actionState?.canShootRocketNow;
        const type = actionState?.nextRocketType ?? '';
        const tenths = ready ? 0 : toCooldownTenths(actionState?.shootCooldownRemaining);
        const cache = this._fireTitle;
        if (cache.canShoot === canShoot && cache.ready === ready
            && cache.type === type && cache.tenths === tenths) {
            return cache.text;
        }
        cache.canShoot = canShoot;
        cache.ready = ready;
        cache.type = type;
        cache.tenths = tenths;
        cache.text = canShoot
            ? `${type}${ready ? '' : ` | Shoot-CD ${(tenths / 10).toFixed(1)}s`}`
            : 'Keine Rakete';
        return cache.text;
    }

    resolveUseItemTitle(actionState) {
        const label = this.resolveItemLabel(actionState?.rawType ?? null);
        const canUse = !!actionState?.canUse;
        const ready = !!actionState?.canUseNow;
        const tenths = ready ? 0 : toCooldownTenths(actionState?.useCooldownRemaining);
        const cache = this._useTitle;
        if (cache.canUse === canUse && cache.ready === ready
            && cache.label === label && cache.tenths === tenths) {
            return cache.text;
        }
        cache.canUse = canUse;
        cache.ready = ready;
        cache.label = label;
        cache.tenths = tenths;
        cache.text = canUse
            ? `${label}${ready ? '' : ` | Use-CD ${(tenths / 10).toFixed(1)}s`}`
            : `${label} | Nicht direkt nutzbar`;
        return cache.text;
    }

    apply(id, button, enabled, visible, title, controlsVisible) {
        if (!button) return false;
        const cached = this._states.get(id);
        if (cached && cached.enabled === enabled && cached.visible === visible
            && cached.title === title && cached.controlsVisible === controlsVisible) {
            return false;
        }
        if (cached) {
            cached.enabled = enabled;
            cached.visible = visible;
            cached.title = title;
            cached.controlsVisible = controlsVisible;
        } else {
            this._states.set(id, { enabled, visible, title, controlsVisible });
        }
        this._applyVisualState(button, { enabled, visible, title, controlsVisible });
        this._writeCount += 1;
        return true;
    }

    sync(actionState, buttonEls = {}, controlsVisible = true) {
        // The fire button launches the next queued rocket; items fire through the use button.
        this.apply('fire', buttonEls.fire, !!actionState?.canShootRocketNow, true,
            this.resolveFireTitle(actionState), controlsVisible);
        this.apply('useItem', buttonEls.useItem, !!actionState?.canUseNow, true,
            this.resolveUseItemTitle(actionState), controlsVisible);
        this.apply('nextItem', buttonEls.nextItem, !!actionState?.canCycle, true,
            actionState?.canCycle ? 'Nächstes Inventar-Item' : 'Kein weiteres Inventar-Item',
            controlsVisible);
        this.apply('shootMG', buttonEls.shootMG, !!actionState?.showMg, !!actionState?.showMg,
            actionState?.showMg ? 'Maschinengewehr' : '', controlsVisible);
    }
}
