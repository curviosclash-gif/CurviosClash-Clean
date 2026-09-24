# CurviosClash: erste Kampagne für die itch.io-Demo

## Positionierung

**Kernversprechen:** Schnelle 3D-Flugduelle, in denen die eigene Leuchtspur zur Gefahr für alle wird. Das Material soll in den ersten zwei Sekunden eine Spurkreuzung, Spur-Falle oder ein knappes Ausweichen entlang mehrerer Spuren zeigen. Danach folgen die Spielstile Klassisch, Kampf und Arcade. Der Trailer beginnt mit Gameplay und endet mit dem Aufruf zur Windows-Demo.

**Verbindliche Bildregel:** In Cover, jedem ausgewählten Screenshot und jeder Hauptszene sind mehrere deutlich sichtbare, geschwungene Leuchtspuren zu sehen. Die erste Einstellung muss die Spurmechanik sofort erkennbar machen. Gerade Einzelspuren, spurarme Perspektiven und Bilder, in denen Logo oder Text die Spuren verdecken, werden aussortiert. Für das Cover bleibt die ganze Spielbreite sichtbar.

**Kurze Seitenbeschreibung (DE):** „Fliege, weiche aus und hinterlasse tödliche Leuchtspuren. CurviosClash verbindet schnelle 3D-Duelle mit Waffen und Arcade-Parcours.“

**Short description (EN):** “Fly, dodge, and leave deadly light trails. CurviosClash combines fast 3D duels, weapons, and arcade courses.”

Diese Texte beschreiben das Spiel. Die Demo-Seite darf nur Modi und Funktionen nennen, die im veröffentlichten Demo-Build tatsächlich enthalten und getestet sind. Die konkrete Spiel-URL wird erst nach dem Anlegen der Projektseite eingetragen; `https://curviosclash.itch.io/` ist derzeit nur die bekannte Profiladresse.

## Medienproduktion

1. Im Desktop-Spiel unter **Einstellungen → Aufnahme** „Cinematic Replay Render“, „Ohne HUD“ und Querformat wählen. F8 startet, F9 beendet die Aufnahme. Im Menü die Aufnahme als MP4 rendern, bevor das Spiel neu gestartet wird: Die Renderliste ist nur im Arbeitsspeicher.
2. Vier bis sechs echte Szenen gezielt spielen und aufnehmen: mehrere farbige Leuchtspuren in einer Szene, eine Spur-Falle mit sichtbarer Reaktion, ein kurzer Kampf mit Treffer und ein Arcade-Parcours-Moment. Die Draufsicht macht Kurven und Spurkreuzungen lesbar; für Tempo und Nähe einzelne andere Kameraperspektiven ergänzen. Keine Startcountdowns, Menüs oder unbeabsichtigten Tode verwenden. Den Kern des Spiels in den ersten zwei Sekunden zeigen.
3. Die besten MP4s in `output/marketing/selected/` ablegen. `itch-demo.example.json` nach `output/marketing/manifest.json` kopieren und pro Szene Datei, Startzeit, Dauer und Unterzeile anpassen. `stillAt` wählt innerhalb der Szene gezielt den spurreichsten Frame für Screenshot und Cover. `coverShot` bestimmt die Cover-Szene. `audio: true` nur setzen, wenn die Quelldatei eine Audiospur enthält. Für veröffentlichte Clips Ton und Musikrechte prüfen.
4. Mit `node scripts/marketing/render-itch-demo.mjs output/marketing/manifest.json output/marketing/<neuer-name>` zwei MP4s, ein 630×500-Cover und unbeschriftete Standbilder erzeugen. Jeder Lauf benötigt ein neues Ausgabeziel und überschreibt keine vorhandenen Dateien. Der Schnitt verwendet FFmpeg aus `FFMPEG_PATH`, der Electron-Installation oder dem Systempfad.
5. Beide Videos und alle Bilder ansehen: viele sichtbare Spuren in jedem Motiv, richtige Szene, keine schwarzen Frames, lesbare Schrift auf dem Handy, passender Ton, echte Gameplay-Darstellung. Die automatisch erzeugten Standbilder sind Kandidaten; für die itch.io-Seite drei bis fünf unterschiedliche starke Motive auswählen.

`node scripts/marketing/capture-demo.mjs C:\CurviosClash\output\marketing` zeichnet zusätzlich automatisch kurze Szenen im isolierten Desktop-Spiel auf. Es steuert den Spieler in Kurven, wählt die Draufsicht und nutzt das bestehende Playwright-Schloss. Seine WebM-Dateien dienen der Motivsuche und dem technischen Probeschnitt; für den öffentlichen Trailer sind bewusst gespielte Cinematic-Replays mit Ton die bessere Quelle.

## itch.io-Seite und Veröffentlichung

- Die Projektseite zuerst als **Draft** anlegen. Titel, Kurzbeschreibung, Cover, drei bis fünf Screenshots, Steuerung, Systemanforderungen, korrekte Windows-Plattform und passende Tags eintragen. Die Seite erst mit getesteter Demo-Datei öffentlich machen; itch.io vergibt den „Most Recent“-Moment bei der ersten Veröffentlichung einmalig. [Seitenerstellung](https://itch.io/docs/creators/getting-started), [Qualitätsregeln](https://itch.io/docs/creators/quality-guidelines)
- Einen öffentlich erreichbaren YouTube- oder Vimeo-Trailer einbinden. Auf itch.io aktiviert er auch den „Watch trailer“-Knopf in der Übersicht. [Seitengestaltung](https://itch.io/docs/creators/design)
- Den Windows-Build auf einem sauberen Rechner installieren und Start, Eingabe, Audio, Einstellungen und Deinstallation prüfen. Vor dem Upload die tatsächlichen Demo-Inhalte und die Systemanforderungen gegen die Seite abgleichen. Für wiederholte Updates kann `butler push <release-ordner> curviosclash/<spielslug>:windows-demo` genutzt werden; ein Push auf eine öffentliche Seite ist sofort verfügbar. [Butler](https://itch.io/docs/butler/pushing.html)
- Kommentare oder Community-Forum für Feedback aktivieren. Einen klaren Feedback-Link auf der Seite und in der Demo anbieten. Änderungen mit echten Verbesserungen per Devlog zeigen. Im Dashboard Aufrufe, Downloadquote und Zugriffsquellen prüfen. [Interaktion](https://itch.io/docs/creators/interact), [Devlogs](https://itch.io/updates/introducing-devlogs)

## Verbreitung und Messung

Aus einem guten Spielmoment drei kurze Varianten mit unterschiedlichem Einstieg schneiden: **Leuchtspur-Falle**, **knappes Ausweichen**, **Arcade-Bestzeit**. Querformat dient der Demo-Seite und YouTube, Hochformat Shorts und TikTok. Jede Variante verweist auf die konkrete itch.io-Spielseite, sobald sie öffentlich ist. Passende kleine Creator und Communities gezielt mit einem kurzen, persönlichen Pitch ansprechen; keine pauschalen Massenposts.

Wöchentlich vergleichen: Welche Clips halten Zuschauer über die ersten Sekunden, welche Quellen bringen Seitenbesuche, wie viele Seitenbesuche führen zum Download, und welches Feedback nennt denselben Reibungspunkt? Zuerst die Demo oder ihre Darstellung verbessern, dann neue Clips aus den stärksten Spielmomenten schneiden.
