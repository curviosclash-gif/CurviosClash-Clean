import { GLOBAL_KEY_BIND_ACTIONS, KEY_BIND_ACTIONS } from './KeybindActionCatalog.js';
import { formatKeyCode } from './KeybindLabels.js';
import { createRuntimeAccess } from '../shared/runtime/RuntimeAccessFactory.js';

const KEY_BIND_SCOPES = [
    { key: 'PLAYER_1', actions: KEY_BIND_ACTIONS },
    { key: 'PLAYER_2', actions: KEY_BIND_ACTIONS },
    { key: 'GLOBAL', actions: GLOBAL_KEY_BIND_ACTIONS },
];

export function createKeybindEditorRuntimeAccess(runtime) {
    return createRuntimeAccess(runtime, (game) => {
        const actionEnsurePlayerControls = (playerKey) => {
            if (!game?.settings?.controls?.[playerKey]) {
                if (!game?.settings?.controls) {
                    if (!game?.settings) {
                        return {};
                    }
                    game.settings.controls = {};
                }
                game.settings.controls[playerKey] = {};
            }
            return game?.settings?.controls?.[playerKey] || {};
        };
        const actionOnSettingsChanged = () => {
            game?._onSettingsChanged?.();
        };
        const actionApplyPauseBindings = () => {
            game?.input?.setBindings?.(game?.settings?.controls);
        };
        const actionShowStatusToast = (message, durationMs, tone) => {
            game?._showStatusToast?.(message, durationMs, tone);
        };
        return {
        getUi: () => game?.ui || null,
        getState: () => game?.state || null,
        getKeyCapture: () => game?.keyCapture || null,
        setKeyCapture(keyCapture) {
            if (!game) return;
            game.keyCapture = keyCapture;
        },
        getControls: () => game?.settings?.controls || {},
        actionEnsurePlayerControls,
        actionOnSettingsChanged,
        actionApplyPauseBindings,
        actionShowStatusToast,
        // Backward-compatible aliases for transitional call sites.
        ensurePlayerControls: actionEnsurePlayerControls,
        onSettingsChanged: actionOnSettingsChanged,
        applyPauseBindings: actionApplyPauseBindings,
        showStatusToast: actionShowStatusToast,
    };
    });
}

export class KeybindEditorController {
    constructor(runtimeAccess = {}) {
        this.runtimeAccess = runtimeAccess && typeof runtimeAccess === 'object'
            ? runtimeAccess
            : {};
    }

    renderEditor() {
        const ui = this.runtimeAccess.getUi?.() || null;
        const conflicts = this.collectKeyConflicts();
        this.renderKeybindRows('PLAYER_1', ui?.keybindP1, KEY_BIND_ACTIONS, conflicts);
        this.renderKeybindRows('PLAYER_2', ui?.keybindP2, KEY_BIND_ACTIONS, conflicts);
        this.renderKeybindRows('GLOBAL', ui?.keybindGlobal, GLOBAL_KEY_BIND_ACTIONS, conflicts);
        this.updateKeyConflictWarning(conflicts);
    }

    renderPauseEditor() {
        const ui = this.runtimeAccess.getUi?.() || null;
        const conflicts = this.collectKeyConflicts();
        this.renderKeybindRows('PLAYER_1', ui?.pauseKeybindP1, KEY_BIND_ACTIONS, conflicts);
        this.renderKeybindRows('PLAYER_2', ui?.pauseKeybindP2, KEY_BIND_ACTIONS, conflicts);
        this._updateWarningElement(ui?.pauseKeybindWarning, conflicts);
    }

    renderKeybindRows(playerKey, container, actions, conflicts) {
        if (!container) return;

        const keyCapture = this.runtimeAccess.getKeyCapture?.() || null;
        container.replaceChildren();

        for (const action of actions) {
            const row = document.createElement('div');
            row.className = 'key-row';

            const label = document.createElement('div');
            label.className = 'key-action';
            label.textContent = action.label;

            const value = this.getControlValue(playerKey, action.key);
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'keybind-btn';
            button.dataset.action = action.key;
            const isConflict = !!value && (conflicts.get(value) || 0) > 1;
            button.textContent = this.formatKeyCode(value) + (isConflict ? '  (Konflikt)' : '');
            if (isConflict) {
                row.classList.add('conflict');
                button.classList.add('conflict');
            }

            if (keyCapture && keyCapture.playerKey === playerKey && keyCapture.actionKey === action.key) {
                button.classList.add('listening');
                button.textContent = 'Taste druecken...';
            }

            row.appendChild(label);
            row.appendChild(button);
            container.appendChild(row);
        }
    }

