@echo off
setlocal

cd /d "%~dp0"

set "HOST=127.0.0.1"
set "PORT=5173"
set "EDITOR_URL=http://%HOST%:%PORT%/editor/map-editor-3d.html"

echo === Curvios Clash - Map Editor (Local) ===
echo Starte Vite Dev-Server auf %HOST%:%PORT% ...
echo Editor URL: %EDITOR_URL%
echo.

start "" "%EDITOR_URL%"
npm run dev -- --host %HOST% --port %PORT%
