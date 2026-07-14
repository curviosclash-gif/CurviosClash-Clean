@echo off
setlocal

if /i "%~1"=="--development" goto :development

echo Starte das Settings Studio aus der fertigen Paketversion.
echo Fuer den aktuellen Quellcode: start_settings.bat --development
echo.
call "%~dp0START_CURVIOSCLASH.cmd" --settings-studio %*
exit /b %errorlevel%

:development
echo Starte das Settings Studio als aktuelle Entwicklungsversion.
echo Der aktuelle Renderer wird vor dem Start neu gebaut.
echo.
call "%~dp0start_development.bat" --settings-studio
exit /b %errorlevel%
