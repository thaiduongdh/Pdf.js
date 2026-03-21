@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "update-pdfjs.ps1" -Silent
if exist "%~dp0chromeviewera3-app.vbs" (
    wscript.exe "%~dp0chromeviewera3-app.vbs"
) else (
    powershell -NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0chromeviewera3-app.ps1"
)
