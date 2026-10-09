# Eigene Partie aufnehmen

Im Projektordner `Marketing-Aufnahme.cmd` öffnen. Im Spielfenster **Ich allein**
oder **Zwei am selben Rechner** wählen und die Zahl der Bots einstellen.
Mit **Spieleinstellungen anzeigen** lassen sich vorher Karte, Schwierigkeit und
Steuerung im normalen Menü einstellen. Anschließend über **Marketingaufnahme
einrichten** zurückkehren und die tatsächlichen Teilnehmer bestätigen.

**Aufnahme und Partie starten** beginnt eine normale Kampfpartie. Die kleine
Anzeige bestätigt die Aufnahme. Danach selbst spielen; F8/F9 sind nicht nötig.
Menüs, Pausen und weitere Partien bleiben in derselben Originalaufnahme.
Beim normalen Schließen des Spielfensters beginnt die lokale Nachbearbeitung.
Der Starter muss bis zu deren Abschluss laufen; Codex braucht nicht offen zu sein.

Aufnahmen liegen unter `%USERPROFILE%\Videos\CurviosClash`. Jede Sitzung erhält
einen eigenen Ordner. In dessen `production-…`-Unterordner erklärt `ERGEBNIS.txt`
das Ergebnis. Der Starter öffnet diesen Ordner nach der Nachbearbeitung.
Geeignete Kandidaten enthalten `video.mp4`, `cover.png`,
`captions.srt` und `review.json` mit Ereignisbelegen und offenen Sichtprüfungen.
Es werden höchstens drei chronologische Videos à 28 Sekunden erzeugt.

Es gibt **keine Modellaufrufe und keine automatische Veröffentlichung**.
Solo-Partien werden als Mensch gegen Bots gekennzeichnet. Ohne passende Handlung
entsteht eine begründete Ablehnung. Insbesondere braucht jeder Clip mindestens
120 Sekunden aktive Spielzeit derselben Runde davor, gegenseitigen Schaden,
eine Itemaufnahme, eine erfolgreich abgefeuerte Rakete, einen Wechsel des
Gesundheitsvorteils und eine dem Gegner zugeordnete Eliminierung. Fremder Schaden,
unklare Eingabeherkunft, Pausen, verdeckte Schlüsselaktionen oder beschädigte
Quellen schließen den Kandidaten aus. Deshalb liefern kurze Probeläufe keine Shorts.

## Aufbewahrung und Wiederanlauf

`original.webm` enthält Fensterbild und Spielton. `journal.ndjson` enthält
Spielzustände, Spuränderungen, Ereignisse, spielbezogene Eingaben und Zeitbezüge.
Die Aufnahme speichert die Zustände jedes festen Simulationsschritts mit Zielrate
60 pro Sekunde. Unter Last kann die tatsächliche Rate niedriger sein; das
Originalvideo wird davon unabhängig erfasst.
Prüfsummen sichern beide Quellen. Vollständige Trailzustände werden alle fünf
Sekunden gespeichert, Änderungen dazwischen fortlaufend. Die Replay-Wiedergabe
beginnt vor dem Clip, damit frühere Zustände bereits aufgebaut sind.

Nach einem Absturz bleiben `original.webm.partial` und abgeschlossene
`segment-*.mkv` erhalten. Solche Sitzungen sind keine automatisch freigegebene
Quelle. Originale werden niemals überschrieben oder automatisch gelöscht.
Scheitert der Aufnahmestart nach dem Öffnen des Sitzungsordners, wird die Sitzung
als unvollständig geschlossen. Für einen neuen Versuch den Starter neu öffnen;
der fehlgeschlagene Ordner bleibt zur Diagnose erhalten.
Mindestens 10 GiB freier Platz sind zum Start erforderlich. Bei weniger als
1 GiB Reserve oder einer zu großen Schreibwarteschlange wird die Aufnahme als
unvollständig behandelt; die Partie kann weitergespielt werden.

Eine Nachbearbeitung lässt sich mit demselben Desktop-Build wiederholen:

```powershell
npm run marketing:process -- "C:\Users\Name\Videos\CurviosClash\session-…"
```

Jeder Versuch erhält einen neuen Ergebnisordner. Ein geänderter Build wird
abgelehnt, damit eine andere Spielversion nicht unbemerkt das Replay verändert.
Den Aufnahme-Build deshalb bis zum erfolgreichen Export behalten.

## Prüfgrenzen

Ein fertiger Kandidat trägt **needs-human-review**. Vor Veröffentlichung bleiben
der Vergleich mit dem Original, sichtbare Geschosse und Effekte, tatsächliche
Treffer-/Tonsynchronität, Lesbarkeit am Handy sowie Verständlichkeit mit und ohne
Ton zu prüfen. Geometrische Sichtlinien und gemessene Exportzeiten ersetzen diese
Bildprüfung nicht. Kurze Ereignisse zwischen den Replay-Abtastungen können fehlen.
Die Eingaben und Teilnehmerbestätigung belegen keine persönliche Identität und
können externe Betriebssystem-Makros nicht zweifelsfrei ausschließen.

Die Kurztests decken Aufnahme, Export und Ablehnung fehlerhafter Beispiele ab.
Der 90-Minuten-Dauertest prüft fortlaufende Aufnahme, Matchwechsel, Schreibpuffer
und Speicherzuwachs nach der Aufwärmphase. Er ersetzt keine Vergleichsmessung der
Spielgeschwindigkeit mit und ohne Aufnahme, keine gemessene Trefferton-Synchronität
und keine tatsächlich gespielte Abnahmepartie.

## Entwicklung

```powershell
npm run test:marketing-session
npm run build:app
node scripts/marketing/smoke-session.mjs --duo --render
node scripts/marketing/smoke-session.mjs --duo --crash
node scripts/marketing/smoke-session.mjs --duo --duration 5400
node scripts/marketing/smoke-export.mjs
```

Die Electron-Probe verwendet das gemeinsame Testschloss und eine getrennte,
ausdrücklich als `technical-test` markierte Sitzung außerhalb des Repositorys.
Sie erzeugt keinen Nachweis menschlichen Spielens.
