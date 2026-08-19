export function countActiveEndlessBotSlots(slots) {
    let count = 0;
    for (let index = 0; index < slots.length; index += 1) {
        if (slots[index].state === 'active') count += 1;
    }
    return count;
}

export function countPendingEndlessBotSlots(slots) {
    let count = 0;
    for (let index = 0; index < slots.length; index += 1) {
        if (slots[index].state === 'pending') count += 1;
    }
    return count;
}
