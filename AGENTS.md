# AGENTS.md

1. Erhalte Spielgefühl, Modi und Desktop-Funktionen; vereinfache keine produktive Logik ohne konkreten Auftrag.
2. Behandle `src/`, `assets/`, `electron/`, `server/`, `editor/` und das Vehicle Lab als Produktbestand.
3. Baue Desktop zuerst; Browser und Mobile dürfen danach separat geprüft werden.
4. Ändere Physik, Kamera, Bots, Netzwerk oder Speicherformate nur mit passenden Tests.
5. Lege keine Secrets, Spielstände, Builds, Logs oder Abhängigkeiten im Repository ab.
6. Nutze vorhandene Contracts und Runtime-Grenzen, bevor du neue globale Zugriffe einführst.
7. Halte Render- und Update-Schleifen allokationsarm und räume Ressourcen beim Neustart auf.
8. Führe vor einem Commit mindestens die kleinsten betroffenen Tests und den passenden Build aus.
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

17. Verstehe für jede Coding-Aufgabe zuerst den vollständigen betroffenen Ablauf und wähle danach die kleinste tragfähige Änderung nach YAGNI, Wiederverwendung, Standardbibliothek, nativen Plattformfunktionen und bereits installierten Abhängigkeiten; behebe Bugs an der gemeinsamen Ursache und vereinfache niemals Validierung, Schutz vor Datenverlust, Sicherheit, Barrierefreiheit oder ausdrücklich verlangtes Verhalten.
18. Ergänze bei nicht-trivialen Commits einen knappen Body mit Motivation (`Why:`) und ausgeführter Verifikation (`Tests:`); wiederhole weder Betreff noch Diff. Bei trivialen Dokumentations- und Konfigurationsänderungen darf der Body entfallen.

## Council

19. Nutze die Council-Agenten (`@council-review`, `@council-arch`, `@council-sec`, `@council-perf`, `@council-test`, `@council-refactor`, `@council-lead`) fuer Analyse-, Review-, Planungs- und Brainstorming-Aufgaben. Jeder Fach-Agent hat vier parallele Geschwister (`<name>-fb`, `<name>-fb2`, `<name>-fb3`, `<name>-fb4`) mit jeweils einem anderen kostenlosen Modell — alle fünf erhalten denselben Prompt und werden parallel gestartet (5x-Run). Alle arbeiten mit kostenlosen Modellen; nur `@council-lead` nutzt ein Premium-Modell.
20. Bei Code-Aenderungen: zuerst den `plan`-Agent fuer den Plan, dann die Fach-Agenten (jeweils 5 parallel: `council-review` + `council-review-fb` + `council-review-fb2` + `council-review-fb3` + `council-review-fb4`, analog fuer arch, perf, sec, test, refactor) mit identischem Prompt, abschliessend `@council-lead` zur Konsolidierung aller Ergebnisse. Das Hauptmodell nur fuer die eigentliche Umsetzung einsetzen.
21. Bei reinen Analysen (ohne Code-Aenderungen) ausschliesslich Council-Agenten nutzen; das Hauptmodell nicht belasten.
22. Council-Agenten sind read-only (`edit: deny`, `bash: deny`, `task: deny`) — sie analysieren und empfehlen, aendern aber keinen Code. Diese Einschraenkungen sind in `.opencode/agents/council-*.md` konfiguriert und technisch durchgesetzt.
23. Das Hauptmodell ruft passende Council-Agenten automatisch und nicht-interaktiv aus dem Repository-Root mit `opencode run --agent <council-agent> "<konkreter Read-only-Auftrag>"` auf; eine erneute Nutzerfreigabe ist dafuer nicht erforderlich.
24. Waehle nur fuer die Aufgabe relevante Fach-Agenten: `council-sec` bei Sicherheits- oder Vertrauensgrenzen, `council-test` bei Tests und Regressionen, `council-refactor` bei Strukturarbeit; starte kein Voll-Council fuer triviale Aufgaben.
25. Jeder Fach-Agent wird GEMEINSAM mit seinen vier Geschwister-Agenten und identischem Prompt parallel gestartet (5x-Run). Die fünf Ergebnisse werden an `@council-lead` uebergeben, der Duplikate konsolidiert, Abweichungen zwischen den Modellen kennzeichnet und die Severity normalisiert: 🔴 = Crash/Datenverlust/falsches Spielverhalten, 🟠 = logischer Fehler/Ressourcen-Leak, 🟡 = Code-Stil/Wartbarkeit/Defensive-Luecke. Begruende Abweichungen von der Modell-Bewertung ausdruecklich. Council-Auftraege duerfen keine weiteren Council-Agenten starten. Keine Endlosschleifen.
26. Nach der Lead-Konsolidierung MUSS `@council-verify` mit allen 🔴-Findings gestartet werden. Der Verify-Agent liest die betroffenen Dateien und bestaetigt oder widerlegt jedes Finding (TRUE/FALSE/UNCERTAIN). Nur bestaetigte Findings duerfen in den finalen Report. Bei UNCERTAIN: im Report als "nicht verifizierbar" kennzeichnen.

## Coding Council

27. Der Coding Council (`council-code-*`) ist die implementierende Variante des Councils. Anders als die read-only Council-Agenten haben Coding-Council-Agenten Schreibrechte (`edit: allow`, `bash: allow`, `task: allow`) und setzen Änderungen direkt um. Der Coding Council verwendet KEINE fb-Geschwister (keine 5x-Parallel-Review), weil parallel schreibende Agenten auf denselben Dateien zu Merge-Konflikten fuehren wuerden und kostenlose Modelle fuer Code-Implementierung ungeeignet sind.
28. Coding-Council-Agenten sind: `council-code-arch`, `council-code-perf`, `council-code-refactor`, `council-code-review`, `council-code-sec`, `council-code-test`. Jeder ist auf einen Implementierungsaspekt spezialisiert.
29. Der Coding-Council-Ablauf: (1) `plan`-Agent fuer den Plan, (2) relevante Coding-Council-Agenten parallel mit identischem Prompt + Plan starten — jeder implementiert seinen Aspekt selbständig, (3) Ergebnisse an `council-lead` zur Konsolidierung und Konflikterkennung, (4) `council-verify` mit 🔴-Findings, (5) Hauptmodell praesentiert den konsolidierten Report.
30. Nutze den Coding Council nur fuer komplexe, mehrdimensionale Implementierungsaufgaben. Fuer einfache Aenderungen direkt das Hauptmodell verwenden.
31. Der `code-council`-Command orchestriert den vollständigen Durchlauf mit allen 6 Coding-Agenten parallel. Bei gezielten Aufgaben nur die relevanten Agenten starten.
32. Coding-Council-Agenten arbeiten auf denselben Dateien — der Lead erkennt und meldet Merge-Konflikte. Bei echten Konflikten entscheidet das Hauptmodell.
33. Vor einem Commit prueft das Hauptmodell alle Coding-Council-Aenderungen auf Konsistenz, fuehrt betroffene Tests aus und erstellt EINEN atomaren Commit mit allen Coding-Council-Beitraegen.
