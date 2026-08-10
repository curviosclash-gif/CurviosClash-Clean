// Der eingebaute Coverage-Report ist eine Tabelle fuer Menschen. Fuer den Ratchet
// braucht es Zahlen, die nicht aus Spaltenbreiten zurueckgerechnet werden muessen,
// deshalb schreibt dieser Reporter das Summary-Ereignis unveraendert als JSON.
export default async function* coverageSummaryReporter(source) {
    for await (const event of source) {
        if (event.type !== 'test:coverage') continue;
        yield `${JSON.stringify(event.data.summary)}\n`;
    }
}
