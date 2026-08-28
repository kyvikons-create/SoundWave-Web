@echo off
chcp 65001 >nul
title SoundWave
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Для работы нужен Node.js. Скачайте с https://nodejs.org и установите.
  pause
  exit /b 1
)
node server.js
pause
