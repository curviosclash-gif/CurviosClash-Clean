export function configureParcoursRingProgressProviders(runtime, system, players) {
    const view = { active: false, player: null, totalCheckpoints: 0 };
    runtime?.setProgressProvider?.(() => {
        const playerIndex = system._resolveProgressPlayerIndex(system.entityManager?.players || players);
        return system.getPlayerProgressSnapshot(playerIndex);
    });
    runtime?.setGuidanceProvider?.(() => {
        const playerIndex = system._resolveProgressPlayerIndex(system.entityManager?.players || players);
        view.active = system.entityManager?.activeGameMode === 'ARCADE';
        view.player = (system.entityManager?.players || players)?.[playerIndex] || null;
        view.totalCheckpoints = system._route?.totalCheckpoints ?? 0;
        return view;
    });
}
