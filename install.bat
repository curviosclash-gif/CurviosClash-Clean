@echo off
setlocal

set "ROOT=%~dp0"
set "NO_PAUSE="
if /i "%~1"=="--no-pause" set "NO_PAUSE=1"

cd /d "%ROOT%"
if errorlevel 1 (
    echo FEHLER: Das Repository konnte nicht geoeffnet werden: "%ROOT%"
    exit /b 1
)

echo ====================================
echo   CurviosClash - Installation
echo ====================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo FEHLER: Node.js wurde nicht gefunden. Benoetigt wird Node.js gemaess .nvmrc.
    goto :fail
)

where npm >nul 2>nul
if errorlevel 1 (
    echo FEHLER: npm wurde nicht gefunden. Bitte Node.js inklusive npm installieren.
    goto :fail
)

echo Node.js:
node --version
echo.

echo Installiere Root-Abhaengigkeiten aus package-lock.json...
call npm ci
set "EXIT_CODE=%errorlevel%"
if not "%EXIT_CODE%"=="0" goto :fail_root
if not exist "%ROOT%node_modules\vite\bin\vite.js" (
    set "EXIT_CODE=1"
    goto :fail_root
)

echo.
echo Installiere Electron-Abhaengigkeiten aus electron\package-lock.json...
call npm --prefix electron ci
set "EXIT_CODE=%errorlevel%"
if not "%EXIT_CODE%"=="0" goto :fail_electron

if exist "%ROOT%electron\node_modules\electron\dist\electron.exe" goto :electron_runtime_ready
echo Lade die gesperrte Electron-Laufzeit...
call node "%ROOT%electron\node_modules\electron\install.js"
set "EXIT_CODE=%errorlevel%"
if not "%EXIT_CODE%"=="0" goto :fail_electron

:electron_runtime_ready
if exist "%ROOT%electron\node_modules\ffmpeg-static\ffmpeg.exe" goto :ffmpeg_runtime_ready
echo Lade die gesperrte FFmpeg-Laufzeit...
call node "%ROOT%electron\node_modules\ffmpeg-static\install.js"
set "EXIT_CODE=%errorlevel%"
if not "%EXIT_CODE%"=="0" goto :fail_electron

:ffmpeg_runtime_ready
if not exist "%ROOT%electron\node_modules\electron\dist\electron.exe" (
    set "EXIT_CODE=1"
    goto :fail_electron
)
if not exist "%ROOT%electron\node_modules\electron-builder\package.json" (
    set "EXIT_CODE=1"
    goto :fail_electron
)
if not exist "%ROOT%electron\node_modules\ffmpeg-static\ffmpeg.exe" (
    set "EXIT_CODE=1"
    goto :fail_electron
)

echo.
echo Installiere Server-Abhaengigkeiten aus server\package-lock.json...
call npm --prefix server ci
set "EXIT_CODE=%errorlevel%"
if not "%EXIT_CODE%"=="0" goto :fail_server
if not exist "%ROOT%server\node_modules\ws\package.json" (
    set "EXIT_CODE=1"
    goto :fail_server
)

echo.
echo Installation erfolgreich.
echo Naechster Schritt: START_CURVIOSCLASH.cmd oder start_development.bat
if defined NO_PAUSE exit /b 0
pause
exit /b 0

:fail_root
set "FAILURE=Root-Abhaengigkeiten"
goto :fail_end

:fail_electron
set "FAILURE=Electron-Abhaengigkeiten"
goto :fail_end

:fail_server
set "FAILURE=Server-Abhaengigkeiten"
goto :fail_end

:fail
set "EXIT_CODE=1"

:fail_end
if defined FAILURE echo FEHLER: %FAILURE% konnten nicht installiert werden.
echo Die Installation wurde abgebrochen.
if not defined NO_PAUSE pause
exit /b %EXIT_CODE%
