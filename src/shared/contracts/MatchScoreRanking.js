export function rankScoreRows(rows, scoreKey = 'score') {
    return (Array.isArray(rows) ? rows : [])
        .map((row, order) => ({ row, order }))
        .sort((left, right) => {
            const delta = (Number(right.row?.[scoreKey]) || 0) - (Number(left.row?.[scoreKey]) || 0);
            return delta || left.order - right.order;
        })
        .map(({ row }) => row);
}

export function scoreRank(rows, playerIndex, scoreKey = 'score') {
    const own = rows?.find((row) => (row?.playerIndex ?? row?.index) === playerIndex);
    if (!own) return 0;
    const score = Number(own[scoreKey]) || 0;
    let rank = 1;
    for (const row of rows) {
        if ((Number(row?.[scoreKey]) || 0) > score) rank += 1;
    }
    return rank;
}
