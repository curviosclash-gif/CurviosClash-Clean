@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "DESKTOP_START=%SCRIPT_DIR%start_desktop.bat"

if not exist "%DESKTOP_START%" (
    echo Fehler: "%DESKTOP_START%" wurde nicht gefunden.
    echo Bitte pruefe, ob die Datei im Projektroot existiert.
    pause
    exit /b 1
)

call "%DESKTOP_START%"
exit /b %errorlevel%
