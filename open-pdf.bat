@echo off
powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0open-pdf.ps1" "%~1"
