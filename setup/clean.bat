@echo off
setlocal
cd /d "%~dp0.."
for %%d in (frontend\dist src-tauri\target src-tauri\engine backend\build backend\dist) do if exist %%d rmdir /s /q %%d
del /q src-tauri\binaries\formmorpheus-engine-* 2>nul
if /i "%~1"=="--all" (
  if exist backend\venv rmdir /s /q backend\venv
  if exist frontend\node_modules rmdir /s /q frontend\node_modules
)
echo [formmorpheus] clean
