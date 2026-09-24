---
name: safe-push
description: Prüft und pusht gezielt Git-Commits, ohne lokale Arbeit oder entfernte Branches zu überschreiben. Verwenden bei Push-Aufträgen und vor dem Push am Ende einer Git-Aufgabe; nicht für History-Rewrites.
---

# Sicher pushen

Ziel: Nur die beabsichtigten Commits auf genau einen bestimmten Remote-Branch übertragen und den Zustand danach prüfen. Repository-spezifische AGENTS.md-Regeln und bereits erteilte oder fehlende Autorisierung gelten weiterhin. Eine reine Prüfbitte autorisiert keinen Push.

1. Ermittle Repository, Worktree, aktuellen Branch und HEAD, Arbeitsbaum einschließlich untracked Dateien, Remotes und Upstream. Wähle Ziel-Remote und Ziel-Branch aus dem Auftrag oder einem eindeutigen Upstream. Bei Mehrdeutigkeit anhalten und gezielt nachfragen. Remote-URLs mit Zugangsdaten nicht ausgeben.
2. Prüfe, ob der Auftrag auch uncommittete Änderungen umfasst. Ein Push enthält diese nicht. Stagen, committen oder bereinigen nur, wenn der Auftrag das deckt und die Projektregeln erfüllt sind. Fremde Änderungen weder anfassen noch als eigene ausgeben.
3. Ermittle den aktuellen Remote-Stand per Fetch oder ls-remote und vergleiche ihn mit dem lokalen HEAD. Zeige und prüfe die ausgehenden Commits und betroffenen Dateien. Nur fortfahren, wenn der Remote-Tip Vorfahr des lokalen HEAD ist, jeder ausgehende Commit zum Auftrag gehört und die verlangten Qualitätsprüfungen erfüllt sind. Ein neuer Remote-Branch braucht eine klare Absicht. Bei Abweichung, unbekannter Herkunft eines Commits oder zwischenzeitlich verändertem Ziel stoppen.
4. Fixiere die geprüfte Commit-ID und prüfe unmittelbar vor dem Push, dass HEAD noch darauf zeigt. Führe höchstens einen gezielten Dry Run und anschließend genau den geprüften Push mit dieser Commit-ID als Quelle und explizitem Remote und Ref-Ziel aus. Kein Force-Push, keine Lösch-Refspec, kein Mirror, kein Push aller Branches oder Tags. Keine automatischen Merge-, Rebase-, Reset-, Stash-, Clean- oder Aufräumversuche, um eine Ablehnung zu umgehen. Nach Ablehnung erst den Zustand erneut prüfen.
5. Vergleiche nach Erfolg den Remote-Tip mit dem zuvor geprüften lokalen Commit. Berichte Ziel, Commit-ID, übertragene Commits und verbleibende lokale Änderungen. Falls die Bestätigung fehlschlägt oder ein anderer Prozess den Zustand ändert, melde den unklaren Stand und stoppe weitere Mutationen.

Ein sauberer Push kann Änderungen anderer Prozesse nicht absolut ausschließen. Bei Unsicherheit ist der sichere Ausgang ein Stopp mit genauer Zustandsbeschreibung, keine behauptete Verlustgarantie.
