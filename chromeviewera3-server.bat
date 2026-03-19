@echo off
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File "ensure-chromeviewera3-services.ps1"
