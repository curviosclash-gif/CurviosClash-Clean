# Ein Produkt mit drei Modi

## Kontext

Classic, Hunt und Arcade teilen Steuerung, Leuchtspur, Arena, Kollision und Kamera; Hunt und Arcade ergänzen Classic um Lebenspunkte und Waffen beziehungsweise um Sektorfortschritt. Getrennte Produkte würden Shell, Installer, Einstellungen, Profile und Prüfketten vervielfachen, ohne den gemeinsamen Unterbau zu trennen.

## Entscheidung

Die drei Modi bleiben ein Produkt und sind im Anspruch gleichwertig. Classic ist das Fundament: Änderungen an Steuerung, Spur, Kollision, Arena und Kamera gelten für alle Modi und werden an Classic gemessen; reicht die Zeit nicht für alle, hat Classic Vorfahrt. Getrennte Auslieferungen sind nur nach Plattformzwang zulässig, nie nach Produktidee. Der Android-Schnitt in `mobile-classic` und `mobile-arcade` ist diese zulässige Form.

## Folgen

Ein neuer Modus entsteht als Strategie hinter `GameModeContract` und wird in `GameModeRegistry` registriert, nicht als eigener Einstiegspunkt. Jeder Modus trägt dauerhafte Pflegelast, deshalb braucht Inhalt, der nur einem Modus dient, eine ausdrückliche Begründung.

## Test/Absicherung

`tests/game-mode-strategy.contract.test.mjs` löst jeden Modustyp über die Registry auf und prüft Schaden, Aufsammelobjekte und Spawn gegen den gemeinsamen Vertrag. `tests/mobile-classic-app.contract.test.mjs` und `tests/mobile-arcade-app.contract.test.mjs` halten den plattformbedingten Schnitt an derselben Quelle fest.
