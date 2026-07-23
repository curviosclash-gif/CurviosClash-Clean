@echo off
setlocal

if /i "%~1"=="--development" goto :development

if exist "%~dp0release\win-unpacked\CurviosClash.exe" goto :package
if exist "%~dp0release\win-unpacked.tmp" goto :incomplete_package

:package

echo Starte das Settings Studio aus der fertigen Paketversion.
echo Fuer den aktuellen Quellcode: start_settings.bat --development
echo.
call "%~dp0START_CURVIOSCLASH.cmd" --settings-studio %*
exit /b %errorlevel%

:incomplete_package
echo Ein unvollstaendiges Windows-Paket blockiert den Paket-Build.
echo Das Settings Studio wird deshalb aus dem aktuellen Quellcode gestartet.
echo.

:development
echo Starte das Settings Studio als aktuelle Entwicklungsversion.
echo Der aktuelle Renderer wird vor dem Start neu gebaut.
echo.
call "%~dp0start_development.bat" --settings-studio
exit /b %errorlevel%
