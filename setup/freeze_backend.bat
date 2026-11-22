@echo off
setlocal
cd /d "%~dp0.."
set "ROOT=%cd%"
if not exist "%ROOT%\backend\venv\Scripts\activate.bat" ( echo [formmorpheus] error: backend venv missing, run formmorpheus.bat install 1>&2 & exit /b 1 )
call "%ROOT%\backend\venv\Scripts\activate.bat"
python -c "import PyInstaller" >nul 2>nul || ( echo [formmorpheus] error: PyInstaller missing, run formmorpheus.bat install-desktop 1>&2 & exit /b 1 )
if not exist "%ROOT%\frontend\dist\index.html" ( call "%ROOT%\setup\build_frontend.bat" || exit /b 1 )
set "FM_WINDOWED="
if not "%FORMMORPHEUS_ENGINE_WINDOWED%"=="0" set "FM_WINDOWED=--noconsole"
cd /d "%ROOT%\backend"
if exist build\pyinstaller rmdir /s /q build\pyinstaller
if exist dist-engine rmdir /s /q dist-engine
pyinstaller --noconfirm --clean --onedir %FM_WINDOWED% --name formmorpheus-engine --distpath dist-engine --workpath build\pyinstaller --specpath build\pyinstaller --add-data "%ROOT%\frontend\dist;frontend_dist" --add-data "%ROOT%\backend\app\penlink_static;app\penlink_static" --collect-submodules app --collect-submodules uvicorn --collect-submodules keyring --collect-all winpty formmorpheus_engine.py || ( echo [formmorpheus] error: freezing the engine failed 1>&2 & exit /b 1 )
if exist "%ROOT%\src-tauri\engine" rmdir /s /q "%ROOT%\src-tauri\engine"
xcopy /e /i /q /y dist-engine\formmorpheus-engine "%ROOT%\src-tauri\engine" >nul || ( echo [formmorpheus] error: copying the engine folder failed 1>&2 & exit /b 1 )
rem With --noconsole the self check prints nothing; its exit code is the result.
"%ROOT%\src-tauri\engine\formmorpheus-engine.exe" --selfcheck || ( echo [formmorpheus] error: the frozen engine failed its self check 1>&2 & exit /b 1 )
echo [formmorpheus] engine folder ready: %ROOT%\src-tauri\engine
