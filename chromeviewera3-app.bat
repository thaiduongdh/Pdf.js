@echo off
:: Start ChromeViewerA3 if needed, then open Chrome app mode.
cd /d "%~dp0"
set "APP_URL=http://localhost:8080/web/start.html"

powershell -ExecutionPolicy Bypass -File "ensure-chromeviewera3-services.ps1"

set "APP_BROWSER="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "APP_BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined APP_BROWSER if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "APP_BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined APP_BROWSER if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "APP_BROWSER=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not defined APP_BROWSER if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "APP_BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined APP_BROWSER if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "APP_BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"

if defined APP_BROWSER (
    start "" "%APP_BROWSER%" --app=%APP_URL%
) else (
    start "" "%APP_URL%"
)
