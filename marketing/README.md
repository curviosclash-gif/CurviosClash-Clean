# CurviosClash: erste Kampagne für die itch.io-Demo

Der verbindliche Themen-, Schnitt- und Freigabeablauf steht im [Content-Playbook](content-playbook.md). Die Kampagne bearbeitet ausschließlich Vermarktung. Die fertige Demo wird später geliefert; unser Anteil daran ist ihre korrekte Veröffentlichung.

## Positionierung

**Kernversprechen:** Schnelle 3D-Flugduelle, in denen die eigene Leuchtspur zur Gefahr für alle wird. Das Material soll in den ersten zwei Sekunden eine Spurkreuzung, Spur-Falle oder ein knappes Ausweichen entlang mehrerer Spuren zeigen. Weitere Szenen können Klassisch, Kampf und Arcade zeigen; der Demo-Trailer nutzt nur vom Entwicklungsteam freigegebene Demo-Inhalte. Vor der Veröffentlichung führt der Aufruf zum itch.io-Profil, nach dem Start zur freigegebenen Demo-Seite.

**Verbindliche Bildregel:** In Cover, jedem ausgewählten Screenshot und jeder Hauptszene sind mehrere deutlich sichtbare, geschwungene Leuchtspuren zu sehen. Die erste Einstellung muss die Spurmechanik sofort erkennbar machen. Gerade Einzelspuren, spurarme Perspektiven und Bilder, in denen Logo oder Text die Spuren verdecken, werden aussortiert. Für das Cover bleibt die ganze Spielbreite sichtbar.

**Kurze Seitenbeschreibung (DE):** „Fliege, weiche aus und hinterlasse tödliche Leuchtspuren. CurviosClash verbindet schnelle 3D-Duelle mit Waffen und Arcade-Parcours.“

**Short description (EN):** “Fly, dodge, and leave deadly light trails. CurviosClash combines fast 3D duels, weapons, and arcade courses.”

Diese Texte beschreiben das Spiel. Die Demo-Seite darf nur Modi und Funktionen nennen, die für die gelieferte Demo von den Entwicklern freigegeben sind. Die konkrete Spiel-URL wird erst nach dem Anlegen der Projektseite eingetragen; `https://curviosclash.itch.io/` ist derzeit nur die bekannte Profiladresse.

## Medienproduktion

1. Im Desktop-Spiel unter **Einstellungen → Aufnahme** „Cinematic Replay Render“, „Ohne HUD“ und Querformat wählen. F8 startet, F9 beendet die Aufnahme. Im Menü die Aufnahme als MP4 rendern, bevor das Spiel neu gestartet wird: Die Renderliste ist nur im Arbeitsspeicher.
2. Vier bis sechs echte Szenen gezielt spielen und aufnehmen: mehrere farbige Leuchtspuren in einer Szene, eine Spur-Falle mit sichtbarer Reaktion, ein kurzer Kampf mit Treffer und ein Arcade-Parcours-Moment. Die Draufsicht macht Kurven und Spurkreuzungen lesbar; für Tempo und Nähe einzelne andere Kameraperspektiven ergänzen. Keine Startcountdowns, Menüs oder unbeabsichtigten Tode verwenden. Den Kern des Spiels in den ersten zwei Sekunden zeigen.
3. Die besten MP4s in `output/marketing/selected/` ablegen. `itch-demo.example.json` nach `output/marketing/manifest.json` kopieren und pro Szene Datei, Startzeit, Dauer und Unterzeile anpassen. `stillAt` wählt innerhalb der Szene gezielt den spurreichsten Frame für Screenshot und Cover. `coverShot` bestimmt die Cover-Szene. `audio: true` nur setzen, wenn die Quelldatei eine Audiospur enthält. Für veröffentlichte Clips Ton und Musikrechte prüfen.
4. Mit `node scripts/marketing/render-itch-demo.mjs output/marketing/manifest.json output/marketing/<neuer-name>` zwei MP4s, ein 630×500-Cover und unbeschriftete Standbilder erzeugen. Jeder Lauf benötigt ein neues Ausgabeziel und überschreibt keine vorhandenen Dateien. Der Schnitt verwendet FFmpeg aus `FFMPEG_PATH`, der Electron-Installation oder dem Systempfad.
5. Beide Videos und alle Bilder ansehen: viele sichtbare Spuren in jedem Motiv, richtige Szene, keine schwarzen Frames, lesbare Schrift auf dem Handy, passender Ton, echte Gameplay-Darstellung. Die automatisch erzeugten Standbilder sind Kandidaten; für die itch.io-Seite drei bis fünf unterschiedliche starke Motive auswählen.

`node scripts/marketing/capture-demo.mjs C:\CurviosClash\output\marketing` zeichnet zusätzlich automatisch kurze Szenen im isolierten Desktop-Spiel auf. Es steuert den Spieler in Kurven, wählt die Draufsicht und nutzt das bestehende Playwright-Schloss. Seine WebM-Dateien dienen der Motivsuche und dem technischen Probeschnitt; für den öffentlichen Trailer sind bewusst gespielte Cinematic-Replays mit Ton die bessere Quelle.

## Gameplay-Short: Your trail is a weapon

Der eigene Short kombiniert zwei seitliche Cinematic-Fahrten ohne HUD mit der regulären Third-Person-Kamera und dem Original-HUD des jeweils gezeigten Spielers. Er verwendet keine Draufsicht und keine First Person. Zwei über normale Steuereingaben geflogene Spieler erzeugen unregelmäßige S-Kurven mit wiederholten Steig- und Sinkflügen auf der Standard-Arena in Classic; die Spielphysik bleibt unverändert.

