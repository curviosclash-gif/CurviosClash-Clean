// The parcours route through the Orbital Shipyard: launch bay -> scaffold yard under a slewing
// crane -> through the rib cage of a half-built hull past a welding gantry -> split (timed airlock
// doors or the maintenance duct above) -> helix up the drydock tower through a rotor -> summit gate
// -> dive into the fuel canyon with its pistons -> finish dock.
//
// Coordinates are transcribed exactly from scripts/orbital_shipyard_layout.py (CHECKPOINTS,
// FINISH) -- that file is the single source of truth the Blender generators also read, so the
// route here and the static geometry it was built around can never drift apart. Every checkpoint
// here corresponds 1:1 to an entry there; `tests/orbital-shipyard-blender-assets.contract.test.mjs`
// checks the two stay identical.
//
// Sequential checkpoints omit `nextIds` (the parcours runtime falls back to array order); only the
// branch entry and the two lanes that rejoin it state theirs explicitly, matching the pattern used
// on burg_falkenwacht and the Eiffel Tower.

const ORBITAL_SHIPYARD_CHECKPOINTS = [
    { id: 'CP01', type: 'gate', pos: [-132.0, 40.0, 110.0], radius: 6.0, forward: [1.0, 0.0, 0.0], params: { label: 'Startbucht' } },
    { id: 'CP02', type: 'gate', pos: [-95.0, 30.0, 95.0], radius: 5.5, forward: [0.9, -0.25, -0.35], params: { label: 'Gerüst unten' } },
    { id: 'CP03', type: 'gate', pos: [-65.0, 58.0, 75.0], radius: 5.0, forward: [0.7, 0.6, -0.4], params: { label: 'Gerüst oben' } },
    { id: 'CP04', type: 'gate', pos: [-35.0, 45.0, 50.0], radius: 5.5, forward: [0.8, -0.3, -0.5], params: { label: 'Kranfeld' } },
    { id: 'CP05', type: 'gate', pos: [20.0, 45.0, 78.0], radius: 7.0, forward: [0.707, 0.0, -0.707], params: { label: 'Rumpfbug' } },
    { id: 'CP06', type: 'gate', pos: [30.0, 38.0, 20.0], radius: 5.5, forward: [0.0, 0.0, -1.0], params: { label: 'Rippenhalle' } },
    { id: 'CP07', type: 'gate', pos: [30.0, 30.0, -40.0], radius: 5.0, forward: [0.0, -0.1, -1.0], params: { label: 'Kiel' } },
    // The split sits high behind the stern so both lanes stay straight: the lock lane dips under
    // the front edge of the hall roof, the duct lane passes over it into the duct on that roof.
    {
        id: 'CP08', type: 'branch_entry', pos: [30.0, 66.0, -118.0], radius: 6.0, forward: [0.0, 0.45, -0.9],
        nextIds: ['CP09_LOCK', 'CP09_DUCT'], params: { label: 'Heck' },
    },
    { id: 'CP09_LOCK', type: 'gate', pos: [87.0, 45.0, -110.0], radius: 5.0, forward: [1.0, 0.0, 0.0], nextIds: ['CP10'], params: { label: 'Schleuse' } },
    { id: 'CP09_DUCT', type: 'gate', pos: [90.0, 80.0, -110.0], radius: 5.0, forward: [1.0, 0.0, 0.0], nextIds: ['CP10'], params: { label: 'Wartungsschacht' } },
    // Far enough east that the two lanes still pass either side of the roof's back edge.
    { id: 'CP10', type: 'gate', pos: [174.0, 63.0, -110.0], radius: 5.0, forward: [0.8, 0.0, 0.6], params: { label: 'Schleusenausgang' } },
    { id: 'CP11', type: 'gate', pos: [158.0, 62.0, -20.0], radius: 6.0, forward: [0.0, 0.2, 1.0], params: { label: 'Dockturm Ost' } },
    { id: 'CP12', type: 'gate', pos: [125.0, 82.0, 20.0], radius: 6.0, forward: [-1.0, 0.3, 0.0], params: { label: 'Dockturm Nord' } },
    { id: 'CP13', type: 'gate', pos: [92.0, 112.0, -15.0], radius: 6.0, forward: [0.0, 0.3, -1.0], params: { label: 'Über dem Rotor' } },
    { id: 'CP14', type: 'gate', pos: [125.0, 142.0, -15.0], radius: 7.0, forward: [0.0, 1.0, 0.0], params: { label: 'Turmspitze' } },
    { id: 'CP15', type: 'gate', pos: [160.0, 85.0, 45.0], radius: 6.0, forward: [0.3, -0.6, 0.75], params: { label: 'Sturzflug' } },
    { id: 'CP16', type: 'gate', pos: [158.0, 35.0, 115.0], radius: 6.0, forward: [-0.4, -0.5, 0.77], params: { label: 'Canyon-Einfahrt' } },
    { id: 'CP17', type: 'gate', pos: [128.0, 30.0, 115.0], radius: 5.5, forward: [-1.0, 0.0, 0.0], params: { label: 'Kolben 1' } },
    { id: 'CP18', type: 'gate', pos: [102.0, 30.0, 115.0], radius: 5.5, forward: [-1.0, 0.0, 0.0], params: { label: 'Kolben 2' } },
];

const ORBITAL_SHIPYARD_FINISH = {
    id: 'FINISH', type: 'finish', pos: [66.0, 35.0, 115.0], radius: 7.5, forward: [-1.0, 0.0, 0.0],
};

// Copied from the Eiffel Tower: the same ordered-route rules apply to every GLB parcours map in
// the pack, this one included.
const ORBITAL_SHIPYARD_PARCOURS_RULES = {
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

export { ORBITAL_SHIPYARD_CHECKPOINTS, ORBITAL_SHIPYARD_FINISH, ORBITAL_SHIPYARD_PARCOURS_RULES };
