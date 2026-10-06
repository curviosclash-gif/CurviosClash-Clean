// The fixed playtest scenarios behind operation "scenario". Each run documents build,
// revision, pilot version, parameters (seed, map, mode), the interventions it caused and
// the game bugs it saw, and writes a report into the run folder.
import fs from 'node:fs/promises';
import path from 'node:path';
import { describeProvenance } from './playtest-provenance.mjs';
import { REPO_ROOT } from './playtest-session.mjs';
import {
    scenarioDuelAcceptance, scenarioFlightManeuvers, scenarioParcoursAcceptance, scenarioReaction,
} from './playtest-scenarios-flight.mjs';
import {
    scenarioAllMaps, scenarioEditorRoundTrip, scenarioFailureCases, scenarioHangarTestFlight, scenarioInputPaths,
    scenarioLan, scenarioMenuPauseReturn, scenarioRecordingExport, scenarioSplitscreen,
} from './playtest-scenarios-desktop.mjs';
import { scenarioArcadeRun } from './playtest-scenarios-arcade.mjs';

export const SCENARIOS = Object.freeze({
    flight_maneuvers: { description: 'Direct maneuvers (turn, climb, dive, roll, combined) with measured effect.', run: scenarioFlightManeuvers },
    reaction: { description: 'The pilot changes its commands when the goal moves or a wall is ahead.', run: scenarioReaction },
    parcours_acceptance: { description: 'Flight acceptance: 10 parcours attempts (params.map, default parcours_rift), seeds 101-110, ship1, NORMAL, max 5 min each; passed at 9/10.', run: scenarioParcoursAcceptance },
    arcade_run: { description: 'Arcade test driver: the game bot flies params.seeds (default 101-103) gauntlet runs of params.sectorCount (default 4) on params.tier, hunting map units; per sector time, damage taken, deaths, points, missions.', run: scenarioArcadeRun },
    duel_acceptance: { description: 'Flight acceptance: 10 HUNT duels vs one NORMAL bot (params.map, default standard), seeds 101-110, ship1; passed at 8/10 real wins.', run: scenarioDuelAcceptance },
    menu_pause_return: { description: 'Menu -> match -> pause -> back to the menu with clicks and keys.', run: scenarioMenuPauseReturn },
    hangar_testflight: { description: 'Hangar window: change the trail style, activate, test-fly, find the style on the ship.', run: scenarioHangarTestFlight },
    editor_roundtrip: { description: 'Map editor: build, save into the game, reopen map selection, play it, editor playtest.', run: scenarioEditorRoundTrip },
    recording_export: { description: 'F8/F9 cinematic recording, render from the menu, exported video checked for frames and duration.', run: scenarioRecordingExport },
    splitscreen: { description: 'Local splitscreen: player 1 and player 2 each steer through their own device.', run: scenarioSplitscreen },
    lan: { description: 'Real LAN with two apps: host, join, ready, start, input both ways, leave (needs open layout lan).', run: scenarioLan, layout: 'lan' },
    all_maps: { description: 'Every offered map in a fitting mode, requested vs loaded map, 15 s of pilot flight (params.maps to limit).', run: scenarioAllMaps },
    input_paths: { description: 'Real keyboard steering and a mouse click by coordinates, without the pilot.', run: scenarioInputPaths },
    failure_cases: { description: 'Missing build, renderer crash, closed window, busy lock, released keys and ended own processes.', run: scenarioFailureCases },
});

/** Runs one scenario as a job body and returns its documented result. */
export async function runScenario(run, name, context, params = {}, deps = {}) {
    const scenario = SCENARIOS[name];
    if (scenario.layout === 'lan' && run.layout !== 'lan') {
        return { status: 'blocked', scenario: name, reason: 'this scenario needs a session opened with layout "lan"' };
    }
    const session = run.sessions.get('main') || run.sessions.get('host') || null;
    const interventionsBefore = run.interventions.length;
    const startedAt = new Date();
    let result;
    try {
        result = await scenario.run(run, session, context, { ...params, ...deps });
    } catch (error) {
        if (context.signal?.aborted) result = { status: 'unclear', reason: 'cancelled before the end' };
        else result = { status: 'failed', reason: `scenario error: ${String(error?.message || error).split('\n')[0]}` };
    }
    const report = {
        scenario: name,
        params,
        startedAt: startedAt.toISOString(),
        endedAt: new Date().toISOString(),
        provenance: await describeProvenance(REPO_ROOT),
        ...result,
        interventions: run.interventions.slice(interventionsBefore),
        gameBugs: result.gameBugs || [],
    };
    const file = path.join(run.runDir, `report-${name}-${startedAt.getTime()}.json`);
    await fs.writeFile(file, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    report.reportFile = file;
    return report;
}
