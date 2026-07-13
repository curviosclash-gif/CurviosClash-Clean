@echo off
echo ====================================
echo   Curvios Clash - Settings Studio
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

call npm run app:settings:start
if errorlevel 1 goto :fail
goto :end

:fail
echo.
echo Settings-Studio-Start fehlgeschlagen.

:end
pause
