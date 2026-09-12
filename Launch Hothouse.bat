@echo off
title Hothouse - keep this window open. Close it to stop the app.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Hothouse needs Node.js to run, but it is not installed on this computer.
  echo.
  echo  Please install the current version of Node.js from:
  echo    https://nodejs.org/en/download
  echo  and then start Hothouse again.
  echo.
  start "" "https://nodejs.org/en/download"
  pause
  exit /b 1
)

node scripts\launcher.js
if errorlevel 1 pause
