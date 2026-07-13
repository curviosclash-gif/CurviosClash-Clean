@echo off
echo ====================================
echo   Curvios Clash - Desktop App
echo ====================================
echo.
echo Projektpfad: %~dp0
echo.

set "ELECTRON_RUN_AS_NODE="

if not exist "%~dp0electron\node_modules\electron" (
    echo Electron-Abhaengigkeiten fehlen. Fuehre Setup aus...
    call npm run app:setup
    if errorlevel 1 goto :fail
    echo.
)

if not exist "%~dp0dist-app\index.html" (
    echo Desktop-Build fehlt. Erstelle ihn jetzt...
    call npm run app:start:build
    if errorlevel 1 goto :fail
    goto :end
)

call npm run app:start
if errorlevel 1 goto :fail
goto :end

:fail
echo.
echo Desktop-Start fehlgeschlagen.

:end
pause
