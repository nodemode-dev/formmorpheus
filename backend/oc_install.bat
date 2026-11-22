@echo off
setlocal
cd /d "%~dp0"
call "%~dp0..\setup\find_python.bat" || exit /b 1
if not exist venv ( %FM_PY% -m venv venv || exit /b 1 )
call venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r requirements.txt || exit /b 1
