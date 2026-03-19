@echo off
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File "update-pdfjs.ps1" -Silent
powershell -ExecutionPolicy Bypass -File "ensure-chromeviewera3-services.ps1"
start "" "http://localhost:8080/web/start.html"
