import {
    GAMEPAD_ACTIONS, GAMEPAD_AXES, GAMEPAD_AXIS_LABELS, GAMEPAD_BUTTON_LABELS,
    isGamepadInputEnabled, normalizeGamepadControls,
    SPLITSCREEN_INPUT_LAYOUTS, normalizeSplitscreenInputLayout,
} from '../shared/contracts/GamepadControlsContract.js';

export function renderGamepadBindingEditor(container, runtimeAccess) {
    if (!container) return;
    const doc = container.ownerDocument;
    const section = doc.createElement('section');
    section.style.gridColumn = '1 / -1';
    section.dataset.gamepadEditor = '';
    const enabledLabel = doc.createElement('label');
    enabledLabel.className = 'toggle-row';
    const enabled = doc.createElement('input');
    enabled.type = 'checkbox';
    enabled.dataset.gamepadEnabledToggle = '';
    enabled.checked = isGamepadInputEnabled(runtimeAccess.getControls?.());
    enabled.addEventListener('change', () => {
        const target = runtimeAccess.actionEnsurePlayerControls?.('GAMEPAD');
        if (!target) return;
        target.enabled = enabled.checked;
        runtimeAccess.actionOnSettingsChanged?.();
        runtimeAccess.actionApplyPauseBindings?.();
    });
    const enabledTitle = doc.createElement('span');
    enabledTitle.textContent = 'Controller im Spiel verwenden (aus: Tastatur steuert, auch wenn ein Controller angeschlossen ist)';
    enabledLabel.append(enabled, enabledTitle); section.append(enabledLabel);
    const assignmentLabel = doc.createElement('label');
    assignmentLabel.className = 'key-row';
    const assignmentTitle = doc.createElement('span'); assignmentTitle.textContent = 'Splitscreen: Eingabegeräte';
    const assignment = doc.createElement('select');
    assignment.setAttribute('aria-label', 'Splitscreen: Eingabegeräte');
    for (const layout of SPLITSCREEN_INPUT_LAYOUTS) {
        const option = doc.createElement('option'); option.value = layout.value; option.textContent = layout.label; assignment.append(option);
    }
    assignment.value = normalizeSplitscreenInputLayout(runtimeAccess.getControls?.()?.SPLITSCREEN?.layout);
    assignment.addEventListener('change', () => {
        const target = runtimeAccess.actionEnsurePlayerControls?.('SPLITSCREEN');
        if (!target) return;
        target.layout = normalizeSplitscreenInputLayout(assignment.value);
        runtimeAccess.actionOnSettingsChanged?.();
    });
    assignmentLabel.append(assignmentTitle, assignment); section.append(assignmentLabel);
    const assignmentHelp = doc.createElement('p');
    assignmentHelp.textContent = 'Gilt ab der nächsten Runde im Zwei-Spieler-Splitscreen. Tastaturspieler verwenden die Tasten von Spieler 1 bzw. Spieler 2. Gemischt wird Controller 1 verwendet; mit zwei Controllern steuert Controller 1 Spieler 1 und Controller 2 Spieler 2.';
    section.append(assignmentHelp);
    const title = doc.createElement('h4');
    title.textContent = 'Controller-Belegung';
    section.append(title);
    const info = doc.createElement('p');
    info.textContent = 'Änderungen gelten sofort und werden automatisch gespeichert. Bereits belegte Tasten tauschen ihre Funktionen. Im Menü bleiben Steuerkreuz, A und B fest belegt. Im Vier-Spieler-2D-Modus gelten Lenken, Rollen und die Item-/Raketentaste als Kontextaktion. Bei automatischer Zuordnung hat aktivierte Maussteuerung Vorrang.';
    section.append(info);
    const player = doc.createElement('select');
    player.setAttribute('aria-label', 'Controller auswählen');
    for (let slot = 1; slot <= 4; slot++) {
        const option = doc.createElement('option'); option.value = `GAMEPAD_${slot}`;
        option.textContent = `Controller ${slot}`; player.append(option);
    }
    player.value = container.dataset.gamepadPlayer || 'GAMEPAD_1';
    section.append(player);
    const rows = doc.createElement('div'); rows.className = 'keybind-grid'; section.append(rows);
    const status = doc.createElement('p'); status.setAttribute('role', 'status'); section.append(status);
    const save = (mapping) => {
        const target = runtimeAccess.actionEnsurePlayerControls?.(player.value);
        if (!target) return;
        Object.assign(target, mapping);
        runtimeAccess.actionOnSettingsChanged?.();
        runtimeAccess.actionApplyPauseBindings?.();
        status.textContent = 'Controller-Belegung geändert und gespeichert.';
    };
    /**
     * @param {Record<string, number>} mapping
     * @param {ReadonlyArray<{ key: string, label: string }>} fields
     * @param {ReadonlyArray<string>} labels
     */
    const renderGroup = (mapping, fields, labels) => {
        for (const field of fields) {
            const row = doc.createElement('label'); row.className = 'key-row';
            const label = doc.createElement('span'); label.className = 'key-action'; label.textContent = field.label;
            const select = doc.createElement('select'); select.dataset.gamepadAction = field.key;
            select.setAttribute('aria-label', field.label);
            labels.forEach((text, index) => {
                const option = doc.createElement('option'); option.value = String(index); option.textContent = text; select.append(option);
            });
            select.value = String(mapping[field.key]);
            select.addEventListener('change', () => {
                const next = { ...mapping };
                const value = Number(select.value);
                const other = fields.find((candidate) => candidate.key !== field.key && next[candidate.key] === value);
                if (other) next[other.key] = next[field.key];
                next[field.key] = value; save(next); renderRows();
                /** @type {HTMLElement | null} */ (rows.querySelector(`[data-gamepad-action="${field.key}"]`))?.focus();
            });
            row.append(label, select); rows.append(row);
        }
    };
    const renderRows = () => {
        const mapping = normalizeGamepadControls(runtimeAccess.getControls?.()?.[player.value]);
        rows.replaceChildren();
        renderGroup(mapping, GAMEPAD_ACTIONS, GAMEPAD_BUTTON_LABELS);
        renderGroup(mapping, GAMEPAD_AXES, GAMEPAD_AXIS_LABELS);
    };
    player.addEventListener('change', () => { container.dataset.gamepadPlayer = player.value; status.textContent = ''; renderRows(); });
    const reset = doc.createElement('button'); reset.type = 'button'; reset.className = 'secondary-btn';
    reset.textContent = 'Controller-Standard wiederherstellen';
    reset.addEventListener('click', () => { save(normalizeGamepadControls()); renderRows(); });
    section.append(reset); container.append(section); renderRows();
}
