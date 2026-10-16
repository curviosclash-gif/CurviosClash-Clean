import { writeFile } from 'node:fs/promises';

const PROFILE_NAME = 'k19-first-target-cpu-profile.json';

function withinDeadline(promise, timeoutMs, operation) {
    let timer;
    const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${operation} exceeded ${timeoutMs}ms`)), timeoutMs);
    });
    return Promise.race([Promise.resolve(promise), deadline]).finally(() => clearTimeout(timer));
}

function reportUnavailable(report, reason, error) {
    report(`K19_TARGET_DIAGNOSTIC ${JSON.stringify({
        phase: 'cdp-profile-unavailable',
        reason,
        detail: String(error?.message || error),
    })}`);
}

async function detachWithinDeadline(session, timeoutMs) {
    if (typeof session?.detach !== 'function') return;
    try {
        await withinDeadline(Promise.resolve().then(() => session.detach()), timeoutMs, 'Profiler.detach');
    } catch {
        // DevTools teardown is best-effort and may itself be queued behind a blocked renderer.
    }
}

/** Run one real target while collecting a bounded, best-effort renderer CPU profile. */
export async function runK19TargetWithCpuProfile({
    page,
    testInfo,
    runTarget,
    captureMs = 15_000,
    commandTimeoutMs = 1_000,
    report = console.info,
    saveProfile = (path, contents) => writeFile(path, contents),
}) {
    let session;
    let sessionRequest;
    try {
        sessionRequest = Promise.resolve().then(() => page.context().newCDPSession(page));
        session = await withinDeadline(sessionRequest, commandTimeoutMs, 'Profiler session setup');
        await withinDeadline(session.send('Profiler.enable'), commandTimeoutMs, 'Profiler.enable');
        await withinDeadline(session.send('Profiler.start'), commandTimeoutMs, 'Profiler.start');
    } catch (error) {
        if (!session && sessionRequest) {
            // If newCDPSession resolves after its deadline, close the late session without blocking
            // the target or leaving a rejected cleanup promise unobserved.
            sessionRequest.then((lateSession) => { void detachWithinDeadline(lateSession, commandTimeoutMs); }, () => {});
        }
        await detachWithinDeadline(session, commandTimeoutMs);
        report(`K19_TARGET_DIAGNOSTIC ${JSON.stringify({
            phase: 'cdp-unavailable',
            reason: String(error?.message || error),
        })}`);
        return runTarget();
    }

    let stopPromise;
    const stopProfile = (reason) => {
        if (stopPromise) return stopPromise;
        stopPromise = (async () => {
            try {
                const { profile } = await withinDeadline(
                    session.send('Profiler.stop'), commandTimeoutMs, 'Profiler.stop',
                );
                const outputPath = testInfo.outputPath(PROFILE_NAME);
                await saveProfile(outputPath, JSON.stringify({ reason, profile }));
                report(`K19_TARGET_DIAGNOSTIC ${JSON.stringify({ phase: 'cdp-profile-saved', reason, outputPath })}`);
            } catch (error) {
                reportUnavailable(report, reason, error);
            } finally {
                await detachWithinDeadline(session, commandTimeoutMs);
            }
        })();
        return stopPromise;
    };

    const timer = setTimeout(() => { void stopProfile('15-second-cap'); }, captureMs);
    try {
        return await runTarget();
    } finally {
        clearTimeout(timer);
        await stopProfile('target-complete');
    }
}
