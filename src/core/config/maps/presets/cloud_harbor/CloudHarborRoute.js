// The parcours route through the Cloud Harbor: mooring dock -> through the cargo bay of a docked
// freight zeppelin -> through the rotor discs of two windmills -> split over the market isle
// (bazaar street under the sky bridges or the rooftops above) -> helix up the weather tower
// through its gyroscope rings -> summit gate -> dive along the cable-car line -> between the
// anchor chains under the harbor pier -> harbor gate.
//
// Coordinates are transcribed exactly from scripts/cloud_harbor_layout.py (CHECKPOINTS, FINISH)
// -- that file is the single source of truth the Blender generators also read.
// `tests/cloud-harbor-blender-assets.contract.test.mjs` checks the two stay identical.
//
// Sequential checkpoints omit `nextIds` (the parcours runtime falls back to array order); only the
// branch entry and the two lanes that rejoin it state theirs explicitly.

const CLOUD_HARBOR_CHECKPOINTS = [
    { id: 'CP01', type: 'gate', pos: [-134.0, 68.0, 100.0], radius: 6.0, forward: [1.0, 0.0, 0.0], params: { label: 'Ankermast' } },
    { id: 'CP02', type: 'gate', pos: [-106.0, 68.0, 100.0], radius: 6.0, forward: [1.0, 0.0, 0.0], params: { label: 'Bugtor' } },
    { id: 'CP03', type: 'gate', pos: [-65.0, 68.0, 100.0], radius: 5.5, forward: [1.0, 0.0, 0.0], params: { label: 'Frachtraum' } },
    { id: 'CP04', type: 'gate', pos: [-24.0, 68.0, 100.0], radius: 6.0, forward: [1.0, 0.0, 0.0], params: { label: 'Heckluke' } },
    { id: 'CP05', type: 'gate', pos: [15.0, 74.0, 92.0], radius: 5.5, forward: [1.0, 0.05, -0.2], params: { label: 'Windmühle West' } },
    { id: 'CP06', type: 'gate', pos: [45.0, 80.0, 60.0], radius: 5.5, forward: [0.4, 0.1, -0.9], params: { label: 'Windmühle Ost' } },
    // The split lines up with the bazaar street so both lanes stay straight: the bazaar lane dips
    // under the sky bridges, the roof lane climbs over them.
    {
        id: 'CP07', type: 'branch_entry', pos: [72.0, 78.0, 22.0], radius: 6.0, forward: [1.0, 0.0, 0.0],
        nextIds: ['CP08_BAZAAR', 'CP08_ROOF'], params: { label: 'Marktplatz' },
    },
    { id: 'CP08_BAZAAR', type: 'gate', pos: [110.0, 56.0, 22.0], radius: 5.0, forward: [1.0, 0.0, 0.0], nextIds: ['CP09'], params: { label: 'Basargasse' } },
    { id: 'CP08_ROOF', type: 'gate', pos: [110.0, 104.0, 22.0], radius: 5.0, forward: [1.0, 0.0, 0.0], nextIds: ['CP09'], params: { label: 'Dachgärten' } },
    { id: 'CP09', type: 'gate', pos: [158.0, 80.0, -5.0], radius: 6.0, forward: [0.85, 0.0, -0.55], params: { label: 'Marktausgang' } },
    { id: 'CP10', type: 'gate', pos: [152.0, 92.0, -62.0], radius: 6.0, forward: [0.0, 0.25, -1.0], params: { label: 'Wetterturm Ost' } },
    { id: 'CP11', type: 'gate', pos: [120.0, 112.0, -100.0], radius: 6.0, forward: [-1.0, 0.3, 0.0], params: { label: 'Wetterturm Nord' } },
    { id: 'CP12', type: 'gate', pos: [86.0, 132.0, -66.0], radius: 6.0, forward: [0.0, 0.3, 1.0], params: { label: 'Kreiselringe' } },
    { id: 'CP13', type: 'gate', pos: [120.0, 160.0, -66.0], radius: 7.0, forward: [0.0, 1.0, 0.0], params: { label: 'Turmspitze' } },
    { id: 'CP14', type: 'gate', pos: [70.0, 118.0, -110.0], radius: 6.0, forward: [-1.0, -0.4, -0.2], params: { label: 'Seilbahn' } },
    { id: 'CP15', type: 'gate', pos: [20.0, 98.0, -118.0], radius: 5.5, forward: [-1.0, -0.2, 0.0], params: { label: 'Gondeln' } },
    { id: 'CP16', type: 'gate', pos: [-30.0, 84.0, -118.0], radius: 5.5, forward: [-1.0, -0.2, 0.0], params: { label: 'Talstation' } },
    { id: 'CP17', type: 'gate', pos: [-80.0, 52.0, -88.0], radius: 6.0, forward: [-0.8, -0.3, 0.5], params: { label: 'Ankerketten' } },
];

const CLOUD_HARBOR_FINISH = {
    id: 'FINISH', type: 'finish', pos: [-128.0, 56.0, -48.0], radius: 7.5, forward: [-0.8, 0.05, 0.6],
};

// The same ordered-route rules as every other GLB parcours map (Eiffel Tower, Orbital Shipyard).
const CLOUD_HARBOR_PARCOURS_RULES = {
    ordered: true,
    bidirectionalCheckpoints: false,
    resetOnDeath: false,
    resetToLastValid: true,
    respawnOnDeath: true,
    lastCheckpointRespawns: 3,
    respawnDelaySeconds: 3,
    maxSegmentTimeMs: 30000,
    cooldownMs: 450,
    wrongOrderCooldownMs: 650,
    wrongOrderPenaltyMs: 2400,
    errorIndicatorMs: 1400,
    allowLaneAliases: true,
    winnerByParcoursComplete: true,
    animateCheckpoints: true,
    showGhost: true,
};

export { CLOUD_HARBOR_CHECKPOINTS, CLOUD_HARBOR_FINISH, CLOUD_HARBOR_PARCOURS_RULES };
