import { renderGamepadBindingEditor } from './GamepadBindingEditor.js';
import { GLOBAL_KEY_BIND_ACTIONS, KEY_BIND_ACTIONS, resolveKeybindActionLabel } from './KeybindActionCatalog.js';
import { formatKeyCode } from './KeybindLabels.js';
import { createRuntimeAccess } from '../shared/runtime/RuntimeAccessFactory.js';

const KEY_BIND_SCOPES = [
    { key: 'PLAYER_1', label: 'Spieler 1', actions: KEY_BIND_ACTIONS },
    { key: 'PLAYER_2', label: 'Spieler 2', actions: KEY_BIND_ACTIONS },
    { key: 'GLOBAL', label: 'Allgemein', actions: GLOBAL_KEY_BIND_ACTIONS },
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
        // The pitch rows name the nose direction, which flips with this per-player setting.
        getInvertPitch: (playerKey) => game?.settings?.invertPitch?.[playerKey] !== false,
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
        renderGamepadBindingEditor(ui?.keybindGlobal, this.runtimeAccess);
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
            label.textContent = resolveKeybindActionLabel(action, { invertPitch: this.runtimeAccess.getInvertPitch?.(playerKey) });

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
                button.textContent = 'Taste drücken...';
            }

            row.appendChild(label);
            row.appendChild(button);
            container.appendChild(row);
        }
    }

    startKeyCapture(playerKey, actionKey) {
        this.runtimeAccess.setKeyCapture?.({ playerKey, actionKey });
        this.renderEditor();
    }

    // The pause shows the menu's settings window, so the menu root is visible there too.
    _isKeybindEditorVisible() {
        const ui = this.runtimeAccess.getUi?.() || null;
        return !!ui?.mainMenu && !ui.mainMenu.classList.contains('hidden');
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
            return true;
        }

        const conflict = this._findControlValueConflict(keyCapture.playerKey, keyCapture.actionKey, event.code);
        if (conflict) {
            this.runtimeAccess.setKeyCapture?.(null);
            this.renderEditor();
            this._showKeyConflictFeedback(event.code, conflict);
            return true;
        }

        this.setControlValue(keyCapture.playerKey, keyCapture.actionKey, event.code);
        this.runtimeAccess.setKeyCapture?.(null);
        // A successful binding replaces the rejected-key hint with the real conflict state.
        this.updateKeyConflictWarning(this.collectKeyConflicts());
        this.runtimeAccess.actionOnSettingsChanged?.();
        if (state === 'PAUSED') {
            this.runtimeAccess.actionApplyPauseBindings?.();
            this.renderEditor();
        }
        this.runtimeAccess.actionShowStatusToast?.('Taste gespeichert!');
        return true;
    }

    getControlValue(playerKey, actionKey) {
        const controls = this.runtimeAccess.getControls?.() || {};
        const playerControls = controls[playerKey] || {};
        return playerControls[actionKey] || '';
    }

    // Returns the scope and action that already use the key, so the hint can name them.
    _findControlValueConflict(playerKey, actionKey, value) {
        if (!value) return null;
        for (const scope of KEY_BIND_SCOPES) {
            for (const action of scope.actions) {
                if (scope.key === playerKey && action.key === actionKey) continue;
                if (this.getControlValue(scope.key, action.key) === value) {
                    return { scope, action };
                }
            }
        }
        return null;
    }

    _hasControlValueConflict(playerKey, actionKey, value) {
        return this._findControlValueConflict(playerKey, actionKey, value) !== null;
    }

    _showKeyConflictFeedback(code, conflict) {
        const message = `Taste ${this.formatKeyCode(code)} ist bereits mit ${conflict.action.label} (${conflict.scope.label}) belegt`;
        const warningElement = this.runtimeAccess.getUi?.()?.keybindWarning;
        if (warningElement) {
            warningElement.classList.remove('hidden');
            warningElement.textContent = message;
        }
        this.runtimeAccess.actionShowStatusToast?.(message, 1800, 'error');
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
