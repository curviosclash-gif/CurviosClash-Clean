# Produkt- und Plattformgrenzen

## Kontext

CurviosClash wird von einer Person gebaut und verfolgt zwei gleichrangige Absichten: das Spiel soll veröffentlicht werden, und der Quellcode soll als Referenzarbeit bestehen. Beides verträgt keine unbegrenzte Zahl gleichzeitig gepflegter Oberflächen. ADR 0003 legt das Desktop-Paket als bevorzugtes Windows-Ziel fest, sagt aber nicht, welchen Anspruch die übrigen Oberflächen haben.

## Entscheidung

Die Oberflächen haben drei Stufen. Windows-Desktop ist Leitplattform: dort wird zuerst gebaut und geprüft, und nichts gilt als fertig, bevor es dort läuft. LAN, Online und Android sind verbindlich, werden nach Desktop separat geprüft und dürfen nachhängen, aber nicht verrotten. Die Browser-Fassung ist eine Demo: sie darf Funktionen weglassen und blockiert keine Veröffentlichung. Mehrspieler bleibt bei den bestehenden Obergrenzen von zehn Spielern je Lobby und zwei lokalen Spielern im geteilten Bild.

## Folgen

Eine Änderung, die eine verbindliche Oberfläche dauerhaft bricht, ist nicht fertig. Der Zusatzaufwand für erzwungene Schichtgrenzen, Ratchets und Contract-Tests ist durch die Referenzabsicht gedeckt und gilt nicht als Überbau. Umfangsfragen zu Konten, Ranglisten, Modvertrieb und Bezahlinhalten sind mit dieser ADR ausdrücklich nicht entschieden.

## Test/Absicherung

CI baut und prüft das Windows-Paket nach ADR 0003. Die Lobby-Obergrenze ist im Code gesetzt und über die Contract-Tests der Signaling- und Lobby-Dienste abgedeckt. Die Demo-Stufe hat einen eigenen Browser-Kompatibilitätslauf, der bewusst nur einen Teil der Desktop-Prüfungen ausführt.
