// ============================================
// telemetry-report-reader.cjs - reads the round history inside Electron
// ============================================
//
// IndexedDB laesst sich nur aus einem Browser lesen, und nur von derselben
// Herkunft (Adresse samt Port), unter der sie geschrieben wurde - die Herkunft
// steckt auch in der Datenbank selbst, eine umbenannte Kopie bleibt leer.
// Dieses Skript startet Electron mit einer Kopie des Profils und beantwortet
// die Adresse intern (protocol.handle): so klappt das Auslesen auch, waehrend
// das Spiel laeuft und den Port selbst belegt.
// Aufgerufen von scripts/telemetry-report.mjs, nie direkt.

const fs = require('node:fs');
const { app, BrowserWindow, session } = require('electron');

const profileDir = String(process.env.TELEMETRY_REPORT_PROFILE || '');
const port = Number(process.env.TELEMETRY_REPORT_PORT);
const outFile = String(process.env.TELEMETRY_REPORT_OUT || '');

const READ_SCRIPT = `(async () => {
    const openDb = () => new Promise((resolve, reject) => {
        const request = indexedDB.open('cuviosclash-telemetry');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    const db = await openDb();
    if (!db.objectStoreNames.contains('rounds')) return '[]';
    const rows = await new Promise((resolve, reject) => {
        const request = db.transaction('rounds', 'readonly').objectStore('rounds').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    db.close();
    return JSON.stringify(rows);
})()`;

function fail(message) {
    process.stderr.write(`[telemetry-report] ${message}\n`);
    app.exit(1);
}

app.setPath('userData', profileDir);

app.whenReady().then(async () => {
    // Kein Netzwerk: jede http-Anfrage dieser Sitzung bekommt eine leere Seite.
    session.defaultSession.protocol.handle('http', () => new Response(
        '<!doctype html><title>telemetry</title>',
        { headers: { 'content-type': 'text/html' } }
    ));
    const window = new BrowserWindow({ show: false });
    try {
        await window.loadURL(`http://127.0.0.1:${port}/`);
        fs.writeFileSync(outFile, await window.webContents.executeJavaScript(READ_SCRIPT));
    } catch (error) {
        fail(`Auslesen fehlgeschlagen: ${error.message}`);
        return;
    } finally {
        window.destroy();
    }
    app.exit(0);
}).catch((error) => fail(error.message));
