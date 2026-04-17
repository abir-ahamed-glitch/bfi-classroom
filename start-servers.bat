@echo off
:: BFI Classroom - Auto-start servers on Windows boot
:: This script is triggered by Windows Task Scheduler on login

cd /d "e:\Antigravity\Project 2 - BFI Classroom"

:: Start PM2 with saved processes (restores bfi-classroom-backend and bfi-classroom-frontend)
pm2 resurrect

:: If resurrect fails (first time), start fresh from ecosystem config
if %ERRORLEVEL% NEQ 0 (
    pm2 start ecosystem.config.cjs
)

:: Save the state
pm2 save

exit 0
