@echo off
setlocal
cd /d "%~dp0.."
set "ROOT=%cd%"
echo [formmorpheus] installing backend
call "%ROOT%\backend\oc_install.bat" || exit /b 1
echo [formmorpheus] installing frontend
call "%ROOT%\frontend\oc_install.bat" || exit /b 1
echo [formmorpheus] done. Boot with formmorpheus.bat
