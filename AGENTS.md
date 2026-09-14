# AGENTS.md

1. Erhalte Spielgefühl, Modi und Desktop-Funktionen; vereinfache keine produktive Logik ohne konkreten Auftrag.
2. Behandle `src/`, `assets/`, `electron/`, `server/`, `editor/` und das Vehicle Lab als Produktbestand.
3. Baue Desktop zuerst; Browser und Mobile dürfen danach separat geprüft werden.
4. Ändere Physik, Kamera, Bots, Netzwerk oder Speicherformate nur mit passenden Tests.
5. Lege keine Secrets, Spielstände, Builds, Logs oder Abhängigkeiten im Repository ab.
6. Nutze vorhandene Contracts und Runtime-Grenzen, bevor du neue globale Zugriffe einführst.
7. Halte Render- und Update-Schleifen allokationsarm und räume Ressourcen beim Neustart auf.
8. Führe vor einem Commit mindestens die kleinsten betroffenen Tests und den passenden Build aus; bei Council-Infrastruktur ist `npm run council:validate` das verpflichtende Live-Gate.
9. Automatisiere prüfbare Regeln in Tests, CI oder Konfiguration; dokumentiere nur dauerhafte Produktentscheidungen.
10. Führe keine Planarchive, Locks, Agenten-Wissensbasen, Statuskopien oder generierten Prozessberichte ein.

## Git und Commits

11. Erstelle nach einer abgeschlossenen Änderung genau einen atomaren Commit, sofern die betroffenen Tests und der passende Build erfolgreich waren.
12. Verwende Conventional Commits im Format `<type>(<scope>): <kurze englische Beschreibung>`.
13. Zulässige Typen sind `feat`, `fix`, `refactor`, `test`, `docs`, `build`, `ci`, `perf` und `chore`.
14. Stage ausschließlich Dateien der aktuellen Aufgabe und niemals pauschal mit `git add -A` oder `git add .`.
15. Übernimm keine bereits vorhandenen oder fremden Änderungen. Bei Überschneidungen erstelle keinen Commit und melde den Konflikt.
16. Ändere, squash oder rebase keine bestehenden Commits ohne ausdrücklichen Auftrag.
17. Lösche KEINE untracked-Dateien ohne explizite Nutzerfreigabe. Bei `git status`-Bereinigung: zuerst Nutzer fragen, welche untracked-Dateien entfernt werden sollen. Niemals eigenständig `Remove-Item` auf untracked-Dateien ausführen. Falls Löschung freigegeben: Dateien müssen wiederherstellbar sein (Recycle Bin via `Remove-Item` OHNE `-Force`, oder vorher nach `$env:TEMP\opencode-trash\` verschieben). Niemals `-Force`-Flag bei `Remove-Item` verwenden.
18. Räume temporäre Test-Artefakte nur nach expliziter Nutzerfreigabe auf; dokumentiere vorher was gelöscht werden soll.

## Coding

19. Verstehe für jede Coding-Aufgabe zuerst den vollständigen betroffenen Ablauf und wähle danach die kleinste tragfähige Änderung nach YAGNI, Wiederverwendung, Standardbibliothek, nativen Plattformfunktionen und bereits installierten Abhängigkeiten; behebe Bugs an der gemeinsamen Ursache und vereinfache niemals Validierung, Schutz vor Datenverlust, Sicherheit, Barrierefreiheit oder ausdrücklich verlangtes Verhalten.
20. Ergänze bei nicht-trivialen Commits einen knappen Body mit Motivation (`Why:`) und ausgeführter Verifikation (`Tests:`); wiederhole weder Betreff noch Diff. Bei trivialen Dokumentations- und Konfigurationsänderungen darf der Body entfallen.

## Council

21. Die Regeln für Council und Coding Council stehen in `.opencode/AGENTS.md`. Sie gelten ausschliesslich für die OpenCode-Agenten unter `.opencode/` und nur, wenn der Nutzer den Council für die aktuelle Aufgabe ausdrücklich anfordert. Ohne eine solche Aufforderung bearbeitet das Hauptmodell Analyse, Planung, Review und Umsetzung selbst und startet keine Council-, Coding-Council- oder `plan`-Agenten.

## Parallele Arbeit

22. In diesem Repository arbeiten mehrere Agenten gleichzeitig (mehrere Claude-Code-Sitzungen, Codex, OpenCode) im selben Arbeitsordner und auf demselben Branch. Gehe immer davon aus, dass der Arbeitsbaum fremde, gerade laufende Änderungen enthält, die nicht zu deiner Aufgabe gehören.
23. Fremde Änderungen sind unantastbar: nicht stagen, nicht committen, nicht zurücksetzen, nicht stashen, nicht formatieren. `git stash`, `git checkout -- <datei>`, `git restore` und `git reset` betreffen immer auch die Arbeit anderer Agenten und sind nur für Dateien erlaubt, die du selbst in dieser Aufgabe angelegt oder geändert hast. Eine Gegenprobe ohne eigene Änderung läuft in einem eigenen Worktree, nie durch Zurücksetzen im Hauptordner.
24. Unterscheide eigene von fremden Änderungen nachvollziehbar (z. B. über die Dateiliste der eigenen Bearbeitung und Änderungszeitpunkte), bevor du stagest. Berührt eine fremde Änderung dieselbe Datei wie deine Aufgabe, erstelle keinen Commit, sondern melde die Überschneidung (Regel 15).
25. Geteilte Ressourcen sind knapp: Nur ein Playwright-Lauf pro Rechner (das Schloss aus `scripts/playwright-run-lock.mjs` niemals abschalten), Ports und `dist-app` werden von anderen Sitzungen mitbenutzt, und Leistungsmessungen sind unter Fremdlast einer zweiten Electron-Instanz wertlos. Schlägt ein Test fehl, kläre zuerst, ob ein fremder Lauf oder eine fremde Änderung die Ursache ist, bevor du sie deiner eigenen Änderung zuschreibst.
