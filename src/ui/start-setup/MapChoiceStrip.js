export function readMapOptions(select) {
    return Array.from(select?.options || []).map((option) => ({
        id: String(option.value || '').trim(),
        label: String(option.textContent || option.value || '').trim(),
        collection: String(option.dataset?.mapCollection || 'other').trim(),
        collectionLabel: String(option.dataset?.mapCollectionLabel || 'Weitere Karten').trim(),
    })).filter((entry) => entry.id);
}

function buildChoiceGroups(options) {
    const fragment = document.createDocumentFragment();
    const groups = new Map();
    options.forEach((entry) => {
        const group = groups.get(entry.collection) || {
            label: entry.collectionLabel,
            entries: [],
        };
        group.entries.push(entry);
        groups.set(entry.collection, group);
    });
    groups.forEach((group) => {
        const groupNode = document.createElement('div');
        groupNode.className = 'start-map-choice-group';
        groupNode.setAttribute('role', 'group');
        groupNode.setAttribute('aria-label', group.label);

        const heading = document.createElement('span');
        heading.className = 'start-map-choice-group-label';
        heading.textContent = group.label;
        groupNode.appendChild(heading);

        const choices = document.createElement('div');
        choices.className = 'start-map-choice-group-row';
        group.entries.forEach((entry) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'start-map-choice';
            button.dataset.mapKey = entry.id;
            button.setAttribute('role', 'option');
            button.textContent = entry.label;
            choices.appendChild(button);
        });
        groupNode.appendChild(choices);
        fragment.appendChild(groupNode);
    });
    return fragment;
}

/** Grouped map buttons under the miniature; rebuilt only when the option list itself changes. */
export function createMapChoiceStrip({ strip, previousButton, nextButton } = {}) {
    let signature = '';
    return Object.freeze({
        render(options, selectedMapKey) {
            const nextSignature = options
                .map((entry) => `${entry.collection}:${entry.id}:${entry.label}`)
                .join('|');
            if (nextSignature !== signature) {
                signature = nextSignature;
                strip?.replaceChildren(buildChoiceGroups(options));
            }
            strip?.querySelectorAll?.('[data-map-key]').forEach((button) => {
                const selected = button.dataset.mapKey === selectedMapKey;
                button.classList.toggle('active', selected);
                button.setAttribute('aria-selected', String(selected));
                button.tabIndex = selected ? 0 : -1;
            });
            [previousButton, nextButton].forEach((button) => { if (button) button.disabled = options.length < 2; });
        },
    });
}
