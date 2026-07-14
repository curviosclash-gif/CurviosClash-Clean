# Migrationsbericht: CurviosClash Clean

Stand: 14. Juli 2026

## Ausgangspunkt und Nachvollziehbarkeit

Das neue Repository wurde ohne Git-Remote als eigenständige Produktbasis angelegt. Ausgangspunkt war der Commit `0532a9d8aca7dccfb015c4305e19b1fa4d54cc53` des alten Repositories `CurviosCLash`. Der Root-Commit `d9bfc59` des neuen Repositories hält diese Herkunft fest. Ein Vergleich der Ausgangsstände ergab 1.100 byte-identische Produktdateien; abweichende Dateien betreffen die bewusst bereinigte Repository-Hülle und nachfolgend dokumentierte Produktänderungen.

Das alte Repository diente während der Migration ausschließlich als Lesequelle. Sein Git-Status, der Hash des Arbeitsverzeichnis-Diffs, der Hash des Index-Diffs sowie die Metadaten von `.git/HEAD` und `.git/index` wurden vor der Abschlussarbeit als Vergleichsbasis erfasst und werden nach allen Prüfungen erneut kontrolliert.

## Übernommene ungespeicherte Produktänderungen

Von 16 Status-Einträgen im alten Arbeitsverzeichnis wurden 14 Produkt- und Teständerungen byte-identisch in das neue Repository übernommen:

- `1380e7b` (`fix: bind arcade persistence timers`): korrigierte Timer-Bindung des Arcade-Persistenz-Schedulers und zugehöriger Contract-Test.
- `9572f64` (`fix: harden heuristic bot survival`): Runtime-Kontext, Policy/Ops, neue Safety-Ops und Regressionstest für den heuristischen Bot.
- `60e83a9` (`test: strengthen bot runtime validation`): Bot-Spielanalyse, Bot-Validierung, reale Bot-Todes- und Rundenmetriken sowie zugehörige Tests. Die darin enthaltenen Entwicklerwerkzeuge wurden bei der späteren Produkttrennung nach `dev/training/` verschoben; produktive Recorder-Logik blieb in `src/`.

Damit bleiben die funktionalen Korrekturen für Arcade-Persistenz, Bot-Überleben und Rundenmetriken erhalten. Die Übernahme wurde über Dateihashes geprüft, nicht nur über Dateinamen oder Diff-Anzeige.

Bewusst nicht direkt übernommen wurden:

- `docs/bot-training/Bot_Trainingsplan.md`: Plan-, Status- und Evidenztext des alten Governance-Systems, keine Spiel- oder Bot-Runtimelogik.
- Ein lokaler Browser-Demo-Export mit absoluten, rechnergebundenen Temporärpfaden. Stattdessen wurde die Browser-Demo in `6a11db7` aus den produktiven Quellen neu und portabel erzeugt.

## Entfernte Repository-Strukturen

Nicht in das neue Produktrepository übernommen wurden die Agenten-Governance des alten Repositories (45 Dateien), Plan-/Status-/Evidenzbestände (410 Dateien), Knowledge-Graph- und RAG-Bestände (23 Dateien), Agenten-Locks, Gates, Council-/Pre-Commit-Automatisierung, Planarchive sowie sechs sonstige Root-Archive. Diese Strukturen steuern Entwicklungsvorgänge, sind aber weder für Spiel, Bots noch für einen Spielmodus erforderlich.

Das Powerup Lab wurde ebenfalls entfernt. Seine eigene Prototyp-Dokumentation kennzeichnete es als nicht in die Spielruntime integriert. Aus den Varianten „Next“ oder „GameOnly“ wurden keine Komponenten übernommen. Das Windows-Icon wurde eigenständig aus geometrischen Formen erstellt; Herkunft und editierbare Quelle liegen unter `assets/branding/`.

## Trennung von Bot-Runtime, Inferenz und Training

Die Bereinigung folgt drei klaren Schichten:

