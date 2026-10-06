// Proves the playtest driver still works against the current build: launch, start a
// match, let the bot pilot fly the human ship, read numbers, take a screenshot.
//   npm run build:app:test && npm run playtest:selftest
import * as D from './playtest-driver.mjs';

const lock = await D.acquireLock('playtest selftest');
let session = null;
let failures = [];
try {
    session = await D.launchApp();
    const startedAt = Date.now();
    const start = await D.startMatch(session, { map: 'standard', mode: 'HUNT', bots: 2 });
    const piloted = await D.enableAutopilot(session);
    const samples = await D.sample(session, 20_000, 1000);
    const fps = await D.measureFps(session, 3000);
    const screenshot = await D.shot(session, 'selftest_standard');
    const report = {
        start,
        piloted,
        distance: D.distanceTravelled(samples),
        deaths: D.countDeaths(samples),
        hp: samples.map((entry) => entry.hp),
        fps,
        screenshot,
        errors: await D.errorsSince(session, startedAt),
    };
    failures = [
        !start.ok && 'match did not start',
        start.mapKey !== 'standard' && `map fell back to ${start.mapKey}`,
        !piloted && 'autopilot could not be attached',
        report.distance < 50 && `ship barely moved (${report.distance})`,
        samples.every((entry) => entry.hp == null) && 'health was never readable',
        report.errors.length > 0 && `${report.errors.length} console errors`,
    ].filter(Boolean);
    report.failures = failures;
    console.log(JSON.stringify(report, null, 2));
    console.log(`[playtest] report ${await D.saveJson('selftest', report)}`);
} finally {
    await D.closeApp(session);
    lock.release();
}
process.exit(failures.length > 0 ? 1 : 0);
