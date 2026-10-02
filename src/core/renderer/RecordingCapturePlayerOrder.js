export function sortPlayersByIndexWhenNeeded(players) {
    let previousIndex = 0;
    let ordered = true;
    for (let index = 0; index < players.length; index += 1) {
        const playerIndex = players[index]?.playerIndex || 0;
        if (!Number.isInteger(playerIndex) || (index > 0 && previousIndex > playerIndex)) {
            ordered = false;
            break;
        }
        previousIndex = playerIndex;
    }
    if (!ordered) {
        players.sort((left, right) => (left.playerIndex || 0) - (right.playerIndex || 0));
    }
    return players;
}
