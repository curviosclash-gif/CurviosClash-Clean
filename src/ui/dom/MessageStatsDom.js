export function clearMessageStats(container) {
    if (!container) return;
    container.innerHTML = '';
    container.classList.add('hidden');
}

export function renderMessageStats(container, overlayStats) {
    if (!container) return;

    const blocks = Array.isArray(overlayStats?.blocks) ? overlayStats.blocks : [];
    if (overlayStats?.visible === false || blocks.length === 0) {
        clearMessageStats(container);
        return;
    }

    container.innerHTML = '';
    for (const block of blocks) {
        const blockElement = document.createElement('section');
        blockElement.className = 'message-stats-card';
        blockElement.setAttribute('data-stats-block-id', String(block?.id || 'block'));

        const title = document.createElement('h3');
        title.className = 'message-stats-title';
        title.textContent = String(block?.title || 'Stats');
        blockElement.appendChild(title);

        const list = document.createElement('dl');
        list.className = 'message-stats-list';
        const rows = Array.isArray(block?.rows) ? block.rows : [];
        for (const row of rows) {
            const rowElement = document.createElement('div');
            rowElement.className = 'message-stats-row';
            rowElement.setAttribute('data-stats-row-key', String(row?.key || 'row'));

            const label = document.createElement('dt');
            label.className = 'message-stats-label';
            label.textContent = String(row?.label || '');

            const value = document.createElement('dd');
            value.className = 'message-stats-value';
            value.textContent = String(row?.value ?? '');

            rowElement.appendChild(label);
            rowElement.appendChild(value);
            list.appendChild(rowElement);
        }

        blockElement.appendChild(list);
        container.appendChild(blockElement);
    }

    container.classList.remove('hidden');
}
