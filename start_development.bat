@echo off
setlocal

set "ROOT=%~dp0"
cd /d "%ROOT%"
if errorlevel 1 (
    echo FEHLER: Das Repository konnte nicht geoeffnet werden: "%ROOT%"
    exit /b 1
)

echo ==================================================
echo   CurviosClash - aktuelle Entwicklungsversion
echo ==================================================
echo Ein vorhandenes Release-Paket wird bewusst ignoriert.
echo Repository: "%ROOT%"
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo FEHLER: Node.js wurde nicht gefunden. Benoetigt wird Node.js gemaess .nvmrc.
    exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
    echo FEHLER: npm wurde nicht gefunden. Bitte Node.js inklusive npm installieren.
    exit /b 1
)

if not exist "%ROOT%node_modules\vite\bin\vite.js" goto :install_dependencies
if not exist "%ROOT%electron\node_modules\electron\dist\electron.exe" goto :install_dependencies
if not exist "%ROOT%electron\node_modules\ffmpeg-static\ffmpeg.exe" goto :install_dependencies
goto :build_renderer

:install_dependencies
echo Installiere fehlende Root- und Electron-Abhaengigkeiten aus den Lockfiles...
call "%ROOT%install.bat" --no-pause
set "EXIT_CODE=%errorlevel%"
if "%EXIT_CODE%"=="0" goto :build_renderer
echo FEHLER: Die Abhaengigkeiten konnten nicht installiert werden.
exit /b %EXIT_CODE%

:build_renderer
echo Baue den aktuellen Desktop-Renderer...
call npm run build:app
set "EXIT_CODE=%errorlevel%"
if "%EXIT_CODE%"=="0" goto :launch_electron
echo FEHLER: Der Desktop-Renderer konnte nicht gebaut werden.
exit /b %EXIT_CODE%

:launch_electron
echo Starte Electron mit dem aktuellen Quellcode...
set "ELECTRON_RUN_AS_NODE="
call npm --prefix electron run start -- %*
set "EXIT_CODE=%errorlevel%"
if not "%EXIT_CODE%"=="0" echo FEHLER: Die Entwicklungsversion wurde mit Exitcode %EXIT_CODE% beendet.
exit /b %EXIT_CODE%
