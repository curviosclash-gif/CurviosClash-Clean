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
