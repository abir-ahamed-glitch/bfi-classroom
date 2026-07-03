@echo off
:: BFI Classroom - Restart PM2 servers
cd /d "%~dp0"

set "PM2_CMD=pm2"
where pm2 >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    set "PM2_CMD=%APPDATA%\npm\pm2"
)

echo Restarting all PM2 backend and frontend servers to load new code...
call %PM2_CMD% restart all

echo PM2 servers restarted successfully!
pause
