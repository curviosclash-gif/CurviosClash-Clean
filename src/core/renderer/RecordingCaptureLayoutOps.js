import { findProjectedPlayerByIndex } from './RecordingCaptureProjectionOps.js';
import {
    VIEWPORT_LAYOUTS,
    normalizeViewportLayout,
} from '../../shared/contracts/ViewportLayoutContract.js';

export function buildStandardCaptureSegments({
    players = [],
    viewportLayout = VIEWPORT_LAYOUTS.SINGLE,
    width = 0,
    height = 0,
    localPlayerIndex = 0,
} = {}) {
    if (!Array.isArray(players) || players.length === 0) return [];
    const layout = normalizeViewportLayout(viewportLayout);
    if (layout === VIEWPORT_LAYOUTS.FOUR_GRID && players.length >= 4) {
        const leftWidth = Math.floor(width / 2);
        const topHeight = Math.floor(height / 2);
        const rightWidth = width - leftWidth;
        const bottomHeight = height - topHeight;
        return [
            { x: 0, y: 0, width: leftWidth, height: topHeight, player: findProjectedPlayerByIndex(players, 0, players[0]), label: 'P1' },
            { x: leftWidth, y: 0, width: rightWidth, height: topHeight, player: findProjectedPlayerByIndex(players, 1, players[1]), label: 'P2' },
            { x: 0, y: topHeight, width: leftWidth, height: bottomHeight, player: findProjectedPlayerByIndex(players, 2, players[2]), label: 'P3' },
            { x: leftWidth, y: topHeight, width: rightWidth, height: bottomHeight, player: findProjectedPlayerByIndex(players, 3, players[3]), label: 'P4' },
        ];
    }
    if (layout === VIEWPORT_LAYOUTS.THREE_COLUMNS && players.length >= 3) {
        const columnWidth = Math.floor(width / 3);
        return [
            { x: 0, y: 0, width: columnWidth, height, player: findProjectedPlayerByIndex(players, 0, players[0]), label: 'P1' },
            { x: columnWidth, y: 0, width: columnWidth, height, player: findProjectedPlayerByIndex(players, 1, players[1]), label: 'P2' },
            { x: columnWidth * 2, y: 0, width: width - columnWidth * 2, height, player: findProjectedPlayerByIndex(players, 2, players[2]), label: 'P3' },
        ];
    }
    if (layout === VIEWPORT_LAYOUTS.THREE_ROWS && players.length >= 3) {
        const rowHeight = Math.floor(height / 3);
        return [
            { x: 0, y: 0, width, height: rowHeight, player: findProjectedPlayerByIndex(players, 0, players[0]), label: 'P1' },
            { x: 0, y: rowHeight, width, height: rowHeight, player: findProjectedPlayerByIndex(players, 1, players[1]), label: 'P2' },
            { x: 0, y: rowHeight * 2, width, height: height - rowHeight * 2, player: findProjectedPlayerByIndex(players, 2, players[2]), label: 'P3' },
        ];
    }
    if (layout === VIEWPORT_LAYOUTS.TWO_COLUMNS && players.length >= 2) {
        const leftWidth = Math.floor(width / 2);
        return [
            { x: 0, y: 0, width: leftWidth, height, player: findProjectedPlayerByIndex(players, 0, players[0]), label: 'P1' },
            { x: leftWidth, y: 0, width: width - leftWidth, height, player: findProjectedPlayerByIndex(players, 1, players[1]), label: 'P2' },
        ];
    }
    const primary = findProjectedPlayerByIndex(
        players,
        Math.max(0, Math.trunc(Number(localPlayerIndex) || 0)),
        players[0]
    );
    return [{
        x: 0,
        y: 0,
        width,
        height,
        player: primary,
        label: `P${primary.playerIndex + 1}`,
}];
}
