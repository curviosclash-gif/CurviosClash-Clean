# AGENTS.md

1. Erhalte Spielgefühl, Modi und Desktop-Funktionen; vereinfache keine produktive Logik ohne konkreten Auftrag.
2. Behandle `src/`, `assets/`, `electron/`, `server/`, `editor/` und das Vehicle Lab als Produktbestand.
3. Baue Desktop zuerst; Browser und Mobile dürfen danach separat geprüft werden.
4. Ändere Physik, Kamera, Bots, Netzwerk oder Speicherformate nur mit passenden Tests.
5. Lege keine Secrets, Spielstände, Builds, Logs oder Abhängigkeiten im Repository ab.
6. Nutze vorhandene Contracts und Runtime-Grenzen, bevor du neue globale Zugriffe einführst.
7. Halte Render- und Update-Schleifen allokationsarm und räume Ressourcen beim Neustart auf.
8. Prüfe vor Abschluss einer Änderung mindestens die kleinsten betroffenen Tests und den passenden Build; bei Council-Infrastruktur ist `npm run council:validate` das verpflichtende Live-Gate.
9. Automatisiere prüfbare Regeln in Tests, CI oder Konfiguration; dokumentiere nur dauerhafte Produktentscheidungen.
10. Führe keine Planarchive, Locks, Agenten-Wissensbasen, Statuskopien oder generierten Prozessberichte ein.



## Coding

11. Verstehe für jede Coding-Aufgabe zuerst den vollständigen betroffenen Ablauf und wähle danach die kleinste tragfähige Änderung nach YAGNI, Wiederverwendung, Standardbibliothek, nativen Plattformfunktionen und bereits installierten Abhängigkeiten; behebe Bugs an der gemeinsamen Ursache und vereinfache niemals Validierung, Schutz vor Datenverlust, Sicherheit, Barrierefreiheit oder ausdrücklich verlangtes Verhalten.

## Council

12. Die Regeln für Council und Coding Council stehen in `.opencode/AGENTS.md`. Sie gelten ausschliesslich für die OpenCode-Agenten unter `.opencode/` und nur, wenn der Nutzer den Council für die aktuelle Aufgabe ausdrücklich anfordert. Ohne eine solche Aufforderung bearbeitet das Hauptmodell Analyse, Planung, Review und Umsetzung selbst und startet keine Council-, Coding-Council- oder `plan`-Agenten.

## Parallele Arbeit

13. In diesem Repository arbeiten mehrere Agenten gleichzeitig (mehrere Claude-Code-Sitzungen, Codex, OpenCode) im selben Arbeitsordner und auf demselben Branch. Gehe immer davon aus, dass der Arbeitsbaum fremde, gerade laufende Änderungen enthält, die nicht zu deiner Aufgabe gehören.
14. Fremde Änderungen sind unantastbar: weder übernehmen noch zurücksetzen, löschen oder formatieren. Eine Gegenprobe ohne eigene Änderung läuft in einem eigenen Arbeitsverzeichnis.
15. Trenne eigene von fremden Änderungen nachvollziehbar. Berührt eine fremde Änderung dieselbe Datei wie deine Aufgabe, melde die Überschneidung.
16. Geteilte Ressourcen sind knapp: Nur ein Playwright-Lauf pro Rechner (das Schloss aus `scripts/playwright-run-lock.mjs` niemals abschalten), Ports und `dist-app` werden von anderen Sitzungen mitbenutzt, und Leistungsmessungen sind unter Fremdlast einer zweiten Electron-Instanz wertlos. Schlägt ein Test fehl, kläre zuerst, ob ein fremder Lauf oder eine fremde Änderung die Ursache ist, bevor du sie deiner eigenen Änderung zuschreibst.
17. Höchstens drei Sitzungen arbeiten standardmäßig gleichzeitig an diesem Repository. Prüfe vor Beginn einer schreibenden Aufgabe mit `git worktree list` und dem Playwright-Schloss, wie viele Arbeiten schon laufen. Sind es bereits drei, frage den Nutzer vor dem Start einer weiteren Sitzung ausdrücklich um Zustimmung und starte sie nur nach dieser Zustimmung. Starte Subagenten mit einer festen Obergrenze, nie „so viele wie möglich".
18. Jede schreibende Aufgabe läuft in einem eigenen Worktree unter `.claude/worktrees/<name>` auf einem eigenen Branch. Der Hauptordner ist dem Zusammenführen und Kleinständerungen an einer einzelnen Datei vorbehalten. Lesende Aufgaben (Analyse, Planung) dürfen im Hauptordner laufen.

## Claude-Agenten

19. Claude-Agenten, Claude-Code-Subagenten und Delegationen an Anthropic-Modelle dürfen nur gestartet, fortgesetzt oder anderweitig genutzt werden, wenn die aktuelle Nutzeranweisung in der ersten Zeile exakt `CLAUDE-AGENT-FREIGABE: 3141` enthält. Der Hook `.claude/hooks/claude-agent-lock.mjs` schützt Claude-interne Agentenaufrufe mit einer sitzungs- und projektgebundenen Einmal-Freigabe für höchstens zwei Minuten; er prüft keine Aufrufe des Codex-Helfers. Jeder weitere oder fortgesetzte Agent-Aufruf benötigt eine neue Freigabe; frühere oder allgemeine Freigaben, indirekte Delegationswünsche und automatische Modellwahl gelten nicht.
