const SLOT_COUNT = 9;

function normalizeEntry(entry) {
    const id = String(entry?.id || '').trim();
    if (!id) return null;
    return { id, label: String(entry?.label || id) };
}

function uniqueEntries(entries, limit = SLOT_COUNT) {
    const result = [];
    const seen = new Set();
    for (const rawEntry of entries) {
        const entry = normalizeEntry(rawEntry);
        if (!entry || seen.has(entry.id)) continue;
        seen.add(entry.id);
        result.push(entry);
        if (result.length >= limit) break;
    }
    return result;
}

export function createEditorBuildHotbar({ favoriteEntries = [], recentEntries = [] } = {}) {
    const slots = Array(SLOT_COUNT).fill(null);
    uniqueEntries([...favoriteEntries, ...recentEntries]).forEach((entry, index) => {
        slots[index] = entry;
    });
    let selectedIndex = 0;

    return {
        getSnapshot() {
            return { slots: slots.map((entry) => (entry ? { ...entry } : null)), selectedIndex };
        },
        selectSlot(index) {
            if (!Number.isInteger(index) || index < 0 || index >= SLOT_COUNT) return false;
            selectedIndex = index;
            return true;
        },
        rebindSlot(index, rawEntry) {
            if (!Number.isInteger(index) || index < 0 || index >= SLOT_COUNT) return false;
            const entry = normalizeEntry(rawEntry);
            if (!entry) return false;
            for (let i = 0; i < slots.length; i += 1) {
                if (i !== index && slots[i]?.id === entry.id) slots[i] = null;
            }
            slots[index] = entry;
            selectedIndex = index;
            return true;
        },
    };
}

export { SLOT_COUNT as EDITOR_BUILD_HOTBAR_SLOT_COUNT };
