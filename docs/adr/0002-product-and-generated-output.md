# Produktcode und generierte Artefakte bleiben getrennt

## Kontext

Abhängigkeiten, Builds, Installer, Logs und Testausgaben vergrößern das Repository und machen Änderungen schwer überprüfbar.

## Entscheidung

Nur Quellen, Produktassets und notwendige Konfiguration werden versioniert. Generierte Ausgaben bleiben lokal oder kurzlebig in CI.

## Folgen

Ein frischer Checkout erzeugt benötigte Artefakte reproduzierbar. Release-Dateien werden außerhalb der Git-Historie verteilt.

## Test/Absicherung

`.gitignore` verhindert übliche Ausgaben; ein Contract schlägt bei verbotenen getrackten Pfaden und Logs fehl.
