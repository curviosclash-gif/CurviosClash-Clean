# Roadmap

Diese Datei ist das schlanke Produktgedächtnis für zukünftige Ideen. Neue Gedanken zuerst unter **Ideen-Eingang** notieren. Bei einer späteren Sichtung werden sie nach **Jetzt**, **Danach** oder **Später** verschoben. Pro Punkt genügen Titel, Ziel, Nutzen und ein überprüfbares Ergebnis.

## Ideen-Eingang

- Neue Ideen hier kurz und ungeordnet ergänzen.
- Modvertrieb: fremde Karten und Fahrzeuge im Spiel anbieten. Offen: nur Karten oder auch Fahrzeuge, bloßer Dateiaustausch oder Katalog im Spiel, wer fremde Inhalte auf Absturz, Anstößigkeit und Urheberrecht prüft, und ob Läufe auf Modkarten in Ranglisten zählen.
- Bezahlinhalte: ob es sie überhaupt gibt und in welcher Form; heute nicht entschieden.
- Erzählerische Rahmung aus `story/das-turnier-der-letzten-staedte.md` ins Spiel holen; bewusst zurückgestellt und im Code bisher nicht vorhanden.

## Jetzt

- **Spielgefühl und Balance** – Ziel: Steuerung, Kollision, Kamera und Bot-Stärke über alle drei Modi hinweg an Classic ausrichten. Nutzen: das Spiel fühlt sich in jedem Modus gleich verlässlich an. Erfolg: Änderungen an Kernwerten sind durch Tests und einen Desktop-Playtest belegt und verschlechtern keines der vier Merkmale aus ADR 0007.
- **Inhalt ausbauen** – Ziel: Karten, Fahrzeuge und Parcours erweitern, ohne neue Sonderpfade je Modus. Nutzen: mehr Abwechslung aus bereits vorhandenen Systemen. Erfolg: neue Inhalte laufen in allen dafür freigegebenen Modi und bestehen Karten- und Parcours-Prüfung.
- **Determinismus vervollständigen** – Ziel: Bot-KI und Spieler-Spawn ziehen ihren Zufall aus dem gesetzten Laufzeitzufall statt aus `Math.random`. Nutzen: Läufe werden wiederholbar, Bot-Vergleiche belastbar und Tode erklärbar. Erfolg: die Kernpfade in `src/entities` und `src/hunt` sind umgestellt und gegen Rückfall gesichert.
- **Ungenutzte Systeme klären** – Ziel: fertig gebaute, aber nicht angeschlossene Systeme entweder anbinden oder entfernen. Nutzen: weniger toter Ballast in Pflege und Prüfung. Erfolg: kein System bleibt dauerhaft allein durch einen Test als unbenutzt festgeschrieben.

## Danach

- **Release-Kriterium festlegen** – Ziel: schriftlich entscheiden, was wahr sein muss, damit veröffentlicht wird. Nutzen: die Release-Arbeiten bekommen ein Ende statt eines Gefühls. Erfolg: das Kriterium steht als ADR und benennt, ob alle drei Modi tragen müssen oder ein Modus führt.
- **Konten und Ranglisten** – Ziel: Spielstände an ein Konto binden und Bestwerte vergleichbar machen. Nutzen: Motivation über die einzelne Sitzung hinaus. Erfolg: die folgenden Fragen sind vor der ersten Zeile Code entschieden und als ADR festgehalten.
  - Bleibt der lokale Spielstand die Wahrheit und das Konto nur eine Kopie, oder zieht der Spielstand auf den Server? Davon hängt ab, ob der Einzelspieler dauerhaft vom Dienst abhängt.
  - Was wird verglichen? Parcours-Bestzeiten sind vergleichbar; Classic-Siege sind es nicht, weil Bot-Stärke, Spielerzahl und Karte frei einstellbar sind.
  - Warum ist ein Eintrag glaubwürdig? Entweder eine ausdrücklich unverbindliche Liste oder eine eingereichte Wiederholung, die nachgerechnet wird. Der zweite Weg setzt den vollständigen Determinismus aus dem Punkt unter **Jetzt** voraus.
  - Welche Art Konto? Nur ein Name, eigene Anmeldung mit Passwort oder Fremdanmeldung über einen bestehenden Dienst.
  - Wer betreibt die Datenhaltung, was kostet sie laufend, und was passiert mit den Spielständen bei Abschaltung?
  - Datenschutzerklärung, Auskunft und Löschung, Mindestalter und Impressum werden mit Konten zur Pflicht.
- **Electron-Audit** – Ziel: Shell, Fenster, IPC und Paketinhalt vollständig prüfen. Nutzen: weniger Sicherheits- und Release-Regressionsrisiko. Erfolg: alle Desktop-Grenzen sind durch Contracts oder reproduzierbare Checks abgedeckt.
- **Signierung und Icon** – Ziel: vertrauenswürdige Windows-Metadaten und ein konsistentes Produkt-Icon. Nutzen: weniger SmartScreen-Reibung und klare Produktidentität. Erfolg: signierter Installer und EXE mit geprüftem Icon aus externer Zertifikatsbereitstellung.
- **E2E-Stabilisierung** – Ziel: alle zentralen Desktop-Cluster ohne Hänger reproduzierbar ausführen. Nutzen: verlässliche Releases. Erfolg: wiederholte grüne Läufe mit klar begrenzten Testzeiten und verwertbarer Fehlerursache.
- **Profilvalidierung** – Ziel: ungültige oder beschädigte Profildaten sicher abweisen beziehungsweise reparieren. Nutzen: robuste Persistenz. Erfolg: Migration, Ablehnung und Wiederherstellung sind durch Contracts abgedeckt.
- **Navigation und Popup-Allowlist** – Ziel: externe Navigation und neue Fenster auf explizit erlaubte Ziele begrenzen. Nutzen: kleinere Desktop-Angriffsfläche. Erfolg: unerlaubte Ziele werden in Main Frame und Popups nachweisbar blockiert.
- **LAN-Hardening** – Ziel: Discovery, Host-Lifecycle und Eingaben weiter absichern. Nutzen: stabilere lokale Mehrspieler-Sitzungen. Erfolg: Fehler-, Neustart- und Missbrauchsfälle bestehen gezielte Integrationsprüfungen.

## Später

- **Performance und Chunks** – Ziel: Startzeit, Laufzeitspitzen und Renderer-Chunking messen und optimieren. Nutzen: schnellerer Start und gleichmäßigeres Spielgefühl. Erfolg: belastbare Budgets werden ohne Funktionsverlust eingehalten.
- **Recording-Bibliothek modernisieren** – Ziel: `mp4-muxer` kontrolliert durch eine gepflegte Alternative ersetzen. Nutzen: langfristig wartbare Videoaufnahmen. Erfolg: Recording-, Lifecycle- und Desktop-Exporttests bestehen mit der neuen Implementierung.
- **Android-Gerätetests** – Ziel: die mobile Variante auf echten Geräten unterschiedlicher Leistung und Bildschirmgröße prüfen. Nutzen: verlässliche Touch-Steuerung, Darstellung, Audio und App-Lifecycle. Erfolg: dokumentierte Testläufe auf repräsentativen Geräten ohne kritische Fehler.