1. **Produktive Botlogik:** Bot-Entitäten, Sensorik, Aktions-Ops, regelbasierte/heuristische/Hunt-Policies, Runtime-Kontext, Beobachtungen, Registry und die für Spielmodi benötigten Bridge-Policies verbleiben in `src/`. Namen wie „Bridge“ waren kein Löschkriterium; entscheidend war ihre tatsächliche Rolle im normalen Spiel.
2. **Optionale KI-Inferenz:** Lokale DQN-Inferenz, Checkpoint-Vokabular und eine auf Aktionsantworten begrenzte WebSocket-Inferenzschnittstelle bleiben produktiv. Diese Schnittstelle nimmt Beobachtungen entgegen und liefert Aktionen, bietet aber keine Trainings-, Batch-, Gate- oder Checkpoint-Management-Befehle an.
3. **Entwickler-Training:** Training-Controller, Reward-/Episode-Logik, Batch- und Benchmark-Läufe, Evaluation, Gates, Promotion, Trainer-Bridge, Bot-Validierung, Analyse-Skripte und zugehörige Tests liegen getrennt unter `dev/training/`. Sie sind nicht an den normalen Startpfad gebunden und werden nicht in das Electron-Produktpaket kopiert.

Die Entwickler-Training-Oberfläche und ihre Bedienelemente wurden aus dem Produktions-HTML und den Menülaufzeiten entfernt. Produktions-Build und Paketprüfung enthalten zusätzliche Negativprüfungen: kein `training-*`-/`trainer-*`-/`validation-*`-Bundle, keine Trainingsbedienelemente und keine Training-Quellen im Paket. Für Playwright darf die Testbrücke Validierungsdienste ausschließlich aus `dev/training/` nachladen; dies ist kein Produktionspfad.

## Behaltene und entfernte Produktbereiche

| Bereich | Entscheidung | Begründung |
| --- | --- | --- |
| Android | Behalten | Die Capacitor-Ziele `android/` und `android-classic/` bilden funktionale Mobile-Varianten und besitzen eigene Contracts. Sie sind Produktcode, auch wenn Desktop der primäre Release-Pfad ist. |
| Editor | Behalten | Der Editor ist über Menü und Startpfade erreichbar, wird in den Desktop-Flows geprüft und dient der produktiven Karten-/Inhaltserstellung. |
| Vehicle Lab | Behalten | `prototypes/vehicle-lab/` ist trotz des historischen Verzeichnisnamens in Menü, Runtime und Tests eingebunden und damit ein produktives Autorenwerkzeug. |
| Settings Studio | Behalten | Das Studio ist ein separat gestarteter Bestandteil derselben Desktop-Anwendung (`--settings-studio`) und bearbeitet die produktiven Einstellungen mit getrenntem Chromium-Profil. |
| Browser-Demo | Behalten | Die Browser-Demo ist eine bewusst eingeschränkte, getestete Produktoberfläche. Nur der host-spezifische Export wurde verworfen und portabel neu erzeugt. |
| Powerup Lab | Entfernt | Isolierter, laut eigener Dokumentation nicht integrierter Prototyp ohne benötigten Runtime-Pfad. |
| Entwickler-Training | Aus dem Produkt entfernt | Werkzeuge bleiben bei Bedarf unter `dev/training/`, sind aber weder Teil des normalen Starts noch des ausgelieferten Pakets. |

## Abhängigkeiten

Root, Electron und Signaling-Server verwenden gesperrte Lockfiles. Die Prüfung umfasst `npm ls` sowie `npm audit` in allen drei Bereichen.

