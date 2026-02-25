@echo off
:: Start server if not running, then open Chrome app
cd /d "%~dp0"

:: Check if server is already running
powershell -Command "try { (Invoke-WebRequest -Uri 'http://localhost:8080' -TimeoutSec 1 -UseBasicParsing).StatusCode } catch { exit 1 }" >nul 2>&1
if %errorlevel% neq 0 (
    start /min "" cmd /c "node server.js"
    timeout /t 1 /nobreak >nul
)

:: Open Chrome in app mode
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --app=http://localhost:8080/web/viewer.html
