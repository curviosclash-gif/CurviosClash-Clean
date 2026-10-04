---
name: worktree-cleanup
description: Bereinigt eigene Git-Worktrees und prüft Worktree-Archive mit möglichst wenig zusätzlichem Speicher. Verwenden beim Abschluss, Entfernen oder Archivieren eines Worktrees sowie bei einer ausdrücklich angeforderten Archivbereinigung. Bewahrt noch ungesicherte Arbeit und vermeidet redundante Vollkopien.
---

# Worktrees ohne überflüssige Archive bereinigen

Erhalte wiederherstellbare Arbeit mit der kleinsten nötigen Sicherung. Repository-Regeln, Dateibesitz und bereits erteilte Autorisierung gelten weiterhin. Eine Skill-Anpassung oder Worktree-Entfernung erlaubt keine pauschale Löschung bestehender Archive, fremder Dateien oder untracked Testartefakte.

## Vor jeder Entfernung

- Prüfe die aktuelle Worktree-Liste, den Branch und HEAD, offene Änderungen einschließlich untracked Dateien sowie relevante ignorierte Dateien. Erfasst `git status` eine Datei nicht, ist das kein Beleg für ihre Entbehrlichkeit. Folge bei der Dateiprüfung keinen Junctions oder anderen Reparse Points in geteilte Verzeichnisse.
- Prüfe aktive Sitzungen, Prozesse, das Playwright-Schloss und sonstige belegte Ressourcen. Fremde, aktive oder `locked initializing` Worktrees bleiben erhalten. Löse vor einer erlaubten Entfernung ausschließlich die Junction des eigenen Worktrees; niemals deren Ziel.
- Erfülle die aktuellen Test-, Build-, Commit-, Integrations- und Push-Gates. Solange ein erforderliches Gate offen oder Dateibesitz ungeklärt ist, bleibt der Aufgaben-Worktree erhalten.

## Bereits gesicherte Arbeit

- Ist der eigene Worktree frei von noch benötigten ungesicherten Dateien und sein vollständiger Aufgabenstand nachweislich in erhaltenen Git-Referenzen gesichert, entferne den Checkout nach den Projektregeln ohne zusätzliche Ordnerkopie, ZIP oder Git-Bundle. Wo Merge und Push verlangt sind, prüfe die Integration und den aktuellen Remote-Commit vorher.
- Bewahre benötigte Git-Referenzen. Entferne nicht zugleich den einzigen Branch mit noch unintegrierten Commits. Ein lokaler Branch genügt als Sicherung innerhalb desselben erhaltenen Repositorys; er ersetzt keine ausdrücklich verlangte unabhängige Datensicherung.
- Von Codex oder einer anderen App verwaltete Worktrees werden mit deren vorgesehenem Werkzeug entfernt oder archiviert. Erzeugt es dabei automatisch eine Git-Sicherung, nutze diese und lege keine zweite manuelle Sicherung an. Skills können diese Werkzeugfunktion nicht abschalten. Sichere benötigte ignorierte Dateien vorher gezielt, wenn das Werkzeug sie nicht erfasst.

## Nur den noch ungesicherten Rest sichern

- Bevorzuge erhaltene Commits und Referenzen. Sichere noch benötigte uncommittete Änderungen gezielt als binärfähigen Patch gegen den festgehaltenen Basiscommit; falls der Indexzustand zur Wiederherstellung gehört, erhalte staged und unstaged Änderungen getrennt. Ergänze ausschließlich benötigte einzigartige untracked oder ignorierte Dateien. Prüfe, dass Patch und Dateien zusammen den benötigten Arbeitsstand wiederherstellen.
- Ein Git-Bundle ist nur nötig, wenn die Commit-Sicherung unabhängig vom ursprünglichen Repository bestehen muss. Beschränke es auf die benötigten Referenzen und Objekte; dokumentiere und prüfe die Verfügbarkeit etwaiger Basiscommits. Keine pauschalen Bundles aller Branches und keine vollständigen Worktree-Kopien als Standard.
- Archive enthalten keine erneut mitgesicherten Abhängigkeiten, Junction-Ziele, Caches, Builds, Zwischenstände oder wiederholten Testausgaben, wenn ihre Wiederherstellung aus vorhandenen Quellen, Eingaben und Parametern belegt ist. Bewahre die nötigen Abnahmebelege und einzigartige Originaldateien. Insbesondere sind `.blend`, `.glb`, Backupdateien oder ignorierte Dateien nicht allein wegen ihrer Endung entbehrlich.
- Prüfe vorhandene Sicherungen vor einer neuen Kopie anhand von Pfad, Inhalt beziehungsweise Hash und benötigtem Versionsstand. Verweise auf eine erhaltene identische Sicherung. Erfasse Basiscommit, gesicherte Dateien und Gesamtgröße knapp neben der Sicherung außerhalb des Produktrepositorys; prüfe Lesbarkeit und Wiederherstellbarkeit vor einer erlaubten Entfernung des Originals.
- Kann die nötige Sicherung nicht erstellt oder geprüft werden, bleibt das Original erhalten. Ein kleineres Archiv rechtfertigt keinen Verlust ungesicherter Arbeit.

