@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Asenna Node.js 22 tai uudempi: https://nodejs.org/
  pause
  exit /b 1
)
node "%~dp0scripts\serve.mjs" --open
pause
