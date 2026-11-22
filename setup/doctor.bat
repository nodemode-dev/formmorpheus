@echo off
setlocal
cd /d "%~dp0.."
set "FAIL=0"
if not defined FORMMORPHEUS_PORT set "FORMMORPHEUS_PORT=9494"
set "FMV="
for /f "tokens=2 delims='" %%v in ('findstr /b /c:"export const VERSION" frontend\src\version.ts 2^>nul') do set "FMV=%%v"
echo [formmorpheus] doctor - windows - %FMV%
set "NODEV="
for /f %%v in ('node -v 2^>nul') do set "NODEV=%%v"
node -e "const [m,n]=process.versions.node.split('.').map(Number);process.exit((m===20&&n>=19)||(m===22&&n>=12)||m>=23?0:1)" >nul 2>nul
if errorlevel 1 ( echo   FAIL   node - Node 20.19+ or 22.12+ is required & set "FAIL=1" ) else ( echo   ok     node %NODEV% )
call setup\find_python.bat >nul 2>nul
set "PYV="
if defined FM_PY for /f "tokens=2" %%v in ('%FM_PY% -V 2^>^&1') do set "PYV=%%v"
if defined FM_PY ( echo   ok     python %PYV% ) else ( echo   FAIL   python - Python 3.12+ is required & set "FAIL=1" )
if exist backend\venv\Scripts\activate.bat ( echo   ok     backend venv ) else ( echo   warn   backend venv - run formmorpheus.bat install )
if exist frontend\node_modules ( echo   ok     frontend node_modules ) else ( echo   warn   frontend deps - run formmorpheus.bat install )
set "RUSTV="
where cargo >nul 2>nul && for /f "tokens=2" %%v in ('rustc --version 2^>nul') do set "RUSTV=%%v"
where cargo >nul 2>nul
if errorlevel 1 ( echo   warn   rust - desktop builds need https://rustup.rs ) else ( echo   ok     rust %RUSTV% for desktop builds )
for %%p in (5194 %FORMMORPHEUS_PORT%) do (
  netstat -ano | findstr /r /c:":%%p .*LISTENING" >nul
  if errorlevel 1 ( echo   ok     port %%p free ) else ( echo   warn   port %%p already in use )
)
if "%FAIL%"=="0" ( echo [formmorpheus] ready ) else ( echo [formmorpheus] fix the FAIL lines above )
exit /b %FAIL%
