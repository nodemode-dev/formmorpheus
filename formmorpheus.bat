@echo off
cd /d "%~dp0"
if "%1"=="install" goto install
start "formmorpheus backend" cmd /k backend\boot_backend.bat
start "formmorpheus frontend" cmd /k frontend\boot_frontend.bat
echo [formmorpheus] frontend http://localhost:5194 · backend http://127.0.0.1:9494
goto end
:install
call formmorpheus_oc_install.bat
:end