`mp4-muxer@5.2.2` ist die letzte Version seiner Linie, aber upstream als veraltet markiert. Der empfohlene Nachfolger ist [Mediabunny](https://github.com/Vanilagy/mediabunny); der Upstream stellt einen [Migrationsleitfaden](https://github.com/Vanilagy/mp4-muxer/blob/main/MIGRATION-GUIDE.md) bereit. Ein Austausch wäre kein risikoloses Paketupdate: Die bestehende synchrone `VideoEncoder`-Callback-Kette müsste auf asynchrone `Output`-/`Mp4OutputFormat`-/`BufferTarget`- und Packet-Source-APIs einschließlich Backpressure umgestellt werden. Zudem muss die Lizenzwirkung des Nachfolgers geprüft werden. Da Recording funktionsfähig bleiben muss, erfolgt kein blindes Hauptversions-Upgrade. Die kontrollierte Mediabunny-Migration bleibt als begründete technische Schuld bestehen und benötigt eigene Recording-Contract-, Lifecycle- und Desktop-Exporttests.

## Abschlussprüfungen

| Prüfung | Status | Nachweis/Zweck |
| --- | --- | --- |
| `npm run quality` | Bestanden | Lint, Typprüfung, Architekturgrenzen und 593/593 Produkt-/Runtime-Contracts; der darin enthaltene App-Build bestand die Trainingsgrenze. |
| `npm run test:desktop:smoke` | Bestanden | 3/3: Desktop-Start, Matchstart/Eingabe/Rückkehr ins Menü und Graceful-Close nach Remount. |
| `npm run test:desktop:e2e` | Bestanden | 151 bestanden, 2 begründete Skips, 0 Fehler. Äußeres Zeitbudget: 20 Minuten; regulärer Abschluss nach rund 4:42 Minuten ohne vorzeitigen Abbruch. |
| Entwickler-Training | Bestanden | `npm run test:dev:training`: 23/23; zusätzlich Headless-Match-Kernel-Smoke erfolgreich. |
| Produktions-Build | Bestanden | `npm run build` und der App-Build aus `npm run app:package`; jeweils 575 Module und 36 Dateien durch die Trainingsgrenze geprüft, kein Trainings-/Trainer-Bundle. |
| Windows-Paket und Paketprüfung | Bestanden | Frischer NSIS-Installer (122.783.059 Bytes) und `win-unpacked` (277 Dateien, 452.166.086 Bytes); Spiel, Settings Studio, IPC, parallele Fenster und fehlende Trainingsartefakte geprüft. |
| `START_CURVIOSCLASH.cmd` | Bestanden | Exitcode 0; vorhandenes Paket gestartet, sichtbares Fenster `Curvios Clash` erkannt. |
| Installer und portable Anwendung | Bestanden | Installer still in isoliertes Verzeichnis installiert (Exitcode 0), installierte EXE vollständig geprüft, Uninstaller erfolgreich; portable EXE separat vollständig geprüft. |
| `npm audit` (Root/Electron/Server) | Bestanden | In allen drei gesperrten Abhängigkeitsbäumen 0 bekannte Sicherheitslücken; `npm ls` jeweils konsistent. |
| Altes Repository unverändert | Bestanden | HEAD, 16 Status-Einträge, Worktree-Diff-Hash `fdd5e48e7b32385e70f5f7fa4b188c5db1247964`, Index-Diff-Hash `d155fd5271c3531d68d0904b421ccc5f287d78bd` sowie `.git/HEAD`-/`.git/index`-Metadaten stimmen exakt mit der Eingangsbasis überein. |
| Neues Git-Arbeitsverzeichnis sauber | Bestanden | Nach den Abschluss-Commits mit `git status --short` kontrolliert; kein Remote eingerichtet. |

Die beiden E2E-Skips sind keine neu entstandenen Ausnahmen: `T20n` setzt einen im Harness nicht deterministisch verfügbaren MediaRecorder-Exportpfad voraus, und `T10g` benötigt deterministisches Editor-Disk-Map-Seeding. Recording selbst wurde durch zahlreiche WebCodecs-, MediaRecorder-, MP4-, Export- und Pakettests abgedeckt; Editor und Editor-Runtime-Pfade wurden in den übrigen E2E- und Contract-Tests geprüft.

## Bekannte Restrisiken und technische Schulden

- Die Migration von `mp4-muxer` zu Mediabunny ist wie oben beschrieben offen.
- Die optionale externe WebSocket-Inferenz benötigt für einen vollständigen Ende-zu-Ende-Test einen kompatiblen externen Inferenzdienst; die Produktgrenze selbst wird per Contract-Test geprüft.
- Android wird als Produktziel erhalten, der Abschlusslauf konzentriert sich gemäß Repository-Regel auf Desktop. Gerätespezifische Android-Tests bleiben von SDK, Emulator oder Testgerät abhängig.
- Ohne extern bereitgestelltes Signaturzertifikat ist der Windows-Installer funktionsfähig, aber unsigniert; SmartScreen-Vertrauen ist damit nicht Teil dieser Migration.
- Die unter `dev/training/` erhaltenen Werkzeuge sind bewusst keine Release-Komponente. Ihre Ausführung kann weiterhin zusätzliche lokale Trainer-/Python-Infrastruktur voraussetzen, die nicht Bestandteil dieses Repositories ist.
- Der Produktions-Build meldet weiterhin einen großen Haupt-Chunk von rund 1,53 MB vor Gzip. Das ist keine neue Regression der Migration, bleibt aber als gezielte Code-Splitting-/Startzeit-Schuld offen.
