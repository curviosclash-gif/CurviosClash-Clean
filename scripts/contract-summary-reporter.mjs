import path from 'node:path';

// Die Spec-Ausgabe ist eine Textwand fuer Menschen. Agenten und CI brauchen Zahlen,
// die niemand aus ANSI-Text zurueckrechnen muss: dieser Reporter sammelt die
// Datei-Zusammenfassungen des Node-Testrunners und schreibt eine einzige JSON-Datei.
// Die Wurzel-Zusammenfassung erkennt man daran, dass sie zu keiner Datei gehoert.
function toCount(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

// Node reports absolute file paths; the list is meant to be read next to the repo, so the
// paths are shortened to repo-relative ones with forward slashes. A file outside the repo
// keeps its absolute path - a "../../.." chain would be harder to read, not easier.
// failingFiles deliberately stays as Node reports it (absolute); that field predates this list.
function toRepoRelativeFile(file, rootDirectory) {
    const relative = path.relative(rootDirectory, file);
    const usable = relative && !relative.startsWith('..') && !path.isAbsolute(relative);
    return (usable ? relative : file).replace(/\\/g, '/');
}

export default async function* contractSummaryReporter(source, { rootDirectory = process.cwd() } = {}) {
    const failingFiles = [];
    // Files are keyed by their reported path, so a file that reports twice is listed once
    // with its latest numbers.
    const fileSummaries = new Map();
    let rootSummary = null;

    for await (const event of source) {
        if (event?.type !== 'test:summary') continue;
        const file = event.data?.file;
        if (!file) {
            rootSummary = event.data;
            continue;
        }
        if (event.data?.success === false && !failingFiles.includes(file)) {
            failingFiles.push(file);
        }
        const counts = event.data?.counts || {};
        const durationMs = Number(event.data?.duration_ms);
        fileSummaries.set(file, {
            file: toRepoRelativeFile(file, rootDirectory),
            // A file that kills its own process (or gets cut off by --test-force-exit) sends
            // no summary at all and is therefore simply absent here; its tests still show up
            // in the run totals. A summary without a usable duration keeps null instead of a
            // made up zero, so it never pretends to be the fastest file of the run.
            duration_ms: Number.isFinite(durationMs) ? durationMs : null,
            pass: toCount(counts.passed),
            fail: toCount(counts.failed),
            skipped: toCount(counts.skipped),
        });
    }

    const counts = rootSummary?.counts || {};
    const files = [...fileSummaries.values()]
        .sort((left, right) => (right.duration_ms ?? -1) - (left.duration_ms ?? -1));
    yield `${JSON.stringify({
        tests: toCount(counts.tests),
        pass: toCount(counts.passed),
        fail: toCount(counts.failed),
        skipped: toCount(counts.skipped),
        todo: toCount(counts.todo),
        duration_ms: toCount(rootSummary?.duration_ms),
        success: rootSummary?.success === true,
        failingFiles,
        files,
        recordedAt: new Date().toISOString(),
    }, null, 2)}\n`;
}
