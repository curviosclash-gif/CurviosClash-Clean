// Die Spec-Ausgabe ist eine Textwand fuer Menschen. Agenten und CI brauchen Zahlen,
// die niemand aus ANSI-Text zurueckrechnen muss: dieser Reporter sammelt die
// Datei-Zusammenfassungen des Node-Testrunners und schreibt eine einzige JSON-Datei.
// Die Wurzel-Zusammenfassung erkennt man daran, dass sie zu keiner Datei gehoert.
function toCount(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

export default async function* contractSummaryReporter(source) {
    const failingFiles = [];
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
    }

    const counts = rootSummary?.counts || {};
    yield `${JSON.stringify({
        tests: toCount(counts.tests),
        pass: toCount(counts.passed),
        fail: toCount(counts.failed),
        skipped: toCount(counts.skipped),
        todo: toCount(counts.todo),
        duration_ms: toCount(rootSummary?.duration_ms),
        success: rootSummary?.success === true,
        failingFiles,
        recordedAt: new Date().toISOString(),
    }, null, 2)}\n`;
}
