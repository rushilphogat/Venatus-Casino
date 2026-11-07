@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.13 or newer is required.
  pause
  exit /b 1
)
if not exist "node_modules\ws\package.json" (
  echo Installing the multiplayer dependency...
  call npm ci --no-fund --no-audit
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
echo Opening Venatus Casino. Keep this window open while playing.
set VENATUS_OPEN_BROWSER=1
node src/server.js
pause
