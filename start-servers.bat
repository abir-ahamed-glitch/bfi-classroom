@echo off
:: BFI Classroom - Auto-start servers on Windows boot
:: This script is triggered by Windows Startup on login

cd /d "e:\Antigravity\Project 2 - BFI Classroom"

set "PM2_CMD=pm2"
where pm2 >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    set "PM2_CMD=%APPDATA%\npm\pm2"
)

:: Start or update processes from ecosystem config
call %PM2_CMD% start ecosystem.config.cjs

:: Save the state
call %PM2_CMD% save

exit 0
