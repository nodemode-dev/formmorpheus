@echo off
rem Sets FM_PY for the caller, so no setlocal here.
set "FM_PY="
py -3.12 -c "import sys" >nul 2>nul && set "FM_PY=py -3.12"
if not defined FM_PY ( py -3 -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 12) else 1)" >nul 2>nul && set "FM_PY=py -3" )
if not defined FM_PY ( python -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 12) else 1)" >nul 2>nul && set "FM_PY=python" )
if not defined FM_PY ( echo [formmorpheus] error: Python 3.12 or newer is required 1>&2 & exit /b 1 )
exit /b 0