## Nur wichtige Nachweise archivieren

- Wähle vor dem Archivieren gezielt aus, was für Wiederherstellung, eine offene Fehleranalyse oder die abschließende Abnahme benötigt wird. Einzigartigkeit, ein fehlender Git-Eintrag oder ein anderer Zeitstempel machen generierte Ausgaben allein noch nicht aufbewahrungswürdig.
- Bewahre ungesicherte Quelländerungen, originale Assets und Eingaben, benötigte Spielstände sowie notwendige Basiscommits, Patches und Referenzen. Kopiere bereits erhaltene Daten nicht erneut. Archivierungswerkzeuge können eigene Sicherungen erzeugen; keine zusätzliche manuelle Vollkopie dazu.
- Für abgeschlossene erfolgreiche Tests genügt normalerweise eine kleine Zusammenfassung mit Commit, Testaufruf, Ergebnis und gegebenenfalls Umgebung. Übernimm keine vollständigen `test-results`, Browserprofile, Rohlogs, Videos, Traces oder Serien automatisch erzeugter Screenshots. Behalte nur gezielt benötigte finale Abnahmebilder oder Messwerte.
- Bei offenen oder unklaren Fehlern bewahre den konkreten Fehlerkontext und die zugehörigen Diagnoseartefakte. Beurteile jeden einzelnen Lauf; ein erfolgreicher `.last-run.json` in einem Unterordner bescheinigt nicht den Erfolg benachbarter Läufe. Entferne Fehlernachweise erst, wenn deren Erledigung oder eine erhaltene gleichwertige Sicherung belegt ist.
- Schließe `node_modules`, heruntergeladene Laufzeiten, Caches, `tmp/playwright`, `dist`, `dist-app` und `dist-app-test` aus, wenn Quellen und nötige Erzeugungsparameter erhalten sind. Bewahre ein Build nur bei einem konkreten Bedarf, etwa einer benötigten Release-Datei, schwer reproduzierbaren Umgebung oder offenen Fehleranalyse.
- Halte das Archiv klein: sichere die ausgewählten Dateien und eine knappe Wiederherstellungsbeschreibung, statt später ungeprüfte Verzeichnisbäume zu sammeln. Keine automatischen neuen Sicherungskopien der ausgeschlossenen Ausgaben.

## Bestehende Archive

Vergleiche die relevanten Dateien und Verzeichnisstände mit erhaltenen Branches, Commits und anderen Sicherungen, bevor du etwas als redundant einstufst. Größe, Alter, fehlende `.git`-Metadaten oder eine frühere Integration allein beweisen das nicht. Ungeklärte Unterschiede bleiben erhalten. Lösche nur aktuell geprüfte, ausdrücklich genehmigte Ziele gemäß den geltenden Regeln für untracked Dateien und Wiederherstellungsablagen; keine automatische Löschung nach Frist und keine zusätzliche Vollkopie vor der Bereinigung.

Eine ausdrückliche Bereinigungserlaubnis gilt innerhalb des vereinbarten Umfangs auch für geprüfte entbehrliche Testausgaben und Builds. Prüfe dabei ihren Zweck: unterschiedliche generierte Dateien brauchen nicht allein wegen unterschiedlicher Hashes dauerhaft erhalten zu bleiben. Lasse Quellen, relevante Abnahmebelege und ungeklärte Fehlernachweise unangetastet. Nach genehmigter Teilbereinigung passe betroffene Dateilisten beziehungsweise Prüfsummenmanifeste an die erhaltenen Dateien an und dokumentiere die absichtlichen Ausschlüsse knapp; alte Manifest-Einträge sind kein generelles Löschverbot.

Berichte kurz, welche einzigartigen Daten erhalten wurden, welche zusätzliche Sicherung dadurch entfiel und wie viel Speicher tatsächlich frei wurde. Ohne ausgeführte Bereinigung keine Speicherersparnis behaupten.
