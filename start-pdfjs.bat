@echo off
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File "update-pdfjs.ps1" -Silent
powershell -WindowStyle Hidden -Command "Start-Process node -ArgumentList 'server.js' -WindowStyle Hidden"
timeout /t 1 /nobreak >nul
start "" "http://localhost:8080/web/viewer.html"