Die Cinematic-Kamera fliegt vor jedem Third-Person-Schnitt zur nativen Folgekamera; das echte HUD blendet in der Third-Person-Aufnahme in 0,25 Sekunden ein und vor der Rückfahrt aus. Spieler 1 sammelt ein echtes THICK-Item ein und aktiviert es im zweiten Gameplay-Abschnitt, sodass die neue Spur sichtbar breiter wird. Der Export mischt die Classic-Musik aus `assets/audio/music/` mit dem Spielton; `publication.txt` enthält die Attribution für die CC-BY-SA-Aufnahme. Die eingebrannten Captions und die SRT-Datei folgen denselben kurzen Zeitfenstern.

Nach `npm run build:app:test` nimmt `node scripts/marketing/produce-trail-short.mjs <ausgabeordner>` beide Formate mit Spielton im isolierten Desktop-Spiel auf. `--probe` prüft nur den Flug und speichert Bilder, `--landscape` oder `--portrait` begrenzt einen Testlauf. Jeder Lauf erhält einen neuen Unterordner und beachtet das gemeinsame Playwright-Schloss. Die Aufnahme bricht bei einem Tod oder einer relevanten Abweichung zwischen Spiel- und Aufnahmezeit ab.

`node scripts/marketing/render-trail-short.mjs <aufnahmeordner>/take.json <neuer-exportordner>` erzeugt die beiden 18-Sekunden-MP4s mit 60 fps, englischen Captions, Schlusskarte, Vorschaubild, SRT und Beitragstext. Querformat und Hochformat werden getrennt aufgenommen und komponiert. FFmpeg kommt aus der Electron-Installation oder `FFMPEG_PATH`; FFprobe muss im Suchpfad oder unter `FFPROBE_PATH` verfügbar sein. Alle Rohaufnahmen und Exporte bleiben außerhalb der versionierten Dateien.

Vor einer Veröffentlichung beide Formate vollständig auf Perspektiven, HUD, Bildfluss und Spielton prüfen. Mindestens vier von fünf Betrachtern müssen ohne Ton die Gefahr und das erfolgreiche Ausweichen verstehen. Dieser menschliche Verständlichkeitstest und die Veröffentlichung sind separate Schritte.

## itch.io-Seite und Veröffentlichung

- Die Projektseite zuerst als **Draft** anlegen. Titel, Kurzbeschreibung, Cover, drei bis fünf Screenshots, Steuerung, Systemanforderungen, korrekte Windows-Plattform und passende Tags eintragen. Die Seite erst mit der vom Entwicklungsteam freigegebenen Demo-Datei öffentlich machen; itch.io vergibt den „Most Recent“-Moment bei der ersten Veröffentlichung einmalig. [Seitenerstellung](https://itch.io/docs/creators/getting-started), [Qualitätsregeln](https://itch.io/docs/creators/quality-guidelines)
- Den Trailer zuerst auf YouTube oder Vimeo öffentlich bereitstellen und den eingebetteten Player ohne Anmeldung prüfen. Auf itch.io aktiviert er auch den „Watch trailer“-Knopf in der Übersicht. [Seitengestaltung](https://itch.io/docs/creators/design)
- Bei Lieferung der fertigen Demo die Datei und freigegebenen Angaben übernehmen, Upload und Download-Link kontrollieren und erst dann die Seite öffentlich schalten. Für gezielte Creator-Vorschauen kann vorher eine Restricted-Seite mit einzelnen Download-Keys genutzt werden. Für wiederholte Uploads kann `butler push <release-ordner> curviosclash/<spielslug>:windows-demo` genutzt werden; ein Push auf eine öffentliche Seite ist sofort verfügbar. [Zugriff](https://itch.io/docs/creators/access-control), [Download-Keys](https://itch.io/docs/creators/download-keys), [Butler](https://itch.io/docs/butler/pushing.html)
- Kommentare oder Community-Forum für Feedback aktivieren. Einen klaren Feedback-Link auf der Seite anbieten. Vom Entwicklungsteam freigegebene Änderungen per Devlog zeigen. Im Dashboard Aufrufe, Downloadquote und Zugriffsquellen prüfen. [Interaktion](https://itch.io/docs/creators/interact), [Devlogs](https://itch.io/updates/introducing-devlogs)

## Verbreitung und Messung

Aus einem guten Spielmoment drei kurze Varianten mit unterschiedlichem Einstieg schneiden: **Leuchtspur-Falle**, **knappes Ausweichen**, **Arcade-Bestzeit**. Querformat dient der Demo-Seite und YouTube, Hochformat Shorts und TikTok. Jede Variante verweist auf die konkrete itch.io-Spielseite, sobald sie öffentlich ist. Passende kleine Creator und Communities gezielt mit einem kurzen, persönlichen Pitch ansprechen; keine pauschalen Massenposts.

Wöchentlich vergleichen: Welche Clips halten Zuschauer über die ersten Sekunden, welche Quellen bringen Seitenbesuche, wie viele Seitenbesuche führen zum Download, und welches Feedback nennt denselben Reibungspunkt? Die Darstellung und Verteilung anhand dieser Signale verbessern; Produktfeedback an das Entwicklungsteam weitergeben.