    startKeyCapture(playerKey, actionKey) {
        this.runtimeAccess.setKeyCapture?.({ playerKey, actionKey });
        this.renderEditor();
        this.renderPauseEditor();
    }

    _isKeybindEditorVisible() {
        const ui = this.runtimeAccess.getUi?.() || null;
        const state = this.runtimeAccess.getState?.() || '';
        if (ui?.mainMenu && !ui.mainMenu.classList.contains('hidden')) {
            return true;
        }
        if (state === 'PAUSED' && ui?.pauseSettingsPanel && !ui.pauseSettingsPanel.classList.contains('hidden')) {
            return true;
        }
        return false;
    }

    handleKeyCapture(event) {
        const keyCapture = this.runtimeAccess.getKeyCapture?.() || null;
        const state = this.runtimeAccess.getState?.() || '';
        if (!keyCapture || !this._isKeybindEditorVisible()) {
            return false;
        }

        event.preventDefault();
        event.stopPropagation();

        if (event.code === 'Escape') {
            this.runtimeAccess.setKeyCapture?.(null);
            this.renderEditor();
            this.renderPauseEditor();
            return true;
        }

        if (this._hasControlValueConflict(keyCapture.playerKey, keyCapture.actionKey, event.code)) {
            this.runtimeAccess.setKeyCapture?.(null);
            this.renderEditor();
            this.renderPauseEditor();
            this._showKeyConflictFeedback(event.code);
            return true;
        }

        this.setControlValue(keyCapture.playerKey, keyCapture.actionKey, event.code);
        this.runtimeAccess.setKeyCapture?.(null);
        this.runtimeAccess.actionOnSettingsChanged?.();
        if (state === 'PAUSED') {
            this.runtimeAccess.actionApplyPauseBindings?.();
            this.renderPauseEditor();
        }
        this.runtimeAccess.actionShowStatusToast?.('Taste gespeichert!');
        return true;
    }

    getControlValue(playerKey, actionKey) {
        const controls = this.runtimeAccess.getControls?.() || {};
        const playerControls = controls[playerKey] || {};
        return playerControls[actionKey] || '';
    }

    _hasControlValueConflict(playerKey, actionKey, value) {
        if (!value) return false;
        for (const scope of KEY_BIND_SCOPES) {
            for (const action of scope.actions) {
                if (scope.key === playerKey && action.key === actionKey) continue;
                if (this.getControlValue(scope.key, action.key) === value) {
                    return true;
                }
            }
        }
        return false;
    }

    _showKeyConflictFeedback(code) {
        const conflicts = this.collectKeyConflicts();
        conflicts.set(code, Math.max(conflicts.get(code) || 0, 2));
        this.updateKeyConflictWarning(conflicts);
        this._updateWarningElement(this.runtimeAccess.getUi?.()?.pauseKeybindWarning, conflicts);
        this.runtimeAccess.actionShowStatusToast?.(
            `Taste bereits belegt: ${this.formatKeyCode(code)}`,
            1800,
            'error'
        );
    }

    setControlValue(playerKey, actionKey, value) {
        const playerControls = this.runtimeAccess.actionEnsurePlayerControls?.(playerKey);
        if (!playerControls) return;
        playerControls[actionKey] = value;
    }

    collectKeyConflicts() {
        const counts = new Map();
        for (const scope of KEY_BIND_SCOPES) {
            for (const action of scope.actions) {
                const code = this.getControlValue(scope.key, action.key);
                if (!code) continue;
                counts.set(code, (counts.get(code) || 0) + 1);
            }
        }
        return counts;
    }

    _updateWarningElement(warningElement, conflicts) {
        if (!warningElement) return;

        const conflictCodes = Array.from(conflicts.entries())
            .filter(([, count]) => count > 1)
            .map(([code]) => this.formatKeyCode(code));

        if (conflictCodes.length === 0) {
            warningElement.classList.add('hidden');
            warningElement.textContent = '';
            return;
        }

        warningElement.classList.remove('hidden');
        warningElement.textContent = `Achtung: Mehrfachbelegte Tasten: ${conflictCodes.join(', ')}`;
    }

    updateKeyConflictWarning(conflicts) {
        this._updateWarningElement(this.runtimeAccess.getUi?.()?.keybindWarning, conflicts);
    }

    formatKeyCode(code) {
        return formatKeyCode(code);
    }
}
