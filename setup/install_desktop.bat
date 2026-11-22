@echo off
setlocal
cd /d "%~dp0.."
set "ROOT=%cd%"
if not exist "%ROOT%\backend\venv\Scripts\activate.bat" ( call "%ROOT%\setup\install_all.bat" || exit /b 1 )
call "%ROOT%\backend\venv\Scripts\activate.bat"
python -m pip install -r "%ROOT%\backend\requirements_desktop.txt" || exit /b 1
echo [formmorpheus] desktop build packages installed into backend\venv
