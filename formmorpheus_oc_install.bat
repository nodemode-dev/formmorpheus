@echo off
cd /d "%~dp0"
call backend\oc_install.bat || exit /b 1
call frontend\oc_install.bat || exit /b 1
echo [formmorpheus] done. Boot with formmorpheus.bat
