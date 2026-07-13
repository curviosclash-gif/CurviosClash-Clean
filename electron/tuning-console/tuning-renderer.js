function createElement(tagName, className = '', text = '') {
    const element = document.createElement(tagName);
    if (className) {
        element.className = className;
    }
    if (text) {
        element.textContent = text;
    }
    return element;
}

function toNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function valuesEqual(left, right) {
    if (typeof left === 'number' || typeof right === 'number') {
        return Number(left) === Number(right);
    }
    return String(left) === String(right);
}

function resolveInputStep(descriptor) {
    const step = Number(descriptor?.step);
    return Number.isFinite(step) && step > 0 ? step : 0.1;
}

function resolveInputMin(descriptor) {
    const min = Number(descriptor?.min);
    return Number.isFinite(min) ? min : -1000;
}

function resolveInputMax(descriptor) {
    const max = Number(descriptor?.max);
    return Number.isFinite(max) ? max : 1000;
}

function normalizeColorValue(value) {
    const normalized = String(value || '').trim();
    if (/^#[0-9a-f]{6}$/i.test(normalized)) {
        return normalized;
    }
    if (/^[0-9a-f]{6}$/i.test(normalized)) {
        return `#${normalized}`;
    }
    return '#ffffff';
}

function createResetButton({ descriptor, changed, onReset, disabled }) {
    const button = createElement('button', 'reset-btn', 'Reset');
    button.type = 'button';
    button.disabled = disabled || !changed;
    button.addEventListener('click', () => {
        if (typeof onReset === 'function') {
            onReset(descriptor.path);
        }
    });
    return button;
}

function createNumberControls({
    descriptor,
    value,
    readOnly,
    onValueChange,
}) {
    const controls = createElement('div', 'param-controls');
    const min = resolveInputMin(descriptor);
    const max = resolveInputMax(descriptor);
    const step = resolveInputStep(descriptor);
    const safeValue = toNumber(value, toNumber(descriptor.defaultValue, min));

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(safeValue);
    slider.disabled = readOnly;

    const numberInput = document.createElement('input');
    numberInput.type = 'number';
    numberInput.min = String(min);
    numberInput.max = String(max);
    numberInput.step = String(step);
    numberInput.value = String(safeValue);
    numberInput.disabled = readOnly;

    const updateValue = (nextRawValue) => {
        const nextNumericValue = Math.max(min, Math.min(max, toNumber(nextRawValue, safeValue)));
        slider.value = String(nextNumericValue);
        numberInput.value = String(nextNumericValue);
        if (typeof onValueChange === 'function') {
            onValueChange(descriptor.path, nextNumericValue);
        }
    };

    slider.addEventListener('input', () => updateValue(slider.value));
    numberInput.addEventListener('change', () => updateValue(numberInput.value));

    controls.appendChild(slider);
    controls.appendChild(numberInput);
    return controls;
}

function createBooleanControls({
    descriptor,
    value,
    readOnly,
    onValueChange,
}) {
    const controls = createElement('div', 'param-controls single');
    const toggleWrap = createElement('label', 'toggle-wrap');
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = value === true;
    toggle.disabled = readOnly;
    const label = createElement('span', '', toggle.checked ? 'Aktiv' : 'Inaktiv');

    toggle.addEventListener('change', () => {
        label.textContent = toggle.checked ? 'Aktiv' : 'Inaktiv';
        if (typeof onValueChange === 'function') {
            onValueChange(descriptor.path, toggle.checked);
        }
    });

    toggleWrap.appendChild(toggle);
    toggleWrap.appendChild(label);
    controls.appendChild(toggleWrap);
    return controls;
}

function createSelectControls({
    descriptor,
    value,
    readOnly,
    onValueChange,
}) {
    const controls = createElement('div', 'param-controls single');
    const select = document.createElement('select');
    const options = Array.isArray(descriptor.options) ? descriptor.options : [];
    options.forEach((optionValue) => {
        const option = document.createElement('option');
        option.value = String(optionValue);
        option.textContent = String(optionValue);
        select.appendChild(option);
    });
    const fallbackValue = options.length > 0 ? String(options[0]) : String(value ?? '');
    select.value = options.includes(value) ? String(value) : fallbackValue;
    select.disabled = readOnly;
    select.addEventListener('change', () => {
        if (typeof onValueChange === 'function') {
            onValueChange(descriptor.path, select.value);
        }
    });
    controls.appendChild(select);
    return controls;
}

