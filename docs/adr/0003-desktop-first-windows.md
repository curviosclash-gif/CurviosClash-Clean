# Desktop-Paket ist das bevorzugte Windows-Startziel

## Kontext

CurviosClash nutzt Desktop-Fähigkeiten für LAN, Persistenz, Recording und produktive Werkzeuge, die der reine Browser nicht vollständig bereitstellt.

## Entscheidung

Unter Windows ist die gepackte Electron-Anwendung das bevorzugte Start- und Release-Ziel. Browser und Mobile bleiben eigenständige, zusätzlich geprüfte Oberflächen.

## Folgen

Desktop-Regressionsschutz und Paketprüfung haben Release-Priorität, ohne andere Produktvarianten zu entfernen oder zu vereinfachen.

## Test/Absicherung

CI baut das Paket, prüft zentrale Laufzeitdateien und startet die EXE mit isoliertem Benutzerprofil bis zu einem reagierenden Fenster.
