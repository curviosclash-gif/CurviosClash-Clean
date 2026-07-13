@echo off
echo ====================================
echo   CurviosClash - Installation
echo ====================================
echo.

:: Pruefen ob Node.js installiert ist
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [FEHLER] Node.js ist nicht installiert!
    echo.
    echo Bitte Node.js herunterladen und installieren:
    echo https://nodejs.org/
    echo.
    pause
    exit /b 1
)

:: Node.js Version anzeigen
echo Node.js gefunden:
node --version
echo.

:: Pruefen ob npm verfuegbar ist
where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo [FEHLER] npm ist nicht verfuegbar!
    echo Bitte Node.js neu installieren: https://nodejs.org/
    pause
    exit /b 1
)

:: In das Projektverzeichnis wechseln
cd /d "%~dp0"

:: Abhaengigkeiten installieren
echo Installiere Abhaengigkeiten...
echo.
call npm install
if %errorlevel% neq 0 (
    echo.
    echo [FEHLER] Installation fehlgeschlagen!
    pause
    exit /b 1
)

echo.
echo ====================================
echo   Installation erfolgreich!
echo ====================================
echo.
echo Starte das Spiel mit: npm run dev
echo Oder doppelklicke auf start_game.bat
echo.
pause
