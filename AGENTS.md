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
17. Lösche KEINE untracked-Dateien ohne explizite Nutzerfreigabe. Bei `git status`-Bereinigung: zuerst Nutzer fragen, welche untracked-Dateien entfernt werden sollen. Nach Freigabe verschiebe die betroffenen Dateien zuerst in einen benannten Ordner unter `$env:TEMP\opencode-trash\`, damit sie wiederhergestellt werden können. Beschreibe `Remove-Item` nicht als Papierkorb-Aktion und verwende niemals dessen `-Force`-Flag.
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
26. Höchstens drei Sitzungen arbeiten standardmäßig gleichzeitig an diesem Repository. Prüfe vor Beginn einer schreibenden Aufgabe mit `git worktree list` und dem Playwright-Schloss, wie viele Arbeiten schon laufen. Sind es bereits drei, frage den Nutzer vor dem Start einer weiteren Sitzung ausdrücklich um Zustimmung und starte sie nur nach dieser Zustimmung. Starte Subagenten mit einer festen Obergrenze, nie „so viele wie möglich".
27. Jede schreibende Aufgabe läuft in einem eigenen Worktree unter `.claude/worktrees/<name>` auf einem eigenen Branch. Der Hauptordner ist dem Zusammenführen und Kleinständerungen an einer einzelnen Datei vorbehalten. Lesende Aufgaben (Analyse, Planung) dürfen im Hauptordner laufen.
28. Eine Aufgabe ist erst fertig, wenn sie committet, in den Hauptbranch gemergt, ihr Worktree entfernt und der Hauptbranch gepusht ist. Löse vor dem Entfernen eines Worktrees zuerst dessen `node_modules`-Verknüpfungen (Junctions), damit das Löschen nicht in den Hauptordner durchgreift. Bleibt etwas davon offen, nenne es im Abschlussbericht ausdrücklich als offen.
29. Merge am Ende der Aufgabe selbstständig in den Hauptbranch, wenn es gefahrlos möglich ist. Gefahrlos heißt: Stufe 1 und die für den Bereich verlangte Stufe 2 sind grün, ein Probe-Merge (`git merge-tree --write-tree`) ist konfliktfrei, der Hauptordner enthält keine fremden uncommitteten Änderungen an denselben Dateien, und es läuft keine fremde Messung, die der Merge verfälschen würde. Ist eine Bedingung nicht erfüllt, merge nicht, sondern melde, was im Weg steht.

## Claude-Agenten

30. Claude-Agenten, Claude-Code-Subagenten und Delegationen an Anthropic-Modelle dürfen nur gestartet, fortgesetzt oder anderweitig genutzt werden, wenn die aktuelle Nutzeranweisung in der ersten Zeile exakt `CLAUDE-AGENT-FREIGABE: 3141` enthält. Der Hook `.claude/hooks/claude-agent-lock.mjs` schützt Claude-interne Agentenaufrufe mit einer sitzungs- und projektgebundenen Einmal-Freigabe für höchstens zwei Minuten; er prüft keine Aufrufe des Codex-Helfers. Jeder weitere oder fortgesetzte Agent-Aufruf benötigt eine neue Freigabe; frühere oder allgemeine Freigaben, indirekte Delegationswünsche und automatische Modellwahl gelten nicht.
