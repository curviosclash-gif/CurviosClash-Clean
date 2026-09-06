// Checkpoints lie beyond each mechanism, never inside its swept volume. The raised
// bypasses merge in the courtyards so they remain useful in every animation phase.
function checkpoint(id, pos, forward, label, extra = {}) {
    return { id, type: 'checkpoint', pos, radius: 6, forward, params: { label }, ...extra };
}

export const FALKENWACHT_CHECKPOINTS = [
    checkpoint('CP01', [0, 26, 160], [0, 0, -1], 'Südliches Vorfeld', { nextIds: ['CP02_BRIDGE', 'CP02_BYPASS'] }),
    checkpoint('CP02_BRIDGE', [0, 26, 97], [0, 0, -1], 'Zugbrücke direkt', { nextIds: ['CP03'] }),
    checkpoint('CP02_BYPASS', [-65, 58, 118], [0, 0, -1], 'Torhaus außen', { nextIds: ['CP03'] }),
    checkpoint('CP03', [-40, 26, 90], [-0.2, -0.5, -1], 'Vorburg'),
    checkpoint('CP04', [-85, 26, 68], [0, 0, -1], 'Stallhalle Eingang'),
    checkpoint('CP05', [-85, 28, 10], [0, 0, -1], 'Stallhalle Ausgang'),
    checkpoint('CP06', [-30, 30, 20], [1, 0, -0.3], 'Inneres Tor', { nextIds: ['CP07_GATE', 'CP07_BYPASS'] }),
    checkpoint('CP07_GATE', [0, 30, -16], [0, 0, -1], 'Fallgatter direkt', { nextIds: ['CP08'] }),
    checkpoint('CP07_BYPASS', [-65, 62, 0], [0, 0, -1], 'Wehrmauer oben', { nextIds: ['CP08'] }),
    checkpoint('CP08', [0, 32, -37], [0.7, 0, -0.7], 'Kernhof'),
    checkpoint('CP09', [48, 34, -56], [1, 0, 0], 'Palashalle'),
    checkpoint('CP10', [108, 34, -56], [1, 0, 0], 'Palas Ausgang'),
    checkpoint('CP11', [104, 35, -102], [0, 0, -1], 'Arkaden'),
    checkpoint('CP12', [145, 64, -118], [1, 0, 0], 'Turmpassage'),
    checkpoint('CP13', [210, 100, -118], [0.8, 0.4, -0.2], 'Östlicher Wehrgang'),
    checkpoint('CP14', [-104, 100, -151], [-1, 0, 0], 'Bergfried Nordseite'),
    checkpoint('CP15', [-104, 90, -78], [-0.7, -0.2, 0.7], 'Bergfried Westseite'),
    checkpoint('CP16', [-185, 36, -95], [-0.7, -0.6, -0.1], 'Grabenabstieg'),
    checkpoint('CP17', [-185, 20, 150], [0, 0, 1], 'Westlicher Burggraben'),
    checkpoint('CP18', [-70, 24, 162], [1, 0, 0], 'Südlicher Burggraben'),
];

export const FALKENWACHT_FINISH = {
    id: 'FINISH', type: 'finish', pos: [20, 26, 164], radius: 8, forward: [1, 0, 0],
};

export const FALKENWACHT_PARCOURS_RULES = {
    ordered: true,
    bidirectionalCheckpoints: false,
    resetOnDeath: false,
    resetToLastValid: true,
    respawnOnDeath: true,
    lastCheckpointRespawns: 3,
    respawnDelaySeconds: 3,
    maxSegmentTimeMs: 60000,
    cooldownMs: 450,
    wrongOrderCooldownMs: 650,
    wrongOrderPenaltyMs: 2400,
    errorIndicatorMs: 1400,
    allowLaneAliases: true,
    winnerByParcoursComplete: true,
    animateCheckpoints: true,
    showGhost: true,
};