function createColorControls({
    descriptor,
    value,
    readOnly,
    onValueChange,
}) {
    const controls = createElement('div', 'param-controls');
    const colorPicker = document.createElement('input');
    colorPicker.type = 'color';
    colorPicker.value = normalizeColorValue(value);
    colorPicker.disabled = readOnly;

    const textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.value = String(value ?? '');
    textInput.disabled = readOnly;

    const updateValue = (nextValue) => {
        const normalizedHex = normalizeColorValue(nextValue);
        colorPicker.value = normalizedHex;
        textInput.value = normalizedHex;
        if (typeof onValueChange === 'function') {
            onValueChange(descriptor.path, normalizedHex);
        }
    };

    colorPicker.addEventListener('input', () => updateValue(colorPicker.value));
    textInput.addEventListener('change', () => updateValue(textInput.value));

    controls.appendChild(colorPicker);
    controls.appendChild(textInput);
    return controls;
}

function createTextControls({
    descriptor,
    value,
    readOnly,
    onValueChange,
}) {
    const controls = createElement('div', 'param-controls single');
    const input = document.createElement('input');
    input.type = 'text';
    input.value = String(value ?? '');
    input.disabled = readOnly;
    input.addEventListener('change', () => {
        if (typeof onValueChange === 'function') {
            onValueChange(descriptor.path, input.value);
        }
    });
    controls.appendChild(input);
    return controls;
}

function createParameterControls({
    descriptor,
    value,
    readOnly,
    onValueChange,
}) {
    if (descriptor.type === 'number') {
        return createNumberControls({ descriptor, value, readOnly, onValueChange });
    }
    if (descriptor.type === 'boolean') {
        return createBooleanControls({ descriptor, value, readOnly, onValueChange });
    }
    if (descriptor.type === 'color') {
        return createColorControls({ descriptor, value, readOnly, onValueChange });
    }
    if (descriptor.type === 'select' || Array.isArray(descriptor.options)) {
        return createSelectControls({ descriptor, value, readOnly, onValueChange });
    }
    return createTextControls({ descriptor, value, readOnly, onValueChange });
}

export function renderTabs({
    container,
    sectionEntries,
    activeSection,
    onSectionSelected,
}) {
    if (!container) return;
    container.innerHTML = '';
    sectionEntries.forEach((entry) => {
        const button = createElement('button', entry.section === activeSection ? 'active' : '', entry.label);
        button.type = 'button';
        button.addEventListener('click', () => {
            if (typeof onSectionSelected === 'function') {
                onSectionSelected(entry.section);
            }
        });
        container.appendChild(button);
    });
}

export function renderParameterList({
    container,
    descriptors,
    valuesByPath,
    defaultsByPath,
    onValueChange,
    onResetParameter,
}) {
    if (!container) return;
    container.innerHTML = '';

    if (!Array.isArray(descriptors) || descriptors.length === 0) {
        const emptyState = createElement('div', 'empty-state', 'Keine Parameter fuer diesen Filter gefunden.');
        container.appendChild(emptyState);
        return;
    }

    descriptors.forEach((descriptor) => {
        const currentValue = valuesByPath?.[descriptor.path];
        const defaultValue = defaultsByPath?.[descriptor.path];
        const readOnly = descriptor.readOnly === true;
        const changed = !valuesEqual(currentValue, defaultValue);

        const row = createElement('article', `param-row${changed ? ' changed' : ''}${readOnly ? ' readonly' : ''}`);
        const head = createElement('div', 'param-head');
        const label = createElement('div', 'param-label', descriptor.label || descriptor.path);
        const pathNode = createElement('div', 'param-path', descriptor.path);
        const marker = readOnly
            ? createElement('span', 'readonly-badge', 'readonly')
            : createElement('span', changed ? 'badge' : 'muted', changed ? 'geaendert' : 'default');

        const titleWrap = createElement('div');
        titleWrap.appendChild(label);
        titleWrap.appendChild(pathNode);

        head.appendChild(titleWrap);
        head.appendChild(marker);
        row.appendChild(head);

        const controls = createParameterControls({
            descriptor,
            value: currentValue,
            readOnly,
            onValueChange,
        });
        controls.appendChild(createResetButton({
            descriptor,
            changed,
            onReset: onResetParameter,
            disabled: readOnly,
        }));
        row.appendChild(controls);
        container.appendChild(row);
    });
}
